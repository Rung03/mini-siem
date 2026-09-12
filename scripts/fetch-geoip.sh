#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

WITH_ASN=false
[[ "${1:-}" == "--with-asn" ]] && WITH_ASN=true

DEST=./geoip
mkdir -p "$DEST"

months=("$(date -u +%Y-%m)" "$(date -u -d '1 month ago' +%Y-%m 2>/dev/null || date -u -v-1m +%Y-%m 2>/dev/null || echo '')")

fetch() {
  local kind="$1" out="$2"
  for month in "${months[@]}"; do
    [[ -z "$month" ]] && continue
    local url="https://download.db-ip.com/free/dbip-${kind}-lite-${month}.mmdb.gz"
    echo "trying $url"
    if curl -fsSL --retry 2 -o "$out.gz" "$url"; then
      gunzip -f "$out.gz"
      echo "  -> $out ($(du -h "$out" | cut -f1))"
      return 0
    fi
  done
  echo "could not download the $kind database for ${months[*]}" >&2
  return 1
}

fetch city "$DEST/dbip-city-lite.mmdb"
if [[ "$WITH_ASN" == true ]]; then
  fetch asn "$DEST/dbip-asn-lite.mmdb" || echo "continuing without ASN data"
fi

cat <<EOF

Done. Restart the backend so it picks the database up:

  docker compose up -d --force-recreate backend

Attribution (required by CC-BY 4.0):
  IP geolocation data by DB-IP — https://db-ip.com
EOF
