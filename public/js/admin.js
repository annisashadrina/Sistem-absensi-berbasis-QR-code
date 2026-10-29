/**
 * SCRIPT DASHBOARD ADMIN HR
 */

let currentAttendanceData = [];

// =========================================================
// DOM ELEMENTS
// =========================================================

const adminName = document.getElementById('adminName');

const filterStartDate = document.getElementById('filterStartDate');
const filterEndDate = document.getElementById('filterEndDate');
const filterDepartment = document.getElementById('filterDepartment');
const filterStatus = document.getElementById('filterStatus');
const filterSearch = document.getElementById('filterSearch');

const attendanceTableBody =
  document.getElementById('attendanceTableBody');

const auditTableBody =
  document.getElementById('auditTableBody');

const tableRecordCount =
  document.getElementById('tableRecordCount');

// =========================================================
// STAT ELEMENTS
// =========================================================

const metricTotal = document.getElementById('metricTotal');
const metricPresent = document.getElementById('metricPresent');
const metricOnTime = document.getElementById('metricOnTime');
const metricLate = document.getElementById('metricLate');
const metricAbsent = document.getElementById('metricAbsent');
const metricCompleted = document.getElementById('metricCompleted');


// =========================================================
// HELPER FORMAT TANGGAL & WAKTU
// =========================================================

/**
 * Mengubah timestamp database menjadi HH:MM.
 *
 * Contoh:
 * 2026-10-23T08:12:34.000Z
 * menjadi
 * 15:12
 *
 * Jika backend sudah mengirim HH:MM:SS,
 * fungsi ini juga tetap aman.
 */
function formatAttendanceTime(value) {
  if (!value) return '-';

  const text = String(value);

  // Jika sudah berupa HH:MM atau HH:MM:SS
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return text.slice(0, 5);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}


/**
 * Format tanggal agar tetap YYYY-MM-DD.
 */
function formatAttendanceDate(value) {
  if (!value) return '-';

  const text = String(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Jakarta'
  });
}


// =========================================================
// 1. INISIALISASI & VERIFIKASI HAK AKSES ADMIN
// =========================================================

async function checkAdminAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (
      !data.success ||
      !data.user ||
      data.user.role !== 'ADMIN'
    ) {
      if (data.success && data.user && data.user.role !== 'ADMIN') {
        window.location.href = '/scan';
        return;
      }
      window.location.href = '/login?redirect=/admin';
      return;
    }

    if (adminName) {
      adminName.textContent = data.user.name;
    }

    initDashboard();

  } catch (err) {
    console.error('Gagal memverifikasi admin:', err);
    window.location.href = '/login?redirect=/admin';
  }
}


// =========================================================
// 2. SETUP AWAL TANGGAL & DROPDOWN
// =========================================================

async function initDashboard() {

  // Gunakan tanggal Indonesia agar tidak bergeser karena UTC.
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Jakarta'
  });

  // Default:
  // tanggal 1 bulan berjalan sampai hari ini.
  const firstDay = `${today.slice(0, 7)}-01`;

  if (filterStartDate) {
    filterStartDate.value = firstDay;
  }

  if (filterEndDate) {
    filterEndDate.value = today;
  }

  await loadDepartments();
  await loadEmployeeDepartments();
  await loadDashboardMetrics();
  await loadAttendanceTable();
}


// =========================================================
// 3. LOAD DEPARTMENTS
// =========================================================

async function loadDepartments() {
  try {
    const res = await fetch('/api/admin/departments');
    const data = await res.json();

    if (data.success && filterDepartment) {

      data.data.forEach(d => {
        const opt = document.createElement('option');

        opt.value = d.id;
        opt.textContent = `${d.name} (${d.code})`;

        filterDepartment.appendChild(opt);
      });
    }

  } catch (err) {
    console.error('Error loading departments:', err);
  }
}


async function loadEmployeeDepartments() {
  const select =
    document.getElementById('employeeDepartment');

  if (!select) {
    console.warn(
      'Dropdown departemen karyawan tidak ditemukan.'
    );
    return;
  }

  try {
    const res =
      await fetch('/api/admin/departments');

    const result =
      await res.json();

    if (!res.ok || !result.success) {
      throw new Error(
        result.message ||
        'Gagal memuat departemen karyawan.'
      );
    }

    const currentValue = select.value;

    select.innerHTML =
      '<option value="">Semua Departemen</option>';

    const departments =
      Array.isArray(result.data)
        ? result.data
        : [];

    departments.forEach(department => {

      const option =
        document.createElement('option');

      option.value = department.id;

      option.textContent =
        `${department.name} (${department.code})`;

      select.appendChild(option);
    });

    if (
      currentValue &&
      [...select.options]
        .some(
          option =>
            option.value === currentValue
        )
    ) {
      select.value = currentValue;
    }

  } catch (err) {
    console.error(
      'Gagal memuat departemen karyawan:',
      err
    );
  }
}


// =========================================================
// 4. LOAD METRIK DASHBOARD
// =========================================================

