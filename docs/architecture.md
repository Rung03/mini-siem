# สถาปัตยกรรม — Mini Log Management / SIEM

## 1. ภาพรวม

```
  แหล่งข้อมูล                 ช่องทางรับ              ประมวลผล                 เก็บ / ใช้งาน
 ─────────────            ──────────────         ──────────────          ──────────────────

 Firewall / Router  ──syslog UDP/TCP 514──┐
                                          │
 App / M365 / API   ──HTTPS POST /ingest──┼──►  resolve collector
                                          │      (ใครส่ง → tenant ไหน)
 AWS / AD /         ──upload ไฟล์ batch───┘              │
 CrowdStrike                                             ▼
                                                   parser ตามแหล่ง
                                              (6 ตัว → schema กลางเดียว)
                                                         │
                                                         ▼
                                                  batcher / writer
                                                         │
                                                         ▼
                                              ┌──── PostgreSQL 17 ────┐
                                              │  events               │
                                              │  PARTITION BY ts (วัน)│
                                              │    └ BY tenant_id     │
                                              │  + RLS ทุกตาราง        │
                                              └───────────┬───────────┘
                                                          │
                          ┌───────────────────┬───────────┴────────────┐
                          ▼                   ▼                        ▼
                    REST API            Dashboard (React)      ตัวตรวจกฎทุก 30 วิ
                    /api/events         Top N / Timeline       → alerts → webhook
                    /api/stats/*        Search / Filter
```

## 2. เหตุผลการเลือกเทคโนโลยี

| ส่วน | เลือกใช้ | ทำไม |
|---|---|---|
| Backend | Node 24 + TypeScript + Express 5 | ภาษาเดียวกับ frontend, ecosystem พร้อม, ไม่ต้อง compile native ตอนติดตั้ง appliance |
| Storage | PostgreSQL 17 | **เหตุผลหลักคือ Row Level Security** — เป็น datastore เดียวในตัวเลือกที่บังคับการแยก tenant ได้ที่ตัว engine ไม่ใช่ที่โค้ด ส่วน declarative partitioning ทำให้ retention เป็นการ DROP TABLE แทนการ DELETE ทีละแถว |
| Frontend | React 18 + Vite + TanStack Query + Recharts | build เร็ว, เสิร์ฟเป็น static ผ่าน nginx ได้ ไม่ต้องมี Node runtime ฝั่ง frontend ตอน production |
| Password hash | `scrypt` จาก `node:crypto` | memory-hard และอยู่ใน stdlib — argon2/bcrypt ต้อง compile native addon ซึ่ง appliance ที่ต้องติดตั้งบนเครื่องลูกค้าไม่ควรพึ่งพา |
| Packaging | Docker Compose | ขึ้นทั้งระบบด้วยคำสั่งเดียวตามข้อกำหนด appliance |

**ที่ไม่เลือก OpenSearch/ClickHouse:** ทั้งคู่ค้นหาเร็วกว่าในระดับ TB แต่ไม่มีกลไกแยก tenant ที่บังคับได้ที่ engine ระดับเดียวกับ RLS ซึ่งเป็นข้อกำหนดข้อ 2.2 ที่เราให้น้ำหนักสูงสุด สำหรับขนาดเดโมนี้ Postgres + partition + index เพียงพอ

## 3. การไหลของข้อมูล (ingest → query)

1. **รับเข้า** — 3 ช่องทาง 2 โปรโตคอล
   - Syslog UDP **และ** TCP พอร์ต 514 (TCP รองรับทั้ง RFC6587 octet-counting และ LF framing)
   - `POST /ingest` พร้อม `Authorization: Bearer <collector token>` รับทั้ง object เดียว, array, NDJSON และ `{"Records":[...]}`
   - อัปโหลดไฟล์ผ่าน `POST /api/ingest/file` (`.log/.json/.ndjson/.csv`)

2. **หา tenant** — ทำจากช่องทาง **ไม่ใช่จากเนื้อ payload**
   - HTTP → hash ของ bearer token → แถว collector
   - Syslog → IP ต้นทาง เทียบ CIDR ของ collector (เจาะจงที่สุดชนะ)
   - อัปโหลด → collector ที่เลือก ตรวจว่าเป็นของ tenant ผู้ใช้จริง

   ตัวอย่าง log ในโจทย์มีฟิลด์ `tenant` อยู่ในตัว payload เราเก็บไว้ที่ `attrs.claimed_tenant` แต่**ไม่ใช้ในการ route** เพราะผู้ส่งที่ระบุ tenant ตัวเองได้ ก็ระบุของคนอื่นได้ — ข้อ 2.2 ระบุให้ใช้ parameter/header/claim ซึ่งตรงกับวิธีนี้

