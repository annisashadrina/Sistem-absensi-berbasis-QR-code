import express from 'express';
import { getCurrentQr } from '../services/qrService.js';
import { getTop5Early, getTodayLiveFeed } from '../services/attendanceService.js';
import config from '../config.js';

const router = express.Router();

/**
 * Endpoint publik untuk polling token QR aktif (berubah setiap 5 detik)
 */
router.get('/current', async (req, res) => {
  try {
    const forceType = req.query.type; // Optional: 'CHECK_IN' atau 'CHECK_OUT' untuk testing/override
    const qrData = await getCurrentQr(forceType);

    return res.json({
      success: true,
      data: qrData
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghasilkan token QR: ' + err.message
    });
  }
});

/**
 * Endpoint data terintegrasi untuk Layar Display Monitor (TV Kiosk)
 * Mengembalikan: QR aktif, Top 5 Terawal, Live Feed terkini, dan Jam Server
 */
router.get('/live-display', async (req, res) => {
  try {
    const forceType = req.query.type;
    const qrData = await getCurrentQr(forceType);
    const top5 = await getTop5Early();
    const liveFeed = await getTodayLiveFeed(null, 10);
    const now = new Date();

    return res.json({
      success: true,
      serverTime: now.toISOString(),
      displayDate: now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      config: {
        officeName: config.officeName,
        checkInLimit: config.checkInLimit,
        checkOutStart: config.checkOutStart
      },
      qr: qrData,
      top5,
      liveFeed
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat data display: ' + err.message
    });
  }
});

export default router;