async function loadDashboardMetrics() {

  const date =
    filterEndDate?.value;

  if (!date) return;

  try {

    const res =
      await fetch(
        `/api/admin/dashboard?date=${encodeURIComponent(date)}`
      );

    const data =
      await res.json();

    if (!res.ok || !data.success) {
      throw new Error(
        data.message ||
        'Gagal memuat metrik.'
      );
    }

    const m =
      data.metrics || {};

    /*
     * LOGIC REKAP:
     *
     * Total       = seluruh karyawan ACTIVE
     * Hadir       = karyawan yang punya check-in
     * Tepat waktu = check-in ON_TIME
     * Terlambat    = check-in LATE
     * Tidak hadir = Total - Hadir
     * Selesai     = sudah check-out
     */

    const totalEmployees =
      Number(m.totalEmployees) || 0;

    const presentCount =
      Number(m.presentCount) || 0;

    const onTimeCount =
      Number(m.onTimeCount) || 0;

    const lateCount =
      Number(m.lateCount) || 0;

    const completedCount =
      Number(m.completedCount) || 0;

    const absentCount =
      Math.max(
        0,
        totalEmployees - presentCount
      );

    if (metricTotal) {
      metricTotal.textContent =
        totalEmployees;
    }

    if (metricPresent) {
      metricPresent.textContent =
        presentCount;
    }

    if (metricOnTime) {
      metricOnTime.textContent =
        onTimeCount;
    }

    if (metricLate) {
      metricLate.textContent =
        lateCount;
    }

    if (metricAbsent) {
      metricAbsent.textContent =
        absentCount;
    }

    if (metricCompleted) {
      metricCompleted.textContent =
        completedCount;
    }

  } catch (err) {

    console.error(
      'Error loading metrics:',
      err
    );

    if (metricTotal) metricTotal.textContent = '-';
    if (metricPresent) metricPresent.textContent = '-';
    if (metricOnTime) metricOnTime.textContent = '-';
    if (metricLate) metricLate.textContent = '-';
    if (metricAbsent) metricAbsent.textContent = '-';
    if (metricCompleted) metricCompleted.textContent = '-';
  }
}


// =========================================================
// 5. LOAD DATA TABEL ABSENSI
// =========================================================

async function loadAttendanceTable() {

  const startDate =
    filterStartDate?.value;

  const endDate =
    filterEndDate?.value;

  const dept =
    filterDepartment?.value;

  const status =
    filterStatus?.value;

  const search =
    filterSearch?.value.trim();

  // ---------------------------------------------------------
  // VALIDASI TANGGAL
  // ---------------------------------------------------------

  if (!startDate || !endDate) {

    alert(
      'Silakan pilih tanggal awal dan tanggal akhir.'
    );

    attendanceTableBody.innerHTML = `
      <tr>
        <td colspan="9"
            style="text-align:center;
                   padding:24px;
                   color:#b91c1c;">
          Tanggal awal dan tanggal akhir wajib diisi.
        </td>
      </tr>
    `;

    return;
  }


  if (startDate > endDate) {

    alert(
      'Tanggal awal tidak boleh melewati tanggal akhir.'
    );

    attendanceTableBody.innerHTML = `
      <tr>
        <td colspan="9"
            style="text-align:center;
                   padding:24px;
                   color:#b91c1c;">
          Periksa kembali rentang tanggal yang dipilih.
        </td>
      </tr>
    `;

    return;
  }


  // ---------------------------------------------------------
  // QUERY PARAMETER
  // ---------------------------------------------------------

  const params =
    new URLSearchParams({
      startDate,
      endDate
    });

  if (dept) {
    params.set(
      'departmentId',
      dept
    );
  }

  if (status) {
    params.set(
      'status',
      status
    );
  }

  if (search) {
    params.set(
      'search',
      search
    );
  }


  // ---------------------------------------------------------
  // LOADING STATE
  // ---------------------------------------------------------

  attendanceTableBody.innerHTML = `
    <tr>
      <td colspan="9"
          style="text-align:center;
                 color:#94a3b8;
                 padding:24px;">
        Memuat data absensi...
      </td>
    </tr>
  `;


  try {

    const res =
      await fetch(
        `/api/admin/attendance?${params.toString()}`
      );

    const data =
      await res.json();

    if (!res.ok || !data.success) {
      throw new Error(
        data.message ||
        'Gagal memuat data absensi.'
      );
    }

    currentAttendanceData =
      Array.isArray(data.data)
        ? data.data
        : [];


    // ---------------------------------------------------------
    // JUMLAH RECORD TABEL
    // ---------------------------------------------------------

    if (tableRecordCount) {

      tableRecordCount.textContent =
        `${currentAttendanceData.length} Catatan Absensi`;
    }


    renderAttendanceTable(
      currentAttendanceData
    );

  } catch (err) {

    console.error(
      'Error loading attendance:',
      err
    );

    currentAttendanceData = [];

    if (tableRecordCount) {
      tableRecordCount.textContent =
        '0 Catatan Absensi';
    }

    attendanceTableBody.innerHTML = `
      <tr>
        <td colspan="9"
            style="text-align:center;
                   color:#ef4444;
                   padding:24px;">
          Gagal memuat data:
          ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
  }
}


// =========================================================
// 6. RENDER TABEL ABSENSI
// =========================================================

function renderAttendanceTable(list) {

  if (!list.length) {

    attendanceTableBody.innerHTML = `
      <tr>
        <td colspan="9"
            style="text-align:center;
                   color:#94a3b8;
                   padding:28px;">
          Tidak ada data kehadiran
          yang sesuai dengan filter.
        </td>
      </tr>
    `;

    return;
  }


  attendanceTableBody.innerHTML =
    list.map(item => {

      // -------------------------------------------------------
      // STATUS CHECK-IN
      // -------------------------------------------------------

      const hasCheckedIn =
        Boolean(item.check_in_time);

      const hasCheckedOut =
        Boolean(item.check_out_time);


      let statusBadge =
        '<span class="badge badge-absent">' +
        'BELUM ABSEN' +
        '</span>';


      if (hasCheckedIn) {

        if (
          item.check_in_status ===
          'ON_TIME'
        ) {

          statusBadge =
            '<span class="badge badge-on-time">' +
            '✓ Tepat Waktu' +
            '</span>';

        } else if (
          item.check_in_status ===
          'LATE'
        ) {

          statusBadge =
            '<span class="badge badge-late">' +
            '⚠ Terlambat' +
            '</span>';

        } else {

          statusBadge =
            '<span class="badge badge-late">' +
            '⚠ ' +
            escapeHtml(
              String(
                item.check_in_status ||
                'Status tidak diketahui'
              )
            ) +
            '</span>';
        }
      }


      // -------------------------------------------------------
      // STATUS AKHIR / CHECK-OUT
      // -------------------------------------------------------

      let finalStatus =
        '<span class="badge" ' +
        'style="background:#f1f5f9;color:#64748b;">' +
        'BELUM ABSEN' +
        '</span>';


      if (hasCheckedOut) {

        finalStatus =
          '<span class="badge badge-completed">' +
          '✓ SELESAI' +
          '</span>';

      } else if (hasCheckedIn) {

        finalStatus =
          '<span class="badge" ' +
          'style="background:#fef3c7;color:#b45309;">' +
          'BELUM CHECK-OUT' +
          '</span>';
      }


      // -------------------------------------------------------
      // FORMAT JAM
      // -------------------------------------------------------

      const checkInDisplay =
        hasCheckedIn
          ? formatAttendanceTime(
              item.check_in_time
            )
          : '-';


      const checkOutDisplay =
        hasCheckedOut
          ? formatAttendanceTime(
              item.check_out_time
            )
          : '-';


      // -------------------------------------------------------
      // RETURN ROW
      // -------------------------------------------------------

      return `
        <tr>

          <!-- NIK -->
          <td class="font-mono"
              style="font-weight:700;color:#0a3d24;">
            ${escapeHtml(
              String(
                item.employee_number ?? '-'
              )
            )}
          </td>

          <!-- TANGGAL -->
          <td class="font-mono">
            ${escapeHtml(
              formatAttendanceDate(
                item.attendance_date
              )
            )}
          </td>

          <!-- NAMA -->
          <td style="font-weight:600;">
            ${escapeHtml(
              String(
                item.name ?? '-'
              )
            )}
          </td>

          <!-- DEPARTEMEN -->
          <td>
            ${escapeHtml(
              String(
                item.department_name ?? '-'
              )
            )}
          </td>

          <!-- JABATAN -->
          <td style="color:#64748b;">
            ${escapeHtml(
              String(
                item.position ?? '-'
              )
            )}
          </td>

          <!-- CHECK-IN -->
          <td class="font-mono"
              style="font-weight:600;">
            ${escapeHtml(
              checkInDisplay
            )}
          </td>

          <!-- STATUS MASUK -->
          <td>
            ${statusBadge}
          </td>

          <!-- CHECK-OUT -->
          <td class="font-mono"
              style="font-weight:600;">
            ${escapeHtml(
              checkOutDisplay
            )}
          </td>

          <!-- STATUS AKHIR -->
          <td>
            ${finalStatus}
          </td>

        </tr>
      `;

    }).join('');
}


// =========================================================
// 7. APPLY FILTER
// =========================================================

function applyFilters() {
  loadDashboardMetrics();
  loadAttendanceTable();
}


// =========================================================
// 8. LOAD LOG AUDIT
// =========================================================

async function loadAuditLogs() {

  auditTableBody.innerHTML = `
    <tr>
      <td colspan="6"
          style="text-align:center;
                 color:#94a3b8;
                 padding:24px;">
        Memuat catatan audit...
      </td>
    </tr>
  `;

  try {

    const res =
      await fetch(
        '/api/admin/audit-logs'
      );

    const data =
      await res.json();

    if (data.success) {
      renderAuditTable(
        data.data
      );
    }

  } catch (err) {

    auditTableBody.innerHTML = `
      <tr>
        <td colspan="6"
            style="text-align:center;
                   color:#ef4444;
                   padding:24px;">
          Gagal memuat log audit:
          ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
  }
}


