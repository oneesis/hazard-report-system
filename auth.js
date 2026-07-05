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
function isAdminOrAbove(role){const r=String(role||"").toUpperCase();return r==="ADMIN"||r==="SUPER_ADMIN";}
function isSuperAdminRole(role){return String(role||"").toUpperCase()==="SUPER_ADMIN";}
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

  container.innerHTML = `
    <button class="user-menu-button" type="button" onclick="toggleUserMenu()" aria-haspopup="true" aria-expanded="false" aria-controls="userMenuDropdown">
      <span class="user-avatar" aria-hidden="true">${userInitials}</span>
      <span class="user-menu-label">${userName}</span>
      <i class="fa-solid fa-chevron-down user-menu-chevron" aria-hidden="true"></i>
    </button>

    <div id="userMenuDropdown" class="user-menu-dropdown" role="menu">
      <div class="user-name">${userName}</div>
      <div class="user-role-badge">${userRole}</div>
      <div class="user-title">${userTitle}</div>
      <div class="user-company">${userCompany}</div>

      <div class="user-divider"></div>

      <button id="btnInstallPwa" class="btn-install-pwa" type="button" onclick="installPwaApp()" role="menuitem" style="${installStyle}">
        <i class="fa-solid fa-download" aria-hidden="true"></i>
        <span>Instal Aplikasi</span>
      </button>

      <button class="btn-change-password" type="button" onclick="openChangePasswordModal()" role="menuitem">
        <i class="fa-solid fa-key" aria-hidden="true"></i>
        <span>Ganti Password</span>
      </button>

      <button class="btn-logout" type="button" onclick="logout()" role="menuitem">
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
function openChangePasswordModal() {
  closeUserMenu();
  let modal = document.getElementById('changePasswordModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'changePasswordModal';
    modal.innerHTML = `
      <div class="cp-overlay" onclick="closeChangePasswordModal()"></div>
      <div class="cp-box" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
        <h3 id="cpTitle"><i class="fa-solid fa-key"></i> Ganti Password</h3>
        <div class="cp-field">
          <label>Password Lama</label>
          <input type="password" id="cpOld" placeholder="Password saat ini" autocomplete="current-password">
        </div>
        <div class="cp-field">
          <label>Password Baru</label>
          <input type="password" id="cpNew" placeholder="Minimal 6 karakter" autocomplete="new-password">
        </div>
        <div class="cp-field">
          <label>Konfirmasi Password Baru</label>
          <input type="password" id="cpConfirm" placeholder="Ulangi password baru" autocomplete="new-password">
        </div>
        <p id="cpMsg" class="cp-msg"></p>
        <div class="cp-actions">
          <button type="button" class="cp-btn-cancel" onclick="closeChangePasswordModal()">Batal</button>
          <button type="button" class="cp-btn-submit" onclick="submitChangePassword()">Simpan</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('cpOld').value = '';
  document.getElementById('cpNew').value = '';
  document.getElementById('cpConfirm').value = '';
  document.getElementById('cpMsg').textContent = '';
  document.getElementById('cpMsg').className = 'cp-msg';
  modal.style.display = 'flex';
  document.getElementById('cpOld').focus();
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
  if (newPw.length < 6) { msg.textContent = 'Password baru minimal 6 karakter.'; return; }
  if (newPw !== confirm) { msg.textContent = 'Konfirmasi password tidak cocok.'; return; }

  const btn = document.querySelector('.cp-btn-submit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    const res = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'changePassword', data: { old_password: oldPw, new_password: newPw } })
    });
    const result = await res.json();
    if (result.status !== 'success') throw new Error(result.message);
    msg.className = 'cp-msg cp-success';
    msg.textContent = 'Password berhasil diubah! Silakan login ulang.';
    setTimeout(() => { logout(); }, 2000);
  } catch (err) {
    msg.textContent = err.message || 'Gagal mengubah password.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan';
  }
}

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
