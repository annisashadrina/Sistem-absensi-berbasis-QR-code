# SISTEM ABSENSI KARYAWAN BERBASIS QR CODE DINAMIS

## 1. Gambaran Umum

Sistem Absensi Karyawan merupakan sistem berbasis web yang digunakan untuk mencatat kehadiran dan kepulangan karyawan secara terpusat ke dalam database perusahaan.

Sistem menggunakan **QR Code dinamis yang berubah setiap 5 detik** sebagai mekanisme validasi absensi. Karyawan tidak perlu menginstal aplikasi mobile karena seluruh proses dapat dilakukan melalui browser pada smartphone.

QR Code dapat dipindai menggunakan:

1. Kamera bawaan smartphone.
2. Scanner QR yang tersedia pada website absensi.

Sistem menggunakan **server timestamp** sebagai sumber waktu utama sehingga waktu pada perangkat karyawan tidak dapat digunakan untuk memanipulasi waktu absensi.

Untuk tahap awal, sistem **tidak menggunakan GPS/geolocation**.

---

# 2. Tujuan Sistem

Sistem dibuat untuk:

* Mencatat waktu masuk karyawan.
* Mencatat waktu pulang karyawan.
* Menentukan status tepat waktu atau terlambat.
* Mengurangi praktik titip absen.
* Menggunakan QR Code yang berubah setiap 5 detik.
* Menyimpan data absensi secara terpusat.
* Menyediakan dashboard admin untuk memantau kehadiran.
* Menyediakan rekap absensi berdasarkan tanggal dan karyawan.
* Memungkinkan karyawan melakukan absensi tanpa aplikasi mobile.

---

# 3. Konsep Utama Sistem

Sistem terdiri dari beberapa komponen utama:

```text
Karyawan
   │
   ▼
Smartphone / Browser
   │
   ├── Kamera HP
   │
   └── Web QR Scanner
   │
   ▼
Frontend Web
   │
   ▼
Backend API
   │
   ├── Authentication
   ├── QR Token Validation
   ├── Attendance Service
   ├── Time Validation
   └── Employee Validation
   │
   ▼
Database PostgreSQL
   │
   ▼
Admin Dashboard
```

---

# 4. Prinsip Keamanan

Sistem tidak hanya bergantung pada QR Code.

Keamanan absensi menggunakan beberapa lapisan:

```text
Dynamic QR
     +
Short-lived Token
     +
Employee Authentication
     +
Server Timestamp
     +
Attendance Validation
     =
Absensi lebih sulit disalahgunakan
```

QR Code berfungsi sebagai **temporary challenge**, sedangkan identitas karyawan berasal dari session login.

---

# 5. QR Code Dinamis

## 5.1 Mekanisme

QR Code dibuat oleh server dan berubah setiap **5 detik**.

Contoh:

```text
07:59:00 - 07:59:05
TOKEN_A

07:59:05 - 07:59:10
TOKEN_B

07:59:10 - 07:59:15
TOKEN_C
```

Token sebelumnya otomatis tidak berlaku ketika periode waktunya berakhir.

---

## 5.2 Isi QR Code

QR Code tidak menyimpan identitas karyawan.

Contoh:

```text
https://absensi.company.com/a/8f73a91...
```

Token tersebut memiliki karakteristik:

* dibuat oleh server;
* memiliki expiration time;
* hanya berlaku dalam periode singkat;
* tidak dapat digunakan setelah expired;
* tidak digunakan untuk menentukan identitas karyawan.

Identitas karyawan diperoleh dari authentication session.

---

# 6. Jenis QR Code

Sistem memiliki dua jenis QR Code.

## 6.1 QR Check-In

Digunakan untuk absensi masuk.

```text
type = CHECK_IN
```

QR aktif sesuai konfigurasi jam absensi masuk.

---

## 6.2 QR Check-Out

Digunakan untuk absensi pulang.

```text
type = CHECK_OUT
```

QR Check-Out **baru ditampilkan mulai pukul 16.00**.

Sebelum pukul 16.00, QR Check-Out tidak tersedia.

---

# 7. Flow Absensi Masuk

## 7.1 Karyawan Scan QR

Karyawan datang ke perusahaan dan melakukan scan QR.

Ada dua metode.

### Metode A — Kamera HP

```text
Kamera HP
    ↓
Scan QR
    ↓
Browser membuka URL
    ↓
Web Absensi
```

