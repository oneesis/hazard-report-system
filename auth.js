function saveUserSession(user){localStorage.setItem("hazard_user",JSON.stringify(user));}
function getCurrentUser(){const d=localStorage.getItem("hazard_user");return d?JSON.parse(d):null;}
function requireLogin(){if(!getCurrentUser()) window.location.href="login.html";}
function logout(){localStorage.removeItem("hazard_user");window.location.href="login.html";}
function isAdmin(){const u=getCurrentUser();return u&&String(u.role||"").toUpperCase()==="ADMIN";}
function isUserRole(){const u=getCurrentUser();return u&&String(u.role||"").toUpperCase()==="USER";}
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
