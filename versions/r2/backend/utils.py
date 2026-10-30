import logging

# ロガーの設定
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def normalize_question(question: dict) -> dict | None:
    """
    単一の質問オブジェクトを検証し、フロントエンドが期待する形式に正規化する。
    - 'choices'がdictなら、{"label": key, "text": value} の配列に変換する。
    - 必須キーが不足している、または'choices'が不正な場合はNoneを返す。
    """
    required_keys = ["question_text", "choices", "answer"]
    if not all(key in question for key in required_keys):
        logger.warning(f"Skipping question due to missing required keys: {question}")
        return None

    choices = question.get("choices")

    if isinstance(choices, dict):
        # choicesが辞書形式の場合、配列形式に変換
        question["choices"] = [{"label": k, "text": v} for k, v in choices.items()]
    elif isinstance(choices, list):
        # 既に配列だが、中身が不正なケースを考慮（例：文字列のリスト）
        # より堅牢にする場合は、ここでも各要素の型チェックを行う
        valid_choices = []
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
        # choicesが辞書でも配列でもない場合、この質問は不正とみなす
        logger.warning(f"Skipping question due to invalid 'choices' format: {question}")
        return None

    # 'explanation'キーが存在しない場合に備えて、空文字列をセット
    if "explanation" not in question:
        question["explanation"] = ""
        
    # 'id'キーが存在しない場合に備える
    if "id" not in question:
        question["id"] = "unknown"

    return question
