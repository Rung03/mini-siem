# ติดตั้งแบบ Appliance

ติดตั้งลงเครื่องหรือ VM เดียว ข้อมูลไม่ออกไปไหน เหมาะกับองค์กรที่ข้อมูลออกนอกไม่ได้

## ความต้องการขั้นต่ำ

ตามข้อกำหนดในโจทย์

| | |
|---|---|
| OS | Ubuntu 22.04 LTS ขึ้นไป (หรือ OS อื่นที่รัน Docker ได้) |
| CPU | 4 vCPU |
| RAM | 8 GB |
| Disk | 40 GB |
| พอร์ตที่ต้องเปิด | 514/udp, 514/tcp (รับ syslog), 8443/tcp และ 8081/tcp (หน้าเว็บ — ผูกกับ loopback โดยค่าเริ่มต้น) |
| Software | Docker Engine 24+ และ Docker Compose v2 |

## 1. ติดตั้ง Docker (ถ้ายังไม่มี)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

## 2. เอาโค้ดลงเครื่อง

```bash
git clone <repository-url> mini-siem
cd mini-siem
```

## 3. ตั้งค่า

```bash
cp .env.appliance.example .env
```

**แก้รหัสผ่านทุกตัวก่อนใช้งานจริง** สร้างค่าสุ่มได้ด้วย

```bash
openssl rand -base64 24
```

ค่าที่ต้องเปลี่ยนเป็นอย่างน้อย

```
POSTGRES_PASSWORD=
OWNER_DB_PASSWORD=
APP_DB_PASSWORD=
ADMIN_DB_PASSWORD=
EVALUATOR_DB_PASSWORD=
SESSION_SECRET=          # อย่างน้อย 32 ไบต์สุ่ม
```

## 4. ขึ้นระบบ — คำสั่งเดียว

```bash
./run.sh appliance
```

หรือถ้ามี `make`

```bash
make appliance
```

หรือเรียก compose ตรง ๆ

```bash
docker compose -f docker-compose.yml -f docker-compose.appliance.yml up -d --build
```

ตอนบูตครั้งแรก backend จะสร้าง role ในฐานข้อมูล รัน migration ทั้งหมด และสร้าง partition ของวันนี้ให้เอง ไม่ต้องสั่งแยก

ตรวจว่าขึ้นครบ

```bash
docker compose ps
curl -fsS http://localhost:8081/api/health
```

## 5. ใส่ข้อมูลตัวอย่าง (ถ้าต้องการเดโม)

```bash
docker compose exec backend npm run seed:prod
```

เปิด <http://localhost:8081> หรือ <https://localhost:8443>

| บัญชี | บทบาท |
|---|---|
| `admin@siem.local` | Admin — ทุก tenant |
| `viewer@northwind.local` | Viewer — Northwind Traders |
| `viewer@contoso.local` | Viewer — Contoso Ltd |

รหัสผ่านทุกบัญชี: `demo-password-change-me` — **เปลี่ยนทันทีในงานจริง** ที่หน้า Administration → Users

## 6. ชี้อุปกรณ์เข้ามา

### ตั้ง collector ก่อน

หน้า Administration → Collectors → Add a collector

- **Syslog** ต้องระบุ CIDR ของผู้ส่ง เช่น `10.10.0.0/24` — IP ที่ไม่ตรงกับ collector ไหนเลยจะถูกบันทึกไว้ที่ Storage → Rejected ingest ไม่ถูกเดาว่าเป็นของใคร
- **HTTP** จะได้ token มา **แสดงครั้งเดียว** ระบบเก็บไว้แค่ hash

### firewall / router

ตั้งปลายทาง syslog เป็น `<ไอพีของ appliance>:514` (UDP หรือ TCP ก็ได้)

ทดสอบ

```bash
./samples/send_syslog.sh --host <ไอพีของ appliance>
logger -n <ไอพีของ appliance> -P 514 -d "test message from $(hostname)"
```

### แอปพลิเคชัน

```bash
curl -X POST http://<ไอพี>:8081/ingest \
  -H "Authorization: Bearer sk_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d @samples/api_login.json
```

### ไฟล์ batch

หน้า Administration → Collectors → Upload a log file รับ `.log` `.json` `.ndjson` `.csv`

## 7. ดูแลรักษา

```bash
docker compose logs -f backend      # ดู log
docker compose ps                   # สถานะ
docker compose restart backend      # รีสตาร์ท
docker compose down                 # หยุด (ข้อมูลยังอยู่)
```

**Retention** ระบบลบ partition ของวันที่เกิน `RETENTION_DAYS` (ค่าเริ่มต้น 7) ให้เองทุกชั่วโมง ดูสถานะได้ที่ Administration → Storage

**สำรองข้อมูล**

```bash
docker compose exec -T db pg_dump -U postgres siem | gzip > siem-$(date +%F).sql.gz
```

**อัปเกรด**

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.appliance.yml up -d --build
```

migration ที่ยังไม่เคยรันจะถูกรันตอนบูต ส่วนที่รันไปแล้วถูก checksum ไว้ ถ้ามีคนแก้ไฟล์ migration ที่ apply ไปแล้ว ระบบจะฟ้องแทนที่จะเงียบ

## 8. ความปลอดภัยของโหมดนี้

- ทุกพอร์ตผูกกับ `127.0.0.1` ยกเว้น syslog 514 ที่ต้องเปิดให้อุปกรณ์เครือข่ายส่งเข้ามา ถ้าต้องเข้าหน้าเว็บจากเครื่องอื่นให้ใช้ SSH tunnel

  ```bash
  ssh -L 8443:127.0.0.1:8443 user@appliance
  ```

- `WEBHOOKS_ENABLED=false` — กล่องที่ไม่มีทางออกอินเทอร์เน็ตไม่ต้องพยายามยิงออก
- ฐานข้อมูลไม่เปิดออกนอกเครื่อง
- รหัสผ่านเก็บแบบ scrypt hash

## 9. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| syslog ส่งแล้วไม่ขึ้น | IP ต้นทางไม่ตรง CIDR ของ collector ไหน — ดูที่ Administration → Storage → Rejected ingest |
| `POST /ingest` ได้ 401 | token ผิด หรือ collector ถูก disable |
| พอร์ต 514 ขึ้นว่าไม่ว่าง | มี rsyslog ของเครื่องจับอยู่ — `sudo systemctl stop rsyslog` หรือเปลี่ยน `SYSLOG_UDP_PORT`/`SYSLOG_TCP_PORT` ใน `.env` |
| ล็อกอินแล้วเด้งกลับ | ถ้าเข้าผ่าน `https://` แต่ `COOKIE_SECURE=false` หรือกลับกัน ให้ตั้งค่าให้ตรงกับที่ใช้จริง |
| เข้า https แล้วเบราว์เซอร์เตือน | ใบรับรองเป็น self-signed ตามค่าเริ่มต้น — ดู `setup_saas.md` หัวข้อใบรับรอง |
