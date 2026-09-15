# Frontend — Mini SIEM

React 18 + Vite + TanStack Query + Recharts build เป็นไฟล์ static แล้วเสิร์ฟด้วย nginx

## หน้า

| หน้า | ไฟล์ | ทำอะไร |
|---|---|---|
| Dashboard | `src/pages/Dashboard.tsx` | การ์ดสรุปเอียง 3D, Timeline, คอลัมน์ 3D ต่อแหล่ง, Top ผู้ใช้ / IP / ประเภท / ประเทศ — **คลิกการ์ด คอลัมน์ แถว หรือเซลล์เพื่อกรองทั้งหน้า** ตัวกรองแสดงเป็น chip ลบได้ |
| Search | `src/pages/Search.tsx` | ค้นข้ามทุกแหล่ง กรองตามเวลา ผลลัพธ์ แหล่ง ผู้ใช้ IP/CIDR ประเทศ และดู payload ดิบ |
| Alerts | `src/pages/Alerts.tsx` | รายการ alert และ Acknowledge |
| Administration | `src/pages/Admin.tsx` | collector, กฎ, ผู้ใช้, tenant, audit, partition |

## คำสั่ง

```bash
npm install
npm run dev          # http://localhost:5173 (proxy /api ไป :8080)
npm run typecheck
npm run build
```

ไฟล์ตั้งค่า nginx: `nginx.conf`, `siem-app.conf` · ใบรับรอง self-signed สร้างโดย `tls-entrypoint.sh`
