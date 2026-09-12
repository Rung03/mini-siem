#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose"
APPLIANCE="docker compose -f docker-compose.yml -f docker-compose.appliance.yml"

case "${1:-up}" in
  down)  $COMPOSE down; exit 0 ;;
  clean) $COMPOSE down -v; exit 0 ;;
  appliance) RUNNER="$APPLIANCE" ;;
  up)    RUNNER="$COMPOSE" ;;
  *) echo "usage: $0 [up|appliance|down|clean]" >&2; exit 2 ;;
esac

if [ ! -f .env ]; then
  cp .env.saas.example .env
  echo "created .env from .env.saas.example — edit the passwords before a real deployment"
fi

echo "building and starting..."
$RUNNER up -d --build

echo "waiting for the API..."
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:8081/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "loading demo data..."
$RUNNER exec -T backend npm run seed:prod

cat <<'EOF'

Ready.

  http://localhost:8081      plain
  https://localhost:8443     TLS (self-signed — your browser will warn once)

  admin@siem.local          / demo-password-change-me   (Admin, all tenants)
  viewer@northwind.local    / demo-password-change-me   (Viewer, one tenant)
EOF
