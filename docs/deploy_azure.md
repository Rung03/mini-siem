# Deploy: Azure VM + DuckDNS + Caddy

ขึ้น SaaS จริงบนอินเทอร์เน็ต พร้อมใบรับรอง Let's Encrypt ที่ต่ออายุเอง

| | |
|---|---|
| VM | Azure **Standard_B2ms** (2 vCPU / 8 GB) ที่ **Southeast Asia** |
| โดเมน | DuckDNS (ฟรี) เช่น `mysiem.duckdns.org` |
| TLS | **Caddy** ขอและต่ออายุ Let's Encrypt อัตโนมัติ (ACME HTTP-01) |
| ค่าใช้จ่าย | B2ms ประมาณ **$60–70/เดือน** ถ้าเปิดทิ้งไว้ — คิดเป็นรายชั่วโมง **ลบทิ้งเมื่อเดโมเสร็จ** |

---

## 0. สิ่งที่ต้องมีก่อน

- Azure subscription + [Azure CLI](https://aka.ms/azure-cli) แล้ว `az login`
- บัญชี [DuckDNS](https://www.duckdns.org) (ล็อกอินด้วย GitHub/Google ได้) จดชื่อและ **token** ไว้
- อีเมลจริงสำหรับ Let's Encrypt (ใช้แจ้งเตือนใบรับรองใกล้หมดอายุ)

---

## 1. สร้าง VM

```bash
./scripts/provision-azure.sh
```

สคริปต์จะสร้าง resource group, public IP แบบ **static**, VM B2ms พร้อม
cloud-init ที่ลง Docker ให้ และเปิด NSG เฉพาะพอร์ตที่จำเป็น

| พอร์ต | เปิดให้ใคร | ทำไม |
|---|---|---|
| 80/tcp | ทุกที่ | **จำเป็น** สำหรับ ACME HTTP-01 ไม่ใช่แค่ redirect |
| 443/tcp + udp | ทุกที่ | หน้าเว็บและ API (udp คือ HTTP/3) |
| 22/tcp | **IP ของคุณเท่านั้น** | สคริปต์ตรวจ IP ปัจจุบันให้อัตโนมัติ |
| 514/udp + tcp | ทุกที่ | syslog — ของจริงควรจำกัดเฉพาะ IP อุปกรณ์ที่ส่ง |

เสร็จแล้วจะได้ public IP มา จดไว้

> ปรับค่าได้: `RG=... VM=... LOCATION=... ./scripts/provision-azure.sh`

---

## 2. ตั้งชื่อโดเมน DuckDNS

1. เข้า <https://www.duckdns.org> ล็อกอิน
2. สร้าง subdomain เช่น `mysiem`
3. ใส่ public IP ของ VM ลงช่อง **current ip** แล้วกด update
4. คัดลอก **token** ไว้

ตรวจว่าชี้ถูก

```bash
dig +short mysiem.duckdns.org     # ต้องได้ IP ของ VM
```

> DNS ต้องชี้มาถูกต้อง **ก่อน** สตาร์ท Caddy ไม่งั้น Let's Encrypt ขอใบรับรองไม่ผ่าน

---

## 3. เอาโค้ดขึ้น VM

```bash
ssh azureuser@<PUBLIC_IP>
git clone <repository-url> mini-siem
cd mini-siem
```

---

## 4. ตั้งค่า

```bash
cp .env.saas.example .env
```

แก้ค่าเหล่านี้ใน `.env`

```bash
# รหัสผ่าน — สร้างใหม่ทุกตัวด้วย: openssl rand -base64 24
POSTGRES_PASSWORD=...
OWNER_DB_PASSWORD=...
APP_DB_PASSWORD=...
ADMIN_DB_PASSWORD=...
EVALUATOR_DB_PASSWORD=...
SESSION_SECRET=...            # openssl rand -base64 32

# โดเมนและ TLS
SITE_DOMAIN=mysiem.duckdns.org
LETSENCRYPT_EMAIL=you@example.com
DUCKDNS_SUBDOMAIN=mysiem      # ชื่อเฉย ๆ ไม่ต้องมี .duckdns.org
DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

COOKIE_SECURE=true            # overlay ตั้งให้อยู่แล้ว แต่ตั้งไว้ให้ชัด
DB_PUBLISH_PORT=0             # ไม่ต้อง publish ฐานข้อมูลออกนอก
```

---

## 5. ขึ้นระบบ

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

Caddy จะขอใบรับรองให้เองภายในไม่กี่วินาที ดูได้จาก

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml logs -f caddy
```

ขึ้นประมาณว่า `certificate obtained successfully` แปลว่าเรียบร้อย

ใส่ข้อมูลเดโม

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml exec -T backend npm run seed:prod
```

เปิด **<https://mysiem.duckdns.org>** — ใบรับรองจริง ไม่มีคำเตือน

---

## 6. โครงสร้างตอน deploy จริง

```
  internet
     │  :80 (ACME + redirect)  :443 (https/h3)   :514 (syslog)
     ▼
  ┌────────┐   Let's Encrypt อัตโนมัติ
  │ Caddy  │   ต่ออายุเองก่อนหมด 30 วัน
  └───┬────┘
      │ :80 ภายใน
      ▼
  ┌────────┐   static files + route /api, /ingest
  │ nginx  │
  └───┬────┘
      │ :8080
      ▼
  ┌─────────┐◄── syslog 514 เข้าตรง (อุปกรณ์เครือข่ายพูด HTTP ไม่ได้)
  │ backend │
  └───┬─────┘
      ▼
  ┌──────────┐  ไม่ publish ออกนอกเลย
  │ postgres │
  └──────────┘
```

**มีสอง proxy ซ้อนกัน** จึงตั้ง `TRUST_PROXY_HOPS=2` ใน overlay — ถ้าตั้งผิด
audit trail จะบันทึก IP ของ container แทน IP จริงของผู้ใช้ ซึ่งทำให้หลักฐาน
ไร้ความหมายพอดีตอนที่ต้องใช้

ตัว `duckdns` container ปิง DuckDNS ทุก 5 นาทีเพื่อให้ record ตามทัน IP
(Azure VM ที่ deallocate แล้วเปิดใหม่อาจได้ IP ใหม่)

---

## 7. ตรวจว่าใช้งานได้จริง

```bash
curl https://mysiem.duckdns.org/api/health
# ใบรับรองจริง จึงไม่ต้องใส่ -k

# ส่ง log เข้าจากเครื่องไหนก็ได้ในโลก
python samples/post_logs.py \
  --url https://mysiem.duckdns.org/ingest --token sk_xxx --simulate 200

# เช็กใบรับรอง
echo | openssl s_client -connect mysiem.duckdns.org:443 -servername mysiem.duckdns.org 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

`issuer` ต้องขึ้นว่า Let's Encrypt

---

## 8. ดูแลรักษา

```bash
C="docker compose -f docker-compose.yml -f docker-compose.caddy.yml"

$C logs -f backend          # log
$C ps                       # สถานะ
$C exec -T db pg_dump -U postgres siem | gzip > backup-$(date +%F).sql.gz
git pull && $C up -d --build   # อัปเกรด
```

ใบรับรองต่ออายุเอง ไม่ต้องทำอะไร Caddy เก็บไว้ใน volume `caddydata` ซึ่งอยู่
ข้ามการ restart — **อย่าลบ volume นี้เล่น ๆ** เพราะขอใหม่บ่อยจะชน rate limit
ของ Let's Encrypt (5 ใบต่อโดเมนต่อสัปดาห์)

> ตอนทดสอบซ้ำ ๆ ให้เปิดบรรทัด `acme_ca ... staging ...` ใน `deploy/Caddyfile`
> ก่อน จะได้ไม่กิน quota ของจริง

---

## 9. ลบทิ้งเมื่อเสร็จ

```bash
az group delete --name mini-siem-rg --yes --no-wait
```

**อย่าลืมขั้นนี้** — B2ms คิดเงินต่อชั่วโมงตราบใดที่ VM ยังอยู่

---

## 10. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| Caddy ขอใบรับรองไม่ผ่าน | DNS ยังไม่ชี้มาที่ VM (`dig +short` เช็กก่อน) หรือพอร์ต 80 ไม่ได้เปิดใน NSG |
| `too many certificates already issued` | ชน rate limit ของ Let's Encrypt — รอ หรือใช้ staging ระหว่างทดสอบ |
| ล็อกอินแล้วเด้งกลับ | `COOKIE_SECURE=true` แต่เข้าผ่าน `http://` — ต้องเข้าผ่าน https |
| audit trail ขึ้น IP ของ container | `TRUST_PROXY_HOPS` ไม่ตรงกับจำนวน proxy จริง (Caddy+nginx = 2) |
| syslog จากภายนอกไม่เข้า | NSG ปิด 514 หรือ CIDR ของ collector ไม่ครอบคลุม IP ต้นทาง (ดู Storage → Rejected ingest) |
| หน้าเว็บขึ้น 502 | `web`/`backend` ยังไม่พร้อม — `$C logs backend` |
