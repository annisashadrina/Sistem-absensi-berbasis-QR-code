import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../../db/index.js';
import config from '../config.js';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function login(identifier, password, clientInfo = {}) {
  const db = await getDb();

  // Cari berdasarkan NIK (employee_number) atau email
  const query = `
    SELECT e.*, d.name as department_name, d.code as department_code
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE (e.employee_number = $1 OR e.email = $1)
  `;
  const result = await db.query(query, [identifier]);

  if (result.rows.length === 0) {
    throw new Error('Karyawan atau NIK/Email tidak ditemukan.');
  }

  const employee = result.rows[0];

  if (employee.status !== 'ACTIVE') {
    throw new Error('Akun karyawan ini berstatus tidak aktif. Silakan hubungi bagian SDM.');
  }

  const isPasswordValid = await bcrypt.compare(password, employee.password_hash);
  if (!isPasswordValid) {
    throw new Error('Kata sandi yang Anda masukkan salah.');
  }

  // Buat random cryptographically secure session token
  const rawSessionToken = crypto.randomBytes(32).toString('hex');
  const sessionTokenHash = hashToken(rawSessionToken);

  // Expiration 30 hari untuk persistent session
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.sessionMaxAgeDays);

  await db.query(`
    INSERT INTO sessions (employee_id, session_token_hash, expires_at)
    VALUES ($1, $2, $3)
  `, [employee.id, sessionTokenHash, expiresAt.toISOString()]);

  // Catat ke audit_logs
  await db.query(`
    INSERT INTO audit_logs (employee_id, action, ip_address, user_agent, metadata)
    VALUES ($1, 'LOGIN', $2, $3, $4)
  `, [employee.id, clientInfo.ip || null, clientInfo.userAgent || null, JSON.stringify({ role: employee.role })]);

  return {
    employee: {
      id: employee.id,
      employee_number: employee.employee_number,
      name: employee.name,
      email: employee.email,
      department_name: employee.department_name,
      department_code: employee.department_code,
      position: employee.position,
      role: employee.role
    },
    rawSessionToken,
    expiresAt
  };
}

export async function verifySession(rawSessionToken) {
  if (!rawSessionToken) return null;
  const db = await getDb();
  const tokenHash = hashToken(rawSessionToken);

  const query = `
    SELECT s.id as session_id, s.expires_at, s.revoked_at,
           e.id, e.employee_number, e.name, e.email, e.role, e.position, e.status,
           d.name as department_name, d.code as department_code
    FROM sessions s
    JOIN employees e ON s.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE s.session_token_hash = $1
  `;
  const result = await db.query(query, [tokenHash]);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  // Cek apakah session sudah dicabut atau kadaluwarsa
  if (row.revoked_at || new Date(row.expires_at) < new Date() || row.status !== 'ACTIVE') {
    return null;
  }

  // Update last_used_at secara asynchronous tanpa blocking
  db.query(`UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.session_id]).catch(() => {});

  return {
    id: row.id,
    employee_number: row.employee_number,
    name: row.name,
    email: row.email,
    role: row.role,
    position: row.position,
    department_name: row.department_name,
    department_code: row.department_code
  };
}

export async function logout(rawSessionToken, clientInfo = {}) {
  if (!rawSessionToken) return;
  const db = await getDb();
  const tokenHash = hashToken(rawSessionToken);

  const res = await db.query(`
    UPDATE sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE session_token_hash = $1
    RETURNING employee_id
  `, [tokenHash]);

  if (res.rows.length > 0) {
    const employeeId = res.rows[0].employee_id;
    await db.query(`
      INSERT INTO audit_logs (employee_id, action, ip_address, user_agent)
      VALUES ($1, 'LOGOUT', $2, $3)
    `, [employeeId, clientInfo.ip || null, clientInfo.userAgent || null]);
  }
}

export default { login, verifySession, logout, hashToken };
