#!/usr/bin/env bash
set -euo pipefail

HOST="${SYSLOG_HOST:-127.0.0.1}"
PORT="${SYSLOG_PORT:-514}"
PROTO=udp
FILES=()
BRUTE=false
KEEP_TIMESTAMPS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tcp)   PROTO=tcp; shift ;;
    --udp)   PROTO=udp; shift ;;
    --host)  HOST="$2"; shift 2 ;;
    --port)  PORT="$2"; shift 2 ;;
    --file)  FILES+=("$2"); shift 2 ;;
    --brute) BRUTE=true; shift ;;
    --keep-timestamps) KEEP_TIMESTAMPS=true; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")"

if [[ ${#FILES[@]} -eq 0 ]]; then
  FILES=(firewall_syslog.log network_syslog.log)
fi

send() {
  local line="$1"
  if command -v nc >/dev/null 2>&1; then
    if [[ "$PROTO" == udp ]]; then
      printf '%s' "$line" | nc -u -w1 "$HOST" "$PORT"
    else
      printf '%s\n' "$line" | nc -w1 "$HOST" "$PORT"
    fi
  elif command -v node >/dev/null 2>&1; then
    PROTO="$PROTO" HOST="$HOST" PORT="$PORT" LINE="$line" node -e '
      const { PROTO, HOST, PORT, LINE } = process.env;
      if (PROTO === "udp") {
        const s = require("dgram").createSocket("udp4");
        s.send(Buffer.from(LINE), Number(PORT), HOST, () => s.close());
      } else {
        const s = require("net").createConnection(Number(PORT), HOST, () => {
          s.end(LINE + "\n");
        });
        s.on("error", (e) => { console.error(e.message); process.exit(1); });
      }
    '
  else
    echo "need either nc or node to send syslog" >&2
    exit 1
  fi
}

retime() {
  local line="$1"
  local rfc3164 date_part time_part
  rfc3164=$(date -u '+%b %e %H:%M:%S')
  date_part=$(date -u '+%Y-%m-%d')
  time_part=$(date -u '+%H:%M:%S')

  line=$(printf '%s' "$line" | sed -E "s/^(<[0-9]+>)[A-Z][a-z]{2}[[:space:]]+[0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2}/\1${rfc3164}/")
  line=$(printf '%s' "$line" | sed -E "s/date=[0-9]{4}-[0-9]{2}-[0-9]{2}/date=${date_part}/; s/time=[0-9]{2}:[0-9]{2}:[0-9]{2}/time=${time_part}/")
  printf '%s' "$line"
}

count=0

if [[ "$BRUTE" == true ]]; then
  echo "sending 12 failed logins from 203.0.113.66 over $PROTO://$HOST:$PORT"
  for i in $(seq 1 12); do
    stamp=$(date -u '+%b %e %H:%M:%S')
    send "<38>${stamp} web-01 sshd[900${i}]: Failed password for invalid user admin from 203.0.113.66 port 5234${i} ssh2"
    count=$((count + 1))
    sleep 0.2
  done
else
  for file in "${FILES[@]}"; do
    echo "sending $file over $PROTO://$HOST:$PORT"
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      if [[ "$KEEP_TIMESTAMPS" == false ]]; then
        line=$(retime "$line")
      fi
      send "$line"
      count=$((count + 1))
      sleep 0.1
    done < "$file"
  done
fi

echo "sent $count line(s)"
echo "check the Search page, or: curl -b cookies.txt 'http://localhost:8081/api/events?limit=10'"
