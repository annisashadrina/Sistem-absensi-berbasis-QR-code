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
    const dateStr =
      req.query.date || getLocalDateString(new Date());

    // =========================================================
    // 1. TOTAL KARYAWAN AKTIF
    // =========================================================
    // Total selalu berdasarkan jumlah karyawan aktif,
    // BUKAN jumlah record attendance.
    const empCountRes = await db.query(`
      SELECT COUNT(*) AS total
      FROM employees
      WHERE role = 'EMPLOYEE'
        AND status = 'ACTIVE'
    `);

    const totalEmployees = parseInt(
      empCountRes.rows[0].total,
      10
    );

    // =========================================================
    // 2. STATISTIK KEHADIRAN
    // =========================================================
    // Menggunakan employees sebagai tabel utama.
    // Dengan LEFT JOIN, karyawan yang belum absen tetap
    // dihitung dan tetap bisa diketahui statusnya.
    const attStatsRes = await db.query(
      `
      SELECT
        COUNT(*) AS total_employees,

        COUNT(
          CASE
            WHEN a.check_in_time IS NOT NULL
            THEN 1
          END
        ) AS present_count,

        COUNT(
          CASE
            WHEN a.check_in_time IS NOT NULL
             AND a.check_in_status = 'ON_TIME'
            THEN 1
          END
        ) AS on_time_count,

        COUNT(
          CASE
            WHEN a.check_in_time IS NOT NULL
             AND a.check_in_status = 'LATE'
            THEN 1
          END
        ) AS late_count,

        COUNT(
          CASE
            WHEN a.check_out_time IS NOT NULL
            THEN 1
          END
        ) AS completed_count

      FROM employees e

      LEFT JOIN attendance a
        ON a.employee_id = e.id
       AND a.attendance_date = $1::date

      WHERE e.role = 'EMPLOYEE'
        AND e.status = 'ACTIVE'
      `,
      [dateStr]
    );

    const stats = attStatsRes.rows[0];

    const presentCount = parseInt(
      stats.present_count,
      10
    );

    const onTimeCount = parseInt(
      stats.on_time_count,
      10
    );

    const lateCount = parseInt(
      stats.late_count,
      10
    );

    const completedCount = parseInt(
      stats.completed_count,
      10
    );

    // Yang belum absen = total karyawan aktif
    // dikurangi karyawan yang sudah check-in.
    const absentCount = Math.max(
      0,
      totalEmployees - presentCount
    );

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
    console.error(
      'Gagal memuat metrik dashboard:',
      err
    );

    return res.status(500).json({
      success: false,
      message: 'Gagal memuat metrik dashboard.'
    });
  }
});


/**
 * Bab 21 & 22: Tabel Absensi & Filter Dashboard
 *
 * Filter:
 * - startDate
 * - endDate
 * - departmentId
 * - status
 * - search
 *
 * PENTING:
 * Employees menjadi tabel utama.
 * Attendance menggunakan LEFT JOIN.
 *
 * Dengan demikian:
 *
 * 10 karyawan aktif
 *      ↓
 * tetap 10 baris
 *
 * yang sudah absen:
 *      check_in_time = jam masuk
 *
 * yang belum absen:
 *      check_in_time = null
 *
 * yang sudah checkout:
 *      check_out_time = jam checkout
 *
 * yang belum checkout:
 *      check_out_time = null
 */