function renderAuditTable(logs) {

  if (!logs.length) {

    auditTableBody.innerHTML = `
      <tr>
        <td colspan="6"
            style="text-align:center;
                   color:#94a3b8;
                   padding:28px;">
          Belum ada catatan aktivitas tercatat.
        </td>
      </tr>
    `;

    return;
  }


  auditTableBody.innerHTML =
    logs.map(log => {

      let actionBadge =
        `<span class="badge"
               style="background:#e2e8f0;color:#334155;">
          ${escapeHtml(log.action)}
        </span>`;


      if (log.action === 'CHECK_IN') {
        actionBadge =
          '<span class="badge badge-on-time">' +
          'CHECK_IN' +
          '</span>';
      }


      if (log.action === 'CHECK_OUT') {
        actionBadge =
          '<span class="badge badge-completed">' +
          'CHECK_OUT' +
          '</span>';
      }


      if (
        log.action === 'INVALID_QR' ||
        log.action === 'EXPIRED_QR'
      ) {
        actionBadge =
          '<span class="badge badge-absent">' +
          '⚠️ ' +
          escapeHtml(log.action) +
          '</span>';
      }


      if (
        log.action ===
        'DUPLICATE_ATTENDANCE'
      ) {
        actionBadge =
          '<span class="badge badge-late">' +
          '🚫 DUPLICATE' +
          '</span>';
      }


      const timeFormatted =
        new Date(
          log.created_at
        ).toLocaleString(
          'id-ID',
          {
            timeZone: 'Asia/Jakarta'
          }
        );


      const empInfo =
        log.employee_name
          ? `${log.employee_name} (${log.employee_number})`
          : '-';


      const metadataStr =
        typeof log.metadata === 'object'
          ? JSON.stringify(
              log.metadata
            )
          : (
              log.metadata ||
              '-'
            );


      return `
        <tr>

          <td class="font-mono"
              style="font-size:0.8rem;color:#64748b;">
            ${escapeHtml(
              timeFormatted
            )}
          </td>

          <td>
            ${actionBadge}
          </td>

          <td style="font-weight:600;">
            ${escapeHtml(
              empInfo
            )}
          </td>

          <td class="font-mono"
              style="font-size:0.8rem;">
            ${escapeHtml(
              log.ip_address || '-'
            )}
          </td>

          <td style="
              font-size:0.78rem;
              color:#64748b;
              max-width:200px;
              overflow:hidden;
              text-overflow:ellipsis;
              white-space:nowrap;">
            ${escapeHtml(
              log.user_agent || '-'
            )}
          </td>

          <td class="font-mono"
              style="
                font-size:0.75rem;
                color:#475569;">
            ${escapeHtml(
              metadataStr
            )}
          </td>

        </tr>
      `;

    }).join('');
}


