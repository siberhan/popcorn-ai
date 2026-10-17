"""Polly speech synthesis client for voice output."""

import logging
import os
import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)


class PollyValidationError(Exception):
    """Raised when the text parameter fails validation (e.g. empty or too long)."""


class PollyServiceError(Exception):
    """Raised when Amazon Polly synthesis fails."""


class PollySpeaker:
    """Manages Polly voice synthesis with configurable engine."""

    def __init__(
        self,
        region: str = "eu-north-1",
        profile: str | None = "popcorn",
        default_voice: str = "Brian",
        engine: str = "standard",
    ):
        self.region = region
        self.default_voice = default_voice
        self.engine = engine
        # Create boto3 session and Polly client once
        # Note: If running inside Lambda, profile_name should not be forced if not configured.
        session_kwargs = {"region_name": region}
        if profile and not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
            session_kwargs["profile_name"] = profile

        self._session = boto3.Session(**session_kwargs)
        self._client = self._session.client("polly")

    def synthesize(self, text: str, voice: str | None = None) -> tuple[bytes, str, str]:
        """Synthesize text to MP3 audio bytes.

        Returns:
            tuple of (audio_bytes, voice_id_used, engine_used)
        """
        stripped = text.strip() if text else ""
        if not stripped:
            raise PollyValidationError("Text must not be empty.")
        if len(stripped) > 1500:
            raise PollyValidationError(
                f"Text length ({len(stripped)} characters) exceeds maximum allowed 1500 characters."
            )

        voice_id = voice or self.default_voice

        try:
            response = self._client.synthesize_speech(
                Engine=self.engine,
                VoiceId=voice_id,
                OutputFormat="mp3",
                Text=stripped,
            )
            audio_stream = response.get("AudioStream")
            if not audio_stream:
                raise PollyServiceError("Polly returned empty audio stream.")
            return audio_stream.read(), voice_id, self.engine
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            error_message = exc.response.get("Error", {}).get("Message", "")
            logger.error("Polly ClientError during synthesize_speech: %s: %s", error_code, error_message)
            raise PollyServiceError("Failed to synthesize speech via Amazon Polly.") from exc
        except BotoCoreError as exc:
            logger.error("Polly BotoCoreError: %s", exc)
            raise PollyServiceError("Polly service communication error.") from exc

