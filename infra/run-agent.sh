#!/bin/bash
# Lambda Web Adapter entry: start the agent service on the port the adapter forwards to.
exec python -c "from popcorn_agent.server import main; main()"