// =========================================================
// 9. MANAJEMEN KARYAWAN
// =========================================================

let employeePage = 1;
let employeeTotalPages = 1;


async function loadEmployees() {

  const tbody =
    document.getElementById(
      'employeeTableBody'
    );

  if (!tbody) return;


  tbody.innerHTML = `
    <tr>
      <td colspan="7"
          style="text-align:center;padding:24px">
        Memuat data karyawan...
      </td>
    </tr>
  `;


  const selectedStatus =
    document.getElementById(
      'employeeStatus'
    )?.value || 'ACTIVE';


  const params =
    new URLSearchParams({
      page: String(employeePage),
      limit: '10',
      search:
        document.getElementById(
          'employeeSearch'
        )?.value.trim() || ''
    });


  const departmentId =
    document.getElementById(
      'employeeDepartment'
    )?.value || '';


  params.set(
    'status',
    selectedStatus
  );


  if (departmentId) {
    params.set(
      'departmentId',
      departmentId
    );
  }


  try {

    const res =
      await fetch(
        `/api/admin/employees?${params}`
      );

    const result =
      await res.json();


    if (!res.ok || !result.success) {
      throw new Error(
        result.message ||
        'Gagal mengambil data karyawan.'
      );
    }


    const employees =
      Array.isArray(result.data)
        ? result.data
        : [];


    const pagination =
      result.pagination || {};


    employeeTotalPages =
      Math.max(
        1,
        Number(
          pagination.totalPages
        ) || 1
      );


    const count =
      document.getElementById(
        'employeeRecordCount'
      );


    if (count) {
      count.textContent =
        `${pagination.total ?? employees.length} Karyawan`;
    }


    const pageInfo =
      document.getElementById(
        'employeePageInfo'
      );


    if (pageInfo) {
      pageInfo.textContent =
        `Halaman ${employeePage} dari ${employeeTotalPages}`;
    }


    const prev =
      document.getElementById(
        'employeePrevPage'
      );


    const next =
      document.getElementById(
        'employeeNextPage'
      );


    if (prev) {
      prev.disabled =
        employeePage <= 1;
    }


    if (next) {
      next.disabled =
        employeePage >= employeeTotalPages;
    }


    if (!employees.length) {

      tbody.innerHTML = `
        <tr>
          <td colspan="7"
              style="text-align:center;padding:24px">
            Data karyawan tidak ditemukan.
          </td>
        </tr>
      `;

      return;
    }


    tbody.innerHTML =
      employees.map(emp => {

        const id =
          Number(emp.id);

        const number =
          emp.employee_number ??
          emp.employeeNumber ??
          '-';

        const name =
          emp.name ??
          emp.employee_name ??
          '-';

        const department =
          emp.department_name ??
          emp.departmentName ??
          '-';

        const status =
          emp.status ??
          'ACTIVE';

        const statusLabel =
          status === 'ACTIVE'
            ? 'Aktif'
            : 'Nonaktif';


        return `
          <tr>

            <td>
              ${escapeHtml(
                String(number)
              )}
            </td>

            <td>
              ${escapeHtml(
                String(name)
              )}
            </td>

            <td>
              ${escapeHtml(
                String(
                  emp.email || '-'
                )
              )}
            </td>

            <td>
              ${escapeHtml(
                String(department)
              )}
            </td>

            <td>
              ${escapeHtml(
                String(
                  emp.position || '-'
                )
              )}
            </td>

            <td>
              <span class="badge ${
                status === 'ACTIVE'
                  ? 'badge-on-time'
                  : 'badge-absent'
              }">
                ${statusLabel}
              </span>
            </td>

            <td>

              <button
                class="btn btn-outline"
                onclick="editEmployee(${id})">
                Edit
              </button>

              <button
                class="btn btn-outline"
                onclick="resetEmployeePassword(${id})">
                Reset Password
              </button>

              <button
                class="btn btn-outline"
                onclick="toggleEmployeeStatus(
                  ${id},
                  '${status === 'ACTIVE'
                    ? 'INACTIVE'
                    : 'ACTIVE'}'
                )">
                ${
                  status === 'ACTIVE'
                    ? 'Nonaktifkan'
                    : 'Aktifkan'
                }
              </button>

            </td>

          </tr>
        `;

      }).join('');


  } catch (err) {

    console.error(
      'Gagal memuat karyawan:',
      err
    );

    tbody.innerHTML = `
      <tr>
        <td colspan="7"
            style="
              text-align:center;
              padding:24px;
              color:#b91c1c;">
          ${escapeHtml(
            err.message
          )}
        </td>
      </tr>
    `;
  }
}


function changeEmployeePage(direction) {

  const nextPage =
    employeePage + direction;

  if (
    nextPage < 1 ||
    nextPage > employeeTotalPages
  ) {
    return;
  }

  employeePage =
    nextPage;

  loadEmployees();
}


async function getEmployeeById(id) {

  const res =
    await fetch(
      `/api/admin/employees/${id}`
    );

  const result =
    await res.json();


  if (!res.ok || !result.success) {
    throw new Error(
      result.message ||
      'Data karyawan gagal dimuat.'
    );
  }


  return result.data;
}


// =========================================================
// 10. TAMBAH KARYAWAN
// =========================================================

