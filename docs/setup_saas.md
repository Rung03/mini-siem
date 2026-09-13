# ติดตั้งแบบ SaaS / Cloud

รันบนคลาวด์ มี URL ให้เข้าใช้ผ่าน HTTPS

ใช้ **image และโค้ดชุดเดียวกันกับ appliance** ต่างกันแค่ไฟล์ตั้งค่า

## ความต้องการ

| | |
|---|---|
| VM | 4 vCPU, 8 GB RAM, 40 GB disk (Ubuntu 22.04+) |
| Security group | 443/tcp เปิดสาธารณะ · 514/udp+tcp เปิดเฉพาะ IP ของลูกค้าที่ส่ง log · 22/tcp เฉพาะ IP ผู้ดูแล |
| DNS | A record ชี้มาที่ VM เช่น `siem.example.com` |
| Software | Docker Engine 24+, Docker Compose v2 |

## 1. เตรียม VM

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker

git clone <repository-url> mini-siem
cd mini-siem
```

## 2. ตั้งค่า

```bash
cp .env.saas.example .env
```

แก้ค่าเหล่านี้

```
POSTGRES_PASSWORD=<สุ่ม>
OWNER_DB_PASSWORD=<สุ่ม>
APP_DB_PASSWORD=<สุ่ม>
ADMIN_DB_PASSWORD=<สุ่ม>
EVALUATOR_DB_PASSWORD=<สุ่ม>
SESSION_SECRET=<สุ่ม 32 ไบต์ขึ้นไป>

COOKIE_SECURE=true          # ต้องเป็น true เมื่อเสิร์ฟผ่าน https
TLS_CN=siem.example.com     # ชื่อโฮสต์จริง
WEB_TLS_PORT=443            # เสิร์ฟที่พอร์ตมาตรฐาน
DB_PUBLISH_PORT=0           # ไม่ต้อง publish ฐานข้อมูลออกนอก
```

สร้างค่าสุ่ม

```bash
openssl rand -base64 24     # รหัสผ่าน
openssl rand -base64 32     # SESSION_SECRET
```

## 3. ขึ้นระบบ

```bash
./run.sh
```

หรือ

```bash
docker compose up -d --build
docker compose exec -T backend npm run seed:prod   # ถ้าต้องการข้อมูลเดโม
```

เปิด `https://siem.example.com`

## 4. TLS

### ค่าเริ่มต้น — ใบรับรอง self-signed

ตอนบูตครั้งแรก container `web` จะสร้างใบรับรอง self-signed ให้เองถ้ายังไม่มี (สคริปต์ `frontend/tls-entrypoint.sh` ทำงานผ่าน entrypoint ของ nginx) ใบรับรองเก็บใน named volume `tlscerts` จึงอยู่ข้ามการ restart

```
CN         = ค่าจาก TLS_CN
SAN        = TLS_CN, localhost, 127.0.0.1
อายุ        = 825 วัน
คีย์        = RSA 2048
```

โจทย์ระบุว่า self-signed รับได้ถ้าอธิบายขั้นตอนชัดเจน — เบราว์เซอร์จะเตือนครั้งแรก กด "Advanced → Proceed" หนึ่งครั้ง

ตรวจใบรับรอง

```bash
openssl s_client -connect siem.example.com:443 -servername siem.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -dates
```

เรียก API ผ่าน TLS โดยข้ามการตรวจใบรับรอง

```bash
curl -k https://siem.example.com/api/health
python samples/post_logs.py --url https://siem.example.com/ingest --token sk_xxx --insecure
```

### ใช้ใบรับรองจริง (แนะนำสำหรับ production)

**วิธีที่ 1 — Let's Encrypt แล้ว mount เข้าไป**

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d siem.example.com

sudo mkdir -p ./certs
sudo cp /etc/letsencrypt/live/siem.example.com/fullchain.pem ./certs/server.crt
sudo cp /etc/letsencrypt/live/siem.example.com/privkey.pem   ./certs/server.key
sudo chown -R "$USER" ./certs
```

เพิ่ม volume ทับใน `docker-compose.override.yml`

```yaml
services:
  web:
    volumes:
      - ./certs:/etc/nginx/certs:ro
```

สคริปต์สร้างใบรับรองจะเห็นว่ามีไฟล์อยู่แล้วและไม่แตะต้อง

```bash
docker compose up -d --force-recreate web
```

ต่ออายุ — ใส่ใน cron ทุกเดือน

```bash
sudo certbot renew --standalone --pre-hook "docker compose stop web" --post-hook "docker compose start web"
```

**วิธีที่ 2 — วาง load balancer ของคลาวด์ไว้หน้า** (ALB / Cloud Load Balancing) ให้ LB ถือใบรับรอง แล้ว forward มาที่พอร์ต 80 ของ container กรณีนี้ตั้ง `WEB_PORT` เป็นพอร์ตที่ LB ยิงเข้ามา และยังต้องตั้ง `COOKIE_SECURE=true` เพราะผู้ใช้คุยกับ LB ผ่าน https

## 5. ส่ง log เข้าระบบจากภายนอก

สร้าง collector ที่หน้า Administration → Collectors เอา token มาใช้

```bash
curl -X POST https://siem.example.com/ingest \
  -H "Authorization: Bearer sk_xxxxxxxx" \
  -H "Content-Type: application/json" \
  --data @samples/m365_audit.json
