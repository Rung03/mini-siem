# คู่มือใช้งาน — Mini SIEM

คู่มือสำหรับรันและตรวจสอบระบบ ส่วนคำอธิบายว่าระบบนี้คืออะไรอยู่ใน `README.md`

---

## สิ่งที่ต้องมี

- Docker Desktop (ต้องเปิดให้ daemon ทำงานอยู่)
- Node.js 20 ขึ้นไป — เฉพาะตอนรันแบบ dev หรือรันเทสต์นอก container

---

## เริ่มใช้งาน

```bash
cp .env.saas.example .env
```

แก้รหัสผ่านทุกตัวใน `.env` ก่อน แล้วจึงสั่ง

```bash
docker compose up -d --build
```

ตอนบูตครั้งแรก backend จะสร้าง role ในฐานข้อมูล รัน migration
และสร้าง partition ของวันนี้ให้เอง ไม่ต้องสั่งแยก

เปิด <http://localhost:8081>

### ใส่ข้อมูลตัวอย่าง

```bash
docker compose exec backend npm run seed:prod
```

สร้าง tenant 2 ราย ผู้ใช้ collector กฎแจ้งเตือน และ log การเข้าระบบย้อนหลัง 24 ชั่วโมง
พร้อมชุดเดารหัสผ่านจาก IP เดียว (`203.0.113.66`) ที่จะทำให้เกิด alert
ภายในรอบตรวจถัดไป (30 วินาที)

> **เรื่องเวลา:** กฎมองย้อนหลังแค่ 5 นาที ตัว seed จึงวางชุดเดารหัสผ่านไว้
> ในนาทีล่าสุดโดยตั้งใจ ถ้าอยากเห็น alert เกิดใหม่อีกครั้ง ให้สั่ง seed ซ้ำ
> ส่วน alert ที่เกิดไปแล้วจะยังอยู่ในตารางตลอด ไม่หายไปตามหน้าต่างเวลา

บัญชีที่ได้ — รหัสผ่านทุกบัญชีคือ `demo-password-change-me`

| บัญชี | บทบาท | เห็นอะไร |
|---|---|---|
| `admin@siem.local` | Admin | ทุก tenant |
| `viewer@northwind.local` | Viewer | Northwind Traders |
| `viewer@contoso.local` | Viewer | Contoso Ltd |

---

## แบบ Appliance

```bash
cp .env.appliance.example .env      # แก้รหัสผ่านก่อน
docker compose -f docker-compose.yml -f docker-compose.appliance.yml up -d --build
```

ใช้ image ชุดเดียวกันกับแบบ SaaS ต่างกันแค่ไฟล์ตั้งค่า คือทุกพอร์ตผูกกับ
`127.0.0.1` ยกเว้น syslog ที่ต้องให้อุปกรณ์เครือข่ายส่งเข้ามาได้
และปิดการยิง webhook ออกนอก

---

## ส่ง log เข้าระบบ

### 1. HTTP

ใช้ token ที่ได้ตอน seed หรือสร้าง collector ใหม่ในหน้า Administration

```bash
curl -X POST http://localhost:8081/ingest \
  -H "Authorization: Bearer sk_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"CreationTime":"2026-09-12T09:14:22","Operation":"UserLoginFailed","ResultStatus":"Failed","UserId":"jsmith@contoso.com","ClientIP":"203.0.113.44","LogonError":"InvalidUserNameOrPassword"}'
```

รับได้ทั้งก้อนเดียว, array, NDJSON และรูปแบบ `{"Records":[...]}` ของ CloudTrail

### 2. Syslog

collector แบบ syslog จะดูจาก IP ต้นทางว่าตรงกับ CIDR ที่ตั้งไว้หรือไม่
IP ที่ไม่ตรงกับ collector ไหนเลยจะถูกบันทึกไว้ในหน้า Storage → Rejected ingest
ไม่ถูกเดาว่าเป็นของใคร

log ที่ส่งจากเครื่อง host จะเข้ามาด้วย IP ของ Docker bridge ซึ่งไม่ตรงกับ
CIDR ของ tenant ไหนเลย ตัว seed จึงสร้าง collector ชื่อ `local-test-syslog`
(`172.16.0.0/12`) ไว้ให้คำสั่งข้างล่างใช้ได้ทันที ถ้าอยากลองดูเส้นทาง
"ผู้ส่งที่ไม่รู้จัก" ให้ปิด collector ตัวนี้ในหน้า Administration ก่อน

```bash
logger -n localhost -P 514 -d "Failed password for invalid user admin from 203.0.113.66 port 52344 ssh2"
```

### 3. อัปโหลดไฟล์

หน้าเว็บ หรือ

```bash
curl -X POST http://localhost:8081/api/ingest/file \
  -b cookies.txt -F collector_id=<uuid> -F file=@cloudtrail.json
```

รับ `.log` `.json` `.ndjson` `.csv`

---

## ตรวจสอบว่าระบบทำตามที่อ้างจริง

```bash
cd backend && npm install
POSTGRES_HOST=localhost POSTGRES_PORT=5433 npm test
```

