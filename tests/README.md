# Tests

ไฟล์เทสต์ทั้งหมดอยู่ในโฟลเดอร์นี้ ใช้ Vitest ที่ติดตั้งใน `backend/` (ตั้งค่าที่ [`backend/vitest.config.ts`](../backend/vitest.config.ts)) และรันใน CI ทุก push (`.github/workflows/ci.yml`)

| ไฟล์ | ทดสอบอะไร | ต้องมีฐานข้อมูล |
|---|---|---|
| `parsers.test.ts` | parser ทุกแหล่ง รวม sample ข้อ 4.1–4.4 และ 4.6 ของโจทย์ | ไม่ |
| `enrich.test.ts` | GeoIP / reverse DNS พังแล้ว event ต้องไม่หาย | ไม่ |
| `login-event.test.ts` | event การล็อกอินหน้าเว็บ และไม่มีรหัสผ่านใน event | ไม่ |
| `migrate.test.ts` | checksum ของ migration | ไม่ |
| `ratelimit.test.ts` | rate limit และการล็อกบัญชีเมื่อรหัสผิดซ้ำ | ไม่ |
| `metrics.test.ts` | รูปแบบ Prometheus ของ `/api/metrics` | ไม่ |
| `timestamps.test.ts` | ขยับเวลาของ sample ที่เก่ากว่า retention | ไม่ |
| `filter.test.ts` | ตัวกรองที่ dashboard ใช้ตอนคลิก (ตรงตัว, AND, บังคับ tenant) | ไม่ |
| `isolation.test.ts` | **RLS แยก tenant, ลบ log ไม่ได้แม้เป็น Admin, ไม่มี role ไหน BYPASSRLS** | ใช่ |

## รัน

```bash
docker compose up -d db
cd backend && npm install
POSTGRES_HOST=localhost POSTGRES_PORT=5433 npm test
```

ต้องได้ `93 passed` ถ้าขึ้น `81 passed | 12 skipped` แปลว่าต่อฐานข้อมูลไม่ได้ และเทสต์ความปลอดภัยไม่ได้รัน

หรือ `make test` จาก root
