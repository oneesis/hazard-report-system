// Shared sidebar layout — loaded after auth.js on all app pages

(function () {
  const PAGE_MAP = {
    'index-home.html':   'beranda',
    'index.html':        'hazard',
    'inspection.html':   'inspeksi',
    'inspection-form.html': 'inspeksi',
    'dashboard.html':    'dashboard',
    'admin.html':        'admin-user',
    'laporan-admin.html':'laporan',
    'eskalasi.html':     'eskalasi',
    'laporan-detail.html':'laporan-detail',
  };

  const PAGE_TITLES = {
    'beranda':        'Beranda',
    'hazard':         'Hazard Report',
    'inspeksi':       'Inspeksi',
    'dashboard':      'Dashboard',
    'admin-user':     'Manajemen User',
    'laporan':        'Manajemen Laporan',
    'eskalasi':       'Monitoring Eskalasi',
    'laporan-detail': 'Detail Laporan',
  };

  function getActivePage() {
    const file = window.location.pathname.split('/').pop() || 'index-home.html';
    return PAGE_MAP[file] || '';
  }

  function navItem(href, iconClass, label, key, active) {
    return `<a href="${href}" class="sidebar-nav-item${active === key ? ' active' : ''}">
      <i class="fa-solid ${iconClass}"></i>
      <span>${label}</span>
    </a>`;
  }

  function renderSidebar() {
    const el = document.getElementById('appSidebar');
    if (!el) return;

    const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
    const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const active = getActivePage();

    const initials = user?.nama
      ? String(user.nama).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
      : 'U';

    const safe = v => String(v ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

    el.innerHTML = `
      <a href="index-home.html" class="sidebar-brand">
        <img src="assets/Logo EBL.png" alt="Logo" class="sidebar-logo">
        <div>
          <div class="sidebar-brand-name">ONE-SAP</div>
          <div class="sidebar-brand-sub">Safety Accountability Program</div>
        </div>
      </a>

      <nav class="sidebar-nav">
        ${navItem('index-home.html', 'fa-house',              'Beranda',       'beranda',   active)}
        ${navItem('index.html',      'fa-triangle-exclamation','Hazard Report','hazard',    active)}
        ${navItem('inspection.html', 'fa-list-check',          'Inspeksi',      'inspeksi',  active)}
        ${navItem('dashboard.html',  'fa-chart-simple',        'Dashboard',     'dashboard', active)}
      </nav>

      ${isAdmin ? `
      <div class="sidebar-section-label">Admin Management</div>
      <nav class="sidebar-nav">
        ${navItem('admin.html',         'fa-users-gear',      'Manajemen User',    'admin-user', active)}
        ${navItem('laporan-admin.html', 'fa-file-lines',      'Manajemen Laporan', 'laporan',    active)}
        ${navItem('eskalasi.html',      'fa-circle-exclamation','Eskalasi',        'eskalasi',   active)}
      </nav>` : ''}

      <div class="sidebar-spacer"></div>

      <div class="sidebar-user-card">
        <div class="sidebar-user-avatar">${safe(initials)}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${safe(user?.nama || 'User')}</div>
          <div class="sidebar-user-role">${safe(role || 'USER')}</div>
        </div>
        <div class="sidebar-user-actions">
          <div id="${window.innerWidth > 768 ? 'notificationBell' : 'notificationBellSidebar'}" class="sidebar-notif-bell"></div>
          <button class="sidebar-logout-btn" onclick="openChangePasswordModal()" title="Ganti Password">
            <i class="fa-solid fa-key"></i>
          </button>
          <button class="sidebar-logout-btn" onclick="confirmLogout()" title="Logout">
            <i class="fa-solid fa-arrow-right-from-bracket"></i>
          </button>
        </div>
      </div>`;

    // Update mobile topbar title
    const titleEl = document.getElementById('appTopbarTitle');
    if (titleEl) titleEl.textContent = PAGE_TITLES[active] || 'ONE-SAP';
  }

  function renderMobileNav() {
    const el = document.getElementById('mobileBottomNav');
    if (!el) return;

    const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
    const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const active = getActivePage();

    function mbnLink(href, icon, label, key) {
      return `<a href="${href}" class="mbn-item${active===key?' mbn-active':''}">
        <i class="fa-solid ${icon}"></i><span>${label}</span>
      </a>`;
    }

    el.innerHTML = `
      ${mbnLink('index-home.html','fa-house','Beranda','beranda')}
      <a href="index.html" class="mbn-item mbn-fab-item${active==='hazard'?' mbn-active':''}">
        <div class="mbn-fab-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <span>Lapor</span>
      </a>
      ${mbnLink('inspection.html','fa-list-check','Inspeksi','inspeksi')}
      ${mbnLink('dashboard.html','fa-chart-simple','Dashboard','dashboard')}
    `;
  }

  // Toggle sidebar (mobile)
  window.toggleSidebar = function () {
    const sidebar = document.getElementById('appSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isOpen = sidebar?.classList.toggle('open');
    overlay?.classList.toggle('active', isOpen);
  };

  // Close sidebar when clicking overlay
  function injectAdminStrip() {
    const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
    const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return;
    const topbar = document.querySelector('.app-topbar');
    if (!topbar || topbar.previousElementSibling?.classList.contains('app-admin-strip')) return;
    const strip = document.createElement('div');
    strip.className = 'app-admin-strip';
    strip.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Admin';
    topbar.parentNode.insertBefore(strip, topbar);
  }

  window.openMobileProfileSheet = function () {
    let sheet = document.getElementById('__mobileProfileSheet');
    if (!sheet) {
      const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
      const role = String(user?.role || '').toUpperCase();
      const initials = user?.nama
        ? String(user.nama).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
        : 'U';
      const safe = v => String(v ?? '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

      sheet = document.createElement('div');
      sheet.id = '__mobileProfileSheet';
      sheet.className = 'profile-sheet-overlay';
      sheet.innerHTML = `
        <div class="profile-sheet">
          <div class="profile-sheet-handle"></div>
          <div class="profile-sheet-avatar">${safe(initials)}</div>
          <div class="profile-sheet-name">${safe(user?.nama || 'User')}</div>
          <div class="profile-sheet-role">${safe(role || 'USER')}</div>
          <div class="profile-sheet-actions">
            <button class="btn-secondary" onclick="document.getElementById('__mobileProfileSheet').style.display='none'; openChangePasswordModal()">
              <i class="fa-solid fa-key"></i> Ganti Password
            </button>
            <button class="btn-danger" onclick="document.getElementById('__mobileProfileSheet').style.display='none'; confirmLogout()">
              <i class="fa-solid fa-arrow-right-from-bracket"></i> Logout
            </button>
          </div>
        </div>`;
      sheet.addEventListener('click', e => { if (e.target === sheet) sheet.style.display = 'none'; });
      document.body.appendChild(sheet);
    }
    sheet.style.display = 'flex';
  };

  function closeSidebar() {
    document.getElementById('appSidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('active');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);

    // Swipe kiri untuk tutup sidebar
    let _touchStartX = 0;
    document.addEventListener('touchstart', e => { _touchStartX = e.touches[0].clientX; }, { passive: true });
    document.addEventListener('touchend', e => {
      const sidebar = document.getElementById('appSidebar');
      if (!sidebar?.classList.contains('open')) return;
      if (_touchStartX - e.changedTouches[0].clientX > 72) closeSidebar();
    }, { passive: true });

    renderSidebar();
    renderMobileNav();
    injectAdminStrip();
    if (typeof initNotificationBell === 'function') initNotificationBell();
    if (typeof refreshNotifications === 'function') refreshNotifications().catch(() => {});
  });
})();
