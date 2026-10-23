import express from "express";
import bcrypt from "bcryptjs";
import { getDb } from "../../db/index.js";
import { requireAdmin } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Semua endpoint di file ini hanya boleh diakses admin.
router.use(requireAdmin);

const EMPLOYEE_COLUMNS = `
  id,
  employee_number,
  name,
  email,
  department_id,
  position,
  role,
  status,
  created_at,
  updated_at
`;

function fail(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
  });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validEmail(value) {
  return value.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 128 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value)
  );
}

function isDuplicateError(error) {
  return error?.code === "23505";
}

async function getEmployee(db, id) {
  const result = await db.query(
    `SELECT ${EMPLOYEE_COLUMNS}
     FROM employees
     WHERE id = $1 AND role = 'EMPLOYEE'
     LIMIT 1`,
    [id],
  );

  return result.rows[0] ?? null;
}

async function departmentExists(db, id) {
  const result = await db.query(
    "SELECT id FROM departments WHERE id = $1 LIMIT 1",
    [id],
  );

  return result.rows.length > 0;
}

async function duplicateExists(db, employeeNumber, email, excludeId = null) {
  const result = await db.query(
    `SELECT id
     FROM employees
     WHERE role = 'EMPLOYEE'
       AND (
         employee_number = $1
         OR LOWER(email) = LOWER($2)
       )
       AND ($3::integer IS NULL OR id <> $3)
     LIMIT 1`,
    [employeeNumber, email, excludeId],
  );

  return result.rows.length > 0;
}