async function openEmployeeModal() {

  try {

    const employeeNumber =
      prompt(
        'LANGKAH 1/6 — Masukkan NIP atau nomor karyawan:'
      );

    if (employeeNumber === null) {
      return;
    }


    if (!employeeNumber.trim()) {
      alert(
        'NIP atau nomor karyawan wajib diisi.'
      );
      return;
    }


    const name =
      prompt(
        'LANGKAH 2/6 — Masukkan nama lengkap guru/karyawan:'
      );

    if (name === null) {
      return;
    }


    if (!name.trim()) {
      alert(
        'Nama lengkap wajib diisi.'
      );
      return;
    }


    const email =
      prompt(
        'LANGKAH 3/6 — Masukkan email guru/karyawan:'
      );

    if (email === null) {
      return;
    }


    if (!email.trim()) {
      alert(
        'Email wajib diisi.'
      );
      return;
    }


    const departmentsRes =
      await fetch(
        '/api/admin/departments'
      );


    const departmentsResult =
      await departmentsRes.json();


    if (
      !departmentsRes.ok ||
      !departmentsResult.success
    ) {
      throw new Error(
        'Daftar departemen gagal dimuat.'
      );
    }


    const departments =
      departmentsResult.data || [];


    if (!departments.length) {
      alert(
        'Belum ada departemen yang tersedia.'
      );
      return;
    }


    const choices =
      departments
        .map(
          d => `${d.id}: ${d.name}`
        )
        .join('\n');


    const departmentId =
      prompt(
        `LANGKAH 4/6 — Pilih departemen.\n\n` +
        `${choices}\n\n` +
        `Masukkan ID departemen:`
      );


    if (departmentId === null) {
      return;
    }


    const department =
      departments.find(
        d =>
          String(d.id) ===
          departmentId.trim()
      );


    if (!department) {
      alert(
        'ID departemen tidak ditemukan. Silakan ulangi.'
      );
      return;
    }


    const position =
      prompt(
        'LANGKAH 5/6 — Masukkan jabatan, ' +
        'misalnya Guru Matematika atau Staf TU:'
      );


    if (position === null) {
      return;
    }


    if (!position.trim()) {
      alert(
        'Jabatan wajib diisi.'
      );
      return;
    }


    const initialPassword =
      prompt(
        'LANGKAH 6/6 — Buat password awal untuk akun ini.\n\n' +
        'Ketentuannya:\n' +
        '• Minimal 12 karakter\n' +
        '• Ada huruf kecil (a-z)\n' +
        '• Ada huruf besar (A-Z)\n' +
        '• Ada angka (0-9)\n\n' +
        'Contoh format: Sekolah2026Ab\n' +
        'Gunakan password unik, jangan gunakan contoh ini sebagai password asli.\n\n' +
        'Masukkan password awal:'
      );


    if (initialPassword === null) {
      return;
    }


    if (
      initialPassword.length < 12 ||
      initialPassword.length > 128 ||
      !/[a-z]/.test(initialPassword) ||
      !/[A-Z]/.test(initialPassword) ||
      !/[0-9]/.test(initialPassword)
    ) {

      alert(
        'Password belum sesuai ketentuan.\n\n' +
        'Pastikan password memiliki minimal 12 karakter, ' +
        'huruf kecil, huruf besar, dan angka.'
      );

      return;
    }


    const res =
      await fetch(
        '/api/admin/employees',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            employeeNumber:
              employeeNumber.trim(),
            name:
              name.trim(),
            email:
              email.trim(),
            departmentId:
              department.id,
            position:
              position.trim(),
            initialPassword
          })
        }
      );


    const result =
      await res.json();


    if (!res.ok || !result.success) {
      throw new Error(
        result.message ||
        'Gagal menambahkan guru/karyawan.'
      );
    }


    alert(
      'Guru/karyawan berhasil ditambahkan!\n\n' +
      'Pastikan akun diberi informasi login melalui cara yang aman.'
    );


    employeePage = 1;

    await loadEmployees();


  } catch (err) {

    console.error(
      'Gagal menambahkan karyawan:',
      err
    );

    alert(
      err.message ||
      'Terjadi kesalahan saat menambahkan karyawan.'
    );
  }
}


// =========================================================
// 11. EDIT KARYAWAN
// =========================================================

async function editEmployee(id) {

  try {

    const emp =
      await getEmployeeById(id);


    if (!emp) {
      throw new Error(
        'Data karyawan tidak ditemukan.'
      );
    }


    const name =
      prompt(
        'Ubah nama:',
        emp.name ??
        emp.employee_name ??
        ''
      );


    if (name === null) {
      return;
    }


    const email =
      prompt(
        'Ubah email:',
        emp.email ?? ''
      );


    if (email === null) {
      return;
    }


    const position =
      prompt(
        'Ubah jabatan:',
        emp.position ?? ''
      );


    if (position === null) {
      return;
    }


    const res =
      await fetch(
        `/api/admin/employees/${id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            position: position.trim()
          })
        }
      );


    const result =
      await res.json();


    if (!res.ok || !result.success) {
      throw new Error(
        result.message ||
        'Gagal memperbarui data karyawan.'
      );
    }


    alert(
      'Data karyawan berhasil diperbarui.'
    );


    await loadEmployees();


  } catch (err) {

    console.error(err);

    alert(
      err.message ||
      'Terjadi kesalahan saat mengedit karyawan.'
    );
  }
}


// =========================================================
// 12. RESET PASSWORD
// =========================================================

async function resetEmployeePassword(id) {

  const newPassword =
    prompt(
      'RESET PASSWORD GURU/KARYAWAN\n\n' +
      'Buat password baru dengan ketentuan:\n' +
      '• Minimal 12 karakter\n' +
      '• Ada huruf kecil (a-z)\n' +
      '• Ada huruf besar (A-Z)\n' +
      '• Ada angka (0-9)\n\n' +
      'Contoh format: GuruBaru2026Ab\n' +
      'Jangan gunakan contoh ini sebagai password asli.\n\n' +
      'Masukkan password baru:'
    );


  if (newPassword === null) {
    return;
  }


  if (
    newPassword.length < 12 ||
    newPassword.length > 128 ||
    !/[a-z]/.test(newPassword) ||
    !/[A-Z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword)
  ) {

    alert(
      'Password belum sesuai ketentuan.\n\n' +
      'Gunakan minimal 12 karakter, dengan huruf kecil, ' +
      'huruf besar, dan angka.'
    );

    return;
  }


  if (
    !confirm(
      'Apakah kamu yakin ingin mengganti password akun ini?'
    )
  ) {
    return;
  }


  try {

    const res =
      await fetch(
        `/api/admin/employees/${id}/reset-password`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            newPassword
          })
        }
      );


    const result =
      await res.json();


    if (!res.ok || !result.success) {
      throw new Error(
        result.message ||
        'Gagal mereset password.'
      );
    }


    alert(
      'Password berhasil diganti.\n\n' +
      'Sampaikan password baru kepada pemilik akun melalui cara yang aman.'
    );


  } catch (err) {

    console.error(
      'Gagal mereset password:',
      err
    );

    alert(
      err.message ||
      'Terjadi kesalahan saat mereset password.'
    );
  }
}


// =========================================================
// 13. AKTIF / NONAKTIF KARYAWAN
// =========================================================

async function toggleEmployeeStatus(
  id,
  status
) {

  const label =
    status === 'ACTIVE'
      ? 'mengaktifkan'
      : 'menonaktifkan';


  if (
    !confirm(
      `Yakin ingin ${label} akun ini?`
    )
  ) {
    return;
  }


  try {

    const res =
      await fetch(
        `/api/admin/employees/${id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            status
          })
        }
      );


    const result =
      await res.json();


    if (!res.ok || !result.success) {
      throw new Error(
        result.message ||
        'Gagal mengubah status akun.'
      );
    }


    await loadEmployees();


  } catch (err) {

    console.error(err);

    alert(
      err.message ||
      'Terjadi kesalahan saat mengubah status.'
    );
  }
}