```

หรือใช้สคริปต์ที่ให้มา

```bash
python samples/post_logs.py --url https://siem.example.com/ingest --token sk_xxx
python samples/post_logs.py --url https://siem.example.com/ingest --token sk_xxx --simulate 500
```

syslog จากอุปกรณ์ภายนอกต้องเปิด 514 ใน security group ให้เฉพาะ IP ต้นทางที่รู้จัก และตั้ง CIDR ของ collector ให้ตรง

## 5.5 เปิด Enrichment (ไม่บังคับ)

เติมประเทศ/เมือง/ASN ของ IP ต้นทาง และชื่อจาก reverse DNS

```bash
./scripts/fetch-geoip.sh --with-asn     # หรือ make geoip
docker compose up -d --force-recreate backend
```

ดาวน์โหลดไฟล์ DB-IP Lite (~120 MB) ลง `./geoip/` ซึ่ง compose mount เข้า
container แบบอ่านอย่างเดียว **ถ้าไม่มีไฟล์ ระบบทำงานปกติทุกอย่าง** แค่คอลัมน์
geo ว่าง — เครื่องที่ไม่มีอินเทอร์เน็ตให้ copy โฟลเดอร์ `geoip/` ไปวางเองได้

reverse DNS ต้องตั้ง `RDNS_SERVERS` ใน `.env` ให้ชี้ไป DNS ที่ตอบ PTR ได้
(ในคอนเทนเนอร์ resolver ของ Docker ไม่ทำ reverse lookup) บน appliance ให้ชี้ไป
DNS ภายในองค์กร เพราะนั่นคือที่ที่ชื่อเครื่องพนักงานอยู่

> event แรกจาก IP ที่ไม่เคยเห็นจะยังไม่มี hostname — ตัว lookup ทำเบื้องหลัง
> เพื่อไม่ให้ DNS ที่ช้าไปถ่วง ingest event ถัดไปจาก IP เดิมจะมีชื่อ

> ข้อมูล IP geolocation จาก DB-IP (<https://db-ip.com>) — CC-BY 4.0

## 6. ดูแลรักษา

```bash
docker compose logs -f backend
docker compose ps
docker compose exec -T db pg_dump -U postgres siem | gzip > backup-$(date +%F).sql.gz
```

อัปเกรด

```bash
git pull && docker compose up -d --build
```

## 7. สิ่งที่ต้องทำเพิ่มก่อนใช้งานจริง

รายการนี้อยู่นอกขอบเขตเดโม แต่ควรรู้ว่ายังขาด

- ตั้ง `SEED_ADMIN_PASSWORD` / `SEED_VIEWER_PASSWORD` ก่อน seed หรือเปลี่ยนรหัสผ่านบัญชีเดโมทั้งหมด
- ตั้ง `DB_PUBLISH_PORT=0` ไม่ให้ฐานข้อมูลโผล่ออกนอก
- จำกัด 514 ให้เฉพาะ IP ที่ส่ง log จริง — syslog UDP ปลอม IP ต้นทางได้ CIDR ของ collector จึงไม่ใช่การยืนยันตัวตนที่แข็งแรง
- ตั้ง backup อัตโนมัติ และ **ทดสอบ restore จริง**
- ปรับ `LOGIN_RATE_LIMIT_PER_MIN` / `INGEST_RATE_LIMIT_PER_MIN` ให้เหมาะกับปริมาณจริง (มี rate limit และ lockout แล้ว แต่นับต่อ process ถ้ารันหลาย replica ต้องย้ายไปเก็บที่ Redis)
- ตั้ง `METRICS_TOKEN` แล้วให้ Prometheus scrape `/api/metrics` และต่อ log ของ container เข้ากับระบบ monitoring
- ใช้ใบรับรองจริงแทน self-signed

## 8. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| ล็อกอินสำเร็จแล้วเด้งกลับหน้า login | `COOKIE_SECURE=true` แต่เข้าผ่าน `http://` — cookie ที่ตั้ง Secure จะไม่ถูกส่งบน http |
| `https` ต่อไม่ได้ | security group ยังไม่เปิด 443 หรือ `WEB_TLS_PORT` ไม่ตรง |
| ขึ้น `ERR_CERT_AUTHORITY_INVALID` | ปกติสำหรับ self-signed — กด Advanced → Proceed หรือเปลี่ยนไปใช้ใบรับรองจริง |
| ใบรับรองยังเป็นชื่อเดิมหลังแก้ `TLS_CN` | ใบเดิมยังอยู่ใน volume — `docker compose down -v web` แล้วขึ้นใหม่ หรือลบไฟล์ใน volume `tlscerts` |
| syslog จากภายนอกไม่เข้า | 514 ไม่ได้เปิดใน security group หรือ CIDR ของ collector ไม่ครอบคลุม IP ต้นทาง (ดู Storage → Rejected ingest) |