async function writeAudit(db, req, action, employeeId) {
  try {
    await db.query(
      `INSERT INTO audit_logs
        (employee_id, action, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        action,
        req.ip || null,
        req.get("user-agent") || null,
        JSON.stringify({ targetEmployeeId: employeeId }),
      ],
    );
  } catch (error) {
    // Jangan mengirimkan detail internal database ke klien.
    console.error("[EMPLOYEE_AUDIT_ERROR]", error.message);
  }
}

// GET /api/admin/employees
// Query opsional: search, status, departmentId, page, limit
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const search = text(req.query.search).toLowerCase();
    const status = text(req.query.status || "ACTIVE").toUpperCase();
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);

    if (search.length > 150) {
      return fail(res, 400, "Kata pencarian terlalu panjang.");
    }

    if (!["ACTIVE", "INACTIVE", "ALL"].includes(status)) {
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

    let departmentId = null;

    if (req.query.departmentId !== undefined && req.query.departmentId !== "") {
      departmentId = positiveId(req.query.departmentId);

      if (!departmentId) {
        return fail(res, 400, "ID departemen tidak valid.");
      }
    }

    const conditions = ["e.role = 'EMPLOYEE'"];
    const params = [];
    let paramIndex = 1;

    if (status !== "ALL") {
      conditions.push(`e.status = $${paramIndex++}`);
      params.push(status);
    }

    if (departmentId !== null) {
      conditions.push(`e.department_id = $${paramIndex++}`);
      params.push(departmentId);
    }

    if (search) {
      conditions.push(
        `(LOWER(e.name) LIKE $${paramIndex}
          OR LOWER(e.employee_number) LIKE $${paramIndex}
          OR LOWER(e.email) LIKE $${paramIndex})`,
      );
      params.push(`%${search}%`);
      paramIndex++;
    }

    const where = conditions.join(" AND ");

    const countResult = await db.query(
      `SELECT COUNT(*) AS total
       FROM employees e
       WHERE ${where}`,
      params,
    );

    const total = Number(countResult.rows[0].total);
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT
         e.id,
         e.employee_number,
         e.name,
         e.email,
         e.department_id,
         d.name AS department_name,
         d.code AS department_code,
         e.position,
         e.role,
         e.status,
         e.created_at,
         e.updated_at
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE ${where}
       ORDER BY e.name ASC
       LIMIT $${paramIndex}
       OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    );

    return res.json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[EMPLOYEE_LIST_ERROR]", error.message);
    return fail(res, 500, "Gagal memuat daftar pegawai.");
  }
});

// POST /api/admin/employees
// Body: employeeNumber, name, email, departmentId, position, initialPassword
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const employeeNumber = text(req.body?.employeeNumber);
    const name = text(req.body?.name);
    const email = text(req.body?.email).toLowerCase();
    const position = text(req.body?.position);
    const departmentId = positiveId(req.body?.departmentId);
    const initialPassword = req.body?.initialPassword;

    if (
      !employeeNumber ||
      !name ||
      !email ||
      !departmentId ||
      initialPassword === undefined
    ) {
      return fail(
        res,
        400,
        "NIP, nama, email, departemen, dan password awal wajib diisi.",
      );
    }

    if (employeeNumber.length > 50) {
      return fail(res, 400, "NIP maksimal 50 karakter.");
    }

    if (name.length > 150) {
      return fail(res, 400, "Nama maksimal 150 karakter.");
    }

    if (!validEmail(email)) {
      return fail(res, 400, "Format email tidak valid.");
    }

    if (position.length > 100) {
      return fail(res, 400, "Jabatan maksimal 100 karakter.");
    }

    if (!validPassword(initialPassword)) {
      return fail(
        res,
        400,
        "Password harus 12–128 karakter dan mengandung huruf kecil, huruf besar, serta angka.",
      );
    }

    if (!(await departmentExists(db, departmentId))) {
      return fail(res, 400, "Departemen tidak ditemukan.");
    }

    if (await duplicateExists(db, employeeNumber, email)) {
      return fail(res, 409, "NIP atau email sudah digunakan.");
    }

    const passwordHash = await bcrypt.hash(initialPassword, 12);

    const result = await db.query(
      `INSERT INTO employees
        (employee_number, name, email, password_hash,
         department_id, position, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'EMPLOYEE', 'ACTIVE')
       RETURNING ${EMPLOYEE_COLUMNS}`,
      [
        employeeNumber,
        name,
        email,
        passwordHash,
        departmentId,
        position || null,
      ],
    );

    const employee = result.rows[0];

    await writeAudit(db, req, "CREATE_EMPLOYEE", employee.id);

    return res.status(201).json({
      success: true,
      message: "Akun pegawai berhasil dibuat.",
      data: employee,
    });
  } catch (error) {
    if (isDuplicateError(error)) {
      return fail(res, 409, "NIP atau email sudah digunakan.");
    }

    console.error("[EMPLOYEE_CREATE_ERROR]", error.message);
    return fail(res, 500, "Gagal membuat akun pegawai.");
  }
});
// GET /api/admin/employees/:id
router.get("/:id", async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) return fail(res, 400, "ID pegawai tidak valid.");

    const db = await getDb();
    const result = await db.query(
      `SELECT e.id, e.employee_number, e.name, e.email,
              e.department_id, d.name AS department_name, d.code AS department_code,
              e.position, e.role, e.status, e.created_at, e.updated_at
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.id = $1 AND e.role = 'EMPLOYEE'
       LIMIT 1`,
      [id],
    );

    if (!result.rows.length) return fail(res, 404, "Pegawai tidak ditemukan.");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("[EMPLOYEE_DETAIL_ERROR]", error.message);
    return fail(res, 500, "Gagal memuat detail pegawai.");
  }
});
// PATCH /api/admin/employees/:id
// Body opsional: employeeNumber, name, email, departmentId, position
router.patch("/:id", async (req, res) => {
  try {
    const id = positiveId(req.params.id);

    if (!id) {
      return fail(res, 400, "ID pegawai tidak valid.");
    }

    const db = await getDb();
    const current = await getEmployee(db, id);

    if (!current) {
      return fail(res, 404, "Pegawai tidak ditemukan.");
    }

    const body = req.body || {};
    const allowed = [
      "employeeNumber",
      "name",
      "email",
      "departmentId",
      "position",
    ];

    if (
      !allowed.some((key) => Object.prototype.hasOwnProperty.call(body, key))
    ) {
      return fail(res, 400, "Tidak ada data yang diperbarui.");
    }

    const employeeNumber =
      body.employeeNumber === undefined
        ? current.employee_number
        : text(body.employeeNumber);

    const name = body.name === undefined ? current.name : text(body.name);

    const email =
      body.email === undefined ? current.email : text(body.email).toLowerCase();

    const position =
      body.position === undefined
        ? current.position || ""
        : text(body.position);

    let departmentId = current.department_id;

    if (body.departmentId !== undefined) {
      departmentId = positiveId(body.departmentId);

      if (!departmentId || !(await departmentExists(db, departmentId))) {
        return fail(res, 400, "Departemen tidak valid.");
      }
    }

    if (!employeeNumber || employeeNumber.length > 50) {
      return fail(res, 400, "NIP wajib diisi, maksimal 50 karakter.");
    }

    if (!name || name.length > 150) {
      return fail(res, 400, "Nama wajib diisi, maksimal 150 karakter.");
    }

    if (!validEmail(email)) {
      return fail(res, 400, "Format email tidak valid.");
    }

    if (position.length > 100) {
      return fail(res, 400, "Jabatan maksimal 100 karakter.");
    }

    if (await duplicateExists(db, employeeNumber, email, id)) {
      return fail(res, 409, "NIP atau email sudah digunakan pegawai lain.");
    }

    const result = await db.query(
      `UPDATE employees
       SET employee_number = $1,
           name = $2,
           email = $3,
           department_id = $4,
           position = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND role = 'EMPLOYEE'
       RETURNING ${EMPLOYEE_COLUMNS}`,
      [employeeNumber, name, email, departmentId, position || null, id],
    );

    if (!result.rows.length) {
      return fail(res, 404, "Pegawai tidak ditemukan.");
    }

    await writeAudit(db, req, "UPDATE_EMPLOYEE", id);

    return res.json({
      success: true,
      message: "Data pegawai berhasil diperbarui.",
      data: result.rows[0],
    });
  } catch (error) {
    if (isDuplicateError(error)) {
      return fail(res, 409, "NIP atau email sudah digunakan.");
    }

    console.error("[EMPLOYEE_UPDATE_ERROR]", error.message);
    return fail(res, 500, "Gagal memperbarui data pegawai.");
  }
});

// PATCH /api/admin/employees/:id/reset-password
// Body: { "newPassword": "PasswordBaru123" }
router.patch("/:id/reset-password", async (req, res) => {
  try {
    const id = positiveId(req.params.id);

    if (!id) {
      return fail(res, 400, "ID pegawai tidak valid.");
    }

    const newPassword = req.body?.newPassword;

    if (!validPassword(newPassword)) {
      return fail(
        res,
        400,
        "Password baru harus 12–128 karakter dan mengandung huruf kecil, huruf besar, serta angka.",
      );
    }

    const db = await getDb();
    const employee = await getEmployee(db, id);

    if (!employee) {
      return fail(res, 404, "Pegawai tidak ditemukan.");
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await db.query(
      `UPDATE employees
       SET password_hash = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND role = 'EMPLOYEE'`,
      [passwordHash, id],
    );

    await db.query(
      `UPDATE sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE employee_id = $1
         AND revoked_at IS NULL`,
      [id],
    );

    await writeAudit(db, req, "RESET_EMPLOYEE_PASSWORD", id);

    return res.json({
      success: true,
      message: "Password direset dan sesi aktif dicabut.",
    });
  } catch (error) {
    console.error("[EMPLOYEE_RESET_PASSWORD_ERROR]", error.message);
    return fail(res, 500, "Gagal mereset password pegawai.");
  }
});

// PATCH /api/admin/employees/:id/status
// Body: { "status": "ACTIVE" } atau { "status": "INACTIVE" }
router.patch("/:id/status", async (req, res) => {
  try {
    const id = positiveId(req.params.id);

    if (!id) {
      return fail(res, 400, "ID pegawai tidak valid.");
    }

    const status = text(req.body?.status).toUpperCase();

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      return fail(res, 400, "Status harus ACTIVE atau INACTIVE.");
    }

    const db = await getDb();
    const employee = await getEmployee(db, id);

    if (!employee) {
      return fail(res, 404, "Pegawai tidak ditemukan.");
    }

    if (employee.status === status) {
      return res.json({
        success: true,
        message: `Akun sudah berstatus ${status}.`,
        data: employee,
      });
    }

    const result = await db.query(
      `UPDATE employees
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND role = 'EMPLOYEE'
       RETURNING ${EMPLOYEE_COLUMNS}`,
      [status, id],
    );

    if (!result.rows.length) {
      return fail(res, 404, "Pegawai tidak ditemukan.");
    }

    if (status === "INACTIVE") {
      await db.query(
        `UPDATE sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE employee_id = $1
           AND revoked_at IS NULL`,
        [id],
      );
    }

    await writeAudit(
      db,
      req,
      status === "INACTIVE" ? "DEACTIVATE_EMPLOYEE" : "ACTIVATE_EMPLOYEE",
      id,
    );

    return res.json({
      success: true,
      message:
        status === "INACTIVE"
          ? "Akun dinonaktifkan tanpa menghapus riwayat absensi."
          : "Akun berhasil diaktifkan.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("[EMPLOYEE_STATUS_ERROR]", error.message);
    return fail(res, 500, "Gagal mengubah status akun pegawai.");
  }
});

export default router;
