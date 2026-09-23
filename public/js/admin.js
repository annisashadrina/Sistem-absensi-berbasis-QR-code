/**
 * SCRIPT DASHBOARD ADMIN HR
 */

let currentAttendanceData = [];

// DOM Elements
const adminName = document.getElementById('adminName');
const filterDate = document.getElementById('filterDate');
const filterDepartment = document.getElementById('filterDepartment');
const filterStatus = document.getElementById('filterStatus');
const filterSearch = document.getElementById('filterSearch');
const attendanceTableBody = document.getElementById('attendanceTableBody');
const auditTableBody = document.getElementById('auditTableBody');
const tableRecordCount = document.getElementById('tableRecordCount');

// Stat Elements
const metricTotal = document.getElementById('metricTotal');
const metricPresent = document.getElementById('metricPresent');
const metricOnTime = document.getElementById('metricOnTime');
const metricLate = document.getElementById('metricLate');
const metricAbsent = document.getElementById('metricAbsent');
const metricCompleted = document.getElementById('metricCompleted');

// 1. Inisialisasi & Verifikasi Hak Akses Admin
async function checkAdminAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (!data.success || !data.user || data.user.role !== 'ADMIN') {
      window.location.href = '/login?redirect=/admin';
      return;
    }

    adminName.textContent = data.user.name;
    initDashboard();
  } catch (err) {
    window.location.href = '/login?redirect=/admin';
  }
}

// 2. Setup Awal Tanggal & Dropdown
async function initDashboard() {
  const today = new Date().toISOString().split('T')[0];
  filterDate.value = today;

  await loadDepartments();
  await loadDashboardMetrics();
  await loadAttendanceTable();
}

async function loadDepartments() {
  try {
    const res = await fetch('/api/admin/departments');
    const data = await res.json();
    if (data.success) {
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

// 3. Muat Metrik Ringkasan (Bab 21)
async function loadDashboardMetrics() {
  const date = filterDate.value;
  try {
    const res = await fetch(`/api/admin/dashboard?date=${date}`);
    const data = await res.json();

    if (data.success) {
      const m = data.metrics;
      metricTotal.textContent = m.totalEmployees;
      metricPresent.textContent = m.presentCount;
      metricOnTime.textContent = m.onTimeCount;
      metricLate.textContent = m.lateCount;
      metricAbsent.textContent = m.absentCount;
      metricCompleted.textContent = m.completedCount;
    }
  } catch (err) {
    console.error('Error loading metrics:', err);
  }
}

// 4. Muat Data Tabel Absensi (Bab 21 & 22)
async function loadAttendanceTable() {
  const date = filterDate.value;
  const dept = filterDepartment.value;
  const status = filterStatus.value;
  const search = filterSearch.value.trim();

  let url = `/api/admin/attendance?date=${date}`;
  if (dept) url += `&departmentId=${dept}`;
  if (status) url += `&status=${status}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  attendanceTableBody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align: center; color: #94a3b8; padding: 24px;">
        Memuat data absensi...
      </td>
    </tr>
  `;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.success) {
      currentAttendanceData = data.data;
      tableRecordCount.textContent = `${data.data.length} Karyawan`;
      renderAttendanceTable(data.data);
    }
  } catch (err) {
    attendanceTableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: #ef4444; padding: 24px;">
          Gagal memuat data: ${err.message}
        </td>
      </tr>
    `;
  }
}

function renderAttendanceTable(list) {
  if (list.length === 0) {
    attendanceTableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: #94a3b8; padding: 28px;">
          Tidak ada data kehadiran yang sesuai dengan filter.
        </td>
      </tr>
    `;
    return;
  }

  attendanceTableBody.innerHTML = list.map(item => {
    const hasCheckedIn = Boolean(item.check_in_time);
    const hasCheckedOut = Boolean(item.check_out_time);

    let statusBadge = '<span class="badge badge-absent">Belum Absen</span>';
    if (hasCheckedIn) {
      statusBadge = item.check_in_status === 'ON_TIME'
        ? '<span class="badge badge-on-time">✓ ON_TIME</span>'
        : '<span class="badge badge-late">⚠ LATE</span>';
    }

    let finalStatus = '<span class="badge" style="background:#f1f5f9; color:#64748b;">-</span>';
    if (hasCheckedOut) {
      finalStatus = '<span class="badge badge-completed">✓ COMPLETED</span>';
    } else if (hasCheckedIn) {
      finalStatus = '<span class="badge" style="background:#fef3c7; color:#b45309;">SEDANG BEKERJA</span>';
    }

    return `
      <tr>
        <td class="font-mono" style="font-weight: 700; color: #0a3d24;">${escapeHtml(item.employee_number)}</td>
        <td style="font-weight: 600;">${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.department_name || '-')}</td>
        <td style="color: #64748b;">${escapeHtml(item.position || '-')}</td>
        <td class="font-mono">${item.check_in_time || '-'}</td>
        <td>${statusBadge}</td>
        <td class="font-mono">${item.check_out_time || '-'}</td>
        <td>${finalStatus}</td>
      </tr>
    `;
  }).join('');
}

function applyFilters() {
  loadDashboardMetrics();
  loadAttendanceTable();
}

// 5. Muat Log Audit Keamanan (Bab 23.5)
async function loadAuditLogs() {
  auditTableBody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align: center; color: #94a3b8; padding: 24px;">
        Memuat catatan audit...
      </td>
    </tr>
  `;

  try {
    const res = await fetch('/api/admin/audit-logs');
    const data = await res.json();

    if (data.success) {
      renderAuditTable(data.data);
    }
  } catch (err) {
    auditTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: #ef4444; padding: 24px;">
          Gagal memuat log audit: ${err.message}
        </td>
      </tr>
    `;
  }
}

