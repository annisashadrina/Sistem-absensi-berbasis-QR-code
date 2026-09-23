import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { getDb } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('--- Memulai Migrasi Database ---');
  const db = await getDb();

  // 1. Eksekusi Schema DDL
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await db.exec(schemaSql);
  console.log('✓ Skema database berhasil dibuat.');

  // 2. Cek apakah seeder sudah pernah dijalankan
  const checkDep = await db.query('SELECT COUNT(*) as count FROM departments');
  const depCount = parseInt(checkDep.rows[0].count, 10);

  if (depCount === 0) {
    console.log('--- Mengisi Data Awal (Seeding) ---');

    // Insert Departments
    await db.query(`
      INSERT INTO departments (name, code) VALUES 
      ('Tenaga Pengajar / Guru', 'GURU'),
      ('Tata Usaha & Administrasi', 'TU'),
      ('IT & Sarana Prasarana', 'IT')
    `);
    console.log('✓ Data departemen berhasil ditambahkan.');

    // Fetch department IDs
    const depRes = await db.query('SELECT id, code FROM departments');
    const depMap = {};
    depRes.rows.forEach(d => { depMap[d.code] = d.id; });

    // Hash default password
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Insert Employees
    const employees = [
      { num: 'ADMIN01', name: 'Administrator HR', email: 'admin@company.com', dep: depMap['TU'], pos: 'Kepala Bagian SDM', role: 'ADMIN' },
      { num: 'EMP001', name: 'Budi Santoso', email: 'budi@company.com', dep: depMap['GURU'], pos: 'Guru Matematika', role: 'EMPLOYEE' },
      { num: 'EMP002', name: 'Siti Rahma', email: 'siti@company.com', dep: depMap['GURU'], pos: 'Guru Bahasa Indonesia', role: 'EMPLOYEE' },
      { num: 'EMP003', name: 'Andi Pratama', email: 'andi@company.com', dep: depMap['GURU'], pos: 'Guru IPA Terpadu', role: 'EMPLOYEE' },
      { num: 'EMP004', name: 'Rina Amelia', email: 'rina@company.com', dep: depMap['TU'], pos: 'Staf Administrasi', role: 'EMPLOYEE' },
      { num: 'EMP005', name: 'Fajar Nugraha', email: 'fajar@company.com', dep: depMap['IT'], pos: 'Koordinator Sarpras & IT', role: 'EMPLOYEE' },
      { num: 'EMP006', name: 'Doni Saputra', email: 'doni@company.com', dep: depMap['GURU'], pos: 'Guru Olahraga', role: 'EMPLOYEE' }
    ];

    for (const emp of employees) {
      await db.query(`
        INSERT INTO employees (employee_number, name, email, password_hash, department_id, position, role, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
      `, [emp.num, emp.name, emp.email, hashedPassword, emp.dep, emp.pos, emp.role]);
    }
    console.log(`✓ ${employees.length} akun pegawai & admin berhasil dibuat (Password: password123).`);

    // Tambahkan beberapa sample attendance hari ini agar display TV langsung ada data demo
    const empRes = await db.query('SELECT id, employee_number, name FROM employees WHERE role = $1', ['EMPLOYEE']);
    const todayStr = new Date().toISOString().split('T')[0];

    const sampleAttendances = [
      { num: 'EMP001', time: '07:21:14', status: 'ON_TIME', outTime: null, outStatus: null },
      { num: 'EMP002', time: '07:24:11', status: 'ON_TIME', outTime: null, outStatus: null },
      { num: 'EMP003', time: '07:28:35', status: 'ON_TIME', outTime: null, outStatus: null },
      { num: 'EMP004', time: '07:31:02', status: 'ON_TIME', outTime: null, outStatus: null },
      { num: 'EMP005', time: '07:34:50', status: 'ON_TIME', outTime: null, outStatus: null },
      { num: 'EMP006', time: '08:04:21', status: 'LATE', outTime: null, outStatus: null }
    ];

    for (const sample of sampleAttendances) {
      const emp = empRes.rows.find(e => e.employee_number === sample.num);
      if (emp) {
        await db.query(`
          INSERT INTO attendance (employee_id, attendance_date, check_in_time, check_in_status, check_out_time, check_out_status)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [emp.id, todayStr, sample.time, sample.status, sample.outTime, sample.outStatus]);
      }
    }
    console.log('✓ Sampel data absensi hari ini (5 Terawal + 1 Terlambat) berhasil disemai.');
  } else {
    console.log('ℹ Data seeder sudah tersedia sebelumnya.');
  }

  console.log('--- Migrasi Selesai Sukses ---');
}

runMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Gagal migrasi database:', err);
    process.exit(1);
  });
