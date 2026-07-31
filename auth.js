let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById("btnInstallPwa");
  if (installBtn) {
    installBtn.style.display = "flex";
  }
});

function installPwaApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then((choiceResult) => {
    if (choiceResult.outcome === "accepted") {
      console.log("User accepted the install prompt");
    }
    deferredPrompt = null;
    const installBtn = document.getElementById("btnInstallPwa");
    if (installBtn) installBtn.style.display = "none";
  });
}

// ===== SESSION & TOKEN =====
function saveUserSession(user, token){
  localStorage.setItem("hazard_user", JSON.stringify(user));
  if (token) localStorage.setItem("hazard_token", token);
}
function getCurrentUser(){const d=localStorage.getItem("hazard_user");return d?JSON.parse(d):null;}
function getAuthToken(){return localStorage.getItem("hazard_token") || "";}

function isTokenExpired(token){
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp && (payload.exp * 1000) < Date.now();
  } catch { return true; }
}

function requireLogin(){
  const token = getAuthToken();
  if (!getCurrentUser() || !token || isTokenExpired(token)) {
    localStorage.removeItem("hazard_user");
    localStorage.removeItem("hazard_token");
    window.location.href = "login.html";
  }
}

function logout(){
  localStorage.removeItem("hazard_user");
  localStorage.removeItem("hazard_token");
  window.location.href = "login.html";
}

// Global toast — works on any page; pages with their own showToast will override this.
function showToast(msg, type = 'success') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast ' + type;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// Generic confirm modal using .cm-* classes from layout.css
function openConfirmModal(msg, onOk, opts) {
  let m = document.getElementById('__genericConfirmModal');
  if (!m) {
    m = document.createElement('div');
    m.id = '__genericConfirmModal';
    m.className = 'cm-overlay';
    m.innerHTML = `<div class="cm-box">
      <div class="cm-icon cm-icon--warning"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <p class="cm-title" id="__gcmTitle"></p>
      <div class="cm-actions">
        <button class="btn-secondary" id="__gcmCancel">Batal</button>
        <button class="btn-danger"    id="__gcmOk">Ya, Lanjutkan</button>
      </div></div>`;
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
    document.body.appendChild(m);
    document.getElementById('__gcmCancel').addEventListener('click', () => { m.style.display = 'none'; });
  }
  document.getElementById('__gcmTitle').textContent = msg;
  if (opts?.okLabel) document.getElementById('__gcmOk').textContent = opts.okLabel;
  document.getElementById('__gcmOk').onclick = () => { m.style.display = 'none'; onOk(); };
  m.style.display = 'flex';
}

function confirmLogout() {
  let m = document.getElementById('logoutConfirmModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'logoutConfirmModal';
    m.className = 'cm-overlay';
    m.innerHTML = `
      <div class="cm-box">
        <div class="cm-icon cm-icon--warning">
          <i class="fa-solid fa-arrow-right-from-bracket"></i>
        </div>
        <h3 class="cm-title">Keluar dari Aplikasi?</h3>
        <p class="cm-text">Sesi Anda akan diakhiri dan Anda perlu login kembali.</p>
        <div class="cm-actions">
          <button class="btn-secondary" onclick="document.getElementById('logoutConfirmModal').style.display='none'">Batal</button>
          <button class="btn-danger" onclick="logout()">Ya, Keluar</button>
        </div>
      </div>`;
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
}

// ===== FETCH INTERCEPTOR =====
// Semua request ke /api otomatis diberi header Authorization.
// Respons 401 (token invalid/expired) -> otomatis logout.
// Dengan ini dashboard.js / script.js / inspection-form.js tidak perlu diubah.
(function () {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const isApiCall = url === "/api" || url.startsWith("/api?") || url.startsWith("/api/");
    const isLoginCall = init && typeof init.body === "string" && init.body.indexOf('"action":"login"') !== -1;

    if (isApiCall && !isLoginCall) {
      const token = getAuthToken();
      init.headers = Object.assign({}, init.headers, token ? { "Authorization": "Bearer " + token } : {});
    }

    const response = await originalFetch(input, init);

    if (isApiCall && !isLoginCall && response.status === 401) {
      logout();
    }
    return response;
  };
})();
function isAdmin(){const u=getCurrentUser();return u&&String(u.role||"").toUpperCase()==="ADMIN";}
function isUserRole(){const u=getCurrentUser();return u&&String(u.role||"").toUpperCase()==="USER";}
function isAdminOrAbove(role){const r=String(role||"").toUpperCase().replace(/\s+/g,"_");return r==="ADMIN"||r==="SUPER_ADMIN";}
function isSuperAdminRole(role){return String(role||"").toUpperCase().replace(/\s+/g,"_")==="SUPER_ADMIN";}
function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[char]));
}
function getUserInitials(name){
  const parts=String(name||"U").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0,2).map(part=>part[0]).join("").toUpperCase()||"U";
}
function renderUserProfile() {
  const user = getCurrentUser();
  const container = document.getElementById("userProfile");

  if (!user || !container) return;

  const userName = escapeHTML(user.nama || "-");
  const userTitle = escapeHTML(user.jabatan || "-");
  const userCompany = escapeHTML(user.perusahaan || "-");
  const userRole = escapeHTML(String(user.role || "USER").toUpperCase());
  const userInitials = escapeHTML(getUserInitials(user.nama));

  const installStyle = deferredPrompt ? "display: flex;" : "display: none;";

  // Di app-layout, info user sudah ada di sidebar — dropdown cukup tombol aksi
  const inAppLayout = !!document.querySelector('.app-layout');

  container.innerHTML = `
    <button class="user-menu-button" type="button" onclick="toggleUserMenu()" aria-haspopup="true" aria-expanded="false" aria-controls="userMenuDropdown">
      <span class="user-avatar" aria-hidden="true">${userInitials}</span>
      <span class="user-menu-label">${userName}</span>
      <i class="fa-solid fa-chevron-down user-menu-chevron" aria-hidden="true"></i>
    </button>

    <div id="userMenuDropdown" class="user-menu-dropdown" role="menu">
      ${!inAppLayout ? `
        <div class="user-name">${userName}</div>
        <div class="user-role-badge">${userRole}</div>
        <div class="user-title">${userTitle}</div>
        <div class="user-company">${userCompany}</div>
        <div class="user-divider"></div>
      ` : ''}

      <button id="btnInstallPwa" class="btn-install-pwa" type="button" onclick="installPwaApp()" role="menuitem" style="${installStyle}">
        <i class="fa-solid fa-download" aria-hidden="true"></i>
        <span>Instal Aplikasi</span>
      </button>

      <button class="btn-change-password" type="button" onclick="openChangePasswordModal()" role="menuitem">
        <i class="fa-solid fa-key" aria-hidden="true"></i>
        <span>Ganti Password</span>
      </button>

      <button class="btn-logout" type="button" onclick="confirmLogout()" role="menuitem">
        <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>
        <span>Logout</span>
      </button>
    </div>
  `;
}

