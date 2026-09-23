import crypto from 'crypto';
import QRCode from 'qrcode';
import { getDb } from '../../db/index.js';
import config from '../config.js';

let currentSlotCache = {
  slot: 0,
  token: null,
  qrDataUrl: null,
  expiresAt: null,
  type: 'CHECK_IN'
};

/**
 * Mendapatkan jenis QR berdasarkan jam server saat ini
 * Sebelum 16:00:00 -> CHECK_IN
 * Mulai 16:00:00 -> CHECK_OUT
 */
export function determineQrType(date = new Date()) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  return timeStr >= config.checkOutStart ? 'CHECK_OUT' : 'CHECK_IN';
}

/**
 * Menghasilkan token QR aktif yang berganti setiap 5 detik
 */
export async function getCurrentQr(forceType = null) {
  const now = new Date();
  const intervalMs = config.qrIntervalSeconds * 1000;
  const currentSlot = Math.floor(now.getTime() / intervalMs);
  const type = forceType || determineQrType(now);

  // Jika slot masih sama dan token sudah di-cache, gunakan cache
  if (currentSlotCache.slot === currentSlot && currentSlotCache.type === type && currentSlotCache.token) {
    const remainingMs = (currentSlot + 1) * intervalMs - now.getTime();
    return {
      ...currentSlotCache,
      remainingMs: Math.max(0, remainingMs),
      remainingSeconds: Math.ceil(Math.max(0, remainingMs) / 1000),
      serverTime: now.toISOString()
    };
  }

  // Generate token baru untuk 5 detik ini
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date((currentSlot + 1) * intervalMs);

  const db = await getDb();
  await db.query(`
    INSERT INTO qr_tokens (token_hash, token_plain, type, expires_at, status)
    VALUES ($1, $2, $3, $4, 'ACTIVE')
  `, [tokenHash, rawToken, type, expiresAt.toISOString()]);

  // URL absensi yang diarahkan saat scan menggunakan kamera bawaan HP
  const scanUrl = `${config.appUrl}/a/${rawToken}`;

  // Generate QR Code image (Data URL SVG / PNG)
  const qrDataUrl = await QRCode.toDataURL(scanUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    color: {
      dark: '#0a3d24',
      light: '#ffffff'
    },
    width: 320
  });

  const remainingMs = expiresAt.getTime() - now.getTime();

  currentSlotCache = {
    slot: currentSlot,
    token: rawToken,
    tokenHash,
    qrDataUrl,
    scanUrl,
    type,
    expiresAt: expiresAt.toISOString()
  };

  return {
    ...currentSlotCache,
    remainingMs: Math.max(0, remainingMs),
    remainingSeconds: Math.ceil(Math.max(0, remainingMs) / 1000),
    serverTime: now.toISOString()
  };
}

/**
 * Validasi token QR saat karyawan check-in / check-out
 */
export async function validateQrToken(tokenPlain, expectedType) {
  if (!tokenPlain) {
    return { valid: false, reason: 'Token QR tidak ditemukan.' };
  }

  const tokenHash = crypto.createHash('sha256').update(tokenPlain).digest('hex');
  const db = await getDb();

  const query = `
    SELECT * FROM qr_tokens 
    WHERE token_hash = $1 OR token_plain = $1
    ORDER BY created_at DESC LIMIT 1
  `;
  const result = await db.query(query, [tokenHash]);

  if (result.rows.length === 0) {
    return { valid: false, reason: 'QR Code tidak terdaftar atau tidak sah.' };
  }

  const token = result.rows[0];

  // 1. Cek apakah sudah pernah digunakan
  if (token.status === 'USED' || token.used_at) {
    return { valid: false, reason: 'Token QR ini sudah pernah digunakan (Single-Use Token).' };
  }

  // 2. Cek apakah sudah kedaluwarsa (diberikan toleransi network 2.5 detik)
  const now = new Date();
  const expiryWithGrace = new Date(new Date(token.expires_at).getTime() + 2500);
  if (now > expiryWithGrace || token.status === 'EXPIRED') {
    return { valid: false, reason: 'QR Code sudah kedaluwarsa. Silakan scan QR terbaru pada monitor.' };
  }

  // 3. Cek kesesuaian tipe QR (CHECK_IN vs CHECK_OUT)
  if (expectedType && token.type !== expectedType) {
    return {
      valid: false,
      reason: `Jenis QR tidak sesuai. QR ini adalah untuk ${token.type === 'CHECK_IN' ? 'Absen Masuk' : 'Absen Pulang'}.`
    };
  }

  return {
    valid: true,
    tokenId: token.id,
    type: token.type
  };
}

/**
 * Tandai token sebagai telah dipakai (used)
 */
export async function markTokenAsUsed(tokenId) {
  const db = await getDb();
  await db.query(`
    UPDATE qr_tokens 
    SET status = 'USED', used_at = CURRENT_TIMESTAMP 
    WHERE id = $1
  `, [tokenId]);
}

export default {
  determineQrType,
  getCurrentQr,
  validateQrToken,
  markTokenAsUsed
};