3. **แปลง** — parser 6 ตัวเลือกจาก `source_type` ของ collector ไม่ใช่จาก payload (ผู้ส่งจึงเลือกไม่ได้ว่าจะให้ตีความแบบไหน) parser ทุกตัวเป็น pure function และถูก unit test

   ตัวอย่างบางชุดในโจทย์มาในรูป "half-normalized" อยู่แล้ว (มี `@timestamp`, `source`, `event_type`) จึงมี **common envelope parser** กลางตัวหนึ่งที่ parser ทุกตัวลองก่อน แล้วค่อย fallback ไปที่ฟอร์แมตจริงของ vendor

4. **Enrich** — เติมข้อมูลว่า IP ต้นทางอยู่ที่ไหนและ resolve เป็นชื่ออะไร
   (รายละเอียดหัวข้อ 4.1)

5. **เขียน** — syslog ผ่าน batcher (รวมแล้ว insert ทีละชุด เพราะ 1 transaction ต่อ 1 datagram ช้าเกินไป) ส่วน HTTP เขียนตรงเพราะผู้เรียกรอ status code อยู่ ถ้าตอบ 202 ทั้งที่ยังอยู่ในคิวคือโกหก

6. **ค้น / แสดงผล** — query เดียวข้ามทุกแหล่งได้ เพราะ normalize ตั้งแต่ขาเข้า

### 4.1 Enrichment (ข้อ 2.3 nice-to-have)

เติมตอน ingest ที่ `insertEvents()` ซึ่งเป็นจุดรวมของทุกช่องทาง และทำ
**ก่อน** เปิด transaction เสมอ เพราะถือ connection ค้างไว้ระหว่างรอ DNS
ไม่คุ้มกัน

หลักการเดียวที่ยึด: **enrichment คือของประดับ ห้ามทำให้ log หาย**
ไม่มีไฟล์ GeoIP ก็ได้, provider พังก็ได้, DNS ค้างก็ได้ — event ยังถูกเก็บ
เหมือนเดิมทุกกรณี

**GeoIP** — อ่านจากไฟล์ `.mmdb` ในเครื่อง ไม่ใช่เรียก API เพราะ appliance
ไม่มีทางออกอินเทอร์เน็ต ใช้ DB-IP Lite (CC-BY 4.0) ดาวน์โหลดด้วย `make geoip`
ตัวอ่านเป็น pure JavaScript ด้วยเหตุผลเดียวกับที่เลือก scrypt — appliance ที่
ต้อง compile native addon บนเครื่องลูกค้าคือ appliance ที่ติดตั้งไม่สำเร็จ

