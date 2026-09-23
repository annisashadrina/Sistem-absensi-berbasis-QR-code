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
