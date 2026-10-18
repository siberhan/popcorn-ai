"""Settings from environment variables.

When running locally (not on Lambda), the repo's .env file is loaded first.
Values already in the environment win over .env.
"""

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv() -> None:
    if os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return
    for parent in Path(__file__).resolve().parents:
        env_file = parent / ".env"
        if env_file.is_file():
            for line in env_file.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())
            return


@dataclass(frozen=True)
class Settings:
    tmdb_token: str
    table_name: str  # empty: in-memory store (local dev and tests)
    household: str
    region: str
    watch_region: str  # where-to-watch country, ISO 3166-1
    openrouter_api_key: str  # empty: no spoken audio, TV shows captions only
    tts_model: str
    tts_voice: str
    stt_model: str


def load_settings() -> Settings:
    _load_dotenv()
    return Settings(
        tmdb_token=os.environ.get("TMDB_API_READ_TOKEN", ""),
        table_name=os.environ.get("POPCORN_TABLE", ""),
        household=os.environ.get("POPCORN_HOUSEHOLD", "demo"),
        region=os.environ.get("AWS_REGION", "eu-north-1"),
        watch_region=os.environ.get("POPCORN_WATCH_REGION", "US").strip().upper() or "US",
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", "").strip(),
        tts_model=os.environ.get("POPCORN_TTS_MODEL", "elevenlabs/eleven-flash-v2.5").strip() or "elevenlabs/eleven-flash-v2.5",
        tts_voice=os.environ.get("POPCORN_TTS_VOICE", "sarah").strip() or "sarah",
        stt_model=os.environ.get("POPCORN_STT_MODEL", "openai/whisper-large-v3-turbo").strip() or "openai/whisper-large-v3-turbo",
    )