router.get('/attendance', async (req, res) => {
  try {
    const db = await getDb();

    // =========================================================
    // VALIDASI TANGGAL
    // =========================================================
    const isValidDate = (value) => {
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
      ) {
        return false;
      }

      const parsed = new Date(
        `${value}T00:00:00.000Z`
      );

      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    };

    // Tetap kompatibel dengan pemanggilan lama ?date=...
    const legacyDate =
      req.query.date ||
      getLocalDateString(new Date());

    const startDate =
      req.query.startDate || legacyDate;

    const endDate =
      req.query.endDate || legacyDate;

    if (
      !isValidDate(startDate) ||
      !isValidDate(endDate)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Format tanggal tidak valid. Gunakan YYYY-MM-DD.'
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        message:
          'Tanggal awal tidak boleh melewati tanggal akhir.'
      });
    }

    // =========================================================
    // BATAS RENTANG MAKSIMAL 366 HARI
    // =========================================================
    const startTime = new Date(
      `${startDate}T00:00:00.000Z`
    ).getTime();

    const endTime = new Date(
      `${endDate}T00:00:00.000Z`
    ).getTime();

    const dayCount =
      Math.floor(
        (endTime - startTime) /
        (24 * 60 * 60 * 1000)
      ) + 1;

    if (dayCount > 366) {
      return res.status(400).json({
        success: false,
        message:
          'Rentang tanggal maksimal 366 hari.'
      });
    }

    // =========================================================
    // FILTER DEPARTEMEN
    // =========================================================
    const departmentIdRaw =
      req.query.departmentId;

    let departmentId = null;

    if (departmentIdRaw) {
      departmentId = Number(departmentIdRaw);

      if (
        !Number.isInteger(departmentId) ||
        departmentId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            'ID departemen tidak valid.'
        });
      }
    }

    // =========================================================
    // FILTER STATUS
    // =========================================================
    const statusFilter =
      req.query.status || null;

    const allowedStatuses = [
      'ON_TIME',
      'LATE',
      'COMPLETED',
      'ABSENT'
    ];

    if (
      statusFilter &&
      !allowedStatuses.includes(statusFilter)
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Filter status tidak valid.'
      });
    }

    // =========================================================
    // FILTER SEARCH
    // =========================================================
    const searchText = String(
      req.query.search || ''
    ).trim();

    const search = searchText
      ? `%${searchText.toLowerCase()}%`
      : null;

    // =========================================================
    // QUERY UTAMA
    // =========================================================
    //
    // STRUKTUR:
    //
    // employees
    //     ↓
    // CROSS JOIN tanggal
    //     ↓
    // LEFT JOIN attendance
    //
    // Hasil:
    //
    // 10 karyawan x 1 tanggal = 10 baris
    //
    // 10 karyawan x 3 tanggal = 30 baris
    //
    let query = `
      SELECT
        e.id AS employee_id,
        e.employee_number,
        e.name,
        e.position,
        e.status AS employee_status,

        d.id AS department_id,
        d.name AS department_name,
        d.code AS department_code,

        a.id AS attendance_id,

        TO_CHAR(
          calendar.attendance_date,
          'YYYY-MM-DD'
        ) AS attendance_date,

        a.check_in_time,
        a.check_in_status,

        a.check_out_time,
        a.check_out_status

      FROM employees e

      CROSS JOIN generate_series(
        $1::date,
        $2::date,
        INTERVAL '1 day'
      ) AS calendar(attendance_date)

      LEFT JOIN departments d
        ON e.department_id = d.id

      LEFT JOIN attendance a
        ON a.employee_id = e.id
       AND a.attendance_date =
           calendar.attendance_date::date

      WHERE e.role = 'EMPLOYEE'
        AND e.status = 'ACTIVE'
    `;

    const params = [
      startDate,
      endDate
    ];

    let paramIndex = 3;

    // =========================================================
    // FILTER DEPARTEMEN
    // =========================================================
    if (departmentId !== null) {
      query += `
        AND e.department_id = $${paramIndex}
      `;

      params.push(departmentId);
      paramIndex++;
    }

    // =========================================================
    // FILTER SEARCH
    // =========================================================
    if (search) {
      query += `
        AND (
          LOWER(e.name) LIKE $${paramIndex}
          OR LOWER(e.employee_number) LIKE $${paramIndex}
        )
      `;

      params.push(search);
      paramIndex++;
    }

    // =========================================================
    // FILTER STATUS
    // =========================================================
    if (statusFilter === 'ABSENT') {

      // Belum mempunyai record attendance
      // atau belum melakukan check-in.
      query += `
        AND a.check_in_time IS NULL
      `;

    } else if (statusFilter === 'ON_TIME') {

      query += `
        AND a.check_in_status = 'ON_TIME'
      `;

    } else if (statusFilter === 'LATE') {

      query += `
        AND a.check_in_status = 'LATE'
      `;

    } else if (statusFilter === 'COMPLETED') {

      query += `
        AND a.check_out_time IS NOT NULL
      `;
    }

    // =========================================================
    // URUTAN DATA
    // =========================================================
    query += `
      ORDER BY
        calendar.attendance_date ASC,
        a.check_in_time ASC NULLS LAST,
        e.name ASC
    `;

    const result = await db.query(
      query,
      params
    );

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (err) {
    console.error(
      'Gagal memuat data absensi:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Gagal memuat data absensi.'
    });
  }
});


/**
 * Daftar Departemen untuk dropdown filter
 */
router.get('/departments', async (req, res) => {
  try {
    const db = await getDb();

    const result = await db.query(`
      SELECT *
      FROM departments
      ORDER BY name ASC
    `);

    return res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error(
      'Gagal memuat departemen:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Gagal memuat daftar departemen.'
    });
  }
});


/**
 * Log Audit Keamanan
 * Bab 23.5 & Bab 29
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const db = await getDb();

    const query = `
      SELECT
        al.*,
        e.name AS employee_name,
        e.employee_number

      FROM audit_logs al

      LEFT JOIN employees e
        ON al.employee_id = e.id

      ORDER BY al.created_at DESC

      LIMIT 50
    `;

    const result = await db.query(query);

    return res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error(
      'Gagal memuat log audit:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Gagal memuat log audit.'
    });
  }
});


export default router;