/**
 * SCRIPT LAYAR DISPLAY TV MONITOR
 * Sinkronisasi jam server, pembaruan QR Code setiap 5 detik,
 * pembaruan 5 Karyawan Terawal & Live Feed Kehadiran.
 */

let serverTimeOffsetMs = 0;
let currentExpiresAtMs = 0;
let qrIntervalMs = 5000;
let currentQrToken = null;

const liveDigitalClock = document.getElementById('liveDigitalClock');
const liveDisplayDate = document.getElementById('liveDisplayDate');
const qrImage = document.getElementById('qrImage');
const qrTypeBadge = document.getElementById('qrTypeBadge');
const progressFill = document.getElementById('progressFill');
const timerCountdown = document.getElementById('timerCountdown');
const tokenShortId = document.getElementById('tokenShortId');
const leaderboardList = document.getElementById('leaderboardList');
const liveFeedList = document.getElementById('liveFeedList');

// Sinkronisasi data display dengan server
async function fetchDisplayData() {
  try {
    const res = await fetch('/api/qr/live-display');
    const data = await res.json();

    if (!data.success) return;

    // Hitung offset selisih waktu klien dengan server
    const serverTimestamp = new Date(data.serverTime).getTime();
    serverTimeOffsetMs = serverTimestamp - Date.now();

    liveDisplayDate.textContent = data.displayDate;

    // Update QR Code
    if (data.qr) {
      currentExpiresAtMs = new Date(data.qr.expiresAt).getTime();
      
      if (currentQrToken !== data.qr.token) {
        currentQrToken = data.qr.token;
        qrImage.src = data.qr.qrDataUrl;
        tokenShortId.textContent = data.qr.token.substring(0, 8) + '...';

        // Update badge tipe QR
        if (data.qr.type === 'CHECK_IN') {
          qrTypeBadge.className = 'qr-type-badge qr-type-in';
          qrTypeBadge.textContent = 'ABSENSI MASUK (00:00 - 15:59)';
        } else {
          qrTypeBadge.className = 'qr-type-badge qr-type-out';
          qrTypeBadge.textContent = 'ABSENSI PULANG (MULAI 16:00)';
        }
      }
    }

    // Render 5 Karyawan Terawal (Bab 19)
    renderLeaderboard(data.top5);

    // Render Live Feed Kehadiran
    renderLiveFeed(data.liveFeed);

  } catch (err) {
    console.error('Error fetching live display data:', err);
  }
}

function renderLeaderboard(list) {
  if (!list || list.length === 0) {
    leaderboardList.innerHTML = `
      <div style="text-align: center; color: #94a3b8; padding: 24px; font-size: 0.9rem;">
        Belum ada karyawan yang check-in hari ini.
      </div>
    `;
    return;
  }

  leaderboardList.innerHTML = list.map((item, index) => {
    const rank = index + 1;
    const isLate = item.check_in_status === 'LATE';
    return `
      <div class="leader-item rank-${rank}">
        <div class="rank-badge">${rank}</div>
        <div class="leader-info">
          <div class="leader-name">${escapeHtml(item.name)}</div>
          <div class="leader-dept">${escapeHtml(item.position || item.department_name || '-')}</div>
        </div>
        <div class="leader-time" style="color: ${isLate ? '#f59e0b' : '#4ade80'}">
          ${item.check_in_time.substring(0, 5)}
        </div>
      </div>
    `;
  }).join('');
}

function renderLiveFeed(list) {
  if (!list || list.length === 0) {
    liveFeedList.innerHTML = `
      <div style="text-align: center; color: #94a3b8; padding: 24px; font-size: 0.9rem;">
        Belum ada catatan aktivitas hari ini.
      </div>
    `;
    return;
  }

  liveFeedList.innerHTML = list.map(item => {
    const isCheckout = Boolean(item.check_out_time);
    const time = isCheckout ? item.check_out_time : item.check_in_time;
    const typeLabel = isCheckout ? 'Pulang' : (item.check_in_status === 'ON_TIME' ? 'Tepat Waktu' : 'Terlambat');
    const badgeClass = isCheckout ? 'badge-completed' : (item.check_in_status === 'ON_TIME' ? 'badge-on-time' : 'badge-late');
    const borderClass = isCheckout ? 'checkout' : (item.check_in_status === 'ON_TIME' ? '' : 'late');

    return `
      <div class="feed-item ${borderClass}">
        <div class="feed-meta">
          <span class="feed-name">${escapeHtml(item.name)}</span>
          <span class="feed-sub">${escapeHtml(item.department_name || item.position || '')} • <span class="font-mono">${time}</span></span>
        </div>
        <span class="badge ${badgeClass}">${typeLabel}</span>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Loop Animasi Jam & Countdown Progress Bar (Super Smooth)
function animationLoop() {
  const adjustedNow = Date.now() + serverTimeOffsetMs;
  const nowDate = new Date(adjustedNow);

  // Digital Clock
  const h = String(nowDate.getHours()).padStart(2, '0');
  const m = String(nowDate.getMinutes()).padStart(2, '0');
  const s = String(nowDate.getSeconds()).padStart(2, '0');
  liveDigitalClock.textContent = `${h}:${m}:${s}`;

  // Progress Bar Countdown 5 Detik
  if (currentExpiresAtMs > 0) {
    const remainingMs = currentExpiresAtMs - adjustedNow;
    if (remainingMs <= 0) {
      progressFill.style.width = '0%';
      timerCountdown.textContent = '0s';
      // Minta data QR baru segera
      currentExpiresAtMs = 0;
      fetchDisplayData();
    } else {
      const percentage = Math.min(100, Math.max(0, (remainingMs / qrIntervalMs) * 100));
      progressFill.style.width = `${percentage}%`;
      const remSec = (remainingMs / 1000).toFixed(1);
      timerCountdown.textContent = `${remSec}s`;
    }
  }

  requestAnimationFrame(animationLoop);
}

// Inisialisasi awal
fetchDisplayData();
animationLoop();

// Polling reguler setiap 2 detik untuk menyelaraskan live feed & top 5
setInterval(fetchDisplayData, 2000);
