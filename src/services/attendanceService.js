import { getDb } from '../../db/index.js';
import config from '../config.js';
import { validateQrToken, markTokenAsUsed } from './qrService.js';

/**
 * Format Date object to YYYY-MM-DD
 */
export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format Date object to HH:mm:ss
 */
export function getLocalTimeString(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Proses Absensi Masuk (Check-In)
 */
export async function processCheckIn(employeeId, qrToken, clientInfo = {}) {
  const db = await getDb();
  const serverNow = new Date();
  const todayStr = getLocalDateString(serverNow);
  const timeStr = getLocalTimeString(serverNow);

  // 1. Cek Karyawan
  const empRes = await db.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
  if (empRes.rows.length === 0) {
    throw new Error('Data karyawan tidak ditemukan.');
  }
  const employee = empRes.rows[0];
  if (employee.status !== 'ACTIVE') {
    throw new Error('Status akun karyawan tidak aktif.');
  }

  // 2. Validasi Token QR
  const qrValidation = await validateQrToken(qrToken, 'CHECK_IN');
  if (!qrValidation.valid) {
    await db.query(`
      INSERT INTO audit_logs (employee_id, action, ip_address, user_agent, metadata)
      VALUES ($1, 'INVALID_QR', $2, $3, $4)
    `, [employeeId, clientInfo.ip || null, clientInfo.userAgent || null, JSON.stringify({ reason: qrValidation.reason, token: qrToken })]);

    throw new Error(qrValidation.reason);
  }

  // 3. Cek apakah karyawan sudah check-in hari ini
  const checkExisting = await db.query(`
    SELECT * FROM attendance 
    WHERE employee_id = $1 AND attendance_date = $2
  `, [employeeId, todayStr]);

  if (checkExisting.rows.length > 0) {
    await db.query(`
      INSERT INTO audit_logs (employee_id, action, ip_address, user_agent, metadata)
      VALUES ($1, 'DUPLICATE_ATTENDANCE', $2, $3, $4)
    `, [employeeId, clientInfo.ip || null, clientInfo.userAgent || null, JSON.stringify({ attempt: 'CHECK_IN' })]);

    throw new Error('Anda sudah melakukan absensi masuk hari ini.');
  }

  // 4. Tentukan status ketepatan waktu (Batas 08:00:00)
  const status = timeStr <= config.checkInLimit ? 'ON_TIME' : 'LATE';

  // 5. Simpan record absensi
  const insertQuery = `
    INSERT INTO attendance (employee_id, attendance_date, check_in_time, check_in_status)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const result = await db.query(insertQuery, [employeeId, todayStr, timeStr, status]);
  const attendance = result.rows[0];

  // 6. Tandai token QR sebagai USED (Single-Use Token)
  await markTokenAsUsed(qrValidation.tokenId);

  // 7. Catat audit log
  await db.query(`
    INSERT INTO audit_logs (employee_id, action, ip_address, user_agent, metadata)
    VALUES ($1, 'CHECK_IN', $2, $3, $4)
  `, [employeeId, clientInfo.ip || null, clientInfo.userAgent || null, JSON.stringify({ time: timeStr, status })]);

  return {
    success: true,
    attendance: {
      id: attendance.id,
      employee_id: employee.id,
      employee_name: employee.name,
      employee_number: employee.employee_number,
      attendance_date: todayStr,
      check_in_time: timeStr,
      status: status,
      is_late: status === 'LATE'
    }
  };
}

/**
 * Proses Absensi Pulang (Check-Out)
 */
export async function processCheckOut(employeeId, qrToken, clientInfo = {}) {
  const db = await getDb();
  const serverNow = new Date();
  const todayStr = getLocalDateString(serverNow);
  const timeStr = getLocalTimeString(serverNow);

  // 1. Cek Karyawan
  const empRes = await db.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
  if (empRes.rows.length === 0) {
    throw new Error('Data karyawan tidak ditemukan.');
  }
  const employee = empRes.rows[0];
  if (employee.status !== 'ACTIVE') {
    throw new Error('Status akun karyawan tidak aktif.');
  }

  // 2. Cek jam server: Absen pulang baru tersedia mulai pukul 16:00:00
  if (timeStr < config.checkOutStart) {
    throw new Error(`Absensi pulang belum tersedia. Layanan absensi pulang baru dibuka mulai pukul ${config.checkOutStart.substring(0, 5)}.`);
  }

  // 3. Validasi Token QR
  const qrValidation = await validateQrToken(qrToken, 'CHECK_OUT');
  if (!qrValidation.valid) {
    await db.query(`
      INSERT INTO audit_logs (employee_id, action, ip_address, user_agent, metadata)
      VALUES ($1, 'INVALID_QR', $2, $3, $4)
    `, [employeeId, clientInfo.ip || null, clientInfo.userAgent || null, JSON.stringify({ reason: qrValidation.reason, token: qrToken })]);

    throw new Error(qrValidation.reason);
  }

  // 4. Cek apakah karyawan sudah check-in hari ini
  const checkExisting = await db.query(`
    SELECT * FROM attendance 
    WHERE employee_id = $1 AND attendance_date = $2
  `, [employeeId, todayStr]);

  if (checkExisting.rows.length === 0) {
    throw new Error('Anda belum melakukan absensi masuk hari ini. Absensi pulang ditolak.');
  }

  const existingAttendance = checkExisting.rows[0];

  // 5. Cek apakah karyawan sudah pernah check-out hari ini
  if (existingAttendance.check_out_time) {
    throw new Error('Anda sudah melakukan absensi pulang hari ini.');
  }

  // 6. Update attendance record
  const updateQuery = `
    UPDATE attendance
    SET check_out_time = $1, check_out_status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *
  `;
  const result = await db.query(updateQuery, [timeStr, existingAttendance.id]);
  const attendance = result.rows[0];

  // 7. Tandai token QR sebagai USED
  await markTokenAsUsed(qrValidation.tokenId);

  // 8. Catat audit log
  await db.query(`
    INSERT INTO audit_logs (employee_id, action, ip_address, user_agent, metadata)
    VALUES ($1, 'CHECK_OUT', $2, $3, $4)
  `, [employeeId, clientInfo.ip || null, clientInfo.userAgent || null, JSON.stringify({ time: timeStr, status: 'COMPLETED' })]);

  return {
    success: true,
    attendance: {
      id: attendance.id,
      employee_id: employee.id,
      employee_name: employee.name,
      employee_number: employee.employee_number,
      attendance_date: todayStr,
      check_in_time: attendance.check_in_time,
      check_in_status: attendance.check_in_status,
      check_out_time: timeStr,
      status: 'COMPLETED'
    }
  };
}

/**
 * Mendapatkan 5 Karyawan Terawal Hari Ini (Bab 19)
 */
export async function getTop5Early(dateStr = null) {
  const db = await getDb();
  const targetDate = dateStr || getLocalDateString(new Date());

  const query = `
    SELECT a.id, a.check_in_time, a.check_in_status,
           e.id as employee_id, e.name, e.employee_number, e.position,
           d.name as department_name, d.code as department_code
    FROM attendance a
    JOIN employees e ON a.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE a.attendance_date = $1 AND a.check_in_time IS NOT NULL
    ORDER BY a.check_in_time ASC
    LIMIT 5
  `;
  const result = await db.query(query, [targetDate]);
  return result.rows;
}

/**
 * Mendapatkan Live Feed Status Absensi Hari Ini untuk Layar Display
 */
export async function getTodayLiveFeed(dateStr = null, limit = 15) {
  const db = await getDb();
  const targetDate = dateStr || getLocalDateString(new Date());

  const query = `
    SELECT a.id, a.check_in_time, a.check_in_status, a.check_out_time, a.check_out_status,
           e.name, e.employee_number, e.position,
           d.name as department_name, d.code as department_code
    FROM attendance a
    JOIN employees e ON a.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE a.attendance_date = $1
    ORDER BY COALESCE(a.check_out_time, a.check_in_time) DESC
    LIMIT $2
  `;
  const result = await db.query(query, [targetDate, limit]);
  return result.rows;
}

/**
 * Mendapatkan Status Kehadiran Karyawan Tertentu Hari Ini
 */
export async function getEmployeeTodayStatus(employeeId) {
  const db = await getDb();
  const todayStr = getLocalDateString(new Date());

  const query = `
    SELECT * FROM attendance
    WHERE employee_id = $1 AND attendance_date = $2
  `;
  const result = await db.query(query, [employeeId, todayStr]);
  return result.rows[0] || null;
}

export default {
  getLocalDateString,
  getLocalTimeString,
  processCheckIn,
  processCheckOut,
  getTop5Early,
  getTodayLiveFeed,
  getEmployeeTodayStatus
};
