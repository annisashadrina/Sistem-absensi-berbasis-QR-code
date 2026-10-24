/**
 * SCRIPT WEB SCANNER KARYAWAN
 * Menangani kamera smartphone, deteksi barcode/QR, dan pengiriman absensi.
 */

let currentUser = null;
let currentMode = 'CHECK_IN';
let videoStream = null;
let facingMode = 'environment'; // kamera belakang
let isScanning = false;
let isProcessing = false;

// DOM Elements
const sessionBar = document.getElementById('sessionBar');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userSub = document.getElementById('userSub');
const sessionAction = document.getElementById('sessionAction');
const loginWarningAlert = document.getElementById('loginWarningAlert');

const btnModeCheckIn = document.getElementById('btnModeCheckIn');
const btnModeCheckOut = document.getElementById('btnModeCheckOut');
const cameraVideo = document.getElementById('cameraVideo');
const cameraCanvas = document.getElementById('cameraCanvas');
const cameraStatusText = document.getElementById('cameraStatusText');
const btnStartCamera = document.getElementById('btnStartCamera');
const btnSwitchCamera = document.getElementById('btnSwitchCamera');

const manualTokenInput = document.getElementById('manualTokenInput');
const btnSubmitManualToken = document.getElementById('btnSubmitManualToken');

const resultModal = document.getElementById('resultModal');
const resultCard = document.getElementById('resultCard');
const resultIcon = document.getElementById('resultIcon');
const resultTitle = document.getElementById('resultTitle');
const resultName = document.getElementById('resultName');
const resultTime = document.getElementById('resultTime');
const resultStatusTag = document.getElementById('resultStatusTag');
const resultMessage = document.getElementById('resultMessage');
const btnCloseModal = document.getElementById('btnCloseModal');

// 1. Cek Sesi Login Karyawan (Bab 8)
async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (data.success && data.user) {
      currentUser = data.user;
      userAvatar.textContent = currentUser.name.charAt(0);
      userName.textContent = currentUser.name;
      userSub.textContent = `${currentUser.employee_number} • ${currentUser.position || currentUser.department_name || 'Pegawai'}`;
      sessionAction.innerHTML = `
        <button onclick="handleLogout()" class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem; color:#f87171; border-color:rgba(248,113,113,0.4);">
          Logout
        </button>
      `;
      loginWarningAlert.style.display = 'none';
    } else {
      currentUser = null;
      userAvatar.textContent = '?';
      userName.textContent = 'Belum Login';
      userSub.textContent = 'Silakan login terlebih dahulu';
      sessionAction.innerHTML = `
        <a href="/login?redirect=/scan" class="btn btn-accent" style="padding:6px 14px; font-size:0.78rem;">
          Login
        </a>
      `;
      loginWarningAlert.style.display = 'block';
    }
  } catch (err) {
    console.error('Error checking auth:', err);
  }
}

// 2. Set Mode Absensi (Masuk vs Pulang)
function setScanMode(mode) {
  currentMode = mode;
  if (mode === 'CHECK_IN') {
    btnModeCheckIn.classList.add('active');
    btnModeCheckOut.classList.remove('active');
  } else {
    btnModeCheckOut.classList.add('active');
    btnModeCheckIn.classList.remove('active');
  }
}

