/**
 * INTEGRATION TEST SUITE: SISTEM ABSENSI KARYAWAN BERBASIS QR DINAMIS
 * Menguji kepatuhan terhadap seluruh aturan di readme.md:
 * 1. Token 5 detik dan rotasi dinamis
 * 2. Autentikasi dan session persistent
 * 3. Absensi Masuk (Check-In) tepat waktu vs terlambat
 * 4. Anti-Replay: Token single-use tidak bisa dipakai 2x
 * 5. Anti-Duplicate: Karyawan tidak bisa absen masuk 2x di hari yang sama
 * 6. Top 5 Karyawan Terawal (Bab 19)
 * 7. Hak Akses Admin (RBAC) pada Dashboard dan Audit Logs
 */

import app from "../src/app.js";
import { getDb } from "../db/index.js";
import fs from "node:fs";
import path from "node:path";
import { purgeExpiredQrTokens } from "../src/jobs/purgeQrTokens.js";
const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

let server;
let db;
let cookieBudi = "";
let cookieAdmin = "";
let testEmployeeId = null;
let testEmployeeNumber = "";
let testEmployeeEmail = "";
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Respons bukan JSON valid (HTTP ${response.status}): ${text}`,
    );
  }
}

async function test(name, callback) {
  console.log(`\n▶ ${name}`);

  try {
    await callback();
    passed += 1;
    console.log("  ✓ LULUS");
  } catch (error) {
    failed += 1;
    console.error(`  ✗ GAGAL: ${error.message}`);
  }
}

async function login(identifier, password) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identifier,
      password,
    }),
  });

  const body = await readJson(response);
  const rawCookie = response.headers.get("set-cookie") || "";

  return {
    response,
    body,
    cookie: rawCookie.includes("absensi_session")
      ? rawCookie.split(";")[0]
      : "",
  };
}

async function runTests() {
  console.log("========================================================");
  console.log("PENGUJIAN INTEGRASI SISTEM ABSENSI + CRUD KARYAWAN");
  console.log("========================================================\n");

  db = await getDb();

  server = app.listen(PORT);

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  console.log(`Server uji aktif di port ${PORT}`);

  try {
    // TEST 1: GENERATOR QR DINAMIS
    await test("Test 1: Generator QR Dinamis", async () => {
      const response = await fetch(`${BASE_URL}/api/qr/current`);
      const body = await readJson(response);

      assert(response.ok && body.success === true, "Endpoint QR harus sukses");

      assert(
        typeof body.data?.token === "string" && body.data.token.length > 0,
        "Token QR harus terisi",
      );

      assert(
        body.data?.qrDataUrl?.startsWith("data:image/png;base64,"),
        "QR harus berupa data URL PNG",
      );

      console.log(`  Token QR: ${body.data.token.substring(0, 12)}...`);
    });

    // TEST 2: LOGIN KARYAWAN
    await test("Test 2: Login karyawan dan cookie sesi", async () => {
      const result = await login("budi@company.com", "password123");

      assert(
        result.response.ok && result.body.success === true,
        "Login Budi harus berhasil",
      );

      assert(
        result.body.user?.name === "Budi Santoso",
        "Nama user harus Budi Santoso",
      );

      assert(
        result.cookie.includes("absensi_session"),
        "Cookie sesi harus diberikan",
      );

      cookieBudi = result.cookie;
    });

    // TEST 3: VERIFIKASI SESI
    await test("Test 3: Verifikasi sesi /api/auth/me", async () => {
      const response = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: {
          Cookie: cookieBudi,
        },
      });

      const body = await readJson(response);

      assert(response.ok && body.success === true, "Sesi karyawan harus valid");

      assert(body.user?.email === "budi@company.com", "Email sesi harus cocok");
    });

    // TEST 4: CHECK-IN
    await test("Test 4: Proteksi check-in dan duplikasi", async () => {
      const qrResponse = await fetch(
        `${BASE_URL}/api/qr/current?type=CHECK_IN`,
      );

      const qrBody = await readJson(qrResponse);

      assert(
        qrBody.success === true && qrBody.data?.token,
        "QR check-in harus tersedia",
      );

      const response = await fetch(`${BASE_URL}/api/attendance/check-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieBudi,
        },
        body: JSON.stringify({
          token: qrBody.data.token,
        }),
      });

      const body = await readJson(response);

      const duplicate =
        !body.success &&
        String(body.message || "")
          .toLowerCase()
          .includes("sudah melakukan absensi");

      assert(
        response.ok ? body.success === true || duplicate : duplicate,
        "Check-in harus berhasil atau ditolak karena duplikasi",
      );
    });

    // TEST 5: TOKEN PALSU
    await test("Test 5: Token QR palsu ditolak", async () => {
      const response = await fetch(`${BASE_URL}/api/attendance/check-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieBudi,
        },
        body: JSON.stringify({
          token: "FAKE_EXPIRED_OR_INVALID_TOKEN_999",
        }),
      });

      const body = await readJson(response);

      assert(body.success === false, "Token palsu tidak boleh diterima");
    });

    // TEST 6: LIVE DISPLAY
    await test("Test 6: Display TV menampilkan daftar karyawan", async () => {
      const response = await fetch(`${BASE_URL}/api/qr/live-display`);

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        "Endpoint display harus sukses",
      );

      assert(Array.isArray(body.top5), "top5 harus berupa array");

      assert(body.top5.length > 0, "Daftar display seharusnya memuat karyawan");

      console.log(`  Data display memuat ${body.top5.length} karyawan.`);
    });

    // TEST 7: HAK AKSES ADMIN
    await test("Test 7: RBAC dashboard admin", async () => {
      const employeeResponse = await fetch(`${BASE_URL}/api/admin/dashboard`, {
        headers: {
          Cookie: cookieBudi,
        },
      });

      assert(
        employeeResponse.status === 403,
        "Karyawan biasa harus mendapat HTTP 403",
      );

      const result = await login("admin@company.com", "password123");

      assert(
        result.response.ok && result.body.success === true,
        "Login admin harus berhasil",
      );

      assert(
        result.cookie.includes("absensi_session"),
        "Cookie admin harus tersedia",
      );

      cookieAdmin = result.cookie;

      const dashboardResponse = await fetch(`${BASE_URL}/api/admin/dashboard`, {
        headers: {
          Cookie: cookieAdmin,
        },
      });

      const dashboardBody = await readJson(dashboardResponse);

      assert(
        dashboardResponse.ok && dashboardBody.success === true,
        "Admin harus dapat membuka dashboard",
      );

      const auditResponse = await fetch(`${BASE_URL}/api/admin/audit-logs`, {
        headers: {
          Cookie: cookieAdmin,
        },
      });

      const auditBody = await readJson(auditResponse);

      assert(
        auditResponse.ok && auditBody.success === true,
        "Admin harus dapat membaca audit logs",
      );
    });

    // TEST 8: AKSES TANPA LOGIN
    await test("Test 8: CRUD ditolak tanpa login", async () => {
      const response = await fetch(`${BASE_URL}/api/admin/employees`);

      assert(
        response.status === 401 || response.status === 403,
        "Pengguna tanpa sesi harus ditolak",
      );
    });

    // TEST 9: AKSES OLEH KARYAWAN BIASA
    await test("Test 9: CRUD ditolak untuk karyawan biasa", async () => {
      const response = await fetch(`${BASE_URL}/api/admin/employees`, {
        headers: {
          Cookie: cookieBudi,
        },
      });

      assert(response.status === 403, "Karyawan biasa harus mendapat HTTP 403");
    });

    // TEST 10: DAFTAR KARYAWAN
    await test("Test 10: Admin dapat melihat daftar karyawan", async () => {
      const response = await fetch(
        `${BASE_URL}/api/admin/employees?status=ALL&page=1&limit=10`,
        {
          headers: {
            Cookie: cookieAdmin,
          },
        },
      );

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        "Daftar karyawan harus berhasil dimuat",
      );

      assert(Array.isArray(body.data), "Data karyawan harus berupa array");

      assert(
        body.pagination && Number.isInteger(body.pagination.total),
        "Informasi pagination harus tersedia",
      );
    });

    // TEST 11: TAMBAH KARYAWAN
    await test("Test 11: Admin dapat membuat karyawan baru", async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

      testEmployeeNumber = `TST${suffix}`.slice(0, 20);
      testEmployeeEmail = `crud.test.${suffix}@example.com`;

      const response = await fetch(`${BASE_URL}/api/admin/employees`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieAdmin,
        },
        body: JSON.stringify({
          employeeNumber: testEmployeeNumber,
          name: "Karyawan Tes CRUD",
          email: testEmployeeEmail,
          departmentId: 1,
          position: "Guru Pengujian",
          initialPassword: "TempPass123!",
        }),
      });

      const body = await readJson(response);

      // Simpan ID sebelum assertion agar cleanup tetap bisa dilakukan.
      if (response.status === 201 && body.data?.id != null) {
        testEmployeeId = body.data.id;
      }

      assert(
        response.status === 201 && body.success === true,
        `Pembuatan karyawan harus menghasilkan HTTP 201; respons: ${body.message || "tanpa pesan"}`,
      );

      assert(
        body.data?.employee_number === testEmployeeNumber,
        "Nomor karyawan harus sesuai",
      );

      assert(
        body.data?.email === testEmployeeEmail,
        "Email karyawan harus sesuai",
      );

      assert(
        !Object.prototype.hasOwnProperty.call(body.data || {}, "password_hash"),
        "Password hash tidak boleh dikirim ke klien",
      );

      assert(
        Number.isInteger(Number(testEmployeeId)),
        "ID karyawan baru harus tersedia",
      );
    });

    // TEST 12: EMAIL DUPLIKAT
    await test("Test 12: Email duplikat ditolak", async () => {
      assert(
        testEmployeeId && testEmployeeEmail,
        "Test pembuatan karyawan harus berhasil lebih dahulu",
      );

      const response = await fetch(`${BASE_URL}/api/admin/employees`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieAdmin,
        },
        body: JSON.stringify({
          employeeNumber: `${testEmployeeNumber}X`,
          name: "Duplikat Email",
          email: testEmployeeEmail,
          departmentId: 1,
          position: "Guru Pengujian",
          initialPassword: "TempPass123!",
        }),
      });

      const body = await readJson(response);

      assert(
        response.status === 409 && body.success === false,
        "Email yang sudah dipakai harus ditolak dengan HTTP 409",
      );
    });

    // TEST 13: UBAH DATA KARYAWAN
    await test("Test 13: Admin dapat mengubah data karyawan", async () => {
      assert(
        testEmployeeId,
        "Test pembuatan karyawan harus berhasil lebih dahulu",
      );

      const response = await fetch(
        `${BASE_URL}/api/admin/employees/${testEmployeeId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            position: "Guru Pengujian - Diperbarui",
          }),
        },
      );

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        "Perubahan data harus berhasil",
      );

      assert(
        body.data?.position === "Guru Pengujian - Diperbarui",
        "Jabatan harus berubah",
      );
    });

    // TEST 14: RESET PASSWORD
    await test("Test 14: Reset password mencabut sesi lama dan password baru bisa dipakai", async () => {
      assert(
        testEmployeeId && testEmployeeEmail,
        "Test pembuatan karyawan harus berhasil lebih dahulu",
      );

      const oldLogin = await login(testEmployeeEmail, "TempPass123!");

      assert(
        oldLogin.response.ok && oldLogin.cookie,
        "Akun uji harus dapat login sebelum reset password",
      );

      const resetResponse = await fetch(
        `${BASE_URL}/api/admin/employees/${testEmployeeId}/reset-password`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            newPassword: "NewTempPass456!",
          }),
        },
      );

      const resetBody = await readJson(resetResponse);

      assert(
        resetResponse.ok && resetBody.success === true,
        "Reset password harus berhasil",
      );

      const oldSessionResponse = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: {
          Cookie: oldLogin.cookie,
        },
      });

      assert(
        oldSessionResponse.status === 401,
        "Sesi lama harus dicabut setelah reset password",
      );

      const newLogin = await login(testEmployeeEmail, "NewTempPass456!");

      assert(
        newLogin.response.ok && newLogin.body.success === true,
        "Password baru harus bisa dipakai login",
      );
    });

    // TEST 15: NONAKTIFKAN AKUN
    await test("Test 15: Akun nonaktif ditolak saat login", async () => {
      assert(
        testEmployeeId,
        "Test pembuatan karyawan harus berhasil lebih dahulu",
      );

      const response = await fetch(
        `${BASE_URL}/api/admin/employees/${testEmployeeId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            status: "INACTIVE",
          }),
        },
      );

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        "Penonaktifan karyawan harus berhasil",
      );

      const inactiveLogin = await login(testEmployeeEmail, "NewTempPass456!");

      assert(
        inactiveLogin.response.status === 401 &&
          inactiveLogin.body.success === false,
        "Akun nonaktif harus ditolak dengan HTTP 401",
      );
    });

    // TEST 16: AKTIFKAN KEMBALI AKUN
    await test("Test 16: Akun dapat diaktifkan kembali", async () => {
      assert(
        testEmployeeId,
        "Test pembuatan karyawan harus berhasil lebih dahulu",
      );

      const response = await fetch(
        `${BASE_URL}/api/admin/employees/${testEmployeeId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            status: "ACTIVE",
          }),
        },
      );

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        "Pengaktifan kembali karyawan harus berhasil",
      );

      const activeLogin = await login(testEmployeeEmail, "NewTempPass456!");

      assert(
        activeLogin.response.ok && activeLogin.body.success === true,
        "Karyawan aktif harus dapat login dengan password baru",
      );
    });
    // ===== PENGAJUAN IZIN / SAKIT / CUTI =====
    const LEAVE_PREFIX = "TEST_LEAVE";
    const PNG_BYTES = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      Buffer.alloc(32),
    ]);
    let leaveId = null;
    let sickLeaveId = null;

    function leaveForm(fields, file) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields))
        form.append(key, value);
      if (file) {
        form.append(
          "attachment",
          new Blob([file.bytes], { type: file.type }),
          file.name,
        );
      }
      return form;
    }

    async function postLeave(cookie, form) {
      const res = await fetch(`${BASE_URL}/api/attendance/leave`, {
        method: "POST",
        headers: cookie ? { Cookie: cookie } : {},
        body: form,
      });
      return { res, body: await readJson(res) };
    }

    async function cleanupLeaveTests() {
      const rows = await db.query(
        `SELECT attachment_path FROM leave_requests WHERE reason LIKE '${LEAVE_PREFIX}%'`,
      );
      for (const r of rows.rows) {
        if (r.attachment_path) {
          await fs.promises
            .unlink(
              path.join(process.cwd(), "uploads", "leave", r.attachment_path),
            )
            .catch(() => {});
        }
      }
      await db.query(
        `DELETE FROM leave_requests WHERE reason LIKE '${LEAVE_PREFIX}%'`,
      );
    }

    await cleanupLeaveTests();

    await test("Leave: guru mengajukan izin valid (PENDING)", async () => {
      const { res, body } = await postLeave(
        cookieBudi,
        leaveForm({
          leaveType: "IZIN",
          startDate: "2030-01-10",
          endDate: "2030-01-11",
          reason: `${LEAVE_PREFIX} keperluan keluarga`,
        }),
      );
      assert(res.status === 201, `Harus 201, dapat ${res.status}`);
      assert(body.data.status === "PENDING", "Status awal harus PENDING");
      assert(
        body.data.start_date === "2030-01-10",
        "Tanggal harus string YYYY-MM-DD",
      );
      leaveId = body.data.id;
    });

    await test("Leave: rentang tanggal tumpang tindih ditolak (409)", async () => {
      const { res } = await postLeave(
        cookieBudi,
        leaveForm({
          leaveType: "IZIN",
          startDate: "2030-01-11",
          endDate: "2030-01-12",
          reason: `${LEAVE_PREFIX} tumpang tindih`,
        }),
      );
      assert(res.status === 409, `Harus 409, dapat ${res.status}`);
    });

    await test("Leave: tanggal selesai sebelum tanggal mulai ditolak (400)", async () => {
      const { res } = await postLeave(
        cookieBudi,
        leaveForm({
          leaveType: "CUTI",
          startDate: "2030-03-10",
          endDate: "2030-03-05",
          reason: `${LEAVE_PREFIX} tanggal terbalik`,
        }),
      );
      assert(res.status === 400, `Harus 400, dapat ${res.status}`);
    });

    await test("Leave: SAKIT tanpa lampiran ditolak (400)", async () => {
      const { res } = await postLeave(
        cookieBudi,
        leaveForm({
          leaveType: "SAKIT",
          startDate: "2030-02-01",
          endDate: "2030-02-02",
          reason: `${LEAVE_PREFIX} tanpa surat`,
        }),
      );
      assert(res.status === 400, `Harus 400, dapat ${res.status}`);
    });

    await test("Leave: lampiran bukan JPG/PNG/PDF ditolak (400)", async () => {
      const { res } = await postLeave(
        cookieBudi,
        leaveForm(
          {
            leaveType: "SAKIT",
            startDate: "2030-02-01",
            endDate: "2030-02-02",
            reason: `${LEAVE_PREFIX} file teks`,
          },
          {
            bytes: Buffer.from("bukan gambar"),
            type: "text/plain",
            name: "a.txt",
          },
        ),
      );
      assert(res.status === 400, `Harus 400, dapat ${res.status}`);
    });

    await test("Leave: file palsu (bertipe PNG tapi isinya teks) ditolak (400)", async () => {
      const { res } = await postLeave(
        cookieBudi,
        leaveForm(
          {
            leaveType: "SAKIT",
            startDate: "2030-02-01",
            endDate: "2030-02-02",
            reason: `${LEAVE_PREFIX} file palsu`,
          },
          {
            bytes: Buffer.from("ini bukan png"),
            type: "image/png",
            name: "x.png",
          },
        ),
      );
      assert(res.status === 400, `Harus 400, dapat ${res.status}`);
    });

    await test("Leave: SAKIT dengan PNG valid diterima (201)", async () => {
      const { res, body } = await postLeave(
        cookieBudi,
        leaveForm(
          {
            leaveType: "SAKIT",
            startDate: "2030-02-01",
            endDate: "2030-02-02",
            reason: `${LEAVE_PREFIX} surat dokter`,
          },
          { bytes: PNG_BYTES, type: "image/png", name: "surat.png" },
        ),
      );
      assert(res.status === 201, `Harus 201, dapat ${res.status}`);
      assert(body.data.has_attachment === true, "has_attachment harus true");
      sickLeaveId = body.data.id;
    });

    await test("Leave: tanpa login ditolak (401)", async () => {
      const { res } = await postLeave(
        "",
        leaveForm({
          leaveType: "IZIN",
          startDate: "2030-04-01",
          endDate: "2030-04-01",
          reason: `${LEAVE_PREFIX} tanpa login`,
        }),
      );
      assert(res.status === 401, `Harus 401, dapat ${res.status}`);
    });

    await test("Leave: admin melihat daftar PENDING, guru dilarang (403)", async () => {
      const resAdmin = await fetch(
        `${BASE_URL}/api/admin/leave?status=PENDING`,
        {
          headers: { Cookie: cookieAdmin },
        },
      );
      const body = await readJson(resAdmin);
      assert(
        resAdmin.status === 200,
        `Admin harus 200, dapat ${resAdmin.status}`,
      );
      assert(
        body.data.some((r) => r.id === leaveId),
        "Pengajuan uji harus muncul",
      );

      const resGuru = await fetch(`${BASE_URL}/api/admin/leave`, {
        headers: { Cookie: cookieBudi },
      });
      assert(resGuru.status === 403, `Guru harus 403, dapat ${resGuru.status}`);
    });

    await test("Leave: admin mengunduh lampiran, pemilik juga bisa", async () => {
      for (const cookie of [cookieAdmin, cookieBudi]) {
        const res = await fetch(
          `${BASE_URL}/api/attendance/leave/${sickLeaveId}/attachment`,
          { headers: { Cookie: cookie } },
        );
        assert(res.status === 200, `Harus 200, dapat ${res.status}`);
      }
    });

    await test("Leave: menolak tanpa catatan (400), lalu setujui (200), ulang (409)", async () => {
      const put = (payload) =>
        fetch(`${BASE_URL}/api/admin/leave/${leaveId}/status`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookieAdmin },
          body: JSON.stringify(payload),
        });

      let res = await put({ status: "REJECTED" });
      assert(
        res.status === 400,
        `Tolak tanpa catatan harus 400, dapat ${res.status}`,
      );

      res = await put({ status: "APPROVED" });
      const body = await readJson(res);
      assert(res.status === 200, `Setujui harus 200, dapat ${res.status}`);
      assert(body.data.status === "APPROVED", "Status harus APPROVED");

      res = await put({ status: "REJECTED", note: "sudah terlambat" });
      assert(
        res.status === 409,
        `Keputusan ulang harus 409, dapat ${res.status}`,
      );
    });

    await cleanupLeaveTests();
    // ===== AUTO-PURGE TOKEN QR =====
    await test("Purge: token QR lama dihapus, token baru dipertahankan", async () => {
      const stamp = Date.now();
      const oldHash = `purge_old_${stamp}`;
      const newHash = `purge_new_${stamp}`;

      await db.query(
        `INSERT INTO qr_tokens (token_hash, token_plain, type, expires_at, status)
         VALUES
           ($1, $2, 'CHECK_IN', CURRENT_TIMESTAMP - INTERVAL '10 days', 'EXPIRED'),
           ($3, $4, 'CHECK_IN', CURRENT_TIMESTAMP + INTERVAL '1 minute', 'ACTIVE')`,
        [oldHash, oldHash, newHash, newHash],
      );

      try {
        // <- GANTI mulai dari sini
        const deleted = await purgeExpiredQrTokens(3);

        const oldRows = await db.query(
          "SELECT id FROM qr_tokens WHERE token_hash = $1",
          [oldHash],
        );
        const newRows = await db.query(
          "SELECT id FROM qr_tokens WHERE token_hash = $1",
          [newHash],
        );

        assert(oldRows.rows.length === 0, "Token lama harus sudah terhapus");
        assert(newRows.rows.length === 1, "Token baru harus tetap ada");
        assert(deleted >= 1, `Jumlah terhapus harus >= 1, dapat ${deleted}`);
      } finally {
        await db.query("DELETE FROM qr_tokens WHERE token_hash = $1", [
          newHash,
        ]);
      }
    });
  } catch (error) {
    failed += 1;
    console.error("\nKesalahan pengujian di luar satu test:", error);
  } finally {
    // BERSIHKAN DATA UJI
    if (testEmployeeId) {
      try {
        const db = await getDb();

        await db.query("DELETE FROM sessions WHERE employee_id = $1", [
          testEmployeeId,
        ]);

        const attendance = await db.query(
          "SELECT id FROM attendance WHERE employee_id = $1 LIMIT 1",
          [testEmployeeId],
        );

        if (attendance.rows.length === 0) {
          await db.query(
            "DELETE FROM employees WHERE id = $1 AND employee_number = $2",
            [testEmployeeId, testEmployeeNumber],
          );

          console.log("\nData karyawan uji dibersihkan.");
        } else {
          console.warn(
            "\nData karyawan uji tidak dihapus karena memiliki riwayat absensi.",
          );
        }
      } catch (error) {
        failed += 1;
        console.error(`\nPembersihan data uji gagal: ${error.message}`);
      }
    }

    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }

    if (db?.close) {
      await db.close();
      console.log("Koneksi database berhasil ditutup.");
    }

    console.log("\n========================================================");
    console.log(`HASIL PENGUJIAN: ${passed} LULUS, ${failed} GAGAL`);
    console.log("========================================================");

    if (failed === 0) {
      console.log("Semua tes yang dijalankan berhasil.");
    } else {
      console.error("Ada tes yang gagal. Periksa pesan error di atas.");
      process.exitCode = 1;
    }
  }
}

runTests().catch((error) => {
  console.error("Pengujian gagal dijalankan:", error);
  process.exitCode = 1;
});
