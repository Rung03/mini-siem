#!/usr/bin/env bash
#
# Sends the sample syslog lines to the collector over UDP (default) or TCP.
#
#   ./send_syslog.sh                         # firewall + network samples, UDP
#   ./send_syslog.sh --tcp                   # same, over TCP with LF framing
#   ./send_syslog.sh --host 10.0.0.5 --port 514
#   ./send_syslog.sh --file firewall_syslog.log
#   ./send_syslog.sh --brute                 # a burst that trips the alert rule
#   ./send_syslog.sh --keep-timestamps       # send the lines exactly as written
#
# The sample lines carry fixed August dates, which fall outside both the
# default dashboard window and the 7-day retention horizon. By default their
# timestamps are rewritten to now so the lines actually show up; pass
# --keep-timestamps to send them verbatim.
#
# The sending address has to match a syslog collector's CIDR, otherwise the
# line is recorded under Administration > Storage > Rejected ingest rather than
# stored. `make seed` creates one covering the Docker bridge for this reason.
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

# nc is not on every machine (Git Bash on Windows has none), so fall back to a
# tiny Node sender. One of the two is essentially always present.
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

# Rewrites whichever timestamp form the line uses to the current time.
retime() {
  local line="$1"
  local rfc3164 date_part time_part
  rfc3164=$(date -u '+%b %e %H:%M:%S')
  date_part=$(date -u '+%Y-%m-%d')
  time_part=$(date -u '+%H:%M:%S')

  # <134>Aug 20 12:44:56 host ...
  line=$(printf '%s' "$line" | sed -E "s/^(<[0-9]+>)[A-Z][a-z]{2}[[:space:]]+[0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2}/\1${rfc3164}/")
  # date=2026-09-12 time=09:14:22
  line=$(printf '%s' "$line" | sed -E "s/date=[0-9]{4}-[0-9]{2}-[0-9]{2}/date=${date_part}/; s/time=[0-9]{2}:[0-9]{2}:[0-9]{2}/time=${time_part}/")
  printf '%s' "$line"
}

count=0

if [[ "$BRUTE" == true ]]; then
  # Twelve failures from one address inside a minute. The seeded rule fires on
  # five within five minutes, so this raises an alert on the next 30s cycle.
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
