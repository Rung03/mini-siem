#!/usr/bin/env bash
#
# Downloads the DB-IP Lite GeoIP databases into ./geoip/.
#
#   ./scripts/fetch-geoip.sh            # city database (country, city, lat/lon)
#   ./scripts/fetch-geoip.sh --with-asn # also the ASN database (asn, as_org)
#
# The files are not committed: the city database is tens of megabytes, and
# CC-BY 4.0 asks for attribution rather than silent redistribution.
#
#   Data from DB-IP (https://db-ip.com) — Creative Commons Attribution 4.0.
#
# Nothing here is required. With no database present the system runs exactly as
# before and the geo columns stay null, which is the normal state on an
# air-gapped appliance. Copy ./geoip/ across by hand if you want geo there.
set -euo pipefail
cd "$(dirname "$0")/.."

WITH_ASN=false
[[ "${1:-}" == "--with-asn" ]] && WITH_ASN=true

DEST=./geoip
mkdir -p "$DEST"

# DB-IP publishes one file per month and removes old ones, so early in a new
# month the current month may not exist yet. Try this month, then last month.
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
