import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import csv from 'csv-parser';
import bcrypt from 'bcryptjs';
import { getDb } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_CSV_PATH = path.join(
  PROJECT_ROOT,
  'data',
  'data_guru.csv'
);

// Hanya untuk pengujian awal.
// Ganti melalui environment variable sebelum penggunaan nyata.
const DEFAULT_PASSWORD =
  process.env.IMPORT_DEFAULT_PASSWORD || 'password123';

const REQUIRED_HEADERS = [
  'nip',
  'nama',
  'email',
  'kode_departemen',
  'jabatan'
];

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let headersValidated = false;

    const stream = fs
      .createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header }) =>
            String(header ?? '')
              .replace(/^\uFEFF/, '')
              .trim()
              .toLowerCase()
        })
      );

    stream.on('headers', (headers) => {
      const missingHeaders = REQUIRED_HEADERS.filter(
        (header) => !headers.includes(header)
      );

      if (missingHeaders.length > 0) {
        stream.destroy(
          new Error(
            `Kolom CSV tidak lengkap: ${missingHeaders.join(', ')}`
          )
        );
        return;
      }

      headersValidated = true;
    });

    stream.on('data', (row) => {
      rows.push(row);
    });

    stream.on('end', () => {
      if (!headersValidated) {
        reject(new Error('Header CSV tidak ditemukan atau tidak valid.'));
        return;
      }

      resolve(rows);
    });

    stream.on('error', reject);
  });
}

async function importSchoolData() {
  const inputPath = path.resolve(
    process.argv[2] || DEFAULT_CSV_PATH
  );

  if (!fs.existsSync(inputPath)) {
    throw new Error(`File CSV tidak ditemukan: ${inputPath}`);
  }

  if (!fs.statSync(inputPath).isFile()) {
    throw new Error('Path yang diberikan bukan file.');
  }

  console.log('======================================');
  console.log(' IMPORT DATA GURU DAN PEGAWAI');
  console.log('======================================');
  console.log(`File: ${path.basename(inputPath)}`);

  const rows = await readCsv(inputPath);

  if (rows.length === 0) {
    console.log('File CSV tidak memiliki data.');
    return;
  }

  const db = await getDb();

  // Hash password cukup satu kali untuk seluruh data impor.
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  const stats = {
    total: rows.length,
    imported: 0,
    skipped: 0,
    failed: 0
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const lineNumber = index + 2;

    try {
      const employeeNumber = normalize(row.nip);
      const name = normalize(row.nama);
      const email = normalizeEmail(row.email);
      const departmentCode = normalize(
        row.kode_departemen
      ).toUpperCase();
      const position = normalize(row.jabatan);

      // Validasi kolom wajib.
      if (
        !employeeNumber ||
        !name ||
        !email ||
        !departmentCode
      ) {
        stats.skipped += 1;
        console.log(
          `[SKIP] Baris ${lineNumber}: ada kolom wajib yang kosong.`
        );
        continue;
      }

      if (!isValidEmail(email)) {
        stats.skipped += 1;
        console.log(
          `[SKIP] Baris ${lineNumber}: format email tidak valid.`
        );
        continue;
      }

      // Cek NIP maupun email untuk mencegah data ganda.
      const duplicate = await db.query(
        `SELECT id
         FROM employees
         WHERE employee_number = $1
            OR LOWER(email) = $2
         LIMIT 1`,
        [employeeNumber, email]
      );

      if (duplicate.rows.length > 0) {
        stats.skipped += 1;
        console.log(
          `[SKIP] Baris ${lineNumber}: NIP atau email sudah terdaftar.`
        );
        continue;
      }

      // Cari departemen berdasarkan kode.
      let department = await db.query(
        `SELECT id
         FROM departments
         WHERE UPPER(code) = $1
         LIMIT 1`,
        [departmentCode]
      );

      let departmentId;

      if (department.rows.length > 0) {
        departmentId = department.rows[0].id;
      } else {
        // Tabel departments mensyaratkan kolom name.
        // Nama awal mengikuti kode jika belum tersedia.
        const departmentName = departmentCode;

        try {
          department = await db.query(
            `INSERT INTO departments (name, code)
             VALUES ($1, $2)
             RETURNING id`,
            [departmentName, departmentCode]
          );

          departmentId = department.rows[0].id;
        } catch (error) {
          // Jika kode atau nama departemen sudah dibuat
          // oleh proses lain, coba cari ulang.
          department = await db.query(
            `SELECT id
             FROM departments
             WHERE UPPER(code) = $1
             LIMIT 1`,
            [departmentCode]
          );

          if (department.rows.length === 0) {
            throw error;
          }

          departmentId = department.rows[0].id;
        }
      }

      // Buat akun pegawai.
      await db.query(
        `INSERT INTO employees (
          employee_number,
          name,
          email,
          password_hash,
          department_id,
          position,
          role,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'EMPLOYEE', 'ACTIVE')`,
        [
          employeeNumber,
          name,
          email,
          passwordHash,
          departmentId,
          position || null
        ]
      );

      stats.imported += 1;
      console.log(
        `[OK] Baris ${lineNumber}: data pegawai berhasil diimpor.`
      );
    } catch (error) {
      stats.failed += 1;

      // Hindari mencetak data pribadi atau password ke terminal.
      console.error(
        `[ERROR] Baris ${lineNumber}: data gagal diproses. ${error.message}`
      );
    }
  }

  console.log('\n========== HASIL IMPORT ==========');
  console.log(`Total data : ${stats.total}`);
  console.log(`Berhasil   : ${stats.imported}`);
  console.log(`Dilewati   : ${stats.skipped}`);
  console.log(`Gagal      : ${stats.failed}`);
  console.log('==================================');

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

importSchoolData().catch((error) => {
  console.error(`Import dibatalkan: ${error.message}`);
  process.exitCode = 1;
});