// =========================================================
// 14. TAB NAVIGATION
// =========================================================

function switchTab(tab) {

  const tabs = {

    attendance: {
      content:
        'tabContentAttendance',
      button:
        'tabBtnAttendance'
    },

    employees: {
      content:
        'tabContentEmployees',
      button:
        'tabBtnEmployees'
    },

    leave: {
      content:
        'tabContentLeave',
      button:
        'tabBtnLeave'
    },

    audit: {
      content:
        'tabContentAudit',
      button:
        'tabBtnAudit'
    }

  };


  const selected =
    tabs[tab];


  if (!selected) {

    console.error(
      'Tab tidak dikenal:',
      tab
    );

    return;
  }


  Object.values(tabs)
    .forEach(
      ({
        content,
        button
      }) => {

        const panel =
          document.getElementById(
            content
          );

        const tabButton =
          document.getElementById(
            button
          );


        if (panel) {
          panel.style.display =
            'none';
        }


        if (tabButton) {

          tabButton.classList
            .remove('active');

          tabButton.setAttribute(
            'aria-selected',
            'false'
          );
        }

      }
    );


  const panel =
    document.getElementById(
      selected.content
    );


  const tabButton =
    document.getElementById(
      selected.button
    );


  if (!panel) {

    console.error(
      'Panel tab tidak ditemukan:',
      selected.content
    );

    return;
  }


  panel.style.display =
    'block';


  if (tabButton) {

    tabButton.classList
      .add('active');

    tabButton.setAttribute(
      'aria-selected',
      'true'
    );
  }


  if (tab === 'attendance') {

    loadDashboardMetrics();
    loadAttendanceTable();

  } else if (tab === 'employees') {

    loadEmployees();

  } else if (tab === 'leave') {

    loadAdminLeave();

  } else if (tab === 'audit') {

    loadAuditLogs();
  }
}


// =========================================================
// 15. VERIFIKASI IZIN / SAKIT
// =========================================================

async function loadAdminLeave() {

  const tableBody =
    document.getElementById(
      'adminLeaveTableBody'
    );

  const statusFilter =
    document.getElementById(
      'leaveStatusFilter'
    );


  if (!tableBody) {

    console.error(
      'Tabel pengajuan izin tidak ditemukan.'
    );

    return;
  }


  tableBody.innerHTML = `
    <tr>
      <td colspan="8"
          style="text-align:center;padding:24px">
        Memuat data pengajuan...
      </td>
    </tr>
  `;


  try {

    const params =
      new URLSearchParams({
        status:
          statusFilter?.value ||
          'PENDING',
        page: '1',
        limit: '20'
      });


    const res =
      await fetch(
        `/api/admin/leave?${params.toString()}`
      );


    const result =
      await res.json();


    if (!res.ok || !result.success) {

      throw new Error(
        result.message ||
        'Gagal memuat pengajuan.'
      );
    }


    const requests =
      Array.isArray(result.data)
        ? result.data
        : [];


    if (!requests.length) {

      tableBody.innerHTML = `
        <tr>
          <td colspan="8"
              style="text-align:center;padding:24px">
            Belum ada pengajuan izin atau sakit.
          </td>
        </tr>
      `;

      return;
    }


    tableBody.innerHTML =
      requests.map(item => {

        const id =
          Number(item.id);


        const tanggal =
          `${item.start_date || '-'} s.d. ${
            item.end_date || '-'
          }`;


        const statusLabel = {

          PENDING:
            'Menunggu',

          APPROVED:
            'Disetujui',

          REJECTED:
            'Ditolak'

        }[
          item.status
        ] || item.status;


        const actions =
          item.status === 'PENDING'

            ? `
              <button
                class="btn btn-outline"
                onclick="reviewAdminLeave(
                  ${id},
                  'APPROVED'
                )">
                Setujui
              </button>

              <button
                class="btn btn-outline"
                onclick="reviewAdminLeave(
                  ${id},
                  'REJECTED'
                )">
                Tolak
              </button>
            `

            : '-';


        return `
          <tr>

            <td>
              ${escapeHtml(
                String(
                  item.employee_number ||
                  '-'
                )
              )}
            </td>

            <td>
              ${escapeHtml(
                String(
                  item.employee_name ||
                  '-'
                )
              )}
            </td>

            <td>
              ${escapeHtml(
                String(
                  item.department_name ||
                  '-'
                )
              )}
            </td>

            <td>
              ${escapeHtml(
                String(
                  item.leave_type ||
                  '-'
                )
              )}
            </td>

            <td>
              ${escapeHtml(
                tanggal
              )}
            </td>

            <td>
              ${escapeHtml(
                String(
                  item.reason ||
                  '-'
                )
              )}
            </td>

            <td>
              ${
                item.has_attachment
                  ? 'Ada lampiran'
                  : 'Tidak ada lampiran'
              }

              <br>

              ${escapeHtml(
                String(
                  statusLabel
                )
              )}
            </td>

            <td>
              ${actions}
            </td>

          </tr>
        `;

      }).join('');


  } catch (err) {

    console.error(
      'Gagal memuat pengajuan izin:',
      err
    );


    tableBody.innerHTML = `
      <tr>
        <td colspan="8"
            style="
              text-align:center;
              padding:24px;
              color:#b91c1c;">
          Gagal memuat data pengajuan:
          ${escapeHtml(
            err.message
          )}
        </td>
      </tr>
    `;
  }
}


