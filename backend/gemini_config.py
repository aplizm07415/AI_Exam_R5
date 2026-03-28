import os
from typing import Optional

try:
    import google.generativeai as genai
except ModuleNotFoundError:
    genai = None


GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# Default to the explicitly requested preview model.
DEFAULT_GEMINI_MODEL = os.getenv("GOOGLE_GENAI_MODEL", "gemini-3-flash-preview")

# Optional alias for automatic upgrades when the Flash "latest" alias is preferred.
LATEST_GEMINI_MODEL_ALIAS = os.getenv("GOOGLE_GENAI_LATEST_ALIAS", "gemini-flash-latest")
USE_LATEST_ALIAS = os.getenv("GOOGLE_GENAI_USE_LATEST_ALIAS", "false").lower() in {"1", "true", "yes", "on"}


if GOOGLE_API_KEY and genai is not None:
    genai.configure(api_key=GOOGLE_API_KEY)


def is_gemini_available() -> bool:
    return bool(GOOGLE_API_KEY) and genai is not None


def get_gemini_model_name() -> str:
    return LATEST_GEMINI_MODEL_ALIAS if USE_LATEST_ALIAS else DEFAULT_GEMINI_MODEL


def create_generative_model():
    if genai is None:
        raise RuntimeError("google-generativeai is not installed.")
    return genai.GenerativeModel(get_gemini_model_name())


def get_gemini_unavailable_reason() -> Optional[str]:
    if not GOOGLE_API_KEY:
        return "Google API Key is not configured."
    if genai is None:
        return "google-generativeai is not installed."
    return None
