import logging
from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel
import hashlib # 追加
import json # 追加

# ロガーの設定
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Pydanticモデル定義 ---
class HistoryItem(BaseModel):
    problem_id: str
    subject: str
    selected_answer: str
    is_correct: bool
    answered_at: datetime # タイムゾーン情報はここでは扱わない (main.pyで処理)
    category: str | None = None

class ProblemStudyStatus(BaseModel):
    problem_id: str
    last_answered_at: Optional[datetime] = None
    last_correct_at: Optional[datetime] = None
    total_answers: int = 0
    correct_answers: int = 0
    incorrect_answers: int = 0
    current_streak: int = 0
    max_streak: int = 0

def normalize_question(question: dict) -> dict | None:
    """
    単一の質問オブジェクトを検証し、フロントエンドが期待する形式に正規化する。
    - 'choices'がdictなら、{"label": key, "text": value} の配列に変換する。
    - 'choices'が文字列のリストなら、{"label": index+1, "text": value} の配列に変換する。
    - 'explanation'が文字列なら、{"text": value, "images": []} の辞書に変換する。
    - 必須キーが不足している、または'choices'が不正な場合はNoneを返す。
    """
    required_keys = ["question_text", "choices", "answer"]
    if not all(key in question for key in required_keys):
        logger.warning(f"Skipping question due to missing required keys: {question}")
        return None

    choices = question.get("choices")

    if isinstance(choices, dict):
        question["choices"] = [{"label": k, "text": v} for k, v in choices.items()]
    elif isinstance(choices, list):
        valid_choices = []
        is_string_list = all(isinstance(c, str) for c in choices)

        if is_string_list:
            # 文字列のリストの場合、自動的にlabelを付与
            valid_choices = [{"label": str(i+1), "text": choice} for i, choice in enumerate(choices)]
        else:
            # オブジェクトのリストの場合、形式を検証
            for choice in choices:
                if isinstance(choice, dict) and "label" in choice and "text" in choice:
                    valid_choices.append(choice)
                else:
                    logger.warning(f"Invalid choice format in list for question: {question}. Skipping this choice: {choice}")
        
        if not valid_choices:
            logger.warning(f"No valid choices found in list for question: {question}. Skipping question.")
            return None
        question["choices"] = valid_choices
    else:
        logger.warning(f"Skipping question due to invalid 'choices' format: {question}")
        return None

    # 'explanation' を正規化
    explanation = question.get("explanation")
    if isinstance(explanation, str):
        # 文字列の場合はオブジェクトに変換
        question["explanation"] = {"text": explanation, "images": []}
    elif explanation is None:
        # キーが存在しない場合は空のオブジェクトを作成
        question["explanation"] = {"text": "", "images": []}
    # オブジェクトの場合はそのまま（ただし、text/imagesキーの存在を保証する方がより堅牢）
    elif isinstance(explanation, dict):
        if "text" not in explanation:
            explanation["text"] = ""
        if "images" not in explanation:
            explanation["images"] = []
        
    # 'id'キーが存在しない場合に備え、ハッシュで生成
    if "id" not in question:
        # 質問のコンテンツから一意なIDを生成
        content_for_hash = {
            "question_text": question.get("question_text"),
            "choices": question.get("choices"),
            "answer": question.get("answer")
        }
        canonical_string = json.dumps(content_for_hash, sort_keys=True, ensure_ascii=False)
        question["id"] = hashlib.sha256(canonical_string.encode('utf-8')).hexdigest()

    return question

def get_problem_study_statuses(history_items: List[HistoryItem]) -> Dict[str, ProblemStudyStatus]:
    """
    回答履歴アイテムのリストから、問題ごとの学習状況を計算して返す。
    """
    problem_statuses: Dict[str, ProblemStudyStatus] = {}

    # 回答履歴をproblem_idとanswered_atでソート
    # 同じproblem_idであっても、answered_atの昇順に処理することでstreakを正しく計算できる
    history_items.sort(key=lambda x: x.answered_at)

    for item in history_items:
        if item.problem_id not in problem_statuses:
            problem_statuses[item.problem_id] = ProblemStudyStatus(problem_id=item.problem_id)
        
        status = problem_statuses[item.problem_id]
        status.total_answers += 1
        status.last_answered_at = item.answered_at

        if item.is_correct:
            status.correct_answers += 1
            status.last_correct_at = item.answered_at
            status.current_streak += 1
            status.max_streak = max(status.max_streak, status.current_streak)
        else:
            status.incorrect_answers += 1
            status.current_streak = 0 # 不正解で連続正解はリセット

    return problem_statuses

def calculate_review_priority(status: ProblemStudyStatus, current_time: datetime) -> float:
    """
    問題の学習状況と現在の時刻に基づき、復習優先度スコアを計算する。
    スコアが高いほど復習の優先度が高い。
    """
    priority = 0.0

    # 1. 最後に正解した日時からの経過時間
    if status.last_correct_at:
        time_since_last_correct = (current_time - status.last_correct_at).total_seconds()
        priority += time_since_last_correct / (24 * 3600)  # 日数で加算

    # 2. 不正解回数が多いほど優先度が高い
    priority += status.incorrect_answers * 2 # 不正解を強く意識

    # 3. 正解率が低いほど優先度が高い (ただし、解答回数が少ない場合は影響を小さくする)
    if status.total_answers > 0:
        correct_rate = status.correct_answers / status.total_answers
        priority += (1 - correct_rate) * 5 # 正解率が低いほど加点

    # 4. 連続正解数が多いほど優先度が低い (より確実な知識と見なすため)
    priority -= status.current_streak * 0.5 # 連続正解で減点

    # まだ一度も正解していない問題は非常に優先度を高くする
    if status.total_answers > 0 and status.correct_answers == 0:
        priority += 10.0 # 強力な加点

    # まだ一度も解答していない問題は、他の問題と同等か少し低めの優先度にする
    if status.total_answers == 0:
        priority += 0.1 # ベースラインの優先度

    return max(0.0, priority) # 優先度が負にならないようにする