async function reviewAdminLeave(
  leaveId,
  status
) {

  let note = '';


  if (status === 'REJECTED') {

    const inputNote =
      prompt(
        'Masukkan alasan penolakan:'
      );


    if (inputNote === null) {
      return;
    }


    note =
      inputNote.trim();


    if (!note) {

      alert(
        'Alasan penolakan wajib diisi.'
      );

      return;
    }


    if (note.length > 500) {

      alert(
        'Alasan penolakan maksimal 500 karakter.'
      );

      return;
    }

  } else {

    if (
      !confirm(
        'Yakin ingin menyetujui pengajuan ini?'
      )
    ) {
      return;
    }
  }


  try {

    const res =
      await fetch(
        `/api/admin/leave/${leaveId}/status`,
        {
          method: 'PUT',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            status,
            note
          })
        }
      );


    const result =
      await res.json();


    if (!res.ok || !result.success) {

      throw new Error(
        result.message ||
        'Gagal memproses pengajuan.'
      );
    }


    alert(
      result.message ||
      'Status pengajuan berhasil diperbarui.'
    );


    await loadAdminLeave();


  } catch (err) {

    console.error(
      'Gagal memproses pengajuan:',
      err
    );


    alert(
      err.message ||
      'Terjadi kesalahan saat memproses pengajuan.'
    );
  }
}


// =========================================================
// 16. STATUS UNTUK EXPORT
// =========================================================

function getAttendanceStatusLabel(
  status,
  checkInTime
) {

  if (!checkInTime) {
    return 'Belum Absen';
  }


  if (status === 'ON_TIME') {
    return 'Tepat Waktu';
  }


  if (status === 'LATE') {
    return 'Terlambat';
  }


  return status || '-';
}


function getCheckOutStatusLabel(
  status,
  checkOutTime
) {

  if (!checkOutTime) {
    return 'Belum Check-Out';
  }


  if (status === 'COMPLETED') {
    return 'Selesai';
  }


  return status || '-';
}


// =========================================================
// 17. EXPORT CSV
// =========================================================

function exportToCSV() {

  if (!currentAttendanceData.length) {

    alert(
      'Tidak ada data untuk diekspor.'
    );

    return;
  }


  const startDate =
    filterStartDate.value;

  const endDate =
    filterEndDate.value;


  const csvCell =
    value => {

      const text =
        String(value ?? '');

      return `"${text.replace(
        /"/g,
        '""'
      )}"`;
    };


  const headers = [

    'NIK',
    'Tanggal',
    'Nama Karyawan',
    'Departemen',
    'Jabatan',
    'Check-In',
    'Status Masuk',
    'Check-Out',
    'Status Pulang'

  ];


  const rows =
    currentAttendanceData.map(
      item => [

        item.employee_number ?? '-',

        item.attendance_date ?? '-',

        item.name ?? '-',

        item.department_name ?? '-',

        item.position ?? '-',

        item.check_in_time
          ? formatAttendanceTime(
              item.check_in_time
            )
          : '-',

        getAttendanceStatusLabel(
          item.check_in_status,
          item.check_in_time
        ),

        item.check_out_time
          ? formatAttendanceTime(
              item.check_out_time
            )
          : '-',

        getCheckOutStatusLabel(
          item.check_out_status,
          item.check_out_time
        )

      ]
    );


  const csvContent = [

    headers
      .map(csvCell)
      .join(','),

    ...rows.map(
      row =>
        row
          .map(csvCell)
          .join(',')
    )

  ].join('\r\n');


  const blob =
    new Blob(
      ['\uFEFF', csvContent],
      {
        type:
          'text/csv;charset=utf-8;'
      }
    );


  const url =
    URL.createObjectURL(blob);


  const a =
    document.createElement('a');


  a.href = url;


  a.download =
    `Rekap_Presensi_${startDate}_sampai_${endDate}.csv`;


  document.body.appendChild(a);

  a.click();

  document.body.removeChild(a);


  URL.revokeObjectURL(url);
}


// =========================================================
// 18. EXPORT PDF
// =========================================================

