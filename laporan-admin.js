// Manajemen Laporan — extends dashboard.js logic with extra columns & filters

let lmReports = [];
let lmFiltered = [];
let lmPage = 1;
const LM_PAGE_SIZE = 25;

document.addEventListener('DOMContentLoaded', initLaporan);

async function initLaporan() {
  try {
    const user = getCurrentUser();
    lmReports = await fetchAllReports();

    // ADMIN (bukan SUPER_ADMIN): hanya tampil laporan dari perusahaan sendiri atau jika jadi PIC
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
    lmRender();
    wireFilters();
  } catch (e) {
    document.getElementById('reportTableBody').innerHTML =
      `<tr><td colspan="12" class="lm-loading">Gagal memuat data. ${e.message || ''}</td></tr>`;
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

function wireFilters() {
  ['searchInput','statusFilter','typeFilter','deptFilter','slaFilter','dateRange'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { lmPage = 1; lmRender(); });
    document.getElementById(id)?.addEventListener('input',  () => { lmPage = 1; lmRender(); });
  });
  document.getElementById('btnRefresh')?.addEventListener('click', async () => {
    document.getElementById('reportTableBody').innerHTML =
      `<tr><td colspan="12" class="lm-loading">Memuat...</td></tr>`;
    lmReports = await fetchAllReports();
    window.__reportsCache = lmReports;
    populateDeptFilter();
    lmPage = 1; lmRender();
  });
  document.getElementById('btnExportCsv')?.addEventListener('click', exportCsv);
  document.getElementById('reportTableBody')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-view');
    if (!btn) return;
    const idx = Number(btn.dataset.reportIndex);
    if (lmFiltered[idx]) openReportModal(lmFiltered[idx]);
  });
  // Pasang close modal — dashboard.js melewatkan ini saat __skipDashboardInit aktif
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
  if (days < 0)  return `<span class="sla-badge sla-overdue"><i class="fa-solid fa-circle-xmark"></i> ${Math.abs(days)}h telat</span>`;
  if (days <= 3) return `<span class="sla-badge sla-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${days}h lagi</span>`;
  return `<span class="sla-badge sla-ok"><i class="fa-solid fa-circle-check"></i> ${days}h lagi</span>`;
}

function lmRender() {
  const search  = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const status  = document.getElementById('statusFilter')?.value || '';
  const type    = document.getElementById('typeFilter')?.value || '';
  const dept    = document.getElementById('deptFilter')?.value || '';
  const sla     = document.getElementById('slaFilter')?.value || '';
  const dateVal = (document.getElementById('dateRange')?.value || '').trim();

  let start = null, end = null;
  if (dateVal) {
    const parts = dateVal.split(/\s*(?:to|-|sampai)\s*/i);
    if (parts.length >= 2) { start = new Date(parts[0]); end = new Date(parts[1]); }
    else { start = end = new Date(parts[0]); }
    if (end) end.setHours(23, 59, 59, 999);
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
    if (start && rDate && rDate < start) return false;
    if (end   && rDate && rDate > end)   return false;
    if (search) {
      const haystack = [r.id, r.nama, r.nama_pic, getDashboardLocation(r)].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // Sort: overdue first, then by date desc
  lmFiltered.sort((a, b) => {
    const da = slaDays(a) ?? 9999, db = slaDays(b) ?? 9999;
    if (da !== db) return da - db;
    return new Date(b.tanggal_laporan || 0) - new Date(a.tanggal_laporan || 0);
  });

  updateLmKpi();
  renderLmTable();
}

function updateLmKpi() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('kpiTotal',    lmFiltered.length);
  set('kpiOpen',     lmFiltered.filter(r => (r.status_perbaikan || 'OPEN') === 'OPEN').length);
  set('kpiProgress', lmFiltered.filter(r => r.status_perbaikan === 'PROGRESS').length);
  set('kpiClosed',   lmFiltered.filter(r => r.status_perbaikan === 'CLOSED').length);
  set('kpiOverdue',  lmFiltered.filter(r => slaDays(r) !== null && slaDays(r) < 0 && r.status_perbaikan !== 'CLOSED').length);
}

function renderLmTable() {
  const tbody = document.getElementById('reportTableBody');
  if (!tbody) return;

  if (!lmFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="lm-loading">Tidak ada data.</td></tr>';
    renderLmPagination();
    return;
  }

  const start = (lmPage - 1) * LM_PAGE_SIZE;
  const slice = lmFiltered.slice(start, start + LM_PAGE_SIZE);

  tbody.innerHTML = slice.map((r, i) => {
    const globalIdx = start + i;
    const status    = r.status_perbaikan || 'OPEN';
    const badgeCls  = status === 'OPEN' ? 'status-open' : status === 'PROGRESS' ? 'status-progress' : 'status-closed';
    const due       = r.batas_waktu || r.due_date || '';
    const dueFmt    = due ? new Date(due).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'2-digit' }) : '-';
    const deptVal   = escapeHTML(r.departemen || r.department || '-');
    return `<tr>
      <td><strong>${escapeHTML(r.id || '-')}</strong></td>
      <td><span class="report-type-badge ${getReportType(r).toLowerCase()}">${escapeHTML(getReportTypeLabel(r))}</span></td>
      <td style="white-space:nowrap">${escapeHTML(formatDate(r.timestamp))}</td>
      <td>${escapeHTML(r.nama || '-')}</td>
      <td>${deptVal}</td>
      <td>${escapeHTML(getDashboardLocation(r))}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(getDashboardDescription(r))}</td>
      <td>${escapeHTML(r.nama_pic || '-')}</td>
      <td style="white-space:nowrap">${escapeHTML(dueFmt)}</td>
      <td>${slaBadge(r)}</td>
      <td><span class="status-badge ${badgeCls}">${escapeHTML(status)}</span></td>
      <td>
        <button class="btn-view" data-report-index="${globalIdx}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 5c-7 0-10 6.3-10 7s3 7 10 7 10-6.3 10-7-3-7-10-7zm0 12c-3.9 0-6.7-2.7-8-5 1.3-2.3 4.1-5 8-5s6.7 2.7 8 5c-1.3 2.3-4.1 5-8 5zm0-9a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>
          View
        </button>
      </td>
    </tr>`;
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
    <span>${total} laporan${total > LM_PAGE_SIZE ? ` (${s}–${e})` : ''}</span>
    ${total > LM_PAGE_SIZE ? `
    <div style="display:flex;gap:6px;align-items:center">
      <button class="um-page-btn${lmPage <= 1 ? ' disabled' : ''}" ${lmPage <= 1 ? 'disabled' : ''} onclick="lmGoPage(${lmPage - 1})"><i class="fa-solid fa-chevron-left"></i></button>
      <span style="font-size:.8rem">${lmPage} / ${pages}</span>
      <button class="um-page-btn${lmPage >= pages ? ' disabled' : ''}" ${lmPage >= pages ? 'disabled' : ''} onclick="lmGoPage(${lmPage + 1})"><i class="fa-solid fa-chevron-right"></i></button>
    </div>` : ''}
  `;
}

function lmGoPage(p) {
  const pages = Math.max(1, Math.ceil(lmFiltered.length / LM_PAGE_SIZE));
  lmPage = Math.min(Math.max(1, p), pages);
  renderLmTable();
}
