# 🕌 Sistem Presensi Digital Berbasis QR Code Dinamis
> **SMP Al Falah Assalam Tropodo**  
> *Sistem Presensi Karyawan & Guru Berbasis Web Multi-Device dengan Validasi Jam Server, QR Token 5 Detik, dan Zero-Mobile-App Installation.*

---

## 📌 1. Gambaran Umum

**Sistem Presensi Digital Berbasis QR Code Dinamis** adalah platform presensi web terpusat yang dirancang untuk mengatasi kelemahan sistem absensi konvensional (fingerprint antre, titip absen kartu, atau manipulasi jam pada aplikasi mobile).

Sistem ini mengusung filosofi **Zero Mobile App**: Karyawan **tidak perlu menginstal aplikasi mobile apapun** (seperti APK Android atau App Store iOS). Seluruh proses dapat dilakukan langsung melalui browser smartphone menggunakan:
1. **Kamera Bawaan Smartphone** (Direct URL Scanning `/a/:token`).
2. **Web QR Scanner** (In-browser camera scanner yang tersedia di website absensi).

### 🎯 Karakteristik Utama:
- ⏱️ **Dynamic QR Code (Rotasi 5 Detik)**: QR Code berganti otomatis setiap 5 detik di layar monitor kantor.
- 🎯 **Single-Use Token**: Satu token QR hanya dapat dipakai oleh satu orang, mencegah pembagian link/foto QR ke rekan lain.
- ⏰ **Waktu Server sebagai Sumber Kebenaran Mutlak**: Jam di perangkat karyawan tidak berpengaruh sama sekali terhadap penentuan status tepat waktu atau terlambat.
- 🔒 **Server-Side Persistent Cookie Session**: QR Code **tidak menyimpan data identitas karyawan**. Identitas diperoleh dari sesi login browser yang terenkripsi dan disimpan via cookie `HttpOnly` (30 hari).
- 🏆 **Leaderboard 5 Karyawan Terawal**: Menampilkan 5 pegawai yang datang paling awal secara real-time di layar monitor TV kantor.
- 📊 **Dashboard Monitoring HR**: Metrik kehadiran, filter multi-kriteria, tabel rekap, ekspor CSV, dan audit log deteksi manipulasi.

---

## 🏗️ 2. Arsitektur Sistem

```text
                     ┌───────────────────────────────────┐
                     │   LAYAR DISPLAY TV MONITOR (KIOSK)│
                     │  • Jam Digital Server Presisi     │
                     │  • Dynamic QR Code (Rotasi 5s)    │
                     │  • Papan 5 Karyawan Terawal       │
                     │  • Live Feed Riwayat Kehadiran    │
                     └─────────────────┬─────────────────┘
                                       │
                      Dipindai oleh Smartphone Karyawan
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
       [ METODE A: Kamera HP ]                     [ METODE B: Web Scanner ]
      Arahkan kamera bawaan HP                   Buka website -> Klik Scan QR
                │                                             │
                └──────────────────────┬──────────────────────┘
                                       ▼
                       ┌──────────────────────────────┐
                       │   FRONTEND WEB APPLICATION   │
                       │   • Login Persistent Cookie  │
                       │   • Kartu Hasil Absensi      │
                       └──────────────┬───────────────┘
                                      │  HTTPS / Cookie: absensi_session
                                      ▼
                       ┌──────────────────────────────┐
                       │     BACKEND API (EXPRESS)    │
                       │   • Auth & Session Engine    │
                       │   • QR Rotator Engine        │
                       │   • Attendance Business Logic│
                       │   • Security Audit Logger    │
                       └──────────────┬───────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │    DATABASE (POSTGRESQL)     │
                       │   • employees & departments  │
                       │   • attendance (UNIQUE Date) │
                       │   • qr_tokens & sessions     │
                       │   • audit_logs               │
                       └──────────────────────────────┘
```

---

## 🛡️ 3. Prinsip Keamanan & Anti-Titip Absen

Sistem tidak mengandalkan satu mekanisme tunggal, melainkan perlindungan multi-lapis:

| Lapisan Keamanan | Mekanisme Teknis | Dampak Perlindungan |
| :--- | :--- | :--- |
| **Dynamic QR (5s)** | Token dirotasi dan kedaluwarsa dalam 5 detik | Foto QR Code yang dikirim via chat tidak dapat dipakai karena sudah expired saat dibuka. |
| **Single-Use Token** | Status token diubah menjadi `USED` pada milidetik penggunaan | Satu token tidak bisa dipakai lebih dari satu karyawan (mencegah *replay attack*). |
| **Identitas Terisolasi** | Payload QR hanya berisi token acak kriptografis (tanpa NIK/User ID) | QR code tidak bisa diretas untuk mengabsenkan orang lain tanpa login akun yang sah. |
| **Server Timestamp** | Waktu absensi diambil dari jam backend (WIB) | Karyawan tidak bisa mengubah jam di HP mereka untuk berpura-pura tepat waktu. |
| **Cookie `HttpOnly`** | Cookie `absensi_session` dilindungi flag `HttpOnly`, `SameSite=Lax` | Mencegah pencurian token sesi melalui serangan XSS pada browser. |
| **Anti-Duplicate Rule** | Database constraint `UNIQUE(employee_id, attendance_date)` | Karyawan dijamin tidak bisa melakukan check-in ganda di tanggal yang sama. |
| **Audit Logging** | Setiap kegagalan token (`INVALID_QR`, `EXPIRED_QR`, `DUPLICATE`) dicatat | Admin dapat mendeteksi percobaan kecurangan lengkap dengan IP dan User-Agent. |

---

## ⏰ 4. Aturan Waktu & Logika Bisnis

### A. Absensi Masuk (Check-In)
- **Batas Jam Masuk**: `08:00:00 WIB` (Waktu Server).
  $$\text{check\_in\_time} \le \text{08:00:00} \implies \mathbf{ON\_TIME} \text{ (Tepat Waktu)}$$
  $$\text{check\_in\_time} > \text{08:00:00} \implies \mathbf{LATE} \text{ (Terlambat)}$$

### B. Absensi Pulang (Check-Out)
- **Jam Dibuka**: Mulai pukul `16:00:00 WIB`.
- **Syarat Validasi**:
  1. Karyawan **wajib sudah melakukan check-in** pada hari yang sama.
  2. Jika belum check-in $\rightarrow$ Ditolak: *"Anda belum melakukan absensi masuk hari ini."*
  3. Sebelum pukul 16:00:00 $\rightarrow$ Ditolak: *"Absensi pulang belum tersedia. Mulai pukul 16.00."*
  4. Belum pernah check-out sebelumnya pada hari tersebut.

---

## 🗄️ 5. Skema Database (PostgreSQL)

