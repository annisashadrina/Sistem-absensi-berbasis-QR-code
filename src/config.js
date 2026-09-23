import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'absensi_secret_key_2026',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  officeName: process.env.OFFICE_NAME || 'SMP Al Falah Assalam Tropodo',
  checkInLimit: process.env.CHECK_IN_LIMIT || '08:00:00',
  checkOutStart: process.env.CHECK_OUT_START || '16:00:00',
  qrIntervalSeconds: 5,
  sessionMaxAgeDays: 30
};

export default config;
