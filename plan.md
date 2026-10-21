# 📋 Blueprint & Arsitektur Sistem Presensi Digital Berbasis QR Dinamis
> **SMP Al Falah Assalam Tropodo**  
> *Dokumen Teknis & Konsep Arsitektur Inti (Technical Specification for Development Team)*

---

## 1. 🎯 Konsep Utama & Filosofi Sistem

Sistem Presensi Digital ini dirancang untuk mengatasi kelemahan absensi konvensional (antrean mesin sidik jari, titip kartu, atau manipulasi jam HP) dengan prinsip:

1. **Zero Mobile App Installation**:
   - Guru & staf **tidak perlu menginstal aplikasi mobile** (tidak perlu download APK atau App Store).
   - Seluruh proses berjalan di browser smartphone melalui:
     - **Metode A**: Kamera bawaan HP (scan QR langsung membuka URL `/a/:token`).
     - **Metode B**: Web QR Scanner in-browser yang tersedia di website absensi (`/scan`).
2. **Dynamic QR Code (Rotasi 5 Detik)**:
   - QR Code yang ditampilkan pada layar TV kantor berganti otomatis setiap **5 detik**.
   - Foto QR yang dibagikan via chat tidak dapat digunakan karena sudah kedaluwarsa saat dibuka.
3. **Waktu Server Mutlak (Absolute Server Timestamp)**:
   - Jam backend (WIB) menjadi satu-satunya sumber kebenaran penentuan status tepat waktu atau terlambat. Jam di perangkat karyawan tidak berpengaruh.
4. **Tanpa GPS pada Tahap Awal**:
   - Sistem berfokus pada efisiensi validasi fisik di lokasi melalui QR rotasi cepat 5 detik dan single-use token. Fitur geofencing/GPS disiapkan untuk fase lanjutan.

---

## 2. 🛡️ Lapisan Keamanan & Anti-Titip Absen

Sistem mengimplementasikan proteksi multi-lapis (*defense in depth*):

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          LAPISAN KEAMANAN                              │
├─────────────────────────┬──────────────────────────────────────────────┤
│ 1. Dynamic QR (5s)      │ Token dirotasi & expired tiap 5 detik         │
│ 2. Single-Use Token     │ 1 token hanya berlaku untuk 1 kali absensi   │
│ 3. Isolated Payload     │ QR hanya memuat random hash (tanpa NIK/User) │
│ 4. Persistent Session   │ Identitas diambil dari Cookie HttpOnly 30 hr │
│ 5. Database Constraint  │ UNIQUE(employee_id, attendance_date)         │
│ 6. Server Clock (WIB)   │ Menangkal manipulasi jam lokal smartphone    │
│ 7. Audit Logging        │ Pencatatan insiden IP, UA, dan token anomali │
└─────────────────────────┴──────────────────────────────────────────────┘
```

- **Mekanisme Single-Use Token**: Begitu token dipindai dan diproses, statusnya langsung diubah menjadi `USED` di milidetik yang sama. Percobaan absensi kedua dengan token yang sama otomatis ditolak (*Anti-Replay Attack*).

---

## 3. 🏗️ Arsitektur Alur Sistem

```text
               ┌─────────────────────────────────────────┐
               │    LAYAR MONITOR DISPLAY TV (KIOSK)     │
               │  • Jam Digital Server Presisi (WIB)     │
               │  • Dynamic QR Code (Auto-Refresh 5s)    │
               │  • Papan Top 5 Karyawan Terawal Datang  │
               │  • Live Feed Riwayat Presensi Hari Ini  │
               └────────────────────┬────────────────────┘
                                    │ Dipindai Smartphone
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
          [ Kamera Bawaan HP ]             [ Web QR Scanner ]
           Akses URL: /a/:token            Akses URL: /scan
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │    FRONTEND WEB BROWSER     │
                     │  • Cek Cookie HttpOnly Sesi │
                     │  • Modal Hasil Absensi      │
                     └──────────────┬──────────────┘
                                    │ HTTPS + Session Cookie
                                    ▼
                     ┌─────────────────────────────┐
                     │    BACKEND API (EXPRESS)    │
                     │  • Auth & RBAC Middleware   │
                     │  • QR Rotator 5s Engine     │
                     │  • Attendance Business Logic│
                     │  • Security Audit Logger    │
                     └──────────────┬──────────────┘
                                    │
                                    ▼
                     ┌─────────────────────────────┐
                     │    DATABASE (POSTGRESQL)    │
                     │  • Dual-Engine: PGlite / PG │
                     │  • Relasi & Unique Rules    │
                     └─────────────────────────────┘
