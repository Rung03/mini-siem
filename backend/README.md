# Backend — Mini SIEM

Node 24 + TypeScript + Express 5 รวม API, ช่องทางรับ log, ตัวแปลง, pipeline และตัวตรวจกฎแจ้งเตือนไว้ใน process เดียว

แผนผังไฟล์ทีละชั้นอยู่ใน [`../README.md`](../README.md) หัวข้อ 3

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `src/ingest/` | รับ log: syslog UDP/TCP 514, `POST /ingest`, อัปโหลดไฟล์ |
| `src/normalize/` | parser แยกตามแหล่ง → schema กลาง `CanonicalEvent` |
| `src/enrich/` | GeoIP และ reverse DNS |
| `src/pipeline/` | batcher และ writer (ที่เดียวที่เขียนตาราง `events`) |
| `src/alerting/` | ตัวตรวจกฎทุก 30 วิ และ webhook |
| `src/api/` | REST API, rate limit |
| `src/auth/` · `src/audit/` | session, RBAC, รหัสผ่าน, lockout, audit log |
| `src/observability/` | ค่าวัด Prometheus สำหรับ `GET /api/metrics` |
| `src/db/` | ทางเข้าฐานข้อมูล ปักหมุด tenant, migration, partition |
| `tools/seed.ts` | ข้อมูลเดโม |
| [`../tests/`](../tests/) | unit test และเทสต์ความปลอดภัยกับฐานข้อมูลจริง (รันจากโฟลเดอร์นี้ด้วย `npm test`) |

## คำสั่ง

```bash
npm install
npm run dev          # API + syslog แบบ watch ที่ :8080
npm run typecheck
npm test             # ชุดที่ต้องใช้ฐานข้อมูลจะข้ามเองถ้าต่อไม่ได้
npm run migrate
npm run seed
```

รันเทสต์ครบทุกชุดจากเครื่อง host (ต้องเปิด `docker compose up -d db` ก่อน)

```bash
POSTGRES_HOST=localhost POSTGRES_PORT=5433 npm test
```

ค่าตั้งทั้งหมดอ่านจาก `.env` ที่ root ของ repo ผ่าน `src/config.ts`
