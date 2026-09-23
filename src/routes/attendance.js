import express from 'express';
import { requireAuth } from '../middlewares/authMiddleware.js';
import { processCheckIn, processCheckOut, getEmployeeTodayStatus, getLocalDateString } from '../services/attendanceService.js';
import { getDb } from '../../db/index.js';

const router = express.Router();

/**
 * Bab 27: Endpoint Check-In
 * Body: { token: "QR_TOKEN" }
 */
router.post('/check-in', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token QR tidak ditemukan dalam request.'
      });
    }

    const clientInfo = {
      ip: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent']
    };

    const result = await processCheckIn(req.user.id, token, clientInfo);

    return res.json({
      success: true,
      message: result.attendance.is_late 
        ? `Absensi masuk berhasil dicatat. Status: Terlambat (${result.attendance.check_in_time}).`
        : `Absensi masuk berhasil dicatat. Status: Tepat Waktu (${result.attendance.check_in_time}).`,
      attendance: result.attendance
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Gagal memproses absensi masuk.'
    });
  }
});

/**
 * Bab 28: Endpoint Check-Out
 * Body: { token: "QR_TOKEN" }
 */
router.post('/check-out', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token QR tidak ditemukan dalam request.'
      });
    }

    const clientInfo = {
      ip: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent']
    };

    const result = await processCheckOut(req.user.id, token, clientInfo);

    return res.json({
      success: true,
      message: `Absensi pulang berhasil dicatat pada ${result.attendance.check_out_time}. Sampai jumpa!`,
      attendance: result.attendance
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Gagal memproses absensi pulang.'
    });
  }
});

/**
 * Status Kehadiran Karyawan yang Sedang Login Hari Ini
 */
router.get('/today', requireAuth, async (req, res) => {
  try {
    const status = await getEmployeeTodayStatus(req.user.id);
    return res.json({
      success: true,
      data: status
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat status kehadiran: ' + err.message
    });
  }
});

/**
 * Riwayat Absensi Karyawan
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const query = `
      SELECT id, attendance_date, check_in_time, check_in_status, check_out_time, check_out_status
      FROM attendance
      WHERE employee_id = $1
      ORDER BY attendance_date DESC, check_in_time DESC
      LIMIT 30
    `;
    const result = await db.query(query, [req.user.id]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat riwayat kehadiran: ' + err.message
    });
  }
});

export default router;
