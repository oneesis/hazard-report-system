// Manajemen Laporan — card-based redesign

let lmReports  = [];
let lmFiltered = [];
let lmPage     = 1;
let lmActiveTab = 'semua';
const LM_PAGE_SIZE = 25;

document.addEventListener('DOMContentLoaded', initLaporan);

async function initLaporan() {
  try {
    const user = getCurrentUser();
    lmReports = await fetchAllReports();

    if (!isSuperAdminRole(user?.role)) {
      const myPerusahaan = String(user?.perusahaan || '').trim().toLowerCase();
      const myNama = String(user?.nama || '').trim().toLowerCase();
      const myNik  = String(user?.nik  || '').trim().toLowerCase();
      lmReports = lmReports.filter(r => {
        const rPerusahaan = String(r.perusahaan || r.company || '').trim().toLowerCase();
        const rPic        = String(r.nama_pic || r.pic || '').trim().toLowerCase();
        const rNikPic     = String(r.nik_pic || '').trim().toLowerCase();
        return (myPerusahaan && rPerusahaan === myPerusahaan) ||
               (myNama && rPic === myNama) ||
               (myNik  && rNikPic === myNik);
      });
    }

    window.__reportsCache = lmReports;
    populateDeptFilter();
    _lmRestoreFilter(); // #6 — restore filter sebelumnya
    lmRender();
    wireFilters();
  } catch (e) {
    const el = document.getElementById('reportCardList');
    if (el) el.innerHTML = `<div class="lm-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Gagal memuat data. ${escapeHTML(e.message || '')}</p></div>`;
  }
}

function populateDeptFilter() {
  const sel = document.getElementById('deptFilter');
  if (!sel) return;
  const depts = [...new Set(
    lmReports.map(r => (r.departemen || r.department || '').trim()).filter(Boolean)
  )].sort();
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    sel.appendChild(opt);
  });
}

const _LM_FILTER_KEY = () => 'lm_filter_' + (getCurrentUser()?.nik || 'guest');
function _lmSaveFilter() {
  try {
    const state = {};
    ['searchInput','statusFilter','typeFilter','deptFilter','slaFilter','dateRange','sortSelect']
      .forEach(id => { const el = document.getElementById(id); if (el) state[id] = el.value; });
    sessionStorage.setItem(_LM_FILTER_KEY(), JSON.stringify(state));
  } catch {}
}
function _lmRestoreFilter() {
  try {
    const state = JSON.parse(sessionStorage.getItem(_LM_FILTER_KEY()) || '{}');
    Object.entries(state).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val) el.value = val;
    });
  } catch {}
}

function wireFilters() {
  ['searchInput','statusFilter','typeFilter','deptFilter','slaFilter','dateRange'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { lmPage = 1; _lmSaveFilter(); lmRender(); });
    document.getElementById(id)?.addEventListener('input',  () => { lmPage = 1; _lmSaveFilter(); lmRender(); });
  });
  document.getElementById('sortSelect')?.addEventListener('change', () => { lmPage = 1; _lmSaveFilter(); lmRender(); });

  document.getElementById('btnRefresh')?.addEventListener('click', async () => {
    const el = document.getElementById('reportCardList');
    if (el) el.innerHTML = '<div class="lm-loading"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>';
    lmReports = await fetchAllReports();
    window.__reportsCache = lmReports;
    populateDeptFilter();
    lmPage = 1; lmRender();
  });

  document.getElementById('btnExportCsv')?.addEventListener('click', exportCsv);

  // Card click → modal
  document.getElementById('reportCardList')?.addEventListener('click', e => {
    const btn = e.target.closest('.lm-detail-btn');
    if (!btn) return;
    const idx = Number(btn.dataset.reportIndex);
    if (lmFiltered[idx]) openReportModal(lmFiltered[idx]);
  });

  // Tab filter
  document.getElementById('lmTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.lm-tab');
    if (!tab) return;
    document.querySelectorAll('.lm-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    lmActiveTab = tab.dataset.tab || 'semua';
    lmPage = 1;
    lmRender();
  });

  // Advanced filter toggle
  document.getElementById('btnFilterToggle')?.addEventListener('click', () => {
    const extra = document.getElementById('lmFilterExtra');
    const btn   = document.getElementById('btnFilterToggle');
    if (!extra) return;
    const open = extra.classList.toggle('open');
    btn.classList.toggle('active', open);
  });

  // "Lainnya" dropdown
  document.getElementById('btnLainnya')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('lainnyaDropdown')?.classList.toggle('open');
  });
  document.addEventListener('click', () => {
    document.getElementById('lainnyaDropdown')?.classList.remove('open');
  });

  // Modal close
  document.getElementById('modalClose')?.addEventListener('click', closeReportModal);
  document.querySelector('.modal-overlay')?.addEventListener('click', closeReportModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeReportModal(); });
}

