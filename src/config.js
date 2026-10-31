import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "1116", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  sessionSecret: process.env.SESSION_SECRET || "absensi_secret_key_2026",
  appUrl: process.env.APP_URL || "http://localhost:1116",
  officeName: process.env.OFFICE_NAME || "SMP Al Falah Assalam Tropodo",
  checkInLimit: process.env.CHECK_IN_LIMIT || "08:00:00",
  checkOutStart: process.env.CHECK_OUT_START || "16:00:00",
  qrIntervalSeconds: 5,
  sessionMaxAgeDays: 30,
  qrTokenRetentionDays: Math.max(
    1,
    parseInt(process.env.QR_TOKEN_RETENTION_DAYS || "3", 10) || 3,
  ),
  purgeIntervalHours: Math.max(
    1,
    parseInt(process.env.PURGE_INTERVAL_HOURS || "6", 10) || 6,
  ),
};

export default config;
