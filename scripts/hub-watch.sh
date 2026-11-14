#!/bin/bash
# Keeps the longcon hub agent (laptop -> near-longcon.nearbuild.workers.dev WebSocket) running; checks every 30 s.
cd /Users/kamal/near-build/longcon || exit 1
mkdir -p /tmp/lc-tunnel
while :; do
  if ! pgrep -f "bun scripts/hub-agent.ts" >/dev/null; then
    echo "$(date '+%F %T') hub agent down, restarting" >> /tmp/lc-tunnel/watch.log
    HUB_SECRET=$(cat ~/.config/longcon/hub-secret) nohup caffeinate -is bun scripts/hub-agent.ts >> /tmp/lc-tunnel/agent.log 2>&1 &
  fi
  sleep 30
done