function slaDays(report) {
  const due = new Date(report.batas_waktu || report.due_date || '');
  if (isNaN(due)) return null;
  return Math.round((due - new Date()) / 86400000);
}

function slaBadge(report) {
  if ((report.status_perbaikan || 'OPEN') === 'CLOSED') return '';
  const days = slaDays(report);
  if (days === null) return '<span class="sla-badge sla-none">-</span>';
  if (days < 0)  return `<span class="sla-badge sla-overdue"><i class="fa-solid fa-clock"></i> TERLAMBAT ${Math.abs(days)} HARI</span>`;
  if (days === 0) return `<span class="sla-badge sla-warning"><i class="fa-solid fa-clock"></i> JATUH TEMPO HARI INI</span>`;
  if (days <= 3) return `<span class="sla-badge sla-warning"><i class="fa-solid fa-triangle-exclamation"></i> SISA ${days} HARI</span>`;
  return `<span class="sla-badge sla-ok"><i class="fa-solid fa-circle-check"></i> SISA ${days} HARI</span>`;
}

function slaPercent(r) {
  const created = new Date(r.timestamp || r.tanggal_laporan || 0);
  const due     = new Date(r.batas_waktu || r.due_date || 0);
  if (!due || isNaN(due) || isNaN(created)) return 0;
  const total   = due - created;
  if (total <= 0) return 100;
  return Math.min(100, Math.round(((Date.now() - created) / total) * 100));
}

function getRiskLevel(r) {
  return getReportValue(r, ['tingkat_resiko', 'tingkat_risiko', 'risiko', 'risk_level'], '');
}

function getCardPhoto(r) {
  const photos = getReportImages(r, ['upload_foto_bahaya', 'upload_foto_inspeksi', 'upload_foto_bahaya_pic', 'foto_temuan', 'foto_before', 'foto_before_url', 'foto_bahaya']);
  return { first: photos[0] || null, count: photos.length };
}