> ข้อมูล IP geolocation จาก DB-IP (<https://db-ip.com>) — CC-BY 4.0

**Reverse DNS — ไม่บล็อกการเขียนเด็ดขาด**

`dns.reverse()` ต่อ resolver ที่ล่มอาจค้างเป็นวินาที ส่วน syslog รับเป็นพัน
event ต่อวินาที การรอมันคือการเปลี่ยนปัญหา nameserver ให้กลายเป็น ingest ล่ม
เพื่อฟิลด์ที่เป็นแค่ของประดับ

ตัว enricher จึงอ่าน**จาก cache อย่างเดียว** ถ้าไม่เจอจะคืน null แล้วสั่ง
lookup ไว้เบื้องหลัง ผลคือ

- event แรกจาก IP ที่ไม่เคยเห็น → ไม่มี hostname
- event ถัดไปจาก IP เดิม → มี

นี่คือ trade-off ที่ตั้งใจ ไม่ใช่บั๊ก จำกัด lookup พร้อมกันไว้ 8 ตัวและจำกัดคิว
เพื่อไม่ให้ IP แปลกหน้าจำนวนมากทำให้งานบานปลาย ผลที่หาไม่เจอก็ cache ไว้
(TTL สั้นกว่า) จะได้ไม่ถามซ้ำทุก packet

`RDNS_SERVERS` ตั้ง nameserver เองได้ — ค่าว่างคือใช้ของเครื่อง ซึ่งถูกสำหรับ
appliance จริง แต่ผิดในคอนเทนเนอร์ เพราะ DNS ฝังของ Docker ไม่ forward
reverse lookup บน appliance ให้ชี้ไป DNS ภายในที่รู้จักชื่อเครื่องพนักงาน

**IP ภายในไม่ถูก geolocate** — ถาม GeoIP ว่า 10.0.0.5 อยู่ไหนคือเสีย lookup
ฟรีเพื่อได้คำตอบว่า "ไม่อยู่ไหน" แต่ยังทำ reverse DNS เพราะ PTR ภายในคือสิ่งที่
เปลี่ยน 10.0.0.44 ให้เป็น `WS-114.corp.local` ช่วง documentation ของ RFC5737
(`203.0.113.x` ฯลฯ) ที่ใช้ในข้อมูลตัวอย่างถูกจัดเป็น reserved จึงข้ามทั้งสองอย่าง

ทุก event ได้ tag `public-ip` หรือ `private-ip` และถ้าระบุตำแหน่งได้จะได้
`geo:<ISO>` เพิ่ม

## 4. Schema กลาง

ตาราง `events` ครอบคลุมฟิลด์ตามหัวข้อ 3 ของโจทย์

| กลุ่ม | คอลัมน์ |
|---|---|
| เวลา | `ts` (RFC3339), `received_at` |
| ที่มา | `source` (firewall\|network\|api\|crowdstrike\|aws\|m365\|ad), `source_type` (parser ที่อ่าน), `vendor`, `product`, `collector_id` |
| เหตุการณ์ | `event_type`, `event_subtype`, `event_category`, `action`, `event_outcome`, `severity` (0–10) |
| ตัวตน | `user_name`, `host`, `process` |
| เครือข่าย | `src_ip`, `src_port`, `dst_ip`, `dst_port`, `protocol` |
| HTTP | `url`, `http_method`, `status_code` |
| กฎ | `rule_name`, `rule_id` |
| คลาวด์ | `cloud_account_id`, `cloud_region`, `cloud_service` |
| enrichment | `src_hostname`, `geo_country_iso`, `geo_country`, `geo_city`, `geo_lat`, `geo_lon`, `asn`, `as_org` |
| อื่น | `message`, `raw`, `attrs` (jsonb), `tags` (text[]), `parse_ok` |

- `raw` **เก็บ payload ดิบทั้งก้อนเสมอ** ไม่ตัดทิ้ง
- `parse_ok` — บรรทัดที่แปลงไม่ได้ยังถูกเก็บ ไม่ถูกทิ้ง แค่ติดธงไว้
- `severity` ใช้สเกล 0–10 ตามโจทย์ (10 = หนักสุด) syslog นับกลับทาง จึงมีตัวแปลงให้

**Index:** `(tenant_id, ts)`, `(tenant_id, user_name, ts)`, `(tenant_id, src_ip, ts)`, `(tenant_id, event_type, ts)`, `(tenant_id, source, ts)`, `(tenant_id, action, ts)`, partial index บน `event_outcome='failure'` สำหรับ query ของตัวตรวจกฎ และ GIN บน `tags`

## 5. Tenant model

**การแยกข้อมูลบังคับที่ฐานข้อมูล ไม่ใช่ที่โค้ด** — นี่คือแกนของงานนี้

Role ในฐานข้อมูล 4 ตัว ไม่มีตัวไหนเป็น superuser และไม่มีตัวไหนมี `BYPASSRLS`

| role | ใช้เมื่อ | เห็นอะไร |
|---|---|---|
| `siem_owner` | migration, สร้าง/ลบ partition | DDL เท่านั้น |
| `siem_app` | ผู้ใช้ Viewer | tenant เดียวที่ปักหมุดไว้ |
| `siem_admin` | ผู้ใช้ Admin | ทุก tenant |
| `siem_evaluator` | ตัวตรวจกฎ | อ่านข้าม tenant เขียน alert |

ทุกตารางเปิด `ENABLE` **และ** `FORCE ROW LEVEL SECURITY` (FORCE สำคัญ เพราะเจ้าของตารางจะข้าม policy ตัวเองได้ถ้าไม่ใส่)

การปักหมุด tenant ทำที่ระดับ transaction:

```sql
SELECT set_config('app.tenant_id', $1, true);
--                                     ^^^^ is_local = true
```

`true` ทำให้ค่าอยู่แค่ใน transaction นั้น connection ที่คืนเข้า pool จึงไม่พาค่าของ tenant เดิมไปให้ request ถัดไป — **นี่คือรายละเอียดที่สำคัญที่สุดในระบบทั้งหมด** ถ้าใช้ `SET` ระดับ session แทน จะกลายเป็นช่องรั่วข้าม tenant ทันทีที่ connection ถูกใช้ซ้ำ

ถ้าลืมปักหมุด → `app_tenant_id()` คืน NULL → policy ไม่ match อะไรเลย → ได้ 0 แถว ไม่ใช่ทุกแถว (fail closed)

`GRANT` ให้เฉพาะตาราง `events` ตัวแม่ **ไม่เคยให้บน partition ย่อย** Postgres ตรวจสิทธิ์ที่ตัวแม่เมื่อเข้าถึงผ่านตัวแม่ ดังนั้น query ปกติทำงานได้ แต่ role ของแอปเอื้อมไปแตะ partition ตรง ๆ เพื่อข้าม policy ไม่ได้

**Multi-tenant จริง (คะแนนพิเศษ):** `events` แบ่ง `PARTITION BY RANGE (ts)` รายวัน แล้วซ้อน `PARTITION BY LIST (tenant_id)` อีกชั้น ข้อมูลของแต่ละลูกค้าจึงอยู่คนละตารางจริง ๆ ไม่ใช่แค่คนละแถว

## 6. Append-only

ไม่มี role ไหนได้ `UPDATE` หรือ `DELETE` บน `events` และ `audit_log` เลย

```
$ psql -U siem_admin -c "DELETE FROM events;"
ERROR:  permission denied for table events
```

Admin ลบ log ไม่ได้ — ถ้าผู้ดูแลลบได้ ผู้บุกรุกที่ยึดบัญชีผู้ดูแลก็ลบร่องรอยตัวเองได้ ข้อมูลหายทางเดียวคือ retention drop partition ทั้งวันเมื่อครบ 7 วัน

## 7. Alert

`alert_rules` เก็บเงื่อนไขเป็นข้อมูล ไม่ใช่โค้ด: filter (category/action/outcome/source), `group_by`, `window_seconds`, `threshold`, `severity`, `suppress_seconds`, `webhook_url`

ตัวตรวจทำงานทุก 30 วินาที แปลงแต่ละกฎเป็น aggregate query ครั้งเดียว กฎเดโมตามโจทย์คือ outcome=failure, group by src_ip, window 300s, threshold 5

**การกันยิงซ้ำ:** brute force ที่รันยาว 1 ชั่วโมงจะทำให้เกิด alert 120 ใบถ้าไม่กัน จึงใช้ `dedupe_key = (rule, group, ช่วง suppress)` + unique index — การโจมตีที่ยังดำเนินอยู่จะ **อัปเดต** alert เดิมแทนการสร้างใหม่

Webhook ส่งแบบแยกรอบ อ่านจากตาราง ไม่ได้ยิงตอน alert เกิด ปลายทางที่ช้าหรือล่มจึงไม่ถ่วงการตรวจกฎ และถ้า process ตายกลางคัน alert ยังค้างคิวไว้ไม่หาย

## 8. สองโหมดการติดตั้ง

ใช้ image และโค้ดชุดเดียวกัน ต่างกันแค่ไฟล์ตั้งค่า — ไม่มี `if (isAppliance)` ในโค้ดแอปเลย

- **SaaS** — `docker-compose.yml` เปิด HTTPS (self-signed) ที่ 8443
- **Appliance** — เพิ่ม overlay 20 บรรทัด ผูกทุกพอร์ตกับ `127.0.0.1` ยกเว้น syslog 514 ที่ต้องให้อุปกรณ์เครือข่ายส่งเข้ามาได้ และปิด webhook ขาออก

> รายละเอียด overlay: ต้องใช้ YAML tag `!override` เพราะ Compose **ต่อท้าย** list เวลา merge ไม่ได้แทนที่ ถ้าไม่ใส่จะ publish พอร์ตซ้ำสองรอบแล้วชนกันเอง

## 9. ที่ระบบนี้ไม่ได้ทำ

- ไม่ได้ออกแบบมารับข้อมูลระดับ TB — Postgres + partition พอสำหรับเดโม ถ้าต้องสเกลจริงต้องย้าย hot path ไป ClickHouse/OpenSearch แล้วยกการแยก tenant ขึ้นมาทำที่ชั้น query ซึ่งอ่อนกว่าปัจจุบัน
- enrichment เติมตอน ingest เท่านั้น ไม่ย้อนเติมข้อมูลเก่า ถ้าเพิ่งลง GeoIP
  ทีหลัง แถวที่เก็บไปแล้วจะยังว่าง
- ไม่มี CI/CD และ IaC
- Admin ที่เลือกดู "ทุก tenant" อาศัย WHERE ในโค้ดกรอง ไม่ใช่ RLS (RLS ของ role นี้คือ `USING (true)` โดยตั้งใจ) — การรับประกันด้วยฐานข้อมูลครอบคลุม **Viewer** ซึ่งเป็นกรณีที่สำคัญ
