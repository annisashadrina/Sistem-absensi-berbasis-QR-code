import express from 'express';
import { login, logout } from '../services/authService.js';
import { requireAuth } from '../middlewares/authMiddleware.js';
import config from '../config.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'NIK / Email dan kata sandi wajib diisi.'
      });
    }

    const clientInfo = {
      ip: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent']
    };

    const { employee, rawSessionToken, expiresAt } = await login(identifier, password, clientInfo);

    // Set secure persistent cookie
    res.cookie('absensi_session', rawSessionToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      expires: expiresAt
    });

    return res.json({
      success: true,
      message: 'Login berhasil.',
      user: employee
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.message || 'Gagal login.'
    });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.absensi_session;
    const clientInfo = {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    };
    if (token) {
      await logout(token, clientInfo);
    }
    res.clearCookie('absensi_session');
    return res.json({
      success: true,
      message: 'Logout berhasil.'
    });
  } catch (err) {
    res.clearCookie('absensi_session');
    return res.json({
      success: true,
      message: 'Sesi dibersihkan.'
    });
  }
});

router.get('/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      user: null
    });
  }

  return res.json({
    success: true,
    authenticated: true,
    user: req.user
  });
});

export default router;
