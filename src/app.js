import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import { attachUser } from "./middlewares/authMiddleware.js";
import authRouter from "./routes/auth.js";
import qrRouter from "./routes/qr.js";
import attendanceRouter from "./routes/attendance.js";
import adminRouter from "./routes/admin.js";
import adminEmployeesRouter from "./routes/adminEmployees.js";
import leaveRouter from "./routes/leave.js";
import adminLeaveRouter from "./routes/adminLeave.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachUser);

// API Endpoints
app.use("/api/auth", authRouter);
app.use("/api/qr", qrRouter);
app.use("/api/attendance/leave", leaveRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/employees", adminEmployeesRouter);
app.use("/api/admin/leave", adminLeaveRouter);

// Static files directory
const publicDir = path.resolve(__dirname, "../public");

// Frontend Page Routing with Role-based Guards
app.get("/display", (req, res) => {
  res.sendFile(path.join(publicDir, "display.html"));
});

app.get(["/scan", "/scan.html"], (req, res) => {
  if (req.user && req.user.role === "ADMIN") {
    return res.redirect("/admin");
  }
  res.sendFile(path.join(publicDir, "scan.html"));
});

app.get(["/login", "/login.html"], (req, res) => {
  if (req.user) {
    if (req.user.role === "ADMIN") {
      return res.redirect("/admin");
    }
    return res.redirect("/scan");
  }
  res.sendFile(path.join(publicDir, "login.html"));
});

app.get(["/admin", "/admin.html"], (req, res) => {
  if (!req.user) {
    return res.redirect("/login?redirect=/admin");
  }
  if (req.user.role !== "ADMIN") {
    return res.redirect("/scan");
  }
  res.sendFile(path.join(publicDir, "admin.html"));
});

// Scan QR melalui kamera HP (/a/:token)
app.get("/a/:token", (req, res) => {
  if (req.user && req.user.role === "ADMIN") {
    return res.redirect("/admin");
  }
  res.sendFile(path.join(publicDir, "attend.html"));
});

// Static files
app.use(express.static(publicDir));

// Default fallback
app.use((req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
