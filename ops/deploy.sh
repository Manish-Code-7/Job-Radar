#!/usr/bin/env bash
# Deploy / update Job Radar on the server from your Mac.
#   ops/deploy.sh <host-ip> <path-to-ssh-key.pem> [--with-tunnel | --quick-tunnel]
# Copies .env over SSH (never via git), pulls main, rebuilds and restarts the stack.
set -euo pipefail
HOST="${1:?server IP}"; KEY="${2:?ssh key .pem}"; TUNNEL="${3:-}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$HOST")
cd "$(dirname "$0")/.."

echo "→ waiting for first-boot setup"
"${SSH[@]}" 'for i in $(seq 1 60); do test -f ~/.bootstrap-done && exit 0; sleep 5; done; echo "bootstrap not finished"; exit 1'

echo "→ copying .env (server copy is chmod 600)"
scp -i "$KEY" -q .env "ubuntu@$HOST:job-radar/.env"
"${SSH[@]}" 'chmod 600 ~/job-radar/.env && (grep -q "^BROWSER_CONCURRENCY=" ~/job-radar/.env || echo "BROWSER_CONCURRENCY=1" >> ~/job-radar/.env)'

PROFILES=""
[ "$TUNNEL" = "--with-tunnel" ] && PROFILES="--profile tunnel"
[ "$TUNNEL" = "--quick-tunnel" ] && PROFILES="--profile quicktunnel"

echo "→ pulling code and (re)starting"
"${SSH[@]}" "cd ~/job-radar && git fetch -q && git reset -q --hard origin/main && \
  export PLATFORM=linux/arm64 && \
  docker compose build web && docker compose build worker && docker compose build migrate && docker compose build backup && \
  docker compose $PROFILES up -d --remove-orphans && \
  docker image prune -f >/dev/null && docker compose ps --format '{{.Service}}: {{.Status}}'"
echo "✓ deployed"