// 3. Manajemen Kamera Browser
async function startCamera() {
  if (videoStream) {
    stopCamera();
  }

  try {
    cameraStatusText.textContent = 'Menghubungkan ke kamera...';
    const constraints = {
      video: {
        facingMode: facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraVideo.srcObject = videoStream;
    await cameraVideo.play();

    isScanning = true;
    cameraStatusText.textContent = 'Arahkan kamera ke QR Code monitor';
    btnStartCamera.textContent = '⏹️ Matikan Kamera';

    // Mulai deteksi barcode/QR jika didukung
    detectQrLoop();
  } catch (err) {
    console.error('Gagal membuka kamera:', err);
    cameraStatusText.textContent = 'Kamera tidak dapat diakses (' + err.message + ')';
    btnStartCamera.textContent = '📷 Buka Kamera';
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
  isScanning = false;
  btnStartCamera.textContent = '📷 Buka Kamera';
  cameraStatusText.textContent = 'Kamera mati. Klik "Buka Kamera" untuk scan.';
}

// 4. Deteksi QR Code Otomatis Menggunakan BarcodeDetector API
let barcodeDetector = null;
if ('BarcodeDetector' in window) {
  try {
    barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
  } catch (e) {
    console.warn('BarcodeDetector format qr_code error:', e);
  }
}

async function detectQrLoop() {
  if (!isScanning || isProcessing) return;

  if (barcodeDetector && cameraVideo.readyState === cameraVideo.HAVE_ENOUGH_DATA) {
    try {
      const barcodes = await barcodeDetector.detect(cameraVideo);
      if (barcodes.length > 0) {
        const rawValue = barcodes[0].rawValue;
        handleDetectedPayload(rawValue);
        return;
      }
    } catch (err) {
      // Abaikan frame error sesaat
    }
  }

  if (isScanning) {
    requestAnimationFrame(detectQrLoop);
  }
}

// Parsing nilai hasil scan
function handleDetectedPayload(scannedString) {
  if (isProcessing) return;

  // Jika berupa URL absensi: https://absensi.../a/<TOKEN>
  let token = scannedString;
  if (scannedString.includes('/a/')) {
    const parts = scannedString.split('/a/');
    token = parts[parts.length - 1];
  }

  // Bersihkan parameter query jika ada
  token = token.split('?')[0].trim();

  submitAttendance(token);
}

// 5. Eksekusi Pengiriman Absensi (Bab 9, 15, 27, 28)
async function submitAttendance(token) {
  if (isProcessing) return;
  isProcessing = true;

  // Cek apakah karyawan sudah login
  if (!currentUser) {
    showResultModal({
      type: 'error',
      title: 'LOGIN DIPERLUKAN',
      name: 'Identitas Tidak Diketahui',
      time: '--:--',
      statusText: '❌ Belum Login',
      message: 'Sistem absensi membutuhkan sesi login aktif. Silakan login ke akun karyawan Anda.'
    });
    isProcessing = false;
    return;
  }

  cameraStatusText.textContent = 'Memvalidasi token QR ke server...';

  const endpoint = currentMode === 'CHECK_IN' ? '/api/attendance/check-in' : '/api/attendance/check-out';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const data = await res.json();

    if (data.success) {
      const att = data.attendance;
      if (currentMode === 'CHECK_IN') {
        const isLate = att.status === 'LATE';
        showResultModal({
          type: isLate ? 'late' : 'success',
          title: 'ABSENSI BERHASIL',
          name: att.employee_name || currentUser.name,
          time: att.check_in_time,
          statusText: isLate ? '⚠ TERLAMBAT' : '✓ TEPAT WAKTU',
          message: data.message
        });
      } else {
        showResultModal({
          type: 'success',
          title: 'ABSENSI PULANG BERHASIL',
          name: att.employee_name || currentUser.name,
          time: att.check_out_time,
          statusText: '✓ PULANG TERCATAT',
          message: data.message
        });
      }
    } else {
      showResultModal({
        type: 'error',
        title: 'ABSENSI DITOLAK',
        name: currentUser.name,
        time: '--:--',
        statusText: '❌ Ditolak',
        message: data.message || 'Token QR tidak valid atau sudah kedaluwarsa.'
      });
    }
  } catch (err) {
    showResultModal({
      type: 'error',
      title: 'KONEKSI GAGAL',
      name: currentUser.name,
      time: '--:--',
      statusText: '❌ Gangguan Jaringan',
      message: 'Tidak dapat menghubungi server. Pastikan Anda terhubung ke jaringan kantor.'
    });
  } finally {
    isProcessing = false;
    cameraStatusText.textContent = 'Arahkan kamera ke QR Code monitor';
  }
}

// 6. Modal Tampilan Hasil (Bab 13)
function showResultModal({ type, title, name, time, statusText, message }) {
  resultCard.className = `result-card ${type}`;
  resultIcon.textContent = type === 'error' ? '✕' : (type === 'late' ? '⚠' : '✓');
  resultTitle.textContent = title;
  resultName.textContent = name;
  resultTime.textContent = time;
  resultStatusTag.className = `result-status-tag ${type === 'error' ? 'status-error' : (type === 'late' ? 'status-late' : 'status-on-time')}`;
  resultStatusTag.textContent = statusText;
  resultMessage.textContent = message;

  resultModal.classList.add('active');
}

function closeModal() {
  resultModal.classList.remove('active');
  // Lanjutkan scanning jika kamera masih aktif
  if (isScanning) {
    setTimeout(detectQrLoop, 500);
  }
}

// 7. Logout Handler
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  } catch (err) {
    console.error('Error logging out:', err);
  }
}

