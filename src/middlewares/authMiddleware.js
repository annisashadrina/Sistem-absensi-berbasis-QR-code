import { verifySession } from '../services/authService.js';

export async function attachUser(req, res, next) {
  try {
    const token = req.cookies?.absensi_session;
    if (token) {
      const user = await verifySession(token);
      if (user) {
        req.user = user;
      }
    }
  } catch (err) {
    console.error('[AUTH_MIDDLEWARE_ERROR]', err);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Sesi login tidak ditemukan atau telah kedaluwarsa. Silakan login terlebih dahulu.'
    });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Sesi login diperlukan.'
    });
  }
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Akses ditolak. Fitur ini khusus untuk Administrator SDM.'
    });
  }
  next();
}
