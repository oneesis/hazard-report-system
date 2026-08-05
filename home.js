document.addEventListener('DOMContentLoaded', initHomePage);

let _currentObj = null;

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
    const [reports, obj] = await Promise.all([refreshNotifications(), fetchMyObj()]);
    _currentObj = obj;

    renderActionBanner(reports);
    renderMyReports(reports);
    renderQuickStats(reports);
    renderSapAchievement(reports, obj);

    // search filter
    let _allReports = reports;
    document.getElementById('myReportsSearch')?.addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      renderMyReports(_allReports, q);
    });

    // update saat auto-refresh dari layout.js
    document.addEventListener('reportsRefreshed', e => {
      _allReports = e.detail;
      const q = (document.getElementById('myReportsSearch')?.value || '').trim().toLowerCase();
      renderActionBanner(e.detail);
      renderMyReports(e.detail, q);
      renderQuickStats(e.detail);
      renderSapAchievement(e.detail, _currentObj);
    });
  } catch (e) {
    console.error('Home load error', e);
    const el = document.getElementById('myReportsList');
    if (el) el.innerHTML = '<p class="reports-loading">Gagal memuat laporan.</p>';
  }
}

async function fetchMyObj() {
  try {
    const res = await fetch('/api?action=getMyObj');
    if (!res.ok) return null;
    const json = await res.json();
    return json.status === 'success' ? json.data : null;
  } catch { return null; }
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

function renderMyReports(reports, query = '') {
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
  const sorted = pool.sort((a, b) => getTs(b) - getTs(a));
  const recent = query
    ? sorted.filter(r => {
        const id   = (getReportId(r) || '').toLowerCase();
        const desc = (r.deskripsi_bahaya || r.temuan || '').toLowerCase();
        return id.includes(query) || desc.includes(query);
      }).slice(0, 10)
    : sorted.slice(0, 5);

  if (!recent.length) {
    el.innerHTML = `<div class="reports-empty">
      <i class="fa-regular fa-folder-open"></i>
      ${query ? 'Tidak ada laporan yang cocok' : 'Belum ada laporan'}
    </div>`;
    return;
  }

  el.innerHTML = recent.map(r => {
    const status  = (getReportStatus(r) || 'OPEN').toUpperCase();
    const id      = escapeHTML(getReportId(r) || '-');
    const desc    = escapeHTML((r.deskripsi_bahaya || r.temuan || '-').substring(0, 60));
    const dateVal = r.tanggal_laporan || r.tgl_laporan || r.tanggal_inspeksi || r.timestamp || '';
    const date    = dateVal ? new Date(dateVal).toLocaleDateString('id-ID', { day:'2-digit', month:'short' }) : '';
    const due     = r.batas_waktu || r.due_date || '';
    const dueDate = due ? new Date(due) : null;
    const isOverdue = dueDate && !isNaN(dueDate) && status !== 'CLOSED' && dueDate < new Date();
    const dotCls  = `dot-${status.toLowerCase()}`;
    const badgeCls = `badge-${status.toLowerCase()}`;
    return `<a class="report-item${isOverdue ? ' report-item--overdue' : ''}" href="laporan-detail.html?id=${encodeURIComponent(getReportId(r) || '')}">
      <div class="report-item-dot ${dotCls}"></div>
      <div class="report-item-body">
        <div class="report-item-id">${id}${isOverdue ? ' <span class="overdue-tag">OVERDUE</span>' : ''}</div>
        <div class="report-item-desc">${desc}</div>
        ${date ? `<div class="report-item-meta">${date}</div>` : ''}
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
        <button onclick="event.preventDefault();event.stopPropagation();deleteHazardDraft()" title="Hapus draft" style="margin-left:8px;background:none;border:none;cursor:pointer;color:#ef4444;font-size:1rem;padding:4px 6px;border-radius:6px;line-height:1">
          <i class="fa-solid fa-trash"></i>
        </button>
      </a>`;
    section.style.display = '';
  } catch { section.style.display = 'none'; }
}

function deleteHazardDraft() {
  localStorage.removeItem('hazard_draft');
  const section = document.getElementById('hazardDraftSection');
  if (section) section.style.display = 'none';
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

  const rencana = [], review = [], closing = [], rejected = [];

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

    if (asPic && planStatus === 'rejected')         rejected.push(r);
    if (asPic && status === 'OPEN' && !planStatus)  rencana.push(r);
    if (asRep && planStatus === 'pending_review')    review.push(r);
    if (asPic && planStatus === 'approved')          closing.push(r);
  }

  const items = [];
  if (rejected.length) items.push({ reports: rejected, label: 'rencana kamu ditolak, perlu revisi segera', color: 'red', icon: 'fa-circle-xmark' });
  if (rencana.length)  items.push({ reports: rencana,  label: 'menunggu rencana tindakan kamu', color: 'orange', icon: 'fa-pen-to-square' });
  if (review.length)   items.push({ reports: review,   label: 'rencana PIC menunggu review kamu', color: 'blue', icon: 'fa-magnifying-glass' });
  if (closing.length)  items.push({ reports: closing,  label: 'siap untuk closing kamu', color: 'green', icon: 'fa-flag-checkered' });
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
    const desc = escapeHTML((r.deskripsi_bahaya || r.temuan_inspeksi || r.temuan || '').substring(0, 45) || '-');
    const href = `laporan-detail.html?id=${encodeURIComponent(getReportId(r) || '')}`;
    const due  = r.batas_waktu || r.due_date || '';
    const dueDate = due ? new Date(due) : null;
    const isOverdue = dueDate && !isNaN(dueDate) && dueDate < new Date();
    const dueStr = dueDate && !isNaN(dueDate)
      ? dueDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
      : '';
    return `<a href="${href}" class="ab-report-row${isOverdue ? ' ab-report-row--overdue' : ''}">
      <span class="ab-report-id">${id}</span>
      <span class="ab-report-desc">${desc}</span>
      ${dueStr ? `<span class="ab-report-due${isOverdue ? ' ab-report-due--over' : ''}">${isOverdue ? '⚠ ' : ''}${dueStr}</span>` : ''}
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

function renderSapAchievement(reports, obj) {
  const el = document.getElementById('sapAchievement');
  if (!el || !obj) { if (el) el.style.display = 'none'; return; }

  const user   = getCurrentUser();
  const myNik  = String(user?.nik  || '').trim();
  const myNama = String(user?.nama || '').trim().toLowerCase();
  const now    = new Date();
  const y = now.getFullYear(), m = now.getMonth();

  // Hanya laporan bulan ini di mana user adalah PELAPOR
  const mine = (reports || []).filter(r => {
    const rNik  = String(r.nik_pelapor || r.nik || '').trim();
    const rNama = String(r.nama || r.pelapor || '').trim().toLowerCase();
    if (!((myNik && rNik === myNik) || (myNama && rNama === myNama))) return false;
    const d = new Date(r.timestamp || r.tanggal_laporan || r.tgl_laporan || r.tanggal_inspeksi || '');
    return !isNaN(d) && d.getFullYear() === y && d.getMonth() === m;
  });

  const hrCount  = mine.filter(r => r.report_type === 'HAZARD').length;
  const insCount = mine.filter(r => r.report_type === 'INSPECTION').length;

  const rows = [
    { label: 'Hazard Report', icon: 'fa-triangle-exclamation', count: hrCount,  target: obj.hr  },
    { label: 'Inspeksi',      icon: 'fa-clipboard-check',       count: insCount, target: obj.ins },
    { label: 'SBO',           icon: 'fa-eye',                   count: 0,        target: obj.sbo },
    { label: 'Personal Contact', icon: 'fa-handshake',           count: 0,        target: obj.pc  },
  ].filter(r => r.target > 0);

  if (!rows.length) { el.style.display = 'none'; return; }

  const pct      = (c, t) => t > 0 ? Math.min(100, Math.round(c / t * 100)) : 0;
  const barColor = p => p >= 100 ? '#22c55e' : p >= 50 ? '#F2A900' : '#3b82f6';

  el.style.display = '';
  el.innerHTML = `
    <div class="sap-ach-card">
      <div class="sap-ach-header">
        <span class="sap-ach-title"><i class="fa-solid fa-trophy"></i> Capaian SAP Bulan Ini</span>
        <span class="sap-ach-month">${MONTHS_ID[m]} ${y}</span>
      </div>
      <div class="sap-ach-rows">
        ${rows.map(r => {
          const p     = pct(r.count, r.target);
          const color = barColor(p);
          const done  = p >= 100;
          return `<div class="sap-obj-row">
            <div class="sap-obj-label"><i class="fa-solid ${r.icon}"></i> ${r.label}</div>
            <div class="sap-obj-bar-wrap">
              <div class="sap-obj-bar" style="width:${p}%;background:${color}"></div>
            </div>
            <div class="sap-obj-count" style="color:${color}">${r.count}<span class="sap-obj-sep">/</span>${r.target}</div>
            ${done ? '<i class="fa-solid fa-circle-check sap-obj-done"></i>' : `<span class="sap-obj-pct">${p}%</span>`}
          </div>`;
        }).join('')}
      </div>
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
