import importlib

import backend.gemini_config as gemini_config


def reload_gemini_config(monkeypatch, **env):
    for key in (
        "GOOGLE_API_KEY",
        "GOOGLE_GENAI_MODEL",
        "GOOGLE_GENAI_LATEST_ALIAS",
        "GOOGLE_GENAI_USE_LATEST_ALIAS",
    ):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return importlib.reload(gemini_config)


def test_default_gemini_model_uses_flash_latest(monkeypatch):
    config = reload_gemini_config(monkeypatch)

    assert config.get_gemini_model_name() == "gemini-flash-latest"


def test_google_genai_model_overrides_default(monkeypatch):
    config = reload_gemini_config(monkeypatch, GOOGLE_GENAI_MODEL="gemini-3-flash-preview")

    assert config.get_gemini_model_name() == "gemini-3-flash-preview"
