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
    openrouter_api_key: str
    openrouter_model: str
    mcp_url: str
    aws_region: str
    aws_profile: str
    polly_voice: str
    polly_engine: str
    host: str
    port: int


def load_settings() -> Settings:
    _load_dotenv()
    return Settings(
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        openrouter_model=os.environ.get("OPENROUTER_MODEL", "openai/gpt-6-luna"),
        mcp_url=os.environ.get("MCP_URL", "http://127.0.0.1:8000/mcp"),
        aws_region=os.environ.get("AWS_REGION", "eu-north-1"),
        aws_profile=os.environ.get("AWS_PROFILE", "popcorn"),
        polly_voice=os.environ.get("POLLY_VOICE", "Brian"),
        polly_engine=os.environ.get("POLLY_ENGINE", "standard"),
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8100")),
    )