// Event Listeners
btnStartCamera.addEventListener('click', () => {
  if (isScanning) {
    stopCamera();
  } else {
    startCamera();
  }
});

btnSwitchCamera.addEventListener('click', () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  if (isScanning) {
    startCamera();
  }
});

btnSubmitManualToken.addEventListener('click', () => {
  const token = manualTokenInput.value.trim();
  if (!token) {
    alert('Silakan masukkan token QR terlebih dahulu.');
    return;
  }
  handleDetectedPayload(token);
  manualTokenInput.value = '';
});

manualTokenInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnSubmitManualToken.click();
  }
});

btnCloseModal.addEventListener('click', closeModal);

// Inisialisasi saat halaman dibuka
checkAuthSession();

// Coba buka kamera otomatis jika di smartphone / mengizinkan
window.addEventListener('DOMContentLoaded', () => {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    startCamera();
  }
});


/* =====================================================
   FITUR PENGAJUAN IZIN, SAKIT, CUTI, DAN RIWAYAT
   ===================================================== */

const employeeNavButtons = document.querySelectorAll('.employee-nav-btn');
const employeeViews = document.querySelectorAll('.employee-view');

const leaveForm = document.getElementById('leaveForm');
const leaveTypeInput = document.getElementById('leaveType');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const leaveAttachmentInput = document.getElementById('leaveAttachment');
const leaveFeedback = document.getElementById('leaveFeedback');
const btnSubmitLeave = document.getElementById('btnSubmitLeave');

const historyStatus = document.getElementById('historyStatus');
const btnRefreshHistory = document.getElementById('btnRefreshHistory');
const historyFeedback = document.getElementById('historyFeedback');
const leaveHistoryList = document.getElementById('leaveHistoryList');

// Navigasi halaman karyawan
employeeNavButtons.forEach(button => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.view;

    employeeNavButtons.forEach(item => {
      item.classList.toggle('active', item === button);
    });

    employeeViews.forEach(view => {
      const active = view.id === targetId;
      view.classList.toggle('active', active);
      view.hidden = !active;
    });

    // Kamera berhenti ketika berpindah ke fitur lain
    if (targetId !== 'scannerView' && videoStream) {
      stopCamera();
    }

    if (targetId === 'historyView') {
      loadLeaveHistory();
    }
  });
});

// Pesan status
function setLeaveFeedback(message, type = 'info') {
  leaveFeedback.textContent = message;
  leaveFeedback.className = `leave-feedback ${type}`;
  leaveFeedback.hidden = false;
}

function setHistoryFeedback(message, type = 'info') {
  historyFeedback.textContent = message;
  historyFeedback.className = `leave-feedback ${type}`;
  historyFeedback.hidden = false;
}

// Validasi lampiran pengajuan sakit
leaveTypeInput.addEventListener('change', () => {
  leaveAttachmentInput.required = leaveTypeInput.value === 'SAKIT';
});

// Pastikan tanggal selesai tidak lebih awal daripada tanggal mulai
startDateInput.addEventListener('change', () => {
  endDateInput.min = startDateInput.value;

  if (endDateInput.value && endDateInput.value < startDateInput.value) {
    endDateInput.value = startDateInput.value;
  }
});

