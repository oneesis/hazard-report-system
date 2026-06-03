function saveUserSession(user){localStorage.setItem("hazard_user",JSON.stringify(user));}
function getCurrentUser(){const d=localStorage.getItem("hazard_user");return d?JSON.parse(d):null;}
function requireLogin(){if(!getCurrentUser()) window.location.href="login.html";}
function logout(){localStorage.removeItem("hazard_user");window.location.href="login.html";}
function isAdmin(){const u=getCurrentUser();return u&&String(u.role||"").toUpperCase()==="ADMIN";}
function isUserRole(){const u=getCurrentUser();return u&&String(u.role||"").toUpperCase()==="USER";}
function renderUserProfile() {
  const user = getCurrentUser();
  const container = document.getElementById("userProfile");

  if (!user || !container) return;

  container.innerHTML = `
    <div class="user-menu-button" onclick="toggleUserMenu()">
      <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm6 7c0-1.66-3.33-2.5-6-2.5S6 17.34 6 19v1h12v-1z"/></svg></span>
      ${user.nama || "-"} v
    </div>

    <div class="user-menu-dropdown">
      <div class="user-name">${user.nama || "-"}</div>
      <div class="user-title">${user.jabatan || "-"}</div>
      <div class="user-company">${user.perusahaan || "-"}</div>
      <div class="user-role">Role: ${user.role || "USER"}</div>

      <div class="user-divider"></div>

      <button class="btn-logout" onclick="logout()">
        Logout
      </button>
    </div>
  `;
}

function toggleUserMenu() {
  const menu = document.getElementById("userProfile");
  if (menu) {
    menu.classList.toggle("open");
  }
}

document.addEventListener("click", function (e) {
  const menu = document.getElementById("userProfile");
  if (menu && !menu.contains(e.target)) {
    menu.classList.remove("open");
  }
});