**ต้องใส่ `POSTGRES_HOST` / `POSTGRES_PORT` ด้วย** เพราะใน `.env` ตั้งไว้เป็น `db:5432`
ซึ่งเป็นชื่อที่ใช้ได้เฉพาะในเครือข่ายของ compose เท่านั้น ถ้ารันด้วย `npm test`
เฉย ๆ จากเครื่อง host จะต่อฐานข้อมูลไม่ได้ แล้วชุดเทสต์ที่สำคัญจะถูก **ข้าม**
ไปเงียบ ๆ — ขึ้นว่า `skipped` ไม่ใช่ `failed` ให้ดูบรรทัดสรุปทุกครั้งว่าได้
`73 passed` จริง ไม่ใช่ `61 passed | 12 skipped`

(การข้ามเมื่อไม่มีฐานข้อมูลเป็นพฤติกรรมที่ตั้งใจ จะได้รันเทสต์ตัวแปลงตอนออฟไลน์ได้)

เทสต์ที่สำคัญที่สุดอยู่ใน `backend/test/isolation.test.ts` ซึ่งจงใจเขียน query ผิด

- `SELECT * FROM events` แบบไม่มี `WHERE` เลย — ต้องได้ข้อมูลของ tenant เดียว
- สั่ง `UPDATE` / `DELETE` บน `events` — ต้องโดนฐานข้อมูลปฏิเสธ (`42501`)
  **รวมถึงตอนเป็น Admin ด้วย**
- ไม่ได้ตั้ง tenant ไว้ — ต้องได้ 0 แถว ไม่ใช่ทุกแถว
- เขียน event ของ tenant B ขณะเป็น tenant A — ต้องถูกปฏิเสธ
- ไม่มี role ไหนมี `SUPERUSER` หรือ `BYPASSRLS`
- app role ไม่มีสิทธิ์แตะ partition ย่อยโดยตรง

ดู partition และ retention ได้ที่หน้า Administration → Storage

---

## ระหว่างพัฒนา

```bash
docker compose up -d db          # เอาแค่ฐานข้อมูล
cd backend && npm run dev        # API + syslog ที่ :8080
cd frontend && npm run dev       # หน้าเว็บที่ :5173
```

Vite proxy `/api` ไปที่ `:8080` ให้แล้ว

**หมายเหตุ:** `.env` ที่ generate ไว้ตั้ง `COOKIE_SECURE=false` เพราะ dev
รันบน http ถ้าขึ้น production จริงต้องตั้งเป็น `true`

---

## Enrichment (ไม่บังคับ)

```bash
./scripts/fetch-geoip.sh        # ดาวน์โหลด DB-IP Lite ลง ./geoip/
docker compose up -d --force-recreate backend
```

ไม่มีไฟล์ก็รันได้ปกติ แค่คอลัมน์ geo ว่าง ส่วน reverse DNS ตั้ง `RDNS_SERVERS`
ใน `.env` และจำไว้ว่า event แรกจาก IP ใหม่จะยังไม่มี hostname (ตั้งใจ — lookup
ทำเบื้องหลังเพื่อไม่ถ่วง ingest)

> ข้อมูล IP geolocation จาก DB-IP (<https://db-ip.com>) — CC-BY 4.0

## ตั้งค่าที่ใช้บ่อย

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `RETENTION_DAYS` | 7 | เก็บย้อนหลังกี่วัน เกินนั้น drop ทั้ง partition |
| `ALERT_INTERVAL_MS` | 30000 | รอบตรวจกฎแจ้งเตือน |
| `WEBHOOKS_ENABLED` | true | ปิดอัตโนมัติในแบบ appliance |
| `SYSLOG_UDP_PORT` / `SYSLOG_TCP_PORT` | 514 | เปลี่ยนได้ถ้าพอร์ตชนกับของเดิม |
| `INGEST_MAX_BATCH` | 5000 | จำนวน event สูงสุดต่อ 1 request |
| `COOKIE_SECURE` | true | ต้องเป็น true เมื่อเสิร์ฟผ่าน https |

---

## โครงสร้างโค้ด

```
db/migrations/    001 ตาราง · 002 สิทธิ์และ RLS · 003 ฟังก์ชัน/partition
                  004 schema กลางตามโจทย์ · 005 catch-all partition · 006 enrichment
backend/src/
  db/tenant.ts    ทางเข้าฐานข้อมูลทางเดียวของทั้งระบบ — ปักหมุด tenant ต่อ transaction
  ingest/         syslog (udp/tcp), http, upload — ทั้งสามลงท่อเดียวกัน
  normalize/      ตัวแปลงแยกตามแหล่ง เก็บ raw ไว้เสมอ
  enrich/         geoip (mmdb), reverse DNS (ไม่บล็อก), แยก IP ภายใน/ภายนอก
  pipeline/       batcher สำหรับ syslog, writer ที่เดียวที่เขียน events
  alerting/       ตัวตรวจกฎทุก 30 วิ และ webhook
  api/routes/     REST
samples/          log ตัวอย่างตามข้อ 4 + สคริปต์ส่ง
scripts/          fetch-geoip.sh
frontend/src/     React — Dashboard, Search, Alerts, Administration
```

จุดที่ควรอ่านก่อนถ้าจะตรวจเรื่องความปลอดภัย คือ `db/migrations/002_rls.sql`
เพราะการแยกข้อมูลลูกค้าและการที่ log ลบไม่ได้ ถูกบังคับไว้ที่นั่นทั้งหมด
ไม่ได้อยู่ในโค้ด API
