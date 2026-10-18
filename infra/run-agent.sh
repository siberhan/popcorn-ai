#!/bin/bash
# Lambda Web Adapter entry: start the agent service on the port the adapter forwards to.
# Dependencies come from the deps layer, mounted at /opt/python.
export PYTHONPATH="/opt/python${PYTHONPATH:+:$PYTHONPATH}"
exec python -c "from popcorn_agent.server import main; main()"