function lmRender() {
  const search  = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const status  = document.getElementById('statusFilter')?.value || '';
  const type    = document.getElementById('typeFilter')?.value || '';
  const dept    = document.getElementById('deptFilter')?.value || '';
  const sla     = document.getElementById('slaFilter')?.value || '';
  const dateVal = (document.getElementById('dateRange')?.value || '').trim();
  const sortVal = document.getElementById('sortSelect')?.value || 'due_asc';

  let startDate = null, endDate = null;
  if (dateVal) {
    const parts = dateVal.split(/\s*(?:to|-|sampai)\s*/i);
    if (parts.length >= 2) { startDate = new Date(parts[0]); endDate = new Date(parts[1]); }
    else { startDate = endDate = new Date(parts[0]); }
    if (endDate) endDate.setHours(23, 59, 59, 999);
  }

  lmFiltered = lmReports.filter(r => {
    const rStatus = r.status_perbaikan || 'OPEN';
    const rDept   = (r.departemen || r.department || '').trim();
    const rDate   = parseReportDate(r);
    const days    = slaDays(r);

    if (status && rStatus !== status) return false;
    if (type   && getReportType(r) !== type) return false;
    if (dept   && rDept !== dept) return false;
    if (sla === 'overdue' && (rStatus === 'CLOSED' || days === null || days >= 0)) return false;
    if (sla === 'warning' && (rStatus === 'CLOSED' || days === null || days < 0 || days > 3)) return false;
    if (sla === 'ok'      && (rStatus === 'CLOSED' || days === null || days <= 3)) return false;
    if (startDate && rDate && rDate < startDate) return false;
    if (endDate   && rDate && rDate > endDate)   return false;
    if (search) {
      const hay = [r.id, r.nama, r.nama_pic, getDashboardLocation(r), getDashboardDescription(r)].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Tab filter applied on top
  if (lmActiveTab === 'open') {
    lmFiltered = lmFiltered.filter(r => (r.status_perbaikan || 'OPEN') === 'OPEN');
  } else if (lmActiveTab === 'progress') {
    lmFiltered = lmFiltered.filter(r => r.status_perbaikan === 'PROGRESS');
  } else if (lmActiveTab === 'overdue') {
    lmFiltered = lmFiltered.filter(r => slaDays(r) !== null && slaDays(r) < 0 && r.status_perbaikan !== 'CLOSED');
  } else if (lmActiveTab === 'risiko-tinggi') {
    lmFiltered = lmFiltered.filter(r => getRiskLevel(r).toUpperCase().includes('TINGGI'));
  }

  // Sort
  lmFiltered.sort((a, b) => {
    if (sortVal === 'date_desc') return new Date(b.timestamp || b.tanggal_laporan || 0) - new Date(a.timestamp || a.tanggal_laporan || 0);
    if (sortVal === 'date_asc')  return new Date(a.timestamp || a.tanggal_laporan || 0) - new Date(b.timestamp || b.tanggal_laporan || 0);
    // due_asc (default): overdue first, then by remaining days
    const da = slaDays(a) ?? 9999, db = slaDays(b) ?? 9999;
    return da - db;
  });

  updateLmKpi();
  renderLmCards();
}

function updateLmKpi() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  // KPI uses all lmReports (not filtered) for overview
  set('kpiTotal',    lmReports.length);
  set('kpiOpen',     lmReports.filter(r => (r.status_perbaikan || 'OPEN') === 'OPEN').length);
  set('kpiProgress', lmReports.filter(r => r.status_perbaikan === 'PROGRESS').length);
  set('kpiClosed',   lmReports.filter(r => r.status_perbaikan === 'CLOSED').length);
  set('kpiOverdue',  lmReports.filter(r => slaDays(r) !== null && slaDays(r) < 0 && r.status_perbaikan !== 'CLOSED').length);

  // Tab counts
  set('tabCountOpen',     lmReports.filter(r => (r.status_perbaikan || 'OPEN') === 'OPEN').length);
  set('tabCountProgress', lmReports.filter(r => r.status_perbaikan === 'PROGRESS').length);
  set('tabCountOverdue',  lmReports.filter(r => slaDays(r) !== null && slaDays(r) < 0 && r.status_perbaikan !== 'CLOSED').length);
}

function renderLmCards() {
  const container = document.getElementById('reportCardList');
  if (!container) return;

  if (!lmFiltered.length) {
    container.innerHTML = '<div class="lm-empty"><i class="fa-solid fa-inbox"></i><p>Tidak ada laporan ditemukan</p></div>';
    renderLmPagination();
    return;
  }

  const startIdx = (lmPage - 1) * LM_PAGE_SIZE;
  const slice    = lmFiltered.slice(startIdx, startIdx + LM_PAGE_SIZE);

  container.innerHTML = slice.map((r, i) => {
    const globalIdx = startIdx + i;
    const status    = r.status_perbaikan || 'OPEN';
    const risk      = getRiskLevel(r);
    const riskUp    = risk.toUpperCase();
    const isHigh    = riskUp.includes('TINGGI');
    const isMed     = riskUp.includes('SEDANG');
    const borderCls = isHigh ? 'lm-card--high' : isMed ? 'lm-card--med' : 'lm-card--low';

    const { first: photo, count: photoCount } = getCardPhoto(r);
    const extraPhotos = photoCount > 1 ? photoCount - 1 : 0;

    const due    = r.batas_waktu || r.due_date || '';
    const dueFmt = due ? new Date(due).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
    const pct    = slaPercent(r);
    const isOverdue = slaDays(r) !== null && slaDays(r) < 0 && status !== 'CLOSED';
    const barColor  = isOverdue ? '#dc2626' : pct > 80 ? '#f59e0b' : '#16a34a';

    const shift  = getReportValue(r, ['shift_kejadian', 'shift_inspeksi', 'shift'], '');
    const tglRaw = r.tanggal_kejadian || r.timestamp || r.tanggal_laporan || '';
    const tglFmt = tglRaw ? formatDate(tglRaw) : '-';

    const statusCls = status === 'OPEN' ? 'status-open' : status === 'PROGRESS' ? 'status-progress' : 'status-closed';
    const typeLabel = escapeHTML(getReportTypeLabel(r));
    const typeCls   = getReportType(r).toLowerCase();

    return `<div class="lm-card ${borderCls}">
      <div class="lm-card-left">
        <div class="lm-card-id">${escapeHTML(r.id || '-')}</div>
        <div class="lm-card-tags">
          <span class="report-type-badge ${typeCls}">${typeLabel}</span>
          ${risk ? `<span class="lm-risk-badge lm-risk--${isHigh ? 'high' : isMed ? 'med' : 'low'}"><i class="fa-solid fa-shield-halved"></i> ${escapeHTML(risk)}</span>` : ''}
        </div>
        <div class="lm-card-location"><i class="fa-solid fa-location-dot"></i> ${escapeHTML(getDashboardLocation(r))}</div>
        <div class="lm-card-desc">${escapeHTML(getDashboardDescription(r))}</div>
        ${photo ? `<div class="lm-card-photo-wrap">
          <img class="lm-card-photo" src="${escapeHTML(photo)}" alt="foto" loading="lazy">
          ${extraPhotos > 0 ? `<span class="lm-photo-more">+${extraPhotos}</span>` : ''}
        </div>` : ''}
      </div>

      <div class="lm-card-mid">
        <div class="lm-meta-row"><i class="fa-solid fa-user lm-meta-icon"></i><div><div class="lm-meta-label">PELAPOR</div><div class="lm-meta-val">${escapeHTML(r.nama || '-')}</div></div></div>
        <div class="lm-meta-row"><i class="fa-solid fa-user-tie lm-meta-icon"></i><div><div class="lm-meta-label">PIC</div><div class="lm-meta-val">${escapeHTML(r.nama_pic || '-')}</div></div></div>
        <div class="lm-meta-row"><i class="fa-solid fa-calendar lm-meta-icon"></i><div><div class="lm-meta-label">TANGGAL KEJADIAN</div><div class="lm-meta-val">${escapeHTML(tglFmt)}</div></div></div>
        ${shift ? `<div class="lm-meta-row"><i class="fa-solid fa-clock lm-meta-icon"></i><div><div class="lm-meta-label">SHIFT</div><div class="lm-meta-val">${escapeHTML(shift)}</div></div></div>` : ''}
      </div>

      <div class="lm-card-right">
        <div>
          <div class="lm-meta-label">DUE DATE</div>
          <div class="lm-card-due-date">${escapeHTML(dueFmt)}</div>
        </div>
        ${slaBadge(r)}
        ${status !== 'CLOSED' && pct > 0 ? `<div class="lm-sla-bar-wrap">
          <div class="lm-meta-label">SLA PROGRESS <span class="lm-bar-pct">${pct}%</span></div>
          <div class="lm-bar"><div class="lm-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        </div>` : ''}
        <div><span class="status-badge ${statusCls}">${escapeHTML(status)}</span></div>
        <button class="lm-detail-btn" data-report-index="${globalIdx}">
          Lihat Detail <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>`;
  }).join('');

  renderLmPagination();
}

function renderLmPagination() {
  const el = document.getElementById('tablePagination');
  if (!el) return;
  const total = lmFiltered.length;
  const pages = Math.max(1, Math.ceil(total / LM_PAGE_SIZE));
  const s = total === 0 ? 0 : (lmPage - 1) * LM_PAGE_SIZE + 1;
  const e = Math.min(lmPage * LM_PAGE_SIZE, total);
  el.innerHTML = `
    <span class="lm-pag-info">Menampilkan ${s}–${e} dari ${total} laporan</span>
    ${total > LM_PAGE_SIZE ? `
    <div class="lm-pag-btns">
      <button class="um-page-btn${lmPage <= 1 ? ' disabled' : ''}" ${lmPage <= 1 ? 'disabled' : ''} onclick="lmGoPage(${lmPage - 1})"><i class="fa-solid fa-chevron-left"></i></button>
      <span class="lm-pag-cur">${lmPage} / ${pages}</span>
      <button class="um-page-btn${lmPage >= pages ? ' disabled' : ''}" ${lmPage >= pages ? 'disabled' : ''} onclick="lmGoPage(${lmPage + 1})"><i class="fa-solid fa-chevron-right"></i></button>
    </div>` : ''}
  `;
}

function lmGoPage(p) {
  const pages = Math.max(1, Math.ceil(lmFiltered.length / LM_PAGE_SIZE));
  lmPage = Math.min(Math.max(1, p), pages);
  renderLmCards();
  document.getElementById('reportCardList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function exportCsv() {
  if (!lmFiltered.length) return;
  const headers = ['ID','Jenis','Tanggal','Pelapor','Dept','Lokasi','Deskripsi','PIC','Due Date','Status','SLA Hari'];
  const rows = lmFiltered.map(r => [
    r.id || '',
    getReportTypeLabel(r),
    formatDate(r.timestamp || r.tanggal_laporan || ''),
    r.nama || '',
    r.departemen || r.department || '',
    getDashboardLocation(r),
    getDashboardDescription(r),
    r.nama_pic || '',
    r.batas_waktu || r.due_date || '',
    r.status_perbaikan || 'OPEN',
    slaDays(r) ?? '',
  ]);
  const csv = [headers, ...rows].map(row =>
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = `laporan_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}
