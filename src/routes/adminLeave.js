import express from "express";
import { requireAdmin } from "../middlewares/authMiddleware.js";
import { getDb } from "../../db/index.js";

const router = express.Router();
router.use(requireAdmin);

const LEAVE_QUERY = `
  SELECT
    l.id, l.employee_id, e.employee_number, e.name AS employee_name,
    d.name AS department_name, l.leave_type,
    to_char(l.start_date, 'YYYY-MM-DD') AS start_date,
    to_char(l.end_date, 'YYYY-MM-DD') AS end_date,
    l.reason, (l.attachment_path IS NOT NULL) AS has_attachment,
    l.status, l.reviewed_by, l.reviewed_at, l.review_note, l.created_at
  FROM leave_requests l
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
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

async function writeAudit(db, req, action, leaveId) {
  try {
    await db.query(
      `INSERT INTO audit_logs (employee_id, action, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        action,
        req.ip || null,
        req.get("user-agent") || null,
        JSON.stringify({ leaveId }),
      ],
    );
  } catch (error) {
    console.error("[LEAVE_AUDIT_ERROR]", error.message);
  }
}

// GET /api/admin/leave?status=PENDING&page=1&limit=20
router.get("/", async (req, res) => {
  try {
    const status = text(req.query.status || "PENDING").toUpperCase();
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);

    if (!["ALL", "PENDING", "APPROVED", "REJECTED"].includes(status)) {
      return fail(res, 400, "Filter status tidak valid.");
    }
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return fail(res, 400, "Parameter page atau limit tidak valid.");
    }

    const db = await getDb();
    const params = [];
    let where = "";
    if (status !== "ALL") {
      where = "WHERE l.status = $1";
      params.push(status);
    }

    const count = await db.query(
      `SELECT COUNT(*) AS total FROM leave_requests l ${where}`,
      params,
    );
    const total = Number(count.rows[0].total);

    const result = await db.query(
      `${LEAVE_QUERY} ${where}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );

    return res.json({
      success: true,
      data: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[LEAVE_ADMIN_LIST_ERROR]", error);
    return fail(res, 500, "Gagal memuat daftar pengajuan." + error.message);
  }
});

// GET /api/admin/leave/:id
router.get("/:id", async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) return fail(res, 400, "ID pengajuan tidak valid.");

    const db = await getDb();
    const result = await db.query(`${LEAVE_QUERY} WHERE l.id = $1`, [id]);
    if (!result.rows.length)
      return fail(res, 404, "Pengajuan tidak ditemukan.");

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("[LEAVE_ADMIN_DETAIL_ERROR]", error);
    return fail(res, 500, "Gagal memuat detail pengajuan.");
  }
});

// PUT /api/admin/leave/:id/status
// Body: { "status": "APPROVED" | "REJECTED", "note": "..." }  (note wajib saat REJECTED)
router.put("/:id/status", async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) return fail(res, 400, "ID pengajuan tidak valid.");

    const status = text(req.body?.status).toUpperCase();
    const note = text(req.body?.note);

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return fail(res, 400, "Status harus APPROVED atau REJECTED.");
    }
    if (status === "REJECTED" && !note) {
      return fail(res, 400, "Catatan wajib diisi saat menolak pengajuan.");
    }
    if (note.length > 500) {
      return fail(res, 400, "Catatan maksimal 500 karakter.");
    }

    const db = await getDb();

    // Hanya pengajuan PENDING yang bisa diputuskan (cek dan update atomik).
    const updated = await db.query(
      `UPDATE leave_requests
       SET status = $1, reviewed_by = $2,
           reviewed_at = CURRENT_TIMESTAMP, review_note = $3
       WHERE id = $4 AND status = 'PENDING'
       RETURNING id`,
      [status, req.user.id, note || null, id],
    );

    if (!updated.rows.length) {
      const exists = await db.query(
        "SELECT status FROM leave_requests WHERE id = $1",
        [id],
      );
      return exists.rows.length
        ? fail(res, 409, `Pengajuan sudah berstatus ${exists.rows[0].status}.`)
        : fail(res, 404, "Pengajuan tidak ditemukan.");
    }

    await writeAudit(
      db,
      req,
      status === "APPROVED" ? "APPROVE_LEAVE" : "REJECT_LEAVE",
      id,
    );

    const detail = await db.query(`${LEAVE_QUERY} WHERE l.id = $1`, [id]);
    return res.json({
      success: true,
      message:
        status === "APPROVED" ? "Pengajuan disetujui." : "Pengajuan ditolak.",
      data: detail.rows[0],
    });
  } catch (error) {
    console.error("[LEAVE_STATUS_ERROR]", error.message);
    return fail(res, 500, "Gagal memproses pengajuan.");
  }
});

export default router;
