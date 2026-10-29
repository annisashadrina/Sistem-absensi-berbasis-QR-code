/**
 * SCRIPT HALAMAN LOGIN
 */

const loginForm = document.getElementById('loginForm');
const identifierInput = document.getElementById('identifierInput');
const passwordInput = document.getElementById('passwordInput');
const btnLoginSubmit = document.getElementById('btnLoginSubmit');
const loginAlert = document.getElementById('loginAlert');

// Cek jika pengguna sudah memiliki sesi login aktif
async function checkExistingSession() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.success && data.user) {
      if (data.user.role === 'ADMIN') {
        window.location.replace('/admin');
      } else {
        window.location.replace('/scan');
      }
    }
  } catch (err) {
    // Abaikan jika tidak ada sesi atau offline
  }
}

checkExistingSession();

function fillAccount(email, password) {
  identifierInput.value = email;
  passwordInput.value = password;
  showAlert('Data akun demo telah diisi. Silakan klik "Masuk Sekarang".', 'info');
}

function showAlert(message, type = 'error') {
  loginAlert.style.display = 'block';
  loginAlert.textContent = message;

  if (type === 'error') {
    loginAlert.style.background = '#FEE2E2';
    loginAlert.style.color = '#B91C1C';
    loginAlert.style.border = '1px solid #FCA5A5';
  } else if (type === 'success') {
    loginAlert.style.background = '#DCFCE7';
    loginAlert.style.color = '#15803D';
    loginAlert.style.border = '1px solid #86EFAC';
  } else {
    loginAlert.style.background = '#E0F2FE';
    loginAlert.style.color = '#0369A1';
    loginAlert.style.border = '1px solid #BAE6FD';
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const identifier = identifierInput.value.trim();
  const password = passwordInput.value;

  if (!identifier || !password) {
    showAlert('Mohon isi NIK / Email dan kata sandi.');
    return;
  }

  btnLoginSubmit.disabled = true;
  btnLoginSubmit.textContent = 'Memverifikasi...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });

    const data = await res.json();

    if (data.success) {
      showAlert('Login berhasil! Mengalihkan...', 'success');

      // Cek apakah ada parameter redirect di URL
      const urlParams = new URLSearchParams(window.location.search);
      const redirectUrl = urlParams.get('redirect');

      setTimeout(() => {
        if (data.user.role === 'ADMIN') {
          // Admin selalu diarahkan ke dashboard admin, tidak boleh ke scanner
          if (redirectUrl && redirectUrl.startsWith('/admin')) {
            window.location.href = redirectUrl;
          } else {
            window.location.href = '/admin';
          }
        } else {
          // Pegawai / Guru diarahkan ke web scanner (/scan)
          if (redirectUrl && !redirectUrl.startsWith('/admin')) {
            window.location.href = redirectUrl;
          } else {
            window.location.href = '/scan';
          }
        }
      }, 700);
    } else {
      showAlert(data.message || 'NIK atau kata sandi tidak cocok.');
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = 'Masuk Sekarang';
    }
  } catch (err) {
    showAlert('Terjadi kesalahan jaringan: ' + err.message);
    btnLoginSubmit.disabled = false;
    btnLoginSubmit.textContent = 'Masuk Sekarang';
  }
});
