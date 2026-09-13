#!/bin/sh
# สร้างใบรับรอง self-signed ตอน container เริ่ม ถ้ายังไม่มี
set -e

CERT_DIR=/etc/nginx/certs
CN="${TLS_CN:-localhost}"

if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
  echo "[tls] using the certificate already present in $CERT_DIR"
  exit 0
fi

mkdir -p "$CERT_DIR"
echo "[tls] generating a self-signed certificate for CN=$CN (valid 825 days)"

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -days 825 \
  -subj "/C=TH/O=Mini SIEM/CN=$CN" \
  -addext "subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1" \
  2>/dev/null

chmod 600 "$CERT_DIR/server.key"
echo "[tls] certificate ready"
