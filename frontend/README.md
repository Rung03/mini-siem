# Frontend — Mini SIEM

React 18 + Vite + TanStack Query + Recharts build เป็นไฟล์ static แล้วเสิร์ฟด้วย nginx

## หน้า

| หน้า | ไฟล์ | ทำอะไร |
|---|---|---|
| Dashboard | `src/pages/Dashboard.tsx` | การ์ดสรุป, Timeline, Top ผู้ใช้ / IP / ประเภท / ประเทศ, กรองตาม tenant / source / ช่วงเวลา |
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
