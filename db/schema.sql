-- ===================================================
-- SKEMA DATABASE POSTGRESQL SISTEM ABSENSI KARYAWAN
-- Sesuai Bab 23 Dokumen Spesifikasi Sistem
-- ===================================================

-- 1. Tabel Departemen
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(20) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabel Employees (Karyawan & Administrator)
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    employee_number VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    department_id INT REFERENCES departments(id) ON DELETE SET NULL,
    position VARCHAR(100),
    role VARCHAR(20) DEFAULT 'EMPLOYEE', -- 'EMPLOYEE', 'ADMIN'
    status VARCHAR(20) DEFAULT 'ACTIVE', -- 'ACTIVE', 'INACTIVE'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabel Attendance (Absensi Kehadiran)
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    check_in_time TIME,
    check_in_status VARCHAR(20), -- 'ON_TIME', 'LATE'
    check_out_time TIME,
    check_out_status VARCHAR(20), -- 'COMPLETED', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_employee_attendance_date UNIQUE(employee_id, attendance_date)
);

-- 4. Tabel QR Tokens (Token Dinamis 5 Detik)
CREATE TABLE IF NOT EXISTS qr_tokens (
    id SERIAL PRIMARY KEY,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    token_plain VARCHAR(128) NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'CHECK_IN', 'CHECK_OUT'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'ACTIVE' -- 'ACTIVE', 'USED', 'EXPIRED'
);

-- Index pencarian cepat token QR
CREATE INDEX IF NOT EXISTS idx_qr_tokens_hash ON qr_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires ON qr_tokens(expires_at);

-- 5. Tabel Sessions (Server-Side Persistent Sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    session_token_hash VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(session_token_hash);

-- 6. Tabel Audit Logs (Pencatatan Aktivitas & Deteksi Kecurangan)
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- 'LOGIN', 'LOGOUT', 'CHECK_IN', 'CHECK_OUT', 'INVALID_QR', 'EXPIRED_QR', 'DUPLICATE_ATTENDANCE'
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_employee ON audit_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- 7. Tabel Leave Requests (Pengajuan Izin / Sakit / Cuti)
CREATE TABLE IF NOT EXISTS leave_requests (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    attachment_path VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reviewed_by INT REFERENCES employees(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
