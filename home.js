document.addEventListener('DOMContentLoaded', initHomePage);

const INSPECTION_AREAS = [
  { type: 'INS_CB', name: 'Conveyor Belt',     sub: 'Area Produksi',    icon: 'fa-gears' },
  { type: 'INS_JA', name: 'Jalan Angkut',       sub: 'Main Hauling',     icon: 'fa-truck' },
  { type: 'INS_MD', name: 'Mess dan Dapur',     sub: 'Camp Utama',       icon: 'fa-utensils' },
  { type: 'INS_KG', name: 'Kantor & Gudang',    sub: 'Logistics Center', icon: 'fa-building' },
  { type: 'INS_SP', name: 'Settling Pond',      sub: 'Water Management', icon: 'fa-water' },
  { type: 'INS_TB', name: 'Tambang',            sub: 'Pit West Wing',    icon: 'fa-helmet-safety' },
  { type: 'INS_BB', name: 'Tangki BBM',         sub: 'Fuel Station',     icon: 'fa-gas-pump' },
  { type: 'INS_WS', name: 'Workshop',           sub: 'Maintenance Yard', icon: 'fa-wrench' },
];

const DAYS_ID  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

async function initHomePage() {
  renderGreeting();
  renderInsGrid();
  renderHazardDraft();
  initNotificationBell();

  try {
    const reports = await refreshNotifications();
    renderActionBanner(reports);
    renderMyReports(reports);
    renderQuickStats(reports);
  } catch (e) {
    console.error('Home load error', e);
    const el = document.getElementById('myReportsList');
    if (el) el.innerHTML = '<p class="reports-loading">Gagal memuat laporan.</p>';
  }
}

function renderGreeting() {
  const user = getCurrentUser();
  const now  = new Date();
  const h    = now.getHours();
  const greet = h < 11 ? 'Selamat Pagi' : h < 15 ? 'Selamat Siang' : h < 18 ? 'Selamat Sore' : 'Selamat Malam';
  const dateStr = `${DAYS_ID[now.getDay()]}, ${now.getDate()} ${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`;

  const dayEl  = document.getElementById('greetingDay');
  const nameEl = document.getElementById('greetingName');
  const badge  = document.getElementById('greetingBadge');

  if (dayEl)  dayEl.textContent  = dateStr;
  if (nameEl) nameEl.textContent = user?.nama ? `${greet}, ${user.nama.split(' ')[0]}` : greet;

  if (badge && user?.nama) {
    const initials = user.nama.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    badge.textContent = initials;
  }
}

function renderInsGrid() {
  const grid = document.getElementById('insGrid');
  if (!grid) return;
  grid.innerHTML = INSPECTION_AREAS.map(area => `
    <a class="ins-card" href="inspection-form.html?type=${area.type}" aria-label="${area.name}">
      <div class="ins-card-icon"><i class="fa-solid ${area.icon}"></i></div>
      <div class="ins-card-name">${area.name}</div>
      <div class="ins-card-sub">${area.sub}</div>
      <span class="ins-card-go">Mulai <i class="fa-solid fa-arrow-right"></i></span>
    </a>
  `).join('');
}

