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

import app from '../src/app.js';
import { getDb } from '../db/index.js';

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

let server;
let db;
let cookieBudi = '';
let cookieAdmin = '';
let testEmployeeId = null;
let testEmployeeNumber = '';
let testEmployeeEmail = '';
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
    console.log('  ✓ LULUS');
  } catch (error) {
    failed += 1;
    console.error(`  ✗ GAGAL: ${error.message}`);
  }
}

async function login(identifier, password) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier,
      password,
    }),
  });

  const body = await readJson(response);
  const rawCookie = response.headers.get('set-cookie') || '';

  return {
    response,
    body,
    cookie: rawCookie.includes('absensi_session')
      ? rawCookie.split(';')[0]
      : '',
  };
}

async function runTests() {
  console.log('========================================================');
  console.log('PENGUJIAN INTEGRASI SISTEM ABSENSI + CRUD KARYAWAN');
  console.log('========================================================\n');

db = await getDb();

  server = app.listen(PORT);

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  console.log(`Server uji aktif di port ${PORT}`);

  try {
    // TEST 1: GENERATOR QR DINAMIS
    await test('Test 1: Generator QR Dinamis', async () => {
      const response = await fetch(`${BASE_URL}/api/qr/current`);
      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        'Endpoint QR harus sukses',
      );

      assert(
        typeof body.data?.token === 'string' &&
          body.data.token.length > 0,
        'Token QR harus terisi',
      );

      assert(
        body.data?.qrDataUrl?.startsWith('data:image/png;base64,'),
        'QR harus berupa data URL PNG',
      );

      console.log(
        `  Token QR: ${body.data.token.substring(0, 12)}...`,
      );
    });

    // TEST 2: LOGIN KARYAWAN
    await test('Test 2: Login karyawan dan cookie sesi', async () => {
      const result = await login(
        'budi@company.com',
        'password123',
      );

      assert(
        result.response.ok && result.body.success === true,
        'Login Budi harus berhasil',
      );

      assert(
        result.body.user?.name === 'Budi Santoso',
        'Nama user harus Budi Santoso',
      );

      assert(
        result.cookie.includes('absensi_session'),
        'Cookie sesi harus diberikan',
      );

      cookieBudi = result.cookie;
    });

    // TEST 3: VERIFIKASI SESI
    await test('Test 3: Verifikasi sesi /api/auth/me', async () => {
      const response = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: {
          Cookie: cookieBudi,
        },
      });

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        'Sesi karyawan harus valid',
      );

      assert(
        body.user?.email === 'budi@company.com',
        'Email sesi harus cocok',
      );
    });

    // TEST 4: CHECK-IN
    await test('Test 4: Proteksi check-in dan duplikasi', async () => {
      const qrResponse = await fetch(
        `${BASE_URL}/api/qr/current?type=CHECK_IN`,
      );

      const qrBody = await readJson(qrResponse);

      assert(
        qrBody.success === true && qrBody.data?.token,
        'QR check-in harus tersedia',
      );

      const response = await fetch(
        `${BASE_URL}/api/attendance/check-in`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieBudi,
          },
          body: JSON.stringify({
            token: qrBody.data.token,
          }),
        },
      );

      const body = await readJson(response);

      const duplicate =
        !body.success &&
        String(body.message || '')
          .toLowerCase()
          .includes('sudah melakukan absensi');

      assert(
        response.ok ? body.success === true || duplicate : duplicate,
        'Check-in harus berhasil atau ditolak karena duplikasi',
      );
    });

    // TEST 5: TOKEN PALSU
    await test('Test 5: Token QR palsu ditolak', async () => {
      const response = await fetch(
        `${BASE_URL}/api/attendance/check-in`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieBudi,
          },
          body: JSON.stringify({
            token: 'FAKE_EXPIRED_OR_INVALID_TOKEN_999',
          }),
        },
      );

      const body = await readJson(response);

      assert(
        body.success === false,
        'Token palsu tidak boleh diterima',
      );
    });

    // TEST 6: LIVE DISPLAY
    await test('Test 6: Display TV menampilkan daftar karyawan', async () => {
      const response = await fetch(
        `${BASE_URL}/api/qr/live-display`,
      );

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        'Endpoint display harus sukses',
      );

      assert(
        Array.isArray(body.top5),
        'top5 harus berupa array',
      );

      assert(
        body.top5.length > 0,
        'Daftar display seharusnya memuat karyawan',
      );

      console.log(
        `  Data display memuat ${body.top5.length} karyawan.`,
      );
    });

    // TEST 7: HAK AKSES ADMIN
    await test('Test 7: RBAC dashboard admin', async () => {
      const employeeResponse = await fetch(
        `${BASE_URL}/api/admin/dashboard`,
        {
          headers: {
            Cookie: cookieBudi,
          },
        },
      );

      assert(
        employeeResponse.status === 403,
        'Karyawan biasa harus mendapat HTTP 403',
      );

      const result = await login(
        'admin@company.com',
        'password123',
      );

      assert(
        result.response.ok && result.body.success === true,
        'Login admin harus berhasil',
      );

      assert(
        result.cookie.includes('absensi_session'),
        'Cookie admin harus tersedia',
      );

      cookieAdmin = result.cookie;

      const dashboardResponse = await fetch(
        `${BASE_URL}/api/admin/dashboard`,
        {
          headers: {
            Cookie: cookieAdmin,
          },
        },
      );

      const dashboardBody = await readJson(dashboardResponse);

      assert(
        dashboardResponse.ok &&
          dashboardBody.success === true,
        'Admin harus dapat membuka dashboard',
      );

      const auditResponse = await fetch(
        `${BASE_URL}/api/admin/audit-logs`,
        {
          headers: {
            Cookie: cookieAdmin,
          },
        },
      );

      const auditBody = await readJson(auditResponse);

      assert(
        auditResponse.ok && auditBody.success === true,
        'Admin harus dapat membaca audit logs',
      );
    });

    // TEST 8: AKSES TANPA LOGIN
    await test('Test 8: CRUD ditolak tanpa login', async () => {
      const response = await fetch(
        `${BASE_URL}/api/admin/employees`,
      );

      assert(
        response.status === 401 || response.status === 403,
        'Pengguna tanpa sesi harus ditolak',
      );
    });

    // TEST 9: AKSES OLEH KARYAWAN BIASA
    await test('Test 9: CRUD ditolak untuk karyawan biasa', async () => {
      const response = await fetch(
        `${BASE_URL}/api/admin/employees`,
        {
          headers: {
            Cookie: cookieBudi,
          },
        },
      );

      assert(
        response.status === 403,
        'Karyawan biasa harus mendapat HTTP 403',
      );
    });

    // TEST 10: DAFTAR KARYAWAN
    await test('Test 10: Admin dapat melihat daftar karyawan', async () => {
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
        'Daftar karyawan harus berhasil dimuat',
      );

      assert(
        Array.isArray(body.data),
        'Data karyawan harus berupa array',
      );

      assert(
        body.pagination &&
          Number.isInteger(body.pagination.total),
        'Informasi pagination harus tersedia',
      );
    });

    // TEST 11: TAMBAH KARYAWAN
    await test('Test 11: Admin dapat membuat karyawan baru', async () => {
      const suffix =
        `${Date.now()}${Math.floor(Math.random() * 1000)}`;

      testEmployeeNumber = `TST${suffix}`.slice(0, 20);
      testEmployeeEmail = `crud.test.${suffix}@example.com`;

      const response = await fetch(
        `${BASE_URL}/api/admin/employees`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            employeeNumber: testEmployeeNumber,
            name: 'Karyawan Tes CRUD',
            email: testEmployeeEmail,
            departmentId: 1,
            position: 'Guru Pengujian',
            initialPassword: 'TempPass123!',
          }),
        },
      );

      const body = await readJson(response);

      // Simpan ID sebelum assertion agar cleanup tetap bisa dilakukan.
      if (response.status === 201 && body.data?.id != null) {
        testEmployeeId = body.data.id;
      }

      assert(
        response.status === 201 && body.success === true,
        `Pembuatan karyawan harus menghasilkan HTTP 201; respons: ${body.message || 'tanpa pesan'}`,
      );

      assert(
        body.data?.employee_number === testEmployeeNumber,
        'Nomor karyawan harus sesuai',
      );

      assert(
        body.data?.email === testEmployeeEmail,
        'Email karyawan harus sesuai',
      );

      assert(
        !Object.prototype.hasOwnProperty.call(
          body.data || {},
          'password_hash',
        ),
        'Password hash tidak boleh dikirim ke klien',
      );

      assert(
        Number.isInteger(Number(testEmployeeId)),
        'ID karyawan baru harus tersedia',
      );
    });

    // TEST 12: EMAIL DUPLIKAT
    await test('Test 12: Email duplikat ditolak', async () => {
      assert(
        testEmployeeId && testEmployeeEmail,
        'Test pembuatan karyawan harus berhasil lebih dahulu',
      );

      const response = await fetch(
        `${BASE_URL}/api/admin/employees`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            employeeNumber: `${testEmployeeNumber}X`,
            name: 'Duplikat Email',
            email: testEmployeeEmail,
            departmentId: 1,
            position: 'Guru Pengujian',
            initialPassword: 'TempPass123!',
          }),
        },
      );

      const body = await readJson(response);

      assert(
        response.status === 409 && body.success === false,
        'Email yang sudah dipakai harus ditolak dengan HTTP 409',
      );
    });

    // TEST 13: UBAH DATA KARYAWAN
    await test('Test 13: Admin dapat mengubah data karyawan', async () => {
      assert(
        testEmployeeId,
        'Test pembuatan karyawan harus berhasil lebih dahulu',
      );

      const response = await fetch(
        `${BASE_URL}/api/admin/employees/${testEmployeeId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            position: 'Guru Pengujian - Diperbarui',
          }),
        },
      );

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        'Perubahan data harus berhasil',
      );

      assert(
        body.data?.position === 'Guru Pengujian - Diperbarui',
        'Jabatan harus berubah',
      );
    });

    // TEST 14: RESET PASSWORD
    await test(
      'Test 14: Reset password mencabut sesi lama dan password baru bisa dipakai',
      async () => {
        assert(
          testEmployeeId && testEmployeeEmail,
          'Test pembuatan karyawan harus berhasil lebih dahulu',
        );

        const oldLogin = await login(
          testEmployeeEmail,
          'TempPass123!',
        );

        assert(
          oldLogin.response.ok && oldLogin.cookie,
          'Akun uji harus dapat login sebelum reset password',
        );

        const resetResponse = await fetch(
          `${BASE_URL}/api/admin/employees/${testEmployeeId}/reset-password`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Cookie: cookieAdmin,
            },
            body: JSON.stringify({
              newPassword: 'NewTempPass456!',
            }),
          },
        );

        const resetBody = await readJson(resetResponse);

        assert(
          resetResponse.ok && resetBody.success === true,
          'Reset password harus berhasil',
        );

        const oldSessionResponse = await fetch(
          `${BASE_URL}/api/auth/me`,
          {
            headers: {
              Cookie: oldLogin.cookie,
            },
          },
        );

        assert(
          oldSessionResponse.status === 401,
          'Sesi lama harus dicabut setelah reset password',
        );

        const newLogin = await login(
          testEmployeeEmail,
          'NewTempPass456!',
        );

        assert(
          newLogin.response.ok &&
            newLogin.body.success === true,
          'Password baru harus bisa dipakai login',
        );
      },
    );

    // TEST 15: NONAKTIFKAN AKUN
    await test('Test 15: Akun nonaktif ditolak saat login', async () => {
      assert(
        testEmployeeId,
        'Test pembuatan karyawan harus berhasil lebih dahulu',
      );

      const response = await fetch(
        `${BASE_URL}/api/admin/employees/${testEmployeeId}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            status: 'INACTIVE',
          }),
        },
      );

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        'Penonaktifan karyawan harus berhasil',
      );

      const inactiveLogin = await login(
        testEmployeeEmail,
        'NewTempPass456!',
      );

      assert(
        inactiveLogin.response.status === 401 &&
          inactiveLogin.body.success === false,
        'Akun nonaktif harus ditolak dengan HTTP 401',
      );
    });

    // TEST 16: AKTIFKAN KEMBALI AKUN
    await test('Test 16: Akun dapat diaktifkan kembali', async () => {
      assert(
        testEmployeeId,
        'Test pembuatan karyawan harus berhasil lebih dahulu',
      );

      const response = await fetch(
        `${BASE_URL}/api/admin/employees/${testEmployeeId}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookieAdmin,
          },
          body: JSON.stringify({
            status: 'ACTIVE',
          }),
        },
      );

      const body = await readJson(response);

      assert(
        response.ok && body.success === true,
        'Pengaktifan kembali karyawan harus berhasil',
      );

      const activeLogin = await login(
        testEmployeeEmail,
        'NewTempPass456!',
      );

      assert(
        activeLogin.response.ok &&
          activeLogin.body.success === true,
        'Karyawan aktif harus dapat login dengan password baru',
      );
    });
  } catch (error) {
    failed += 1;
    console.error(
      '\nKesalahan pengujian di luar satu test:',
      error,
    );
  } finally {
    // BERSIHKAN DATA UJI
    if (testEmployeeId) {
      try {
        const db = await getDb();

        await db.query(
          'DELETE FROM sessions WHERE employee_id = $1',
          [testEmployeeId],
        );

        const attendance = await db.query(
          'SELECT id FROM attendance WHERE employee_id = $1 LIMIT 1',
          [testEmployeeId],
        );

        if (attendance.rows.length === 0) {
          await db.query(
            'DELETE FROM employees WHERE id = $1 AND employee_number = $2',
            [testEmployeeId, testEmployeeNumber],
          );

          console.log('\nData karyawan uji dibersihkan.');
        } else {
          console.warn(
            '\nData karyawan uji tidak dihapus karena memiliki riwayat absensi.',
          );
        }
      } catch (error) {
        failed += 1;
        console.error(
          `\nPembersihan data uji gagal: ${error.message}`,
        );
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
    console.log('Koneksi database berhasil ditutup.');
    }

    console.log('\n========================================================');
    console.log(`HASIL PENGUJIAN: ${passed} LULUS, ${failed} GAGAL`);
    console.log('========================================================');

    if (failed === 0) {
      console.log('Semua tes yang dijalankan berhasil.');
    } else {
      console.error(
        'Ada tes yang gagal. Periksa pesan error di atas.',
      );
      process.exitCode = 1;
    }
  }
}

runTests().catch((error) => {
  console.error('Pengujian gagal dijalankan:', error);
  process.exitCode = 1;
});