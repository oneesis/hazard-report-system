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
          <div class="sidebar-brand-sub">Precision Logistics</div>
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
        <button class="sidebar-logout-btn" onclick="logout()" title="Logout">
          <i class="fa-solid fa-arrow-right-from-bracket"></i>
        </button>
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
      ${mbnLink('dashboard.html','fa-chart-simple','Dashboard','dashboard')}
      ${isAdmin
        ? mbnLink('laporan-admin.html','fa-shield-halved','Admin','laporan')
        : mbnLink('inspection.html','fa-list-check','Inspeksi','inspeksi')}
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
  document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('sidebarOverlay');
    overlay?.addEventListener('click', () => {
      document.getElementById('appSidebar')?.classList.remove('open');
      overlay.classList.remove('active');
    });

    renderSidebar();
    renderMobileNav();
  });
})();
