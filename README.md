# Popcorn AI

An AI movie companion for the living room. It remembers what each family member likes,
finds the movies everyone on the couch will enjoy, and filters out unsafe picks when a child joins.

Built for the Build, Ship, Shape: Amazon Developer Hackathon — Fire TV (Vega OS) + Alexa+ (MCP) tracks,
AWS Builder mini challenge.

> Work in progress. Setup and run instructions will be added here.

## Parts

- `services/mcp/` — the Python MCP server: the TV's HTTP API, the LLM picks, speech, and the phone page.
- `apps/tv/` — the Fire TV (Vega) app. The remote drives every screen; voice is only used for the rating.
- `infra/deploy.py` — deploys the MCP server to AWS Lambda and seeds its duel catalog.

## Deploy

The MCP server runs on AWS Lambda (profile `popcorn`, Region `eu-north-1`), behind a public Function URL:

```bash
cd infra
uv run deploy.py deploy   # build and deploy, remove the v2 leftovers, seed the duel catalog
uv run deploy.py status   # the public URL and /health
uv run deploy.py reset    # forget the demo household (the duel catalog stays)
```

This product uses the TMDB API but is not endorsed or certified by TMDB.