function exportToPDF() {

  if (!currentAttendanceData.length) {

    alert(
      'Tidak ada data untuk diekspor.'
    );

    return;
  }


  if (
    !window.jspdf ||
    !window.jspdf.jsPDF
  ) {

    alert(
      'Library PDF belum berhasil dimuat. Periksa koneksi internet.'
    );

    return;
  }


  const {
    jsPDF
  } =
    window.jspdf;


  const doc =
    new jsPDF({
      orientation:
        'landscape',
      unit:
        'mm',
      format:
        'a4'
    });


  if (
    typeof doc.autoTable !==
    'function'
  ) {

    alert(
      'Fitur tabel PDF belum berhasil dimuat. Muat ulang halaman.'
    );

    return;
  }


  const startDate =
    filterStartDate.value;

  const endDate =
    filterEndDate.value;


  doc.setFontSize(16);

  doc.text(
    'LAPORAN REKAP PRESENSI KARYAWAN',
    14,
    15
  );


  doc.setFontSize(10);

  doc.text(
    'SMP Al Falah Assalam Tropodo',
    14,
    22
  );


  doc.text(
    `Periode: ${startDate} s.d. ${endDate}`,
    14,
    28
  );


  doc.text(
    `Jumlah catatan: ${currentAttendanceData.length}`,
    14,
    34
  );


  const headers = [[

    'NIK',
    'Tanggal',
    'Nama',
    'Departemen',
    'Jabatan',
    'Check-In',
    'Status Masuk',
    'Check-Out',
    'Status Pulang'

  ]];


  const rows =
    currentAttendanceData.map(
      item => [

        item.employee_number ?? '-',

        item.attendance_date ?? '-',

        item.name ?? '-',

        item.department_name ?? '-',

        item.position ?? '-',

        item.check_in_time
          ? formatAttendanceTime(
              item.check_in_time
            )
          : '-',

        getAttendanceStatusLabel(
          item.check_in_status,
          item.check_in_time
        ),

        item.check_out_time
          ? formatAttendanceTime(
              item.check_out_time
            )
          : '-',

        getCheckOutStatusLabel(
          item.check_out_status,
          item.check_out_time
        )

      ]
    );


  doc.autoTable({

    head:
      headers,

    body:
      rows,

    startY:
      40,

    theme:
      'grid',

    styles: {
      fontSize:
        7,
      cellPadding:
        2,
      overflow:
        'linebreak'
    },

    headStyles: {
      fillColor:
        [10, 61, 36],
      textColor:
        255
    },

    margin: {
      left:
        10,
      right:
        10
    }

  });


  doc.save(
    `Rekap_Presensi_${startDate}_sampai_${endDate}.pdf`
  );
}


// =========================================================
// 19. EXPORT EXCEL
// =========================================================

function exportToExcel() {

  if (!currentAttendanceData.length) {

    alert(
      'Tidak ada data untuk diekspor.'
    );

    return;
  }


  if (!window.XLSX) {

    alert(
      'Library Excel belum berhasil dimuat. Periksa koneksi internet.'
    );

    return;
  }


  const startDate =
    filterStartDate.value;

  const endDate =
    filterEndDate.value;


  const headers = [

    'NIK',
    'Tanggal',
    'Nama Karyawan',
    'Departemen',
    'Jabatan',
    'Check-In',
    'Status Masuk',
    'Check-Out',
    'Status Pulang'

  ];


  const rows =
    currentAttendanceData.map(
      item => [

        item.employee_number ?? '-',

        item.attendance_date ?? '-',

        item.name ?? '-',

        item.department_name ?? '-',

        item.position ?? '-',

        item.check_in_time
          ? formatAttendanceTime(
              item.check_in_time
            )
          : '-',

        getAttendanceStatusLabel(
          item.check_in_status,
          item.check_in_time
        ),

        item.check_out_time
          ? formatAttendanceTime(
              item.check_out_time
            )
          : '-',

        getCheckOutStatusLabel(
          item.check_out_status,
          item.check_out_time
        )

      ]
    );


  const worksheet =
    XLSX.utils.aoa_to_sheet([

      [
        'LAPORAN REKAP PRESENSI KARYAWAN'
      ],

      [
        'SMP Al Falah Assalam Tropodo'
      ],

      [
        `Periode: ${startDate} s.d. ${endDate}`
      ],

      [],

      headers,

      ...rows

    ]);


  worksheet['!cols'] = [

    { wch: 16 },
    { wch: 14 },
    { wch: 28 },
    { wch: 22 },
    { wch: 20 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 18 }

  ];


  worksheet['!autofilter'] = {

    ref:
      `A5:I${rows.length + 5}`

  };


  const workbook =
    XLSX.utils.book_new();


  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    'Rekap Presensi'
  );


  XLSX.writeFile(
    workbook,
    `Rekap_Presensi_${startDate}_sampai_${endDate}.xlsx`
  );
}


// =========================================================
// 20. LOGOUT
// =========================================================

async function handleLogout() {

  try {

    await fetch(
      '/api/auth/logout',
      {
        method: 'POST'
      }
    );

    window.location.href =
      '/login';

  } catch (err) {

    window.location.href =
      '/login';
  }
}


// =========================================================
// 21. ESCAPE HTML
// =========================================================

function escapeHtml(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }


  return String(value)

    .replace(
      /&/g,
      '&amp;'
    )

    .replace(
      /</g,
      '&lt;'
    )

    .replace(
      />/g,
      '&gt;'
    )

    .replace(
      /"/g,
      '&quot;'
    )

    .replace(
      /'/g,
      '&#39;'
    );
}


// =========================================================
// 22. EVENT LISTENER
// =========================================================

filterStartDate?.addEventListener(
  'change',
  applyFilters
);


filterEndDate?.addEventListener(
  'change',
  applyFilters
);


filterDepartment?.addEventListener(
  'change',
  applyFilters
);


filterStatus?.addEventListener(
  'change',
  applyFilters
);


filterSearch?.addEventListener(
  'keydown',
  e => {

    if (e.key === 'Enter') {
      applyFilters();
    }

  }
);


// =========================================================
// 23. FILTER KARYAWAN
// =========================================================

document
  .getElementById(
    'employeeSearch'
  )
  ?.addEventListener(
    'keydown',
    event => {

      if (event.key === 'Enter') {

        employeePage = 1;

        loadEmployees();
      }

    }
  );


document
  .getElementById(
    'employeeDepartment'
  )
  ?.addEventListener(
    'change',
    () => {

      employeePage = 1;

      loadEmployees();
    }
  );


document
  .getElementById(
    'employeeStatus'
  )
  ?.addEventListener(
    'change',
    () => {

      employeePage = 1;

      loadEmployees();
    }
  );


// =========================================================
// 24. FILTER IZIN / SAKIT
// =========================================================

document
  .getElementById(
    'leaveStatusFilter'
  )
  ?.addEventListener(
    'change',
    () =>
      loadAdminLeave()
  );


// =========================================================
// 25. JALANKAN SAAT HALAMAN DIBUKA
// =========================================================

checkAdminAuth();   