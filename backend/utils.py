import logging

# ロガーの設定
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
        
    # 'id'キーが存在しない場合に備える
    if "id" not in question:
        question["id"] = "unknown"

    return question
