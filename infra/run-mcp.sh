#!/bin/bash
# Lambda Web Adapter entry: start the MCP server on the port the adapter forwards to.
exec python -c "from popcorn_mcp.server import main; main()"