function renderMyReports(reports) {
  const el  = document.getElementById('myReportsList');
  if (!el) return;
  const user = getCurrentUser();

  const myNik  = String(user?.nik  || '').trim();
  const myNama = String(user?.nama || '').trim().toLowerCase();
  const pool = (reports || []).filter(r => {
    const rNik  = String(r.nik_pelapor || r.nik || '').trim();
    const rNama = String(r.nama || r.pelapor || '').trim().toLowerCase();
    return (myNik && rNik === myNik) || (myNama && rNama === myNama);
  });

  const getTs = r => {
    const v = r.timestamp || r.tanggal_laporan || r.tgl_laporan || r.tanggal_inspeksi || 0;
    const d = new Date(v);
    return isNaN(d) ? 0 : d.getTime();
  };
  const recent = pool.sort((a, b) => getTs(b) - getTs(a)).slice(0, 5);

  if (!recent.length) {
    el.innerHTML = `<div class="reports-empty">
      <i class="fa-regular fa-folder-open"></i>
      Belum ada laporan
    </div>`;
    return;
  }

  el.innerHTML = recent.map(r => {
    const status  = (getReportStatus(r) || 'OPEN').toUpperCase();
    const id      = escapeHTML(getReportId(r) || '-');
    const desc    = escapeHTML((r.deskripsi_bahaya || r.temuan || '-').substring(0, 60));
    const date    = r.tanggal_laporan ? new Date(r.tanggal_laporan).toLocaleDateString('id-ID', { day:'2-digit', month:'short' }) : '-';
    const dotCls  = `dot-${status.toLowerCase()}`;
    const badgeCls = `badge-${status.toLowerCase()}`;
    return `<a class="report-item" href="laporan-detail.html?id=${encodeURIComponent(getReportId(r) || '')}">
      <div class="report-item-dot ${dotCls}"></div>
      <div class="report-item-body">
        <div class="report-item-id">${id}</div>
        <div class="report-item-desc">${desc}</div>
        <div class="report-item-meta">${date}</div>
      </div>
      <span class="report-item-badge ${badgeCls}">${status}</span>
    </a>`;
  }).join('');
}

