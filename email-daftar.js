// Halaman wajib daftar + verifikasi email (gate ONE-SAP)
const _ED_API = '/api';
let _edEmail = '';

(function init() {
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if (!u) { window.location.href = 'login.html'; return; }
  // Sudah punya email terverifikasi? langsung masuk.
  if (u.email_verified) { window.location.href = 'index-home.html'; return; }
  document.getElementById('edNama').textContent = u.nama || '-';
  document.getElementById('edNik').textContent  = u.nik || '-';
  if (u.email) document.getElementById('edEmail').value = u.email;
})();

function _msg(text, kind) {
  const el = document.getElementById('edMsg');
  el.textContent = text || '';
  el.className = 'ed-msg' + (kind ? ' ' + kind : '');
}

async function kirimKode() {
  const email = document.getElementById('edEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _msg('Format email tidak valid.', 'err'); return; }
  const btn = document.getElementById('edSendBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';
  _msg('');
  try {
    const nik = getCurrentUser().nik;
    const res = await fetch(_ED_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'requestEmailOtp', data: { nik, email } }),
    });
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'Gagal mengirim kode.');
    _edEmail = email;
    document.getElementById('edEmailShown').textContent = email;
    document.getElementById('edStep1').style.display = 'none';
    document.getElementById('edStep2').style.display = 'block';
    document.getElementById('edOtp').focus();
    _msg('Kode dikirim. Cek inbox / folder spam.', 'ok');
  } catch (e) {
    _msg(e.message, 'err');
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Kode';
  }
}

async function verifikasi() {
  const code = document.getElementById('edOtp').value.trim();
  if (code.length < 6) { _msg('Masukkan 6 digit kode.', 'err'); return; }
  const btn = document.getElementById('edVerifyBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memeriksa...';
  _msg('');
  try {
    const nik = getCurrentUser().nik;
    const res = await fetch(_ED_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verifyEmailOtp', data: { nik, email: _edEmail, code } }),
    });
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'Verifikasi gagal.');
    // Perbarui sesi lokal supaya guard tidak menendang balik
    const u = getCurrentUser();
    u.email = json.email || _edEmail; u.email_verified = true; u.email_required = false;
    saveUserSession(u, getAuthToken());
    _msg('Email terverifikasi! Mengalihkan...', 'ok');
    setTimeout(() => { window.location.href = 'index-home.html'; }, 800);
  } catch (e) {
    _msg(e.message, 'err');
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Verifikasi';
  }
}

function gantiEmail() {
  document.getElementById('edStep2').style.display = 'none';
  document.getElementById('edStep1').style.display = 'block';
  document.getElementById('edOtp').value = '';
  _msg('');
}

function keluar() {
  _lsRm('hazard_user'); _lsRm('hazard_token');
  window.location.href = 'login.html';
}