Karyawan tidak perlu membuka aplikasi khusus.

---

### Metode B — Web Scanner

Karyawan membuka website:

```text
https://absensi.company.com
```

Kemudian memilih:

```text
[ SCAN QR CODE ]
```

Website meminta izin menggunakan kamera.

```text
Browser
   ↓
Camera Permission
   ↓
QR Scanner
   ↓
QR terbaca
```

---

# 8. Authentication Session

Setelah QR dipindai, sistem memeriksa apakah browser memiliki session karyawan yang masih valid.

## Jika session valid

```text
Scan QR
   ↓
Session ditemukan
   ↓
Identitas karyawan diketahui
   ↓
Validasi QR
   ↓
Proses absensi
```

Karyawan tidak perlu login kembali.

---

## Jika session tidak tersedia

Misalnya karena:

* browser berbeda;
* cookies dihapus;
* site data dihapus;
* session expired;
* perangkat baru;
* karyawan melakukan logout.

Maka:

```text
Scan QR
   ↓
Session tidak ditemukan
   ↓
Halaman Login
   ↓
Karyawan login
   ↓
Session dibuat
   ↓
Kembali ke proses absensi
```

Sistem menggunakan **secure persistent session cookie**, bukan mengandalkan browser cache.

---

# 9. Validasi Absensi Masuk

Setelah identitas karyawan diketahui, backend melakukan validasi.

```text
1. Apakah session valid?
2. Apakah karyawan terdaftar?
3. Apakah karyawan aktif?
4. Apakah QR valid?
5. Apakah token belum expired?
6. Apakah token sesuai dengan CHECK_IN?
7. Apakah token belum digunakan?
8. Apakah karyawan belum melakukan check-in hari ini?
9. Ambil server timestamp
10. Tentukan status absensi
11. Simpan ke database
```

Jika seluruh validasi berhasil, absensi diterima.

---

# 10. Penentuan Status Tepat Waktu

Batas waktu masuk adalah:

```text
08:00:00
```

Sistem menggunakan waktu server.

Aturan:

```text
check_in_time <= 08:00:00
        ↓
    ON_TIME
```

dan:

```text
check_in_time > 08:00:00
        ↓
      LATE
```

Contoh:

| Waktu Check-In | Status  |
| -------------- | ------- |
| 07:30:00       | ON_TIME |
| 07:45:21       | ON_TIME |
| 07:59:59       | ON_TIME |
| 08:00:00       | ON_TIME |
| 08:00:01       | LATE    |
| 08:05:10       | LATE    |

---

# 11. Contoh Check-In Berhasil

Budi melakukan scan pukul:

```text
07:52:14
```

Backend mendapatkan:

```text
employee_id = EMP001
server_time = 07:52:14
qr_type = CHECK_IN
```

Hasil:

```text
status = ON_TIME
```

Data disimpan:

```text
employee_id   = EMP001
attendance_date = 2026-09-23
check_in_time = 07:52:14
check_in_status = ON_TIME
```

---

# 12. Contoh Check-In Terlambat

Andi melakukan scan pukul:

```text
08:04:21
```

Backend mendapatkan:

```text
employee_id = EMP002
server_time = 08:04:21
qr_type = CHECK_IN
```

Karena:

```text
08:04:21 > 08:00:00
```

maka:

```text
check_in_status = LATE
```

---

# 13. Tampilan Setelah Check-In

Setelah absensi berhasil, website menampilkan:

```text
┌──────────────────────────────┐
│       ABSENSI BERHASIL       │
│                              │
│       BUDI SANTOSO           │
│                              │
│       07:52:14               │
│                              │
│       ✓ TEPAT WAKTU          │
└──────────────────────────────┘
```

Jika terlambat:

```text
┌──────────────────────────────┐
│       ABSENSI BERHASIL       │
│                              │
│       ANDI PRATAMA           │
│                              │
│       08:04:21               │
│                              │
│       ⚠ TERLAMBAT            │
└──────────────────────────────┘
```

---

# 14. Absensi Pulang

Absensi pulang memiliki aturan terpisah.

QR Check-Out hanya muncul mulai:

```text
16:00:00
```

Sebelum pukul 16.00:

```text
┌─────────────────────────────┐
│       ABSENSI PULANG       │
│                            │
│    Belum tersedia          │
│                            │
│    Mulai pukul 16.00       │
└─────────────────────────────┘
```

