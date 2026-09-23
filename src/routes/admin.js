import express from 'express';
import { requireAdmin } from '../middlewares/authMiddleware.js';
import { getDb } from '../../db/index.js';
import { getLocalDateString } from '../services/attendanceService.js';

const router = express.Router();

// Semua rute admin diproteksi middleware requireAdmin
router.use(requireAdmin);

/**
 * Bab 21: Ringkasan Metrik Dashboard Admin
 */
router.get('/dashboard', async (req, res) => {
  try {
    const db = await getDb();
    const dateStr = req.query.date || getLocalDateString(new Date());

    // 1. Total Karyawan Aktif (Role: EMPLOYEE)
    const empCountRes = await db.query(`
      SELECT COUNT(*) as total FROM employees 
      WHERE role = 'EMPLOYEE' AND status = 'ACTIVE'
    `);
    const totalEmployees = parseInt(empCountRes.rows[0].total, 10);

    // 2. Statistik Kehadiran Hari Ini
    const attStatsRes = await db.query(`
      SELECT 
        COUNT(*) as total_present,
        COUNT(CASE WHEN check_in_status = 'ON_TIME' THEN 1 END) as on_time,
        COUNT(CASE WHEN check_in_status = 'LATE' THEN 1 END) as late,
        COUNT(CASE WHEN check_out_time IS NOT NULL THEN 1 END) as completed
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.attendance_date = $1 AND e.role = 'EMPLOYEE'
    `, [dateStr]);

    const stats = attStatsRes.rows[0];
    const presentCount = parseInt(stats.total_present, 10);
    const onTimeCount = parseInt(stats.on_time, 10);
    const lateCount = parseInt(stats.late, 10);
    const completedCount = parseInt(stats.completed, 10);
    const absentCount = Math.max(0, totalEmployees - presentCount);

    return res.json({
      success: true,
      date: dateStr,
      metrics: {
        totalEmployees,
        presentCount,
        onTimeCount,
        lateCount,
        absentCount,
        completedCount
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat metrik dashboard: ' + err.message
    });
  }
});

/**
 * Bab 21 & 22: Tabel Absensi & Filter Dashboard
 * Filter: date, departmentId, status (ON_TIME, LATE, COMPLETED, ABSENT), search
 */
router.get('/attendance', async (req, res) => {
  try {
    const db = await getDb();
    const dateStr = req.query.date || getLocalDateString(new Date());
    const departmentId = req.query.departmentId ? parseInt(req.query.departmentId, 10) : null;
    const statusFilter = req.query.status || null; // 'ON_TIME', 'LATE', 'COMPLETED', 'ABSENT'
    const search = req.query.search ? `%${req.query.search.toLowerCase()}%` : null;

    let query = `
      SELECT 
        e.id as employee_id, e.employee_number, e.name, e.position, e.status as employee_status,
        d.id as department_id, d.name as department_name, d.code as department_code,
        a.id as attendance_id, a.attendance_date, a.check_in_time, a.check_in_status,
        a.check_out_time, a.check_out_status
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN attendance a ON e.id = a.employee_id AND a.attendance_date = $1
      WHERE e.role = 'EMPLOYEE' AND e.status = 'ACTIVE'
    `;

    const params = [dateStr];
    let paramIndex = 2;

    if (departmentId) {
      query += ` AND e.department_id = $${paramIndex}`;
      params.push(departmentId);
      paramIndex++;
    }

    if (search) {
      query += ` AND (LOWER(e.name) LIKE $${paramIndex} OR LOWER(e.employee_number) LIKE $${paramIndex})`;
      params.push(search);
      paramIndex++;
    }

    if (statusFilter) {
      if (statusFilter === 'ABSENT') {
        query += ` AND a.id IS NULL`;
      } else if (statusFilter === 'ON_TIME') {
        query += ` AND a.check_in_status = 'ON_TIME'`;
      } else if (statusFilter === 'LATE') {
        query += ` AND a.check_in_status = 'LATE'`;
      } else if (statusFilter === 'COMPLETED') {
        query += ` AND a.check_out_time IS NOT NULL`;
      }
    }

    query += ` ORDER BY a.check_in_time ASC NULLS LAST, e.name ASC`;

    const result = await db.query(query, params);

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat data absensi: ' + err.message
    });
  }
});

/**
 * Daftar Departemen untuk dropdown filter
 */
router.get('/departments', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT * FROM departments ORDER BY name ASC');
    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * Log Audit Keamanan (Bab 23.5 & Bab 29)
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const db = await getDb();
    const query = `
      SELECT al.*, e.name as employee_name, e.employee_number
      FROM audit_logs al
      LEFT JOIN employees e ON al.employee_id = e.id
      ORDER BY al.created_at DESC
      LIMIT 50
    `;
    const result = await db.query(query);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat log audit: ' + err.message
    });
  }
});

export default router;