```

---

## 4. 🗄️ Strategi Database (Penting untuk Tim Pengembang)

Sistem menggunakan arsitektur database **Dual-Engine (Adaptif)** yang diatur pada [`db/index.js`](file:///d:/KULIAH/SEMESTER%205/IUM/ium/db/index.js):

### A. Mode Development Lokal (Embedded PostgreSQL - PGlite)
- Menggunakan library `@electric-sql/pglite` berbasis WebAssembly yang berjalan langsung di Node.js.
- **Keuntungan**:
  - **Zero-Setup**: Tim pengembang di laptop lokal **tidak perlu mendownload/menginstall PostgreSQL server**.
  - Database tersimpan rapi sebagai file lokal di folder `./data/postgres`.
  - Sintaks dan query 100% kompatibel dengan PostgreSQL standar.

### B. Mode Production / Integrasi Database Sekolah (External PostgreSQL)
- Jika pihak sekolah memberikan akses database server (atau hosting Supabase/Neon/VPS), cukup isi variabel `DATABASE_URL` pada file [`.env`](file:///d:/KULIAH/SEMESTER%205/IUM/ium/.env):
  ```env
  DATABASE_URL=postgresql://user:password@ip_server_sekolah:5432/nama_database
  ```
- Konektor sistem secara otomatis langsung beralih menggunakan koneksi `pg.Pool` tanpa perlu mengubah kode aplikasi sama sekali.

### C. Struktur Entitas Tabel Utama
1. **`departments`**: Unit organisasi (Guru, Tata Usaha, Sarpras & IT).
2. **`employees`**: Data induk pegawai (NIK, Nama, Email, Password Hash, Role, Status).
3. **`attendance`**: Pencatatan kehadiran dengan constraint `UNIQUE(employee_id, attendance_date)`.
4. **`qr_tokens`**: Riwayat token dinamis 5 detik (`token_hash`, `type`, `expires_at`, `status`).
5. **`sessions`**: Server-side persistent session token (masa aktif 30 hari).
6. **`audit_logs`**: Log insiden keamanan (`LOGIN`, `CHECK_IN`, `INVALID_QR`, `DUPLICATE_ATTENDANCE`).

> 💡 **Integrasi Data Guru dari Sekolah**:  
> Saat sekolah menyerahkan data pegawai (baik dalam bentuk file Excel/CSV atau database yang sudah ada), cukup jalankan skrip impor untuk memetakan NIP, Nama, dan Departemen ke tabel `employees`.

---

## 5. ⏰ Logika Bisnis Presensi

### A. Absensi Masuk (Check-In)
- Batas waktu server: **`08:00:00 WIB`**.
  - $\le \text{08:00:00} \implies$ Status **`ON_TIME`** (Tepat Waktu).
  - $> \text{08:00:00} \implies$ Status **`LATE`** (Terlambat).
- Validasi: Karyawan ditolak jika mencoba check-in lebih dari satu kali pada tanggal yang sama.

### B. Absensi Pulang (Check-Out)
- QR Check-Out dibuka mulai pukul **`16:00:00 WIB`**.
- Validasi:
  1. Karyawan wajib sudah check-in pada hari yang sama.
  2. Belum pernah melakukan check-out sebelumnya pada hari tersebut.
  3. Ditolak jika melakukan scan sebelum pukul 16:00:00 WIB.

### C. Papan Top 5 Karyawan Terawal (Leaderboard)
- Menampilkan 5 pegawai dengan `check_in_time` paling awal hari ini secara langsung di monitor TV untuk meningkatkan kedisiplinan dan apresiasi kedatangan pagi.

---

## 6. 🌐 Rute Halaman & Endpoint REST API

### Halaman Web Frontend:
- **`/`**: Portal Navigasi Utama.
- **`/display`**: Layar Monitor TV Kiosk (Jam server, QR dinamis, Top 5 terawal, feed riwayat).
- **`/scan`**: Web Scanner smartphone untuk karyawan (kamera in-browser + opsi simulasi token).
- **`/a/:token`**: URL pendaratan otomatis saat karyawan memindai menggunakan kamera bawaan HP.
- **`/login`**: Halaman otentikasi NIK/Email & Password.
- **`/admin`**: Dashboard HR (Metrik ringkasan, filter departemen/status, ekspor CSV, audit log).

### Endpoint API Utama:
- `POST /api/auth/login` & `POST /api/auth/logout`: Manajemen sesi cookie `absensi_session`.
- `GET  /api/auth/me`: Verifikasi sesi dan profil pengguna aktif.
- `GET  /api/qr/current`: Polling token QR aktif (rotasi 5 detik).
- `GET  /api/qr/live-display`: Paket data komprehensif untuk layar monitor TV.
- `POST /api/attendance/check-in`: Proses absensi masuk (Body: `{ token }`).
- `POST /api/attendance/check-out`: Proses absensi pulang (Body: `{ token }`).
- `GET  /api/attendance/today` & `GET /api/attendance/history`: Status dan riwayat presensi pegawai.
- `GET  /api/admin/dashboard`: Ringkasan metrik kehadiran harian.
- `GET  /api/admin/attendance`: Data tabel presensi berfilter (Tanggal, Unit, Status, Cari Nama).
- `GET  /api/admin/audit-logs`: Log audit keamanan dan anomali.

---

## 7. 🚀 Roadmap Pengembangan Fase Berikutnya

1. **CRUD Pegawai pada Dashboard Admin**: Form visual untuk menambah, mengubah jabatan, atau menonaktifkan akun guru langsung dari panel web.
2. **Modul Pengajuan Izin / Cuti / Sakit**: Formulir upload surat dokter atau permohonan izin dinas luar.
3. **Pembersihan Berkala Token QR (*Auto-Purge Job*)**: Cron job pembersihan token `qr_tokens` yang sudah berumur $> 3$ hari agar ukuran database tetap efisien.
4. **Geofencing / Validasi Radius GPS**: Validasi koordinat GPS sebagai lapisan keamanan tambahan bila diperlukan di masa mendatang.
