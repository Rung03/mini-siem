# Mini SIEM

ระบบ Log Management / SIEM ขนาดเล็ก รับ log จากหลายแหล่ง แปลงเป็นโครงสร้างกลางเดียวกัน
เก็บลง PostgreSQL แล้วค้นหา แสดงผล และแจ้งเตือนได้จากที่เดียว รองรับหลายลูกค้า (tenant)
โดยบังคับแยกข้อมูลที่ระดับฐานข้อมูล

ทุกไฟล์มี comment บรรทัดแรกบอกว่าไฟล์นั้นทำอะไร ส่วนไฟล์นี้คือแผนที่ของโค้ดทั้งหมด
บอกว่าแต่ละไฟล์อยู่ชั้นไหน ทำหน้าที่อะไร และจุดไหนห้ามแก้ผิด

---

## สารบัญ

1. [สถาปัตยกรรมเป็นชั้น](#1-สถาปัตยกรรมเป็นชั้น)
2. [เส้นทางของ log หนึ่งบรรทัด](#2-เส้นทางของ-log-หนึ่งบรรทัด)
3. [แผนผังไฟล์ทีละชั้น](#3-แผนผังไฟล์ทีละชั้น)
4. [จุดที่ห้ามแก้ผิด](#4-จุดที่ห้ามแก้ผิด)
5. [คำสั่งที่ใช้บ่อย](#5-คำสั่งที่ใช้บ่อย)
6. [เอกสารอื่น](#6-เอกสารอื่น)

---

## 1. สถาปัตยกรรมเป็นชั้น

เรียงจากชั้นที่ผู้ใช้แตะ ลงไปถึงฐานข้อมูล แต่ละชั้นเรียกได้เฉพาะชั้นที่อยู่ต่ำกว่า

```
┌──────────────────────────────────────────────────────────────────────┐
│ ชั้น 1  Edge        Caddy (TLS จริง)  →  nginx (static + proxy)       │  deploy/  frontend/*.conf
├──────────────────────────────────────────────────────────────────────┤
│ ชั้น 2  Frontend    pages  →  components  →  api/client               │  frontend/src/
├──────────────────────────────────────────────────────────────────────┤
│ ชั้น 3  API         app  →  routes  →  util                           │  backend/src/api/
│ ชั้น 4  Auth        rbac · session · password · audit                 │  backend/src/auth/  audit/
├──────────────────────────────────────────────────────────────────────┤
│ ชั้น 5  Ingest      syslog · http · upload  →  collectors             │  backend/src/ingest/
│ ชั้น 6  Normalize   parsers  →  schema กลาง                           │  backend/src/normalize/
│ ชั้น 7  Enrich      ipclass  →  geoip · rdns                          │  backend/src/enrich/
│ ชั้น 8  Pipeline    batcher  →  writer                                │  backend/src/pipeline/
│ ชั้น 9  Alerting    evaluator  →  webhook                             │  backend/src/alerting/
├──────────────────────────────────────────────────────────────────────┤
│ ชั้น 10 Data access tenant.ts (ทางเข้าเดียว)  →  pool  →  role         │  backend/src/db/
├──────────────────────────────────────────────────────────────────────┤
│ ชั้น 11 Database    ตาราง · RLS · ฟังก์ชัน · partition                 │  db/migrations/
└──────────────────────────────────────────────────────────────────────┘
```

**กติกาสำคัญของชั้น:** โค้ดทุกไฟล์เข้าฐานข้อมูลผ่าน `backend/src/db/tenant.ts` เท่านั้น
ไม่มี route ไหนแตะ connection pool ตรง ๆ

---

## 2. เส้นทางของ log หนึ่งบรรทัด

ตัวอย่าง: firewall ส่ง syslog ว่ามีคนล็อกอินผิด

| ขั้น | ไฟล์ | เกิดอะไรขึ้น |
|---|---|---|
| 1 | `ingest/syslog.ts` | รับแพ็กเก็ต UDP/TCP พอร์ต 514 ตัดเฟรม |
| 2 | `ingest/collectors.ts` | ดู IP ต้นทาง → หา collector → รู้ว่าเป็นของ tenant ไหน ใช้ parser ตัวไหน |
| 3 | `normalize/index.ts` | เลือก parser ตาม collector |
| 4 | `normalize/parsers/fortigate.ts` | แปลง key=value เป็น `CanonicalEvent` |
| 5 | `pipeline/batcher.ts` | สะสมเป็นก้อน รอเต็มหรือครบเวลา |
| 6 | `pipeline/writer.ts` | เรียก enrich **นอก transaction** แล้วเขียนลงฐาน |
| 7 | `enrich/index.ts` | เติมประเทศ เมือง hostname และ tag |
| 8 | `db/tenant.ts` | เปิด transaction ในนาม `siem_app` ปักหมุด tenant |
| 9 | `002_rls.sql` | Postgres ตรวจ `WITH CHECK` ว่า tenant ตรงก่อนยอมให้ insert |
| 10 | `alerting/evaluator.ts` | ทุก 30 วิ นับความล้มเหลวต่อ IP → เกินเกณฑ์สร้าง alert |
| 11 | `alerting/webhook.ts` | ส่ง alert ออก webhook (ถ้าตั้งไว้) |
| 12 | `api/routes/events.ts` · `stats.ts` | frontend ขอข้อมูลไปแสดง |
| 13 | `frontend/src/pages/Dashboard.tsx` | แสดงการ์ด กราฟ ตาราง |

HTTP (`ingest/http.ts`) และการอัปโหลดไฟล์ (`ingest/upload.ts`) ต่างกันแค่ขั้น 1–2
หลังจากนั้นเดินเส้นทางเดียวกันทั้งหมด (HTTP เขียนตรงไม่ผ่าน batcher)

---

## 3. แผนผังไฟล์ทีละชั้น

### ชั้น 11 · Database — `db/migrations/`

migration รันครั้งเดียวตามลำดับเลข ในนาม `siem_owner`

| ไฟล์ | หน้าที่ |
|---|---|
| `001_schema.sql` | สร้างตารางทั้งหมด: `tenants` `users` `sessions` `collectors` `events` `alert_rules` `alerts` `audit_log` `ingest_drops` — ตาราง `events` แบ่ง partition ตามวัน (RANGE) แล้วซ้อนตาม tenant (LIST) |
| `002_rls.sql` | **หัวใจความปลอดภัย** — กำหนดสิทธิ์ role ทั้ง 4 และ Row Level Security ทุกตาราง ไม่มี role ไหนได้ `UPDATE`/`DELETE` บน `events` และ `audit_log` |
| `003_functions.sql` | ฟังก์ชัน `SECURITY DEFINER` ที่ต้องมองข้าม tenant ได้ (ล็อกอิน, session, หา collector จาก token/IP) และตัวจัดการ partition (`ensure_partitions`, `drop_old_partitions`) |
| `004_schema_alignment.sql` | เพิ่มคอลัมน์ตาม schema กลางของโจทย์ข้อ 3 (`source` `vendor` `event_type` `action` `dst_ip` `protocol` `cloud_*` `tags` ฯลฯ) และเปลี่ยน severity เป็นสเกล 0–10 |
| `005_default_partition.sql` | partition `events_backfill` แบบ DEFAULT รับ event ที่วันที่อยู่นอกช่วง partition ปกติ (เช่น sample ปี 2025) และฟังก์ชันล้างข้อมูลเก่าในนั้น |
| `006_enrichment.sql` | คอลัมน์สำหรับ enrichment: `src_hostname` `geo_country_iso` `geo_city` `geo_lat/lon` `asn` `as_org` |

**role ในฐานข้อมูล**

| role | ใช้เมื่อไร | มองเห็น |
|---|---|---|
| `siem_owner` | migration, สร้าง/ลบ partition | เป็นเจ้าของตาราง |
| `siem_app` | ผู้ใช้ Viewer และทุกช่องทาง ingest | tenant เดียวที่ถูกปักหมุด |
| `siem_admin` | ผู้ใช้ Admin | ทุก tenant แต่ลบ log ไม่ได้ |
| `siem_evaluator` | ตัวตรวจกฎแจ้งเตือน | อ่าน event ทุก tenant, เขียน alert |

---

### ชั้น 10 · Data access — `backend/src/db/`

| ไฟล์ | หน้าที่ | ฟังก์ชันหลัก |
|---|---|---|
| `tenant.ts` | **ทางเข้าฐานข้อมูลทางเดียวของทั้งระบบ** — เปิด transaction ด้วย role ที่ถูกต้อง และปักหมุด tenant ด้วย `set_config('app.tenant_id', …, true)` | `withApp` `withAdmin` `withActor` `withOwner` `withEvaluator` `withUnscopedApp` |
| `pool.ts` | connection pool แยกต่อ role ตั้ง timezone เป็น UTC ทุก connection | `pool` `withSuperuser` `closeAllPools` |
| `bootstrap.ts` | สร้าง/ปรับ role ทั้ง 4 ตอนบูต บังคับ `NOSUPERUSER NOBYPASSRLS` ทุกครั้ง | `bootstrapRoles` |
| `migrate.ts` | รัน migration ตามลำดับ เก็บ checksum กันแก้ไฟล์ที่ apply แล้ว | `runMigrations` |
| `checksums.ts` | คำนวณ checksum และเก็บ checksum เดิมของ migration 001–006 ก่อนลบ comment — ฐานข้อมูลที่ apply ไว้แล้วจึงบูตต่อได้ และถูกอัปเดตเป็นค่าใหม่ให้อัตโนมัติ | `checksum` `compareChecksum` `EQUIVALENT_EARLIER_CHECKSUMS` |
| `migrate-cli.ts` | คำสั่ง `npm run migrate` | — |
| `partitions.ts` | สร้าง partition ล่วงหน้า, ลบ partition เกินอายุ, ล้าง session หมดอายุ ทุกชั่วโมง | `runMaintenance` `startMaintenanceLoop` |

---

### ชั้น 9 · Alerting — `backend/src/alerting/`

| ไฟล์ | หน้าที่ | ฟังก์ชันหลัก |
|---|---|---|
| `evaluator.ts` | ทุก 30 วิ แปลงกฎแต่ละข้อเป็น query นับจำนวนในหน้าต่างเวลา เกินเกณฑ์สร้าง alert — กันยิงซ้ำด้วย `dedupe_key` ต่อช่วง suppression | `evaluateRule` `evaluateAll` `startAlertLoop` |
| `webhook.ts` | ส่ง alert ที่รอส่งออกไป webhook มี timeout และลองซ้ำสูงสุด 5 ครั้ง ปิดเองในโหมด appliance | `deliverPendingWebhooks` |

---

### ชั้น 8 · Pipeline — `backend/src/pipeline/`

| ไฟล์ | หน้าที่ | ฟังก์ชันหลัก |
|---|---|---|
| `writer.ts` | **ที่เดียวที่เขียนลงตาราง `events`** — enrich ก่อน แล้ว insert หลายแถวในคำสั่งเดียว แบ่งก้อนไม่ให้เกินลิมิต 65,535 parameter | `insertEvents` `recordDrop` |
| `batcher.ts` | สะสม event จาก syslog แยกตาม tenant+collector แล้ว flush เมื่อเต็มหรือครบเวลา ตอนปิดระบบ flush ของค้างให้ครบก่อน | `EventBatcher` `batcher` |

---

### ชั้น 7 · Enrich — `backend/src/enrich/`

| ไฟล์ | หน้าที่ | ฟังก์ชันหลัก |
|---|---|---|
| `index.ts` | ตัวประสาน: จัดประเภท IP → เติม hostname → เติม geo → ติด tag ห้ามโยน error และห้ามทิ้ง event | `enrichBatch` |
| `ipclass.ts` | แยก IP เป็น public / private / loopback / link-local / reserved — ช่วง RFC5737 (`203.0.113.x` ฯลฯ) นับเป็น reserved | `classifyIp` `isLocatable` |
| `geoip.ts` | อ่านไฟล์ DB-IP Lite (`.mmdb`) ในเครื่อง ถ้าไม่มีไฟล์ก็ปิดตัวเองเงียบ ๆ | `initGeoip` `geoProvider` `setGeoProvider` |
| `rdns.ts` | reverse DNS แบบ **อ่าน cache อย่างเดียว** ถ้าไม่เจอคืน null แล้วค้นเบื้องหลัง จำกัดจำนวนงานพร้อมกันและความยาวคิว | `hostnameFor` `setResolver` `resetRdnsCache` |

---

### ชั้น 6 · Normalize — `backend/src/normalize/`

| ไฟล์ | หน้าที่ | ฟังก์ชันหลัก |
|---|---|---|
| `schema.ts` | นิยาม `CanonicalEvent` (โครงสร้างกลาง) รายการ source ที่รองรับ และค่าเริ่มต้นของ event | `blankEvent` `unparsed` `SOURCE_TYPES` `SOURCES` |
| `index.ts` | ทะเบียน parser เลือกตาม collector และจับ parser ที่ throw ให้กลายเป็น event แบบ unparsed แทนการทำหาย | `normalize` `parserFor` |
| `util.ts` | ตัวช่วยร่วม: แยก key=value, แปลง IP/วันที่/ตัวเลข, ตัดหัว syslog, และ parser กลางสำหรับ JSON รูปแบบตัวอย่างในโจทย์ข้อ 4 | `parseKeyValue` `coerceIp` `coerceDate` `stripSyslogHeader` `parseEnvelope` `looksLikeEnvelope` |

**parser แต่ละแหล่ง — `normalize/parsers/`**

| ไฟล์ | อ่านอะไร |
|---|---|
| `fortigate.ts` | Firewall แบบ key=value ทั้งรูปแบบ FortiGate (`srcip=`) และแบบทั่วไป (`src=` `dst=` `spt=` `dpt=` `proto=`) |
| `windows-ad.ts` | Windows Security Event 4624 / 4625 / 4634 ทั้ง JSON และข้อความแบบ rendered แปลรหัส sub-status เป็นเหตุผลที่อ่านได้ |
| `m365.ts` | Microsoft 365 Unified Audit Log (`UserLoggedIn` / `UserLoginFailed`) |
| `aws-cloudtrail.ts` | AWS CloudTrail (`ConsoleLogin`, `AssumeRole` ฯลฯ) |
| `crowdstrike.ts` | CrowdStrike Falcon ทั้ง `UserActivityAuditEvent` และ `DetectionSummaryEvent` |
| `generic.ts` | syslog ทั่วไปและ JSON จากแอปภายใน จับรูปแบบ sshd (`Failed password for …`) ได้ |

---

### ชั้น 5 · Ingest — `backend/src/ingest/`

| ไฟล์ | หน้าที่ | ฟังก์ชันหลัก |
|---|---|---|
| `syslog.ts` | ฟัง UDP และ TCP พอร์ต 514 รองรับทั้ง octet-counting และแบ่งบรรทัด ผู้ส่งที่ไม่ตรงกับ collector ไหนถูกทิ้ง | `startSyslogUdp` `startSyslogTcp` |
| `http.ts` | `POST /ingest` ด้วย bearer token รับได้ทั้ง object, array, `{"Records":[…]}` และ NDJSON เขียนแบบรอผลก่อนตอบ | `ingestRouter` `extractPayloads` |
| `upload.ts` | `POST /api/ingest/file` อัปโหลด `.log` `.json` `.ndjson` `.csv` ผ่านหน้าเว็บ | `handleUpload` |
| `collectors.ts` | จับคู่ข้อมูลเข้ากับ collector (จาก token หรือ IP) มี cache ทั้งเจอและไม่เจอ สร้างและ hash token | `resolveByToken` `resolveByIp` `resolveById` `generateToken` |

---

### ชั้น 4 · Auth & Audit — `backend/src/auth/` · `backend/src/audit/`

| ไฟล์ | หน้าที่ | ฟังก์ชันหลัก |
|---|---|---|
| `auth/rbac.ts` | อ่าน session จาก cookie, หา IP จริงของผู้ใช้หลัง proxy, ตรวจสิทธิ์ Admin/Viewer, บังคับ JSON บน mutation กัน CSRF | `attachActor` `requireAuth` `requireAdmin` `requireJsonMutation` `clientIp` |
| `auth/session.ts` | session ฝั่งเซิร์ฟเวอร์: cookie เก็บ token สุ่ม ฐานข้อมูลเก็บแค่ hash | `createSession` `lookupSession` `revokeSession` |
| `auth/password.ts` | hash รหัสผ่านด้วย scrypt (ไม่ใช้ native addon) และหน่วงเวลาเท่ากันเมื่อไม่พบอีเมล | `hashPassword` `verifyPassword` `dummyVerify` |
| `audit/log.ts` | บันทึกการกระทำของผู้ดูแลลง `audit_log` ใน transaction เดียวกับการเปลี่ยนแปลง | `auditIn` `audit` |

---

### ชั้น 3 · API — `backend/src/api/`

| ไฟล์ | หน้าที่ |
|---|---|
| `app.ts` | ประกอบ Express: security headers → `/api/health` → `/ingest` (ก่อน JSON parser) → routes → error handler |
| `util.ts` | ตัวช่วยของ route: ตรวจ input ด้วย zod, แปลง error `42501` ของ Postgres เป็น 403, ตัดสินว่า request นี้เกี่ยวกับ tenant ไหน, แปลงช่วงเวลา |

**routes — `api/routes/`**

| ไฟล์ | endpoint | สิทธิ์ |
|---|---|---|
| `auth.ts` | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | ทุกคน |
| `events.ts` | `GET /events` (ค้นหา, แบ่งหน้าแบบ cursor) · `GET /events/:id/raw` | ผู้ที่ล็อกอิน |
| `stats.ts` | `GET /stats/summary` · `/timeseries` · `/top` · `/sources` | ผู้ที่ล็อกอิน |
| `alerts.ts` | `GET /alerts` · `POST /alerts/:id/ack` | ผู้ที่ล็อกอิน |
| `rules.ts` | อ่านกฎ / สร้าง แก้ ลบ (กฎที่มีประวัติ alert จะถูกปิดแทนการลบ) | อ่าน: ทุกคน · แก้: Admin |
| `collectors.ts` | อ่าน / สร้าง / แก้ / `POST /collectors/:id/rotate-token` | อ่าน: ทุกคน · แก้: Admin |
| `admin.ts` | `tenants` · `users` · `audit` · `ingest-drops` · `partitions` | Admin (ยกเว้นอ่าน tenant ของตัวเอง) |

---

### Backend · ส่วนรวม — `backend/`

| ไฟล์ | หน้าที่ |
|---|---|
| `src/index.ts` | จุดเริ่มระบบ บูตตามลำดับ: role → migration → partition → GeoIP → API → syslog → ตัวตรวจกฎ ตอนปิด flush ของค้างก่อน |
| `src/config.ts` | อ่านและตรวจค่า environment ทั้งหมดด้วย zod รวมเป็น object `config` ที่เดียว |
| `tools/seed.ts` | สร้างข้อมูลเดโม: 2 tenant, ผู้ใช้, collector, กฎแจ้งเตือน, traffic 24 ชม. และชุดเดารหัสผ่านที่ทำให้เกิด alert — สร้าง payload ดิบของแต่ละแหล่งแล้วส่งผ่าน parser จริง |
| `test/parsers.test.ts` | เทสต์ parser ทุกแหล่ง รวม sample ข้อ 4.1–4.7 ของโจทย์ |
| `test/migrate.test.ts` | เทสต์ว่า checksum เดิมก่อนลบ comment ยังถูกยอมรับ และ migration ที่ถูกแก้จริงยังถูกปฏิเสธ |
| `test/enrich.test.ts` | เทสต์ enrichment: ไฟล์ GeoIP หาย, provider พัง, DNS ค้าง — event ต้องรอดทุกกรณี |
| `test/isolation.test.ts` | **เทสต์ความปลอดภัย** จงใจเขียน query ผิดเพื่อพิสูจน์ว่า RLS กันข้าม tenant และลบ log ไม่ได้แม้เป็น Admin (ต้องมีฐานข้อมูล) |
| `vitest.config.ts` | ตั้งค่าเทสต์ ไม่รันพร้อมกันเพราะใช้ฐานข้อมูลร่วม |
| `tsconfig.json` · `package.json` | ตั้งค่า TypeScript และ dependency |
| `Dockerfile` | build 2 ขั้น: compile TypeScript แล้วสร้าง image เบาพร้อมไฟล์ migration |

---

### ชั้น 2 · Frontend — `frontend/src/`

| ไฟล์ | หน้าที่ |
|---|---|
| `main.tsx` | จุดเริ่มแอป ตั้ง React Query ให้ดึงข้อมูลใหม่ทุก 30 วิ |
| `App.tsx` | ตรวจว่าล็อกอินหรือยัง, แถบข้างแบบติดหน้าจอ, ปุ่ม Sign out, กำหนด route |
| `api/client.ts` | ตัวเรียก API: ส่ง cookie ทุกครั้ง, ใส่ `content-type: application/json` ทุก mutation, อัปโหลดไฟล์, type ของข้อมูลทุกชนิด |
| `components/common.tsx` | ส่วนประกอบใช้ซ้ำ: เลือกช่วงเวลา, เลือก tenant (Admin เท่านั้น), การ์ดตัวเลข, ป้ายผลลัพธ์, จัดรูปแบบเวลา |
| `pages/Login.tsx` | หน้าเข้าสู่ระบบ |
| `pages/Dashboard.tsx` | การ์ดสรุป, กราฟเส้นตามเวลา, อันดับผู้ใช้ / IP / ประเภทเหตุการณ์ / ประเทศ, รายการล่าสุด |
| `pages/Search.tsx` | ค้นหาข้ามทุกแหล่ง กรองตามเวลา ผลลัพธ์ แหล่ง ผู้ใช้ IP/CIDR ประเทศ และเปิดดู payload ดิบได้ |
| `pages/Alerts.tsx` | รายการ alert และปุ่ม Acknowledge |
| `pages/Admin.tsx` | จัดการ collector (สร้าง, ปิด, หมุน token, อัปโหลดไฟล์), กฎ, ผู้ใช้, tenant, audit trail, partition |
| `styles.css` | ธีมขาวมินิมอล |

**ไฟล์ตั้งค่า frontend**

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` · `vite.config.ts` · `tsconfig.json` | build ด้วย Vite, dev proxy `/api` ไปพอร์ต 8080 |
| `Dockerfile` | build ด้วย Node แล้วเสิร์ฟด้วย nginx |

---

### ชั้น 1 · Edge — nginx และ Caddy

| ไฟล์ | หน้าที่ |
|---|---|
| `frontend/nginx.conf` | server block พอร์ต 80 และ 443 (`__API_HOST__` ถูกแทนตอน build) |
| `frontend/siem-app.conf` | location ที่ใช้ร่วมกันทั้งสองพอร์ต: SPA fallback, proxy `/api` และ `/ingest` ไป backend |
| `frontend/tls-entrypoint.sh` | สร้างใบรับรอง self-signed ตอน container เริ่ม ถ้ายังไม่มี |
| `deploy/Caddyfile` | Caddy ขอและต่ออายุใบรับรอง Let's Encrypt อัตโนมัติ แล้วส่งต่อให้ nginx |

---

### Deploy · Scripts · Samples

| ไฟล์ | หน้าที่ |
|---|---|
| `docker-compose.yml` | stack หลัก: `db` `backend` `web` (โหมด SaaS / เครื่องพัฒนา) |
| `docker-compose.appliance.yml` | overlay โหมด appliance: ผูกพอร์ตกับ `127.0.0.1` ปิด webhook |
| `docker-compose.caddy.yml` | overlay ขึ้นอินเทอร์เน็ต: Caddy ถือพอร์ต 80/443, `TRUST_PROXY_HOPS=2`, ปิด publish ฐานข้อมูล |
| `deploy/cloud-init.yaml` | ติดตั้ง Docker, swap, firewall บน VM ตอนบูตครั้งแรก |
| `scripts/provision-azure.sh` | สร้าง VM บน Azure พร้อม static IP และ NSG ถ้าขนาดที่ขอใช้ไม่ได้จะลองขนาดถัดไปเอง |
| `scripts/fetch-geoip.sh` | ดาวน์โหลดฐานข้อมูล DB-IP Lite (`--with-asn` เพิ่มข้อมูล ASN) |
| `samples/*.json` · `samples/*.log` | log ตัวอย่างตามโจทย์ข้อ 4 ทุกแหล่ง |
| `samples/send_syslog.sh` | ส่ง syslog ตัวอย่าง (`--brute` ส่งชุดที่ทำให้เกิด alert) |
| `samples/post_logs.py` | ส่ง JSON ตัวอย่างเข้า `/ingest` (`--simulate N` สร้าง traffic สุ่ม) |
| `.env.example` · `.env.saas.example` · `.env.appliance.example` | แม่แบบค่าตั้ง — คัดลอกเป็น `.env` แล้วเปลี่ยนรหัสผ่าน |
| `Makefile` · `run.sh` | คำสั่งลัด (`run.sh` สำหรับเครื่องที่ไม่มี `make`) |
| `.gitattributes` | บังคับไฟล์สคริปต์เป็น LF ไม่งั้นรันบน Linux ไม่ได้ |

---

## 4. จุดที่ห้ามแก้ผิด

รวมเหตุผลเชิงออกแบบที่เคยอยู่ใน comment ทุกข้อเกิดจากบั๊กจริงหรือเป็นเงื่อนไขความปลอดภัย

### ความปลอดภัยของข้อมูล

| # | กฎ | อยู่ที่ | ถ้าผิดจะเกิดอะไร |
|---|---|---|---|
| 1 | เข้าฐานข้อมูลผ่าน `tenant.ts` เท่านั้น | `db/tenant.ts` | route ข้าม role / tenant ได้ |
| 2 | `set_config('app.tenant_id', …, true)` ตัวสุดท้ายต้องเป็น `true` | `db/tenant.ts` | ถ้าเป็น session-level connection ที่คืนเข้า pool จะพา tenant เดิมไปให้ request ถัดไป **ข้อมูลรั่วข้ามลูกค้า** |
| 3 | ไม่ปักหมุด tenant = ต้องได้ 0 แถว | `002_rls.sql` (`app_tenant_id()`) | ถ้าเปลี่ยนให้คืนทุกแถว RLS จะไร้ความหมาย |
| 4 | ห้าม `GRANT UPDATE/DELETE` บน `events` และ `audit_log` ให้ role ใด | `002_rls.sql` | ผู้บุกรุกที่ยึดบัญชี Admin ลบร่องรอยตัวเองได้ |
| 5 | ให้สิทธิ์บนตาราง `events` ตัวแม่เท่านั้น ไม่ให้บน partition | `002_rls.sql` | เข้า partition ตรง ๆ แล้วข้าม policy ได้ |
| 6 | `FORCE ROW LEVEL SECURITY` มีผลกับ owner ด้วย — owner ต้องมี policy `SELECT` บน `tenants` `users` `collectors` | `002_rls.sql` | **ล็อกอินไม่ได้ทั้งระบบ** และ ingest ทุกช่องทางพัง (ฟังก์ชัน `SECURITY DEFINER` รันเป็น owner) |
| 7 | tenant มาจาก collector เสมอ ไม่ใช่จากค่าใน payload | `ingest/collectors.ts` | ผู้ส่งอ้างเป็น tenant อื่นได้ (`tenant` ใน payload ถูกเก็บไว้ใน `attrs.claimed_tenant` เท่านั้น) |
| 8 | role ทุกตัว `NOBYPASSRLS` ถูกตั้งซ้ำทุกครั้งที่บูต | `db/bootstrap.ts` | มีคนเผลอให้สิทธิ์เกินแล้วค้างอยู่ถาวร |

### ความถูกต้องของระบบ

| # | กฎ | อยู่ที่ | ถ้าผิดจะเกิดอะไร |
|---|---|---|---|
| 9 | enrichment ต้องรัน **ก่อน** เปิด transaction | `pipeline/writer.ts` | DNS ช้า → ถือ connection ค้าง → pool หมด |
| 10 | `enrichBatch` ห้าม throw และห้ามทิ้ง event | `enrich/index.ts` | log หายเพราะ lookup พัง |
| 11 | reverse DNS อ่าน cache อย่างเดียว ครั้งแรกที่เจอ IP ได้ `null` เป็นเรื่องปกติ | `enrich/rdns.ts` | nameserver ค้าง = ingest ทั้งระบบค้าง |
| 12 | `parser` ที่ throw ต้องกลายเป็น event แบบ `parse_ok=false` เก็บ `raw` ไว้ | `normalize/index.ts` | format เปลี่ยนนิดเดียว log หายเงียบ |
| 13 | `TRUST_PROXY_HOPS` ต้องเท่ากับจำนวน proxy จริง (nginx = 1, Caddy+nginx = 2) | `auth/rbac.ts` · `config.ts` | audit trail บันทึก IP ของ container แทน IP ผู้ใช้ |
| 14 | frontend ต้องส่ง `content-type: application/json` ทุก POST/PATCH/DELETE แม้ไม่มี body | `frontend/src/api/client.ts` | ปุ่ม Sign out / Acknowledge / Rotate token ได้ 415 |
| 15 | seed เป็น process แยก ต้องเรียก `initGeoip()` เอง | `tools/seed.ts` | ข้อมูลเดโมมี hostname แต่ไม่มีประเทศ |
| 16 | ห้ามแก้ migration ที่ apply แล้ว — เพิ่มไฟล์ใหม่แทน ถ้าแก้แค่ comment/ช่องว่าง ต้องเพิ่ม checksum เดิมลง `checksums.ts` | `db/migrate.ts` · `db/checksums.ts` | backend ไม่ยอมบูต (checksum ไม่ตรง) |
| 17 | ไฟล์ `.sh` ต้องเป็น LF | `.gitattributes` | `bad interpreter: /usr/bin/env bash^M` บน VM |

---

## 5. คำสั่งที่ใช้บ่อย

### เริ่มระบบ

```bash
./run.sh              # โหมด SaaS + ใส่ข้อมูลเดโม
./run.sh appliance    # โหมด appliance
./run.sh down         # หยุด เก็บข้อมูลไว้
./run.sh clean        # หยุดและลบข้อมูลทั้งหมด
```

### Makefile

| คำสั่ง | ทำอะไร |
|---|---|
| `make up` | build และเริ่ม stack (SaaS) |
| `make appliance` | เริ่มโหมด appliance |
| `make seed` | ใส่ข้อมูลเดโม |
| `make geoip` | ดาวน์โหลดฐานข้อมูล GeoIP |
| `make samples` | ส่ง syslog ตัวอย่าง (`TOKEN=sk_…` เพื่อส่ง JSON ด้วย) |
| `make brute` | ส่งชุดล็อกอินผิดที่ทำให้เกิด alert |
| `make test` | รันเทสต์ทั้งหมด (ต้องมีฐานข้อมูลรันอยู่) |
| `make typecheck` | ตรวจ type ทั้ง backend และ frontend |
| `make logs` · `make ps` · `make health` · `make psql` | ดู log · สถานะ · เช็ก API · เปิด psql |
| `make down` · `make clean` | หยุด · หยุดและลบข้อมูล |

### backend (`cd backend`)

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | รัน API + syslog แบบ watch |
| `npm test` | รันเทสต์ (ชุดที่ต้องใช้ฐานข้อมูลจะข้ามเองถ้าไม่มี) |
| `npm run migrate` · `npm run seed` | migration · ข้อมูลเดโม |

### frontend (`cd frontend`)

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | หน้าเว็บที่ `:5173` proxy `/api` ไป `:8080` |
| `npm run build` | build สำหรับ production |

### บัญชีเดโม

รหัสผ่านทุกบัญชี `demo-password-change-me`

| อีเมล | บทบาท |
|---|---|
| `admin@siem.local` | Admin — ทุก tenant |
| `viewer@northwind.local` | Viewer — Northwind Traders |
| `viewer@contoso.local` | Viewer — Contoso Ltd |

---

## 6. เอกสารอื่น

| ไฟล์ | เนื้อหา |
|---|---|
| [`RUNBOOK.md`](RUNBOOK.md) | คู่มือรันและตรวจสอบระบบ |
| [`ไฟล์อธิบายการเปิดข้อมูลต่างๆ.md`](ไฟล์อธิบายการเปิดข้อมูลต่างๆ.md) | วิธีเปิดระบบ และเข้าดูข้อมูลดิบ: ฐานข้อมูล, API, log, ไฟล์ตัวอย่าง, ใบรับรอง |
| [`docs/architecture.md`](docs/architecture.md) | สถาปัตยกรรม, data flow, tenant model, เหตุผลการเลือกเทคโนโลยี |
| [`docs/setup_appliance.md`](docs/setup_appliance.md) | ติดตั้งแบบ appliance ทีละขั้น |
| [`docs/setup_saas.md`](docs/setup_saas.md) | ติดตั้งแบบ SaaS ทีละขั้น |
| [`docs/deploy_azure.md`](docs/deploy_azure.md) | deploy บน Azure VM พร้อม TLS จริง |

ข้อมูลตำแหน่ง IP โดย DB-IP — <https://db-ip.com> (CC-BY 4.0)