Mulai pukul 16.00:

```text
┌─────────────────────────────┐
│       ABSENSI PULANG       │
│                            │
│        QR CODE             │
│                            │
│     Scan untuk pulang      │
└─────────────────────────────┘
```

QR Check-Out juga berubah setiap 5 detik.

---

# 15. Validasi Check-Out

Saat karyawan melakukan scan pulang, backend memeriksa:

```text
1. Session valid?
2. Karyawan terdaftar?
3. QR valid?
4. Token belum expired?
5. QR merupakan CHECK_OUT?
6. Sudah pukul 16.00?
7. Karyawan sudah melakukan check-in hari ini?
8. Karyawan belum melakukan check-out hari ini?
```

Jika seluruh kondisi terpenuhi:

```text
CHECK-OUT DITERIMA
```

---

# 16. Contoh Check-Out

Budi:

```text
Check-in  = 07:52:14
Check-out = 16:17:32
```

Database:

```text
employee_id       = EMP001
attendance_date   = 2026-09-23
check_in_time     = 07:52:14
check_in_status   = ON_TIME
check_out_time    = 16:17:32
check_out_status  = COMPLETED
```

---

# 17. Jika Karyawan Belum Check-In

Misalnya seseorang mencoba melakukan check-out pukul 16.05 tetapi tidak memiliki record check-in.

Backend menolak:

```text
❌ ABSENSI PULANG DITOLAK

Anda belum melakukan absensi masuk hari ini.
```

---

# 18. QR Token Sekali Pakai

Token QR harus memiliki status penggunaan.

Contoh:

```text
token_id = QR123
type = CHECK_IN
created_at = 07:55:00
expires_at = 07:55:05
used = false
```

Ketika digunakan:

```text
used = true
```

Percobaan kedua dengan token yang sama:

```text
❌ TOKEN SUDAH DIGUNAKAN
```

Dengan demikian token tidak dapat dipakai berkali-kali.

---

# 19. 5 Karyawan Datang Paling Awal

Sistem menampilkan **5 karyawan dengan waktu check-in paling awal**.

Query logika:

```text
SELECT employees
FROM attendance
WHERE attendance_date = TODAY
ORDER BY check_in_time ASC
LIMIT 5;
```

Contoh tampilan:

```text
╔════════════════════════════════════╗
║       5 KARYAWAN TERAWAL           ║
╠════════════════════════════════════╣
║ 1. Budi Santoso       07:21        ║
║ 2. Siti Rahma         07:24        ║
║ 3. Andi Pratama       07:28        ║
║ 4. Rina Amelia        07:31        ║
║ 5. Fajar Nugraha      07:34        ║
╚════════════════════════════════════╝
```

Daftar diperbarui secara real-time atau menggunakan polling/websocket sesuai kebutuhan implementasi.

---

# 20. Attendance Display

Layar utama dapat menampilkan:

```text
┌──────────────────────────────────────────────┐
│              ABSENSI KARYAWAN                │
│              23 SEPTEMBER 2026               │
├───────────────────────┬──────────────────────┤
│  5 KARYAWAN TERAWAL   │ STATUS ABSENSI       │
│                       │                      │
│  1. Budi    07:21     │ Budi   ✓ Tepat       │
│  2. Siti    07:24     │ Siti   ✓ Tepat       │
│  3. Andi    07:28     │ Andi   ✓ Tepat       │
│  4. Rina    07:31     │ Doni   ⚠ Terlambat   │
│  5. Fajar   07:34     │ Rudi   ⚠ Terlambat   │
│                       │                      │
└───────────────────────┴──────────────────────┘
```

---

# 21. Admin Dashboard

Admin dapat melihat:

### Ringkasan

```text
TOTAL KARYAWAN
150

SUDAH ABSEN
143

TEPAT WAKTU
135

TERLAMBAT
8

BELUM ABSEN
7
```

### Tabel Absensi

| Karyawan     | Check-In | Status  | Check-Out |
| ------------ | -------: | ------- | --------: |
| Budi Santoso | 07:21:14 | ON_TIME |  16:17:32 |
| Siti Rahma   | 07:24:11 | ON_TIME |  16:10:22 |
| Doni Saputra | 08:04:21 | LATE    |  16:20:15 |
| Rina Amelia  | 08:07:02 | LATE    |         - |

---

# 22. Filter Dashboard

Admin dapat melakukan filter:

