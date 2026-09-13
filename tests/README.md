# Tests

ไฟล์เทสต์อยู่ที่ [`../backend/test/`](../backend/test/) ใช้ Vitest และรันใน CI ทุก push (`.github/workflows/ci.yml`)

| ไฟล์ | ทดสอบอะไร | ต้องมีฐานข้อมูล |
|---|---|---|
| `parsers.test.ts` | parser ทุกแหล่ง รวม sample ข้อ 4.1–4.7 ของโจทย์ | ไม่ |
| `enrich.test.ts` | GeoIP / reverse DNS พังแล้ว event ต้องไม่หาย | ไม่ |
| `login-event.test.ts` | event การล็อกอินหน้าเว็บ และไม่มีรหัสผ่านใน event | ไม่ |
| `migrate.test.ts` | checksum ของ migration | ไม่ |
| `ratelimit.test.ts` | rate limit และการล็อกบัญชีเมื่อรหัสผิดซ้ำ | ไม่ |
| `metrics.test.ts` | รูปแบบ Prometheus ของ `/api/metrics` | ไม่ |
| `timestamps.test.ts` | ขยับเวลาของ sample ที่เก่ากว่า retention | ไม่ |
| `isolation.test.ts` | **RLS แยก tenant, ลบ log ไม่ได้แม้เป็น Admin, ไม่มี role ไหน BYPASSRLS** | ใช่ |

## รัน

```bash
docker compose up -d db
cd backend && npm install
POSTGRES_HOST=localhost POSTGRES_PORT=5433 npm test
```

ต้องได้ `102 passed` ถ้าขึ้น `90 passed | 12 skipped` แปลว่าต่อฐานข้อมูลไม่ได้ และเทสต์ความปลอดภัยไม่ได้รัน

หรือ `make test` จาก root
