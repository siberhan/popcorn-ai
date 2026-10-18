"""OpenRouter speech to text (Whisper Large V3 Turbo). Raw audio in, plain text out."""

import httpx

from .voice_tts import BASE

MAX_BYTES = 10 * 1024 * 1024
NO_SPEECH = 0.6  # a segment above this chance of silence is dropped


class TranscribeError(Exception):
    """A problem to tell the person in plain words."""


def _extension(content_type: str) -> str:
    kind = content_type.split(";")[0].strip().lower()
    for key, ext in (("webm", "webm"), ("mp4", "mp4"), ("m4a", "m4a"), ("mpeg", "mp3"), ("mp3", "mp3"),
                     ("ogg", "ogg"), ("wav", "wav"), ("flac", "flac")):
        if key in kind:
            return ext
    return "webm"


def clean(result: dict) -> str:
    """Text of the segments that are speech. Noise-only recordings give an empty string."""
    segments = result.get("segments")
    if isinstance(segments, list) and segments:
        kept = [s for s in segments if (s.get("no_speech_prob") or 0) < NO_SPEECH]
        return " ".join(" ".join(str(s.get("text", "")).split()) for s in kept).strip()
    return " ".join(str(result.get("text", "")).split())


class OpenRouterSTT:
    def __init__(self, api_key: str, model: str = "openai/whisper-large-v3-turbo",
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = api_key
        self.model = model
        self._transport = transport

    async def transcribe(self, audio: bytes, content_type: str) -> str:
        if not audio:
            return ""
        files = {"file": (f"speech.{_extension(content_type)}", audio, content_type.split(";")[0] or "audio/webm")}
        data = {"model": self.model, "temperature": "0", "response_format": "verbose_json", "language": "en"}
        try:
            async with httpx.AsyncClient(base_url=BASE, headers={"Authorization": f"Bearer {self._key}"},
                                         timeout=30, transport=self._transport) as client:
                response = await client.post("/audio/transcriptions", data=data, files=files)
        except httpx.HTTPError as exc:
            raise TranscribeError("I couldn't reach the speech service. Try again.") from exc
        if response.status_code == 400:
            raise TranscribeError("I couldn't read that recording. Try again.")
        if response.status_code >= 400:
            raise TranscribeError("The speech service isn't answering right now. Try again.")
        return clean(response.json())