function toggleUserMenu() {
  if (typeof closeNotificationMenu === "function") {
    closeNotificationMenu();
  }
  const menu = document.getElementById("userProfile");
  if (menu) {
    const isOpen = menu.classList.toggle("open");
    const button = menu.querySelector(".user-menu-button");
    button?.setAttribute("aria-expanded", String(isOpen));
  }
}

function closeUserMenu() {
  const menu = document.getElementById("userProfile");
  if (!menu) return;
  menu.classList.remove("open");
  menu.querySelector(".user-menu-button")?.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", function (e) {
  const menu = document.getElementById("userProfile");
  if (menu && !menu.contains(e.target)) {
    closeUserMenu();
  }
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeUserMenu();
  }
});

// ===== GANTI PASSWORD =====
function _cpToggleVis(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
}

function openChangePasswordModal() {
  closeUserMenu();
  let modal = document.getElementById('changePasswordModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'changePasswordModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:999999;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.65);box-sizing:border-box;font-family:Inter,system-ui,sans-serif;';
    modal.addEventListener('click', e => { if (e.target === modal) closeChangePasswordModal(); });

    const S = {
      box:   'position:relative;background:#fff;border-radius:20px;width:min(440px,100%);box-shadow:0 32px 80px rgba(0,0,0,.35);overflow:hidden;',
      hdr:   'display:flex;align-items:center;gap:14px;padding:22px 22px 18px;border-bottom:1px solid #e8edf5;',
      icon:  'width:44px;height:44px;border-radius:12px;background:#eff6ff;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;',
      titWrap:'flex:1;min-width:0;',
      tit:   'margin:0;font-size:1.05rem;font-weight:700;color:#0f172a;',
      sub:   'margin:3px 0 0;font-size:.78rem;color:#64748b;',
      close: 'background:none;border:none;color:#94a3b8;font-size:1.1rem;cursor:pointer;padding:6px 8px;border-radius:8px;line-height:1;flex-shrink:0;',
      body:  'padding:22px;',
      field: 'margin-bottom:16px;',
      lbl:   'display:block;font-size:.78rem;font-weight:600;margin-bottom:7px;color:#475569;',
      wrap:  'position:relative;display:flex;align-items:center;',
      inp:   'flex:1;padding:11px 44px 11px 13px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:.9rem;color:#0f172a;background:#fff;box-sizing:border-box;width:100%;font-family:inherit;outline:none;transition:border-color .2s;',
      eye:   'position:absolute;right:11px;background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;font-size:.88rem;line-height:1;',
      msg:   'font-size:.8rem;color:#ef4444;min-height:18px;margin:0 0 14px;',
      acts:  'display:flex;gap:10px;justify-content:flex-end;margin-top:6px;',
      cancel:'padding:10px 20px;border:1.5px solid #e2e8f0;background:#fff;border-radius:10px;cursor:pointer;font-weight:600;font-size:.85rem;color:#475569;font-family:inherit;',
      save:  'display:flex;align-items:center;gap:7px;padding:10px 22px;background:#F2A900;color:#00205B;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:.85rem;font-family:inherit;',
    };

    const field = (id, lbl, ph, ac) => `
      <div style="${S.field}">
        <label for="${id}" style="${S.lbl}">${lbl}</label>
        <div style="${S.wrap}">
          <input type="password" id="${id}" placeholder="${ph}" autocomplete="${ac}"
            style="${S.inp}"
            onfocus="this.style.borderColor='#3b82f6';this.style.boxShadow='0 0 0 3px rgba(59,130,246,.12)'"
            onblur="this.style.borderColor='#e2e8f0';this.style.boxShadow='none'">
          <button type="button" style="${S.eye}" onclick="_cpToggleVis('${id}',this)" aria-label="Tampilkan password">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
      </div>`;

    modal.innerHTML = `
      <div style="${S.box}" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
        <div style="${S.hdr}">
          <span style="${S.icon}"><i class="fa-solid fa-lock"></i></span>
          <div style="${S.titWrap}">
            <h3 id="cpTitle" style="${S.tit}">Ganti Password</h3>
            <p style="${S.sub}">Password baru minimal 8 karakter</p>
          </div>
          <button style="${S.close}" onclick="closeChangePasswordModal()" aria-label="Tutup"
            onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div style="${S.body}">
          ${field('cpOld',    'Password Saat Ini',        'Masukkan password saat ini', 'current-password')}
          ${field('cpNew',    'Password Baru',            'Minimal 8 karakter',         'new-password')}
          ${field('cpConfirm','Konfirmasi Password Baru', 'Ulangi password baru',       'new-password')}
          <p id="cpMsg" style="${S.msg}"></p>
          <div style="${S.acts}">
            <button type="button" style="${S.cancel}" onclick="closeChangePasswordModal()"
              onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">Batal</button>
            <button type="button" id="cpSubmitBtn" style="${S.save}" onclick="submitChangePassword()"
              onmouseover="this.style.background='#d99500'" onmouseout="this.style.background='#F2A900'">
              <i class="fa-solid fa-floppy-disk"></i> Simpan
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('cpOld').value = '';
  document.getElementById('cpNew').value = '';
  document.getElementById('cpConfirm').value = '';
  const msg = document.getElementById('cpMsg');
  msg.textContent = '';
  msg.style.color = '#ef4444';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('cpOld')?.focus(), 100);
}

function closeChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.style.display = 'none';
}

async function submitChangePassword() {
  const oldPw  = document.getElementById('cpOld').value.trim();
  const newPw  = document.getElementById('cpNew').value.trim();
  const confirm = document.getElementById('cpConfirm').value.trim();
  const msg = document.getElementById('cpMsg');

  msg.className = 'cp-msg';
  if (!oldPw || !newPw || !confirm) { msg.textContent = 'Semua kolom wajib diisi.'; return; }
  if (newPw.length < 8) { msg.textContent = 'Password baru minimal 8 karakter.'; return; }
  if (newPw !== confirm) { msg.textContent = 'Konfirmasi password tidak cocok.'; return; }

  const btn = document.getElementById('cpSubmitBtn');
  btn.disabled = true;
  btn.style.opacity = '.6';
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

  try {
    const res = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'changePassword', data: { old_password: oldPw, new_password: newPw } })
    });
    const result = await res.json();
    if (result.status !== 'success') throw new Error(result.message);
    window.__onesapForcePw = false;
    document.getElementById('forcePwBanner')?.remove();
    document.querySelectorAll('.pw-force-dot').forEach(el => el.remove());
    msg.style.color = '#16a34a';
    msg.textContent = 'Password berhasil diubah! Silakan login ulang.';
    setTimeout(() => { logout(); }, 2000);
  } catch (err) {
    msg.textContent = err.message || 'Gagal mengubah password.';
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
  }
}

// Force password change jika login dengan password lemah/default
document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('onesap_force_pw')) {
    window.__onesapForcePw = true;
    sessionStorage.removeItem('onesap_force_pw');
    const banner = document.createElement('div');
    banner.id = 'forcePwBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:#fff;' +
      'padding:10px 16px;font-size:.85rem;font-weight:600;text-align:center;';
    banner.innerHTML = '⚠️ Password kamu terlalu lemah atau masih default. Wajib ganti sekarang. Klik ikon kunci di sidebar.';
    document.body.prepend(banner);
    setTimeout(() => {
      if (typeof openChangePasswordModal === 'function') openChangePasswordModal();
    }, 500);
  }
});

// Register Service Worker for PWA offline capability
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then((reg) => {
        console.log("Service Worker registered successfully:", reg.scope);
        // Force update check on load to detect new version immediately
        reg.update();
      })
      .catch((err) => console.warn("Service Worker registration failed:", err));
  });

  // Reload page when new service worker takes control (via skipWaiting)
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
