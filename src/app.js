
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { attachUser } from './middlewares/authMiddleware.js';
import authRouter from './routes/auth.js';
import qrRouter from './routes/qr.js';
import attendanceRouter from './routes/attendance.js';
import adminRouter from './routes/admin.js';
import adminEmployeesRouter from './routes/adminEmployees.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachUser);

// Static files
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// API Endpoints
app.use('/api/auth', authRouter);
app.use('/api/qr', qrRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/admin', adminRouter);

// CRUD API Guru dan Pegawai.
// Route ini memiliki middleware requireAdmin sendiri.
app.use('/api/admin/employees', adminEmployeesRouter);

// Frontend Page Routing
app.get('/display', (req, res) => {
  res.sendFile(path.join(publicDir, 'display.html'));
});

app.get('/scan', (req, res) => {
  res.sendFile(path.join(publicDir, 'scan.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Scan QR melalui kamera HP (/a/:token)
app.get('/a/:token', (req, res) => {
  res.sendFile(path.join(publicDir, 'attend.html'));
});

// Default fallback
app.use((req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

export default app;