// Kirim pengajuan
leaveForm.addEventListener('submit', async event => {
  event.preventDefault();

  if (!currentUser) {
    setLeaveFeedback('Silakan login terlebih dahulu.', 'error');
    return;
  }

  if (endDateInput.value < startDateInput.value) {
    setLeaveFeedback(
      'Tanggal selesai tidak boleh sebelum tanggal mulai.',
      'error'
    );
    return;
  }

  const attachment = leaveAttachmentInput.files[0];

  if (leaveTypeInput.value === 'SAKIT' && !attachment) {
    setLeaveFeedback(
      'Lampiran wajib disertakan untuk pengajuan sakit.',
      'error'
    );
    return;
  }

  if (attachment && attachment.size > 5 * 1024 * 1024) {
    setLeaveFeedback('Ukuran lampiran maksimal 5 MB.', 'error');
    return;
  }

  btnSubmitLeave.disabled = true;
  btnSubmitLeave.textContent = 'Mengirim...';

  try {
    const response = await fetch('/api/attendance/leave', {
      method: 'POST',
      body: new FormData(leaveForm)
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      setLeaveFeedback(
        data.message || 'Pengajuan gagal dikirim.',
        'error'
      );
      return;
    }

    setLeaveFeedback(
      data.message || 'Pengajuan berhasil dikirim.',
      'success'
    );

    leaveForm.reset();
    endDateInput.min = '';
    leaveAttachmentInput.required = false;

  } catch (error) {
    console.error('Pengajuan gagal:', error);
    setLeaveFeedback(
      'Tidak dapat terhubung ke server. Silakan coba lagi.',
      'error'
    );
  } finally {
    btnSubmitLeave.disabled = false;
    btnSubmitLeave.textContent = 'Kirim Pengajuan';
  }
});

// Format tanggal
function formatHistoryDate(value) {
  if (!value) return '-';

  const parts = String(value).slice(0, 10).split('-');

  if (parts.length !== 3) return String(value);

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function leaveTypeLabel(type) {
  const labels = {
    IZIN: 'Izin',
    SAKIT: 'Sakit',
    CUTI: 'Cuti'
  };

  return labels[type] || type || 'Pengajuan';
}

function leaveStatusLabel(status) {
  const labels = {
    PENDING: 'Menunggu Persetujuan',
    APPROVED: 'Disetujui',
    REJECTED: 'Ditolak'
  };

  return labels[status] || status || 'Tidak diketahui';
}

// Muat riwayat dari server
async function loadLeaveHistory() {
  leaveHistoryList.replaceChildren();

  const loading = document.createElement('p');
  loading.className = 'history-empty';
  loading.textContent = 'Memuat riwayat pengajuan...';
  leaveHistoryList.appendChild(loading);

  historyFeedback.hidden = true;

  try {
    const status = historyStatus.value || 'ALL';

    const response = await fetch(
      `/api/attendance/leave?status=${encodeURIComponent(status)}`
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Gagal memuat riwayat.');
    }

    const records = Array.isArray(data.data) ? data.data : [];
    leaveHistoryList.replaceChildren();

    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'Belum ada riwayat pengajuan.';
      leaveHistoryList.appendChild(empty);
      return;
    }

    records.forEach(record => {
      const card = document.createElement('article');
      card.className = 'leave-history-card';

      const heading = document.createElement('div');
      heading.className = 'history-card-heading';

      const title = document.createElement('h3');
      title.textContent = leaveTypeLabel(record.leave_type);

      const badge = document.createElement('span');
      badge.className =
        `history-status status-${String(record.status || '').toLowerCase()}`;
      badge.textContent = leaveStatusLabel(record.status);

      heading.append(title, badge);

      const dates = document.createElement('p');
      dates.textContent =
        `Tanggal: ${formatHistoryDate(record.start_date)} – ` +
        `${formatHistoryDate(record.end_date)}`;

      const reason = document.createElement('p');
      reason.textContent = `Alasan: ${record.reason || '-'}`;

    card.append(heading, dates, reason);
    if (record.has_attachment){
        const attachmentLink = document.createElement('a');

        attachmentLink.href =
        `/api/attendance/leave/${encodeURIComponent(record.id)}/attachment`;

        attachmentLink.textContent = 'Lihat Lampiran';
        attachmentLink.target = '_blank';
        attachmentLink.rel = 'noopener noreferrer';

        card.appendChild(attachmentLink);
    }if (record.review_note){
        const note = document.createElement('p');
        note.textContent = `Catatan admin: ${record.review_note}`;
        card.appendChild(note);
      }


      leaveHistoryList.appendChild(card);
    });

  } catch (error) {
    console.error('Gagal memuat riwayat:', error);
    leaveHistoryList.replaceChildren();

    const message = document.createElement('p');
    message.className = 'history-empty';
    message.textContent = error.message;
    leaveHistoryList.appendChild(message);
  }
}

historyStatus.addEventListener('change', loadLeaveHistory);
btnRefreshHistory.addEventListener('click', loadLeaveHistory);