function renderAuditTable(logs) {
  if (logs.length === 0) {
    auditTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: #94a3b8; padding: 28px;">
          Belum ada catatan aktivitas tercatat.
        </td>
      </tr>
    `;
    return;
  }

  auditTableBody.innerHTML = logs.map(log => {
    let actionBadge = `<span class="badge" style="background:#e2e8f0; color:#334155;">${log.action}</span>`;
    if (log.action === 'CHECK_IN') actionBadge = '<span class="badge badge-on-time">CHECK_IN</span>';
    if (log.action === 'CHECK_OUT') actionBadge = '<span class="badge badge-completed">CHECK_OUT</span>';
    if (log.action === 'INVALID_QR' || log.action === 'EXPIRED_QR') actionBadge = '<span class="badge badge-absent">⚠️ ' + log.action + '</span>';
    if (log.action === 'DUPLICATE_ATTENDANCE') actionBadge = '<span class="badge badge-late">🚫 DUPLICATE</span>';

    const timeFormatted = new Date(log.created_at).toLocaleString('id-ID');
    const empInfo = log.employee_name ? `${log.employee_name} (${log.employee_number})` : '-';
    const metadataStr = typeof log.metadata === 'object' ? JSON.stringify(log.metadata) : (log.metadata || '-');

    return `
      <tr>
        <td class="font-mono" style="font-size: 0.8rem; color: #64748b;">${timeFormatted}</td>
        <td>${actionBadge}</td>
        <td style="font-weight: 600;">${escapeHtml(empInfo)}</td>
        <td class="font-mono" style="font-size: 0.8rem;">${escapeHtml(log.ip_address || '-')}</td>
        <td style="font-size: 0.78rem; color: #64748b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(log.user_agent || '-')}
        </td>
        <td class="font-mono" style="font-size: 0.75rem; color: #475569;">
          ${escapeHtml(metadataStr)}
        </td>
      </tr>
    `;
  }).join('');
}

// 6. Tab Navigation
function switchTab(tab) {
  const tabContentAttendance = document.getElementById('tabContentAttendance');
  const tabContentAudit = document.getElementById('tabContentAudit');
  const tabBtnAttendance = document.getElementById('tabBtnAttendance');
  const tabBtnAudit = document.getElementById('tabBtnAudit');

  if (tab === 'attendance') {
    tabContentAttendance.style.display = 'block';
    tabContentAudit.style.display = 'none';
    tabBtnAttendance.classList.add('active');
    tabBtnAudit.classList.remove('active');
  } else {
    tabContentAttendance.style.display = 'none';
    tabContentAudit.style.display = 'block';
    tabBtnAudit.classList.add('active');
    tabBtnAttendance.classList.remove('active');
    loadAuditLogs();
  }
}

// 7. Ekspor CSV
function exportToCSV() {
  if (!currentAttendanceData || currentAttendanceData.length === 0) {
    alert('Tidak ada data untuk diekspor.');
    return;
  }

  const date = filterDate.value;
  let csv = 'NIK,Nama Karyawan,Departemen,Jabatan,Check-In,Status Masuk,Check-Out,Status Pulang\n';

  currentAttendanceData.forEach(item => {
    const row = [
      `"${item.employee_number || ''}"`,
      `"${item.name || ''}"`,
      `"${item.department_name || ''}"`,
      `"${item.position || ''}"`,
      `"${item.check_in_time || ''}"`,
      `"${item.check_in_status || 'ABSENT'}"`,
      `"${item.check_out_time || ''}"`,
      `"${item.check_out_status || ''}"`
    ];
    csv += row.join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Rekap_Presensi_${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 8. Logout
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  } catch (err) {
    window.location.href = '/login';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

filterDate.addEventListener('change', applyFilters);
filterDepartment.addEventListener('change', applyFilters);
filterStatus.addEventListener('change', applyFilters);
filterSearch.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') applyFilters();
});

// Jalankan saat halaman dibuka
checkAdminAuth();
