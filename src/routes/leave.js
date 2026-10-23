import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { getDb } from "../../db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "../../uploads/leave");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const router = express.Router();

const LEAVE_TYPES = ["SAKIT", "IZIN", "CUTI"];
const MAX_DAYS = 90;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

const LEAVE_COLUMNS = `
  id, employee_id, leave_type,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date,
  reason, (attachment_path IS NOT NULL) AS has_attachment,
  status, reviewed_by, reviewed_at, review_note, created_at
`;

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Terima hanya tanggal kalender yang nyata, format YYYY-MM-DD.
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function daysBetween(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}

async function removeFile(filePath) {
  if (filePath) await fs.promises.unlink(filePath).catch(() => {});
}

// Cek isi file, bukan hanya Content-Type dari klien.
function hasValidSignature(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  return (
    buf.subarray(0, 3).toString("hex") === "ffd8ff" ||
    buf.toString("hex") === "89504e470d0a1a0a" ||
    buf.subarray(0, 4).toString("latin1") === "%PDF"
  );
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // Nama acak; nama asli dari klien tidak dipakai sama sekali.
    filename: (req, file, cb) =>
      cb(null, crypto.randomUUID() + EXTENSIONS[file.mimetype]),
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) =>
    EXTENSIONS[file.mimetype]
      ? cb(null, true)
      : cb(new Error("INVALID_FILE_TYPE")),
}).single("attachment");

function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return fail(res, 400, "Ukuran file maksimal 5 MB.");
    }
    if (err.message === "INVALID_FILE_TYPE") {
      return fail(res, 400, "File harus berupa JPG, PNG, atau PDF.");
    }
    return fail(res, 400, "Upload file gagal.");
  });
}

// POST /api/attendance/leave   (multipart/form-data)
// Field: leaveType, startDate, endDate, reason, attachment (opsional kecuali SAKIT)
router.post("/", requireAuth, handleUpload, async (req, res) => {
  const uploaded = req.file;
  const reject = async (status, message) => {
    if (uploaded) await removeFile(uploaded.path);
    return fail(res, status, message);
  };

  try {
    const leaveType = text(req.body?.leaveType).toUpperCase();
    const startDate = validDate(text(req.body?.startDate));
    const endDate = validDate(text(req.body?.endDate));
    const reason = text(req.body?.reason);

    if (!LEAVE_TYPES.includes(leaveType)) {
      return reject(400, "Jenis pengajuan harus SAKIT, IZIN, atau CUTI.");
    }
    if (!startDate || !endDate) {
      return reject(400, "Tanggal harus berformat YYYY-MM-DD.");
    }
    if (endDate < startDate) {
      return reject(400, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
    }
    if (daysBetween(startDate, endDate) > MAX_DAYS) {
      return reject(400, `Rentang pengajuan maksimal ${MAX_DAYS} hari.`);
    }
    if (!reason || reason.length > 500) {
      return reject(400, "Alasan wajib diisi, maksimal 500 karakter.");
    }
    if (leaveType === "SAKIT" && !uploaded) {
      return reject(
        400,
        "Pengajuan sakit wajib melampirkan bukti (surat dokter).",
      );
    }
    if (uploaded && !hasValidSignature(uploaded.path)) {
      return reject(400, "Isi file tidak sesuai format JPG, PNG, atau PDF.");
    }

    const db = await getDb();

    const overlap = await db.query(
      `SELECT id FROM leave_requests
       WHERE employee_id = $1
         AND status IN ('PENDING', 'APPROVED')
         AND start_date <= $3::date
         AND end_date >= $2::date
       LIMIT 1`,
      [req.user.id, startDate, endDate],
    );
    if (overlap.rows.length) {
      return reject(
        409,
        "Sudah ada pengajuan lain pada rentang tanggal tersebut.",
      );
    }

    const result = await db.query(
      `INSERT INTO leave_requests
        (employee_id, leave_type, start_date, end_date, reason, attachment_path)
       VALUES ($1, $2, $3::date, $4::date, $5, $6)
       RETURNING ${LEAVE_COLUMNS}`,
      [
        req.user.id,
        leaveType,
        startDate,
        endDate,
        reason,
        uploaded ? path.basename(uploaded.path) : null,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Pengajuan terkirim dan menunggu persetujuan admin.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("[LEAVE_CREATE_ERROR]", error.message);
    return reject(500, "Gagal mengirim pengajuan.");
  }
});

// GET /api/attendance/leave?status=ALL|PENDING|APPROVED|REJECTED
// Riwayat pengajuan milik guru yang sedang login.
router.get("/", requireAuth, async (req, res) => {
  try {
    const status = text(req.query.status || "ALL").toUpperCase();
    if (!["ALL", "PENDING", "APPROVED", "REJECTED"].includes(status)) {
      return fail(res, 400, "Filter status tidak valid.");
    }

    const params = [req.user.id];
    let where = "employee_id = $1";
    if (status !== "ALL") {
      where += " AND status = $2";
      params.push(status);
    }

    const db = await getDb();
    const result = await db.query(
      `SELECT ${LEAVE_COLUMNS}
       FROM leave_requests
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      params,
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[LEAVE_LIST_ERROR]", error.message);
    return fail(res, 500, "Gagal memuat riwayat pengajuan.");
  }
});

// GET /api/attendance/leave/:id/attachment
// Hanya pemilik pengajuan atau admin.
router.get("/:id/attachment", requireAuth, async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) return fail(res, 400, "ID pengajuan tidak valid.");

    const db = await getDb();
    const result = await db.query(
      "SELECT employee_id, attachment_path FROM leave_requests WHERE id = $1",
      [id],
    );
    const row = result.rows[0];

    // 404 (bukan 403) supaya ID milik orang lain tidak bisa ditebak.
    if (
      !row ||
      !row.attachment_path ||
      (req.user.role !== "ADMIN" && row.employee_id !== req.user.id)
    ) {
      return fail(res, 404, "Lampiran tidak ditemukan.");
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.sendFile(
      path.join(UPLOAD_DIR, path.basename(row.attachment_path)),
      (err) => {
        if (err && !res.headersSent)
          fail(res, 404, "File lampiran tidak ditemukan.");
      },
    );
  } catch (error) {
    console.error("[LEAVE_ATTACHMENT_ERROR]", error.message);
    return fail(res, 500, "Gagal memuat lampiran.");
  }
});

export default router;