function renderHazardDraft() {
  const section = document.getElementById('hazardDraftSection');
  const card    = document.getElementById('hazardDraftCard');
  if (!section || !card) return;
  try {
    const raw = localStorage.getItem('hazard_draft');
    if (!raw) { section.style.display = 'none'; return; }
    const d = JSON.parse(raw);
    const saved = d._savedAt ? new Date(d._savedAt) : null;
    const timeAgo = saved ? (() => {
      const m = Math.floor((Date.now() - saved) / 60000);
      if (m < 1) return 'Baru saja';
      if (m < 60) return `${m} menit lalu`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h} jam lalu`;
      return `${Math.floor(h / 24)} hari lalu`;
    })() : '';
    const lokasi = d.detail_lokasi_bahaya || d.lokasi_bahaya || '';
    const desc   = d.deskripsi_bahaya || '';
    card.innerHTML = `
      <a href="index.html" class="hazard-draft-card">
        <div class="hazard-draft-card-icon"><i class="fa-solid fa-pen-ruler"></i></div>
        <div class="hazard-draft-card-body">
          <div class="hazard-draft-card-title">${lokasi ? escapeHTML(lokasi.substring(0,40)) : 'Draft Hazard Report'}</div>
          <div class="hazard-draft-card-meta">
            ${desc ? `<span>${escapeHTML(desc.substring(0,40))}…</span>` : ''}
            <span>Step ${d._currentStep || 1}/6</span>
            ${timeAgo ? `<span>${timeAgo}</span>` : ''}
          </div>
        </div>
        <span class="hazard-draft-card-cta">Lanjutkan <i class="fa-solid fa-arrow-right"></i></span>
      </a>`;
    section.style.display = '';
  } catch { section.style.display = 'none'; }
}

function renderQuickStats(reports) {
  const user   = getCurrentUser();
  const myNik  = String(user?.nik  || '').trim();
  const myNama = String(user?.nama || '').trim().toLowerCase();
  const pool   = (reports || []).filter(r => {
    const rNik  = String(r.nik_pelapor || r.nik || '').trim();
    const rNama = String(r.nama || r.pelapor || '').trim().toLowerCase();
    return (myNik && rNik === myNik) || (myNama && rNama === myNama);
  });

  const total   = pool.length;
  const open    = pool.filter(r => getReportStatus(r) === 'OPEN').length;
  const closed  = pool.filter(r => getReportStatus(r) === 'CLOSED').length;
  const overdue = pool.filter(r => {
    const due = r.due_date || r.tanggal_due;
    return due && getReportStatus(r) !== 'CLOSED' && new Date(due) < new Date();
  }).length;

  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  set('qsTotal',  total);
  set('qsOpen',   open);
  set('qsClosed', closed);
  set('qsOverdue',overdue);

  // Also fill mobile daily summary
  const sum = document.getElementById('dailySummary');
  if (sum && window.innerWidth <= 700) {
    sum.style.display = '';
    set('dailyClosed', closed);
    set('dailyOpen',   open);
  }
}

function computeActionItems(reports, user) {
  const nik  = String(user?.nik  || '').trim().toLowerCase();
  const nama = String(user?.nama || '').trim().toLowerCase();
  const wa   = String(user?.no_whatsapp || '').replace(/\D/g, '');

  const rencana = [], review = [], closing = [];

  for (const r of (reports || [])) {
    const status     = String(r.status_perbaikan || 'OPEN').toUpperCase();
    const planStatus = String(r.plan_status || '').trim().toLowerCase();
    if (status === 'CLOSED') continue;

    const nikPic  = String(r.nik_pic  || '').trim().toLowerCase();
    const namaPic = String(r.nama_pic || '').trim().toLowerCase();
    const waPic   = String(r.no_whatsapp_pic || '').replace(/\D/g, '');
    const asPic   = (nik && nikPic === nik) || (wa && waPic && waPic === wa) || (nama && namaPic === nama);

    const nikRep  = String(r.nik  || r.nik_pelapor  || '').trim().toLowerCase();
    const namaRep = String(r.nama || r.nama_pelapor || '').trim().toLowerCase();
    const asRep   = (nik && nikRep === nik) || (nama && namaRep === nama);

    if (asPic && status === 'OPEN' && !planStatus) rencana.push(r);
    if (asRep && planStatus === 'pending_review')   review.push(r);
    if (asPic && planStatus === 'approved')         closing.push(r);
  }

  const items = [];
  if (rencana.length) items.push({ reports: rencana, label: 'menunggu rencana tindakan kamu', color: 'orange', icon: 'fa-pen-to-square' });
  if (review.length)  items.push({ reports: review,  label: 'rencana PIC menunggu review kamu', color: 'blue', icon: 'fa-magnifying-glass' });
  if (closing.length) items.push({ reports: closing, label: 'siap untuk closing kamu', color: 'green', icon: 'fa-flag-checkered' });
  return items;
}

function renderActionBanner(reports) {
  const el = document.getElementById('actionBanner');
  if (!el) return;
  const user  = getCurrentUser();
  const items = computeActionItems(reports, user);
  if (!items.length) { el.style.display = 'none'; return; }

  const reportRow = r => {
    const id   = escapeHTML(getReportId(r) || '-');
    const desc = escapeHTML((r.deskripsi_bahaya || r.temuan_inspeksi || r.temuan || '').substring(0, 55) || '-');
    const href = `laporan-detail.html?id=${encodeURIComponent(getReportId(r) || '')}`;
    return `<a href="${href}" class="ab-report-row">
      <span class="ab-report-id">${id}</span>
      <span class="ab-report-desc">${desc}</span>
      <i class="fa-solid fa-arrow-right"></i>
    </a>`;
  };

  el.style.display = '';
  el.innerHTML = `<div class="action-banner">
    <div class="action-banner-title"><i class="fa-solid fa-circle-exclamation"></i> Perlu Tindakan Kamu</div>
    ${items.map((it, i) => `
      <div class="action-banner-item action-banner-item--${it.color}" data-ab="${i}">
        <div class="ab-header" onclick="toggleActionItem(${i})">
          <span class="action-banner-count">${it.reports.length}</span>
          <span class="action-banner-label"><i class="fa-solid ${it.icon}"></i> ${it.reports.length} laporan ${it.label}</span>
          <i class="fa-solid fa-chevron-down ab-chevron"></i>
        </div>
        <div class="ab-list" style="display:none">
          ${it.reports.map(reportRow).join('')}
        </div>
      </div>`).join('')}
  </div>`;
}

window.toggleActionItem = function(idx) {
  const item = document.querySelector(`.action-banner-item[data-ab="${idx}"]`);
  if (!item) return;
  const list    = item.querySelector('.ab-list');
  const chevron = item.querySelector('.ab-chevron');
  const open    = list.style.display === 'none';
  list.style.display    = open ? '' : 'none';
  chevron.style.transform = open ? 'rotate(180deg)' : '';
};