```text
Tanggal
[ 23 September 2026 ]

Departemen
[ Semua ]

Status
[ Semua ]

[ Cari ]
```

Status:

```text
ON_TIME
LATE
ABSENT
COMPLETED
```

---

# 23. Database

Database utama menggunakan PostgreSQL.

## 23.1 Table Employees

```text
employees
-----------------------------
id
employee_number
name
email
department_id
position
status
created_at
updated_at
```

---

## 23.2 Table Attendance

```text
attendance
-----------------------------
id
employee_id
attendance_date

check_in_time
check_in_status

check_out_time
check_out_status

created_at
updated_at
```

Constraint yang disarankan:

```text
UNIQUE(employee_id, attendance_date)
```

Tujuannya agar satu karyawan hanya memiliki satu record absensi utama per hari.

---

## 23.3 Table QR Tokens

```text
qr_tokens
-----------------------------
id
token_hash
type
created_at
expires_at
used_at
status
```

Jenis:

```text
CHECK_IN
CHECK_OUT
```

Token sebaiknya disimpan dalam bentuk hash jika memungkinkan, bukan plaintext.

---

## 23.4 Table Sessions

Session dapat dikelola menggunakan mekanisme session server-side.

Contoh:

```text
sessions
-----------------------------
id
employee_id
session_token_hash
created_at
expires_at
last_used_at
revoked_at
```

Cookie browser hanya membawa session identifier/token yang aman.

---

## 23.5 Table Audit Logs

Untuk sistem perusahaan, aktivitas penting sebaiknya dicatat.

```text
audit_logs
-----------------------------
id
employee_id
action
ip_address
user_agent
created_at
metadata
```

Contoh action:

```text
LOGIN
LOGOUT
CHECK_IN
CHECK_OUT
INVALID_QR
EXPIRED_QR
DUPLICATE_ATTENDANCE
```

---

# 24. Arsitektur Sistem

```text
                    ┌───────────────────┐
                    │    QR DISPLAY     │
                    │    Monitor PC/TV   │
                    └─────────┬─────────┘
                              │
                              │
               ┌──────────────┴──────────────┐
               │                             │
               ▼                             ▼
        Kamera HP biasa              Web QR Scanner
               │                             │
               └──────────────┬──────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │  FRONTEND   │
                       │     WEB     │
                       └──────┬──────┘
                              │
                         HTTPS / API
                              │
                              ▼
                       ┌─────────────┐
                       │   BACKEND   │
                       │     API     │
                       └──────┬──────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
       Authentication     QR Service     Attendance
             │                │                │
             └────────────────┼────────────────┘
                              │
                       ┌──────▼──────┐
                       │ PostgreSQL  │
                       └─────────────┘
```

Redis dapat ditambahkan untuk kebutuhan token sementara dan caching.

---

# 25. Redis

Redis bersifat opsional.

Jika digunakan, Redis dapat menangani:

* QR token aktif;
* expiration 5 detik;
* session/cache;
* rate limiting;
* temporary state.

Contoh:

```text
qr:checkin:current
TTL = 5 seconds
```

PostgreSQL tetap digunakan sebagai database permanen untuk data absensi.

---

# 26. API Endpoint Awal

Contoh API:

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me

GET  /api/qr/current
POST /api/attendance/check-in
POST /api/attendance/check-out

GET  /api/attendance/today
GET  /api/attendance/history