Skema database tersimpan di [`db/schema.sql`](file:///d:/KULIAH/SEMESTER%205/IUM/ium/db/schema.sql):

```sql
-- 1. Unit & Departemen
departments (id, name, code, created_at)

-- 2. Karyawan & Guru
employees (id, employee_number, name, email, password_hash, department_id, position, role, status, created_at)

-- 3. Rekap Kehadiran Utama
attendance (
    id, employee_id, attendance_date,
    check_in_time, check_in_status,
    check_out_time, check_out_status,
    created_at, updated_at,
    CONSTRAINT uq_employee_attendance_date UNIQUE(employee_id, attendance_date)
)

-- 4. Token Dinamis 5 Detik
qr_tokens (id, token_hash, token_plain, type, created_at, expires_at, used_at, status)

-- 5. Sesi Login Persistent
sessions (id, employee_id, session_token_hash, created_at, expires_at, last_used_at, revoked_at)

-- 6. Log Audit Keamanan
audit_logs (id, employee_id, action, ip_address, user_agent, metadata, created_at)
```

> **Catatan Database**:  
> Sistem secara default menggunakan engine **Embedded PostgreSQL (`@electric-sql/pglite`)** yang berjalan langsung di Node.js (100% kompatibel sintaks PostgreSQL tanpa perlu instalasi server eksternal). Jika ingin menggunakan PostgreSQL server eksternal (Supabase/Neon/Local), cukup isi variabel `DATABASE_URL` pada file `.env`.

---

## 📂 6. Struktur Direktori Proyek

```text
├── db/
│   ├── index.js              # Database connector (otomatis switch PGlite / External PostgreSQL)
│   ├── schema.sql            # DDL Skema PostgreSQL lengkap
│   └── migrate.js            # Runner migrasi & seeder data awal
├── src/
│   ├── app.js                # Inisialisasi Express & konfigurasi routing
│   ├── server.js             # Entrypoint server HTTP
│   ├── config.js             # Konfigurasi aplikasi & batas jam kerja
│   ├── middlewares/
│   │   └── authMiddleware.js # Proteksi sesi cookie & otorisasi RBAC (Admin/Pegawai)
│   ├── services/
│   │   ├── authService.js    # Logika login, bcrypt, session persistent hash
│   │   ├── qrService.js      # Generator token 5 detik, in-memory cache, validasi token
│   │   └── attendanceService.js # Validasi jam (08:00 & 16:00), anti-duplikasi, feed display
│   └── routes/
│       ├── auth.js           # API: /api/auth (login, logout, me)
│       ├── qr.js             # API: /api/qr (current, live-display)
│       ├── attendance.js     # API: /api/attendance (check-in, check-out, today, history)
│       └── admin.js          # API: /api/admin (dashboard, attendance, audit-logs)
├── public/
│   ├── css/
│   │   ├── common.css        # Token desain, palette Al Falah, glassmorphism
│   │   ├── display.css       # Layar display TV kantor (resolusi 1080p/4K)
│   │   ├── scan.css          # Desain responsif mobile scanner smartphone
│   │   ├── login.css         # Desain halaman login
│   │   └── admin.css         # Desain panel dashboard admin
│   ├── js/
│   │   ├── display.js        # Engine jam digital real-time & countdown 5 detik
│   │   ├── scan.js           # Engine kamera in-browser & BarcodeDetector
│   │   ├── login.js          # Form login & auto-redirect
│   │   └── admin.js          # Filter tabel, metrik metrik, ekspor CSV
│   ├── index.html            # Portal navigasi utama
│   ├── display.html          # Layar Monitor TV Kiosk
│   ├── scan.html             # Web Scanner Smartphone Karyawan
│   ├── attend.html           # Landing page pemindaian kamera HP bawaan (/a/:token)
│   ├── login.html            # Halaman Login
│   └── admin.html            # Dashboard Admin HR
├── tests/
│   └── integration_test.js   # Rangkaian pengujian integrasi otomatis (100% PASS)
├── .env.example              # Template konfigurasi environment
├── .gitignore                # Konfigurasi git ignore
├── package.json              # Dependensi proyek
└── plan.md                   # Dokumen spesifikasi fungsional awal
```

---

## 🚀 7. Panduan Instalasi & Menjalankan

### Prasyarat
- **Node.js**: Versi `20.x` atau lebih baru.
- **NPM**: Versi `10.x` atau lebih baru.

### Langkah Instalasi
1. **Clone Repository & Masuk ke Folder Proyek**:
   ```bash
   git clone <repo-url>
   cd ium
   ```

2. **Instal Dependensi**:
   ```bash
   npm install
   ```

3. **Konfigurasi Environment**:
   Salin `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
   *(Secara bawaan, `.env` sudah siap pakai tanpa perlu mengubah apapun).*

4. **Jalankan Migrasi Skema & Seeder Database**:
   ```bash
   npm run migrate
   ```
   *Perintah ini akan membuat tabel PostgreSQL dan mengisi data awal pegawai serta admin.*

5. **Jalankan Server Aplikasi**:
   ```bash
   npm start
   ```
   Aplikasi akan aktif di **`http://localhost:1116`**.

6. **Menjalankan Pengujian Integrasi Otomatis**:
   ```bash
   npm test
   ```
   *Menguji rotasi QR 5 detik, keamanan token single-use, batas jam 08:00, hak akses admin, dan pencegahan titip absen.*

---

## 🌐 8. Rute Halaman Aplikasi

| Halaman | URL | Keterangan |
| :--- | :--- | :--- |
| **Portal Navigasi** | `http://localhost:1116/` | Pintu masuk utama menuju seluruh modul sistem. |
| **Layar Display TV** | `http://localhost:1116/display` | Ditampilkan di TV/Monitor lobi kantor (QR Dinamis, Jam Server, Top 5 Terawal). |
| **Web QR Scanner** | `http://localhost:1116/scan` | Dibuka di smartphone karyawan untuk scan QR masuk/pulang. |
| **Scan Kamera Bawaan** | `http://localhost:1116/a/:token` | URL otomatis saat karyawan scan QR langsung pakai aplikasi kamera HP bawaan. |
| **Login Pengguna** | `http://localhost:1116/login` | Login karyawan & admin dengan tombol akun demo sekali klik. |
| **Dashboard Admin** | `http://localhost:1116/admin` | Monitoring metrik kehadiran, filter tanggal/departemen, ekspor CSV, dan audit log. |

---

## 👥 9. Akun Demo untuk Pengujian

Semua akun di bawah ini telah disemai (*seeded*) dengan kata sandi default: **`password123`**:

| Peran | NIK / Email | Nama Karyawan | Jabatan / Unit |
| :--- | :--- | :--- | :--- |
| **Administrator HR** | `admin@company.com` | Administrator HR | Kepala Bagian SDM |
| **Guru (Pegawai)** | `budi@company.com` | Budi Santoso | Guru Matematika |
| **Guru (Pegawai)** | `siti@company.com` | Siti Rahma | Guru Bahasa Indonesia |
| **Guru (Pegawai)** | `andi@company.com` | Andi Pratama | Guru IPA Terpadu |
| **Staf (Pegawai)** | `rina@company.com` | Rina Amelia | Staf Administrasi (TU) |
| **Staf (Pegawai)** | `fajar@company.com` | Fajar Nugraha | Koordinator Sarpras & IT |
| **Guru (Pegawai)** | `doni@company.com` | Doni Saputra | Guru Olahraga (PJOK) |

---

## 📡 10. Daftar Endpoint REST API

### Autentikasi (`/api/auth`)
- `POST /api/auth/login`: Autentikasi NIK/Email & Password. Mengirimkan cookie `absensi_session`.
- `POST /api/auth/logout`: Mencabut sesi dari database dan membersihkan cookie browser.
- `GET /api/auth/me`: Memeriksa sesi login aktif dan data pegawai saat ini.

### QR Code Engine (`/api/qr`)
- `GET /api/qr/current`: Mengambil token QR aktif saat ini (berganti tiap 5 detik).
- `GET /api/qr/live-display`: Mengambil paket data lengkap untuk layar TV (QR aktif, jam server, Top 5 Terawal, live feed).

### Layanan Absensi (`/api/attendance`)
- `POST /api/attendance/check-in`: Melakukan absensi masuk (Body: `{ token }`). Validasi $\le$ 08:00, token single-use, anti-duplicate.
- `POST /api/attendance/check-out`: Melakukan absensi pulang (Body: `{ token }`). Validasi $\ge$ 16:00 dan sudah check-in.
- `GET /api/attendance/today`: Mengambil status kehadiran pegawai yang sedang login hari ini.
- `GET /api/attendance/history`: Mengambil riwayat absensi 30 hari terakhir pegawai.

### Panel Admin (`/api/admin`)
- `GET /api/admin/dashboard?date=YYYY-MM-DD`: Metrik ringkasan kehadiran (Total, Hadir, Tepat Waktu, Terlambat, Belum Absen).
- `GET /api/admin/attendance?date=...&departmentId=...&status=...&search=...`: Data tabel absensi berfilter.
- `GET /api/admin/departments`: Daftar unit departemen untuk filter dropdown.
- `GET /api/admin/audit-logs`: Log riwayat aktivitas keamanan dan deteksi anomali.

---

## 📄 Lisensi & Hak Cipta
Dikembangkan untuk kebutuhan **Sistem Presensi Digital - SMP Al Falah Assalam Tropodo**.  
Lisensi: ISC License.
