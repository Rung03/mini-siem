#!/usr/bin/env python3
"""Posts the sample JSON payloads to the HTTP ingest endpoint.

    python post_logs.py --token sk_xxx                 # every JSON sample
    python post_logs.py --token sk_xxx --file m365_audit.json
    python post_logs.py --token sk_xxx --url https://siem.example.com/ingest
    python post_logs.py --token sk_xxx --insecure      # self-signed TLS
    python post_logs.py --token sk_xxx --simulate 200  # generated login traffic
    python post_logs.py --token sk_xxx --keep-timestamps

By default the timestamps in the sample files are rewritten to the last few
minutes. The files carry fixed 2025 dates, which are outside both the default
dashboard window and the 7-day retention horizon, so sending them verbatim
stores events that nothing will ever show. Pass --keep-timestamps to send the
files exactly as they are on disk.

The collector the token belongs to decides both the tenant and which parser
reads the payload, so send a file to a token whose source type matches it. A
tenant named inside the payload is recorded but never used for routing.

Standard library only — no pip install needed.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent

DEFAULT_FILES = [
    "api_login.json",
    "crowdstrike.json",
    "aws_cloudtrail.json",
    "m365_audit.json",
    "windows_ad.json",
]

USERS = ["alice", "bob", "carol", "dave", "eve", "admin", "svc_backup"]
IPS = ["203.0.113.7", "203.0.113.44", "198.51.100.23", "10.0.1.10", "192.0.2.31"]


# Every spelling of "when did this happen" across the sample files.
TIME_FIELDS = ("@timestamp", "eventTime", "CreationTime", "TimeCreated", "timestamp")


def retime(value, base: datetime, counter: list[int]):
    """Walks the payload and moves any timestamp it finds close to `base`."""
    if isinstance(value, list):
        return [retime(v, base, counter) for v in value]
    if isinstance(value, dict):
        out = {}
        for key, inner in value.items():
            if key in TIME_FIELDS and isinstance(inner, str):
                counter[0] += 1
                stamp = base - timedelta(seconds=counter[0] * 7)
                # Microsoft writes audit times without a zone; keep that shape.
                out[key] = (
                    stamp.strftime("%Y-%m-%dT%H:%M:%S")
                    if key in ("CreationTime",)
                    else stamp.isoformat().replace("+00:00", "Z")
                )
            else:
                out[key] = retime(inner, base, counter)
        return out
    return value


def post(url: str, token: str, body: bytes, insecure: bool) -> dict:
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    context = None
    if url.startswith("https://") and insecure:
        # The SaaS profile ships a self-signed certificate by default; the
        # assignment allows that, so make it usable without extra setup.
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(request, timeout=30, context=context) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")
        raise SystemExit(f"HTTP {err.code} from {url}: {detail}") from err
    except urllib.error.URLError as err:
        raise SystemExit(f"could not reach {url}: {err.reason}") from err


def simulate(count: int) -> bytes:
    """Generates `count` login events as NDJSON in the common envelope shape."""
    now = datetime.now(timezone.utc)
    lines = []
    for i in range(count):
        ok = random.random() > 0.2
        stamp = now - timedelta(seconds=random.randint(0, 3600))
        lines.append(
            json.dumps(
                {
                    "source": "api",
                    "event_type": "app_login_succeeded" if ok else "app_login_failed",
                    "user": random.choice(USERS),
                    "ip": random.choice(IPS),
                    "status": "Success" if ok else "Failed",
                    "severity": 2 if ok else 6,
                    "@timestamp": stamp.isoformat().replace("+00:00", "Z"),
                    **({} if ok else {"reason": "wrong_password"}),
                }
            )
        )
    return "\n".join(lines).encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        default=os.environ.get("INGEST_URL", "http://localhost:8081/ingest"),
        help="ingest endpoint (default: http://localhost:8081/ingest)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("INGEST_TOKEN"),
        help="collector bearer token, or set INGEST_TOKEN",
    )
    parser.add_argument("--file", action="append", dest="files", help="sample file to send")
    parser.add_argument("--insecure", action="store_true", help="skip TLS verification")
    parser.add_argument(
        "--keep-timestamps",
        action="store_true",
        help="send the sample files verbatim instead of retiming them to now",
    )
    parser.add_argument(
        "--simulate",
        type=int,
        metavar="N",
        help="send N generated login events instead of the sample files",
    )
    args = parser.parse_args()

    if not args.token:
        parser.error("a collector token is required (--token or INGEST_TOKEN)")

    if args.simulate:
        result = post(args.url, args.token, simulate(args.simulate), args.insecure)
        print(f"simulated {args.simulate} events -> {result}")
        return 0

    files = args.files or DEFAULT_FILES
    total = 0
    for name in files:
        path = Path(name)
        if not path.is_absolute() and not path.exists():
            path = HERE / name
        if not path.exists():
            print(f"skipping {name}: not found", file=sys.stderr)
            continue

        body = path.read_bytes()
        if not args.keep_timestamps:
            try:
                payload = json.loads(body.decode("utf-8"))
                body = json.dumps(
                    retime(payload, datetime.now(timezone.utc), [0])
                ).encode("utf-8")
            except json.JSONDecodeError:
                pass  # NDJSON or plain text: send as-is

        result = post(args.url, args.token, body, args.insecure)
        accepted = result.get("accepted", 0)
        total += accepted
        print(f"{path.name}: {accepted} accepted, {result.get('unparsed', 0)} unparsed")

    print(f"\n{total} event(s) accepted in total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