GET  /api/admin/dashboard
GET  /api/admin/attendance
GET  /api/admin/employees
```

---

# 27. Endpoint Check-In

Request:

```text
POST /api/attendance/check-in
```

Body:

```json
{
  "token": "QR_TOKEN"
}
```

Backend memperoleh identitas karyawan dari session.

Response berhasil:

```json
{
  "success": true,
  "attendance": {
    "check_in_time": "07:52:14",
    "status": "ON_TIME"
  }
}
```

---

# 28. Endpoint Check-Out

Request:

```text
POST /api/attendance/check-out
```

Body:

```json
{
  "token": "QR_TOKEN"
}
```

Response:

```json
{
  "success": true,
  "attendance": {
    "check_out_time": "16:17:32",
    "status": "COMPLETED"
  }
}
```

---

# 29. Keamanan Sistem

Sistem minimal menggunakan:

* HTTPS;
* secure cookies;
* HttpOnly cookies;
* SameSite cookie policy;
* server-side authentication;
* short-lived QR token;
* token expiration;
* token single-use;
* server timestamp;
* rate limiting;
* input validation;
* database constraints;
* audit log;
* role-based access control untuk admin;
* password hashing menggunakan algoritma yang sesuai.

---

# 30. Pencegahan Titip Absen

Sistem dirancang untuk mengurangi kemungkinan titip absen melalui:

### 1. QR berubah setiap 5 detik

QR lama tidak dapat digunakan setelah expired.

### 2. Token single-use

Token yang telah digunakan tidak dapat digunakan kembali.

### 3. Login session

Sistem mengetahui akun karyawan yang melakukan absensi.

### 4. Server timestamp

Karyawan tidak dapat memanipulasi waktu menggunakan jam smartphone.

### 5. Validasi duplicate

Satu karyawan tidak dapat melakukan check-in berkali-kali dalam satu hari.

### 6. Audit log

Aktivitas mencurigakan dapat ditelusuri.

GPS belum digunakan pada tahap awal.

---

# 31. Keterbatasan Sistem Tanpa GPS

Tanpa GPS, sistem dapat mencegah beberapa bentuk kecurangan seperti penggunaan QR yang sudah expired atau token yang digunakan ulang.

Namun, sistem belum dapat memastikan secara teknis bahwa perangkat karyawan secara fisik berada di lokasi kantor.

Contoh skenario yang masih mungkin:

```text
Karyawan A berada di kantor
        ↓
Mendapat QR aktif
        ↓
Mengirim informasi QR aktif
kepada Karyawan B
        ↓
Karyawan B mencoba melakukan absensi
```

Karena itu sistem mengurangi risiko titip absen, tetapi tidak dapat memberikan jaminan absolut tanpa faktor validasi lokasi atau mekanisme tambahan.

GPS/geolocation dapat ditambahkan sebagai fitur tahap berikutnya.

---

# 32. Flow Lengkap Sistem

```text
                    MULAI
                      │
                      ▼
             Server Generate QR
                      │
                      ▼
              QR ditampilkan
                      │
                QR berubah
                  setiap 5s
                      │
                      ▼
                Karyawan Scan
                      │
             ┌────────┴─────────┐
             │                  │
       Kamera HP          Web Scanner
             │                  │
             └────────┬─────────┘
                      ▼
                 Web Absensi
                      │
                      ▼
              Cek Session Login
                 /          \
               ADA          TIDAK
                │             │
                │           Login
                │             │
                │       Create Session
                │             │
                └──────┬──────┘
                       ▼
                 Validasi QR
                       │
                ┌──────┴──────┐
                │             │
              VALID         INVALID
                │             │
                │          REJECT
                ▼
          Cek Jenis Absensi
                │
        ┌───────┴────────┐
        │                │
     CHECK-IN        CHECK-OUT
        │                │
        ▼                ▼
   Cek waktu         Cek >= 16:00
        │                │
        ▼                ▼
 <= 08:00?          Sudah check-in?
   /    \              /      \
 YA     TIDAK         YA       TIDAK
 │        │           │          │
 ▼        ▼           ▼          ▼
ON_TIME  LATE       ACCEPT      REJECT
 │        │           │
 └────┬───┘           │
      │               │
      └───────┬───────┘
              ▼
        Simpan Database
              │
              ▼
        Update Dashboard
              │
              ▼
             SELESAI
```

---

# 33. Kesimpulan

Sistem absensi menggunakan pendekatan:

```text
WEB APPLICATION
      +
DYNAMIC QR 5 DETIK
      +
EMPLOYEE SESSION
      +
SERVER TIMESTAMP
      +
SINGLE-USE TOKEN
      +
POSTGRESQL
      +
ADMIN DASHBOARD
```

Karyawan tidak perlu menginstal aplikasi mobile.

Karyawan dapat menggunakan:

```text
Kamera HP
    ↓
Scan QR
    ↓
Web Absensi
```

atau:

```text
Website
    ↓
Web QR Scanner
    ↓
Kamera HP
```

Sistem mencatat:

```text
CHECK-IN
    ↓
Tepat waktu / Terlambat
    ↓
Database

CHECK-OUT
    ↓
Mulai 16.00
    ↓
Database
```

Dashboard admin menjadi pusat monitoring dan rekap seluruh data kehadiran karyawan.

GPS **tidak digunakan pada tahap awal** dan dapat ditambahkan kemudian sebagai lapisan keamanan tambahan.
