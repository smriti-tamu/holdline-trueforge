#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "${WORKSPACE_ROOT:-$SCRIPT_DIR}"
DEV_UP=0
BRIDGE_UP=0
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  DEV_UP=1
fi
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8000/health; then
  BRIDGE_UP=1
fi
if [ "$DEV_UP" -eq 1 ] && [ "$BRIDGE_UP" -eq 1 ]; then
  exit 0
fi
if [ "$DEV_UP" -ne 1 ]; then
  nohup npm run dev >>"${TMPDIR:-/tmp}/app-startup.log" 2>&1 </dev/null &
fi
if [ "$BRIDGE_UP" -ne 1 ]; then
  nohup npm run mcp:incident-monitoring:http >>"${TMPDIR:-/tmp}/app-startup.log" 2>&1 </dev/null &
fi
