"""OpenRouter text to speech (ElevenLabs Flash v2.5, MP3). The service caches the audio in the store.

Flash takes a whole reply in one call and answers in about two seconds, so there is no splitting.
"""

import httpx

BASE = "https://openrouter.ai/api/v1"


class OpenRouterTTS:
    ext, content_type = "mp3", "audio/mpeg"

    def __init__(self, api_key: str, model: str = "elevenlabs/eleven-flash-v2.5", voice: str = "sarah",
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = api_key
        self.engine = model  # cache key part
        self.voice = voice
        self._transport = transport

    async def synthesize(self, text: str) -> bytes:
        body = {"model": self.engine, "input": " ".join(text.split()), "voice": self.voice, "response_format": "mp3"}
        async with httpx.AsyncClient(base_url=BASE, headers={"Authorization": f"Bearer {self._key}"},
                                     timeout=25, transport=self._transport) as client:
            response = await client.post("/audio/speech", json=body)
        response.raise_for_status()
        return response.content
