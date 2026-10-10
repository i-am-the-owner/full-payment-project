#!/bin/sh
# Exit 0 only if the API is alive AND ready. For cron, Nagios, a CI schedule or any
# monitor that runs a command.   ./scripts/uptime-check.sh https://api.example.com
set -eu
base="${1:?Usage: uptime-check.sh <base-url>}"
curl -fsS --max-time 10 "$base/healthz" > /dev/null || { echo "DOWN: $base/healthz failed" >&2; exit 1; }
curl -fsS --max-time 10 "$base/readyz" > /dev/null || { echo "NOT READY: $base/readyz failed (database?)" >&2; exit 2; }
echo "OK: $base is up and ready"
