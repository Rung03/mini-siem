# Ingest — ช่องทางรับ log

โค้ดรับ log อยู่ใน backend ที่ [`../backend/src/ingest/`](../backend/src/ingest/) เพราะทุกช่องทางใช้ parser, pipeline และทางเข้าฐานข้อมูลชุดเดียวกัน แยก process ออกมาจะต้องทำซ้ำการปักหมุด tenant

| ช่องทาง | โปรโตคอล | ยืนยันผู้ส่งด้วย | ไฟล์ |
|---|---|---|---|
| Syslog | UDP / TCP 514 | IP ต้นทางอยู่ใน CIDR ของ collector | `syslog.ts` |
| HTTP | `POST /ingest` (JSON, array, NDJSON, `{"Records":[]}`) | `Authorization: Bearer <collector token>` | `http.ts` |
| อัปโหลดไฟล์ | `POST /api/ingest/file` (`.log .json .ndjson .csv`) | session ของผู้ใช้ | `upload.ts` |

- tenant มาจาก collector เสมอ ไม่ใช่จากฟิลด์ `tenant` ใน payload
- ผู้ส่งที่ไม่ตรง collector ไหนถูกบันทึกที่ Administration → Storage → Rejected ingest
- `POST /ingest` จำกัด `INGEST_RATE_LIMIT_PER_MIN` คำขอต่อ IP ต่อนาที (เกินได้ 429)
- ชุด event ที่เก่ากว่า retention ทั้งชุด (เช่น sample ปี 2025) ถูกขยับเวลามาที่ปัจจุบัน เวลาเดิมอยู่ที่ `attrs.original_ts` — ปิดด้วย `X-Keep-Timestamps: true` หรือ `keep_timestamps=true`
- บรรทัด key=value แบบ firewall ที่เข้า collector `generic` ถูกอ่านด้วย parser firewall ให้เอง

## สคริปต์ส่งตัวอย่าง

```bash
./samples/send_syslog.sh                        # firewall + router syslog
./samples/send_syslog.sh --brute                # ชุดที่ทำให้เกิด alert
python samples/post_logs.py --token sk_xxx      # JSON ทุกแหล่ง
python samples/post_logs.py --token sk_xxx --simulate 200
```

Postman Collection: [`../docs/postman_collection.json`](../docs/postman_collection.json)
