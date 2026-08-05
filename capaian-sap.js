let _capKaryawan = [];
let _capHazardReports = [];
let _capInsReports = [];
let _capLoaded = false;
let _capFiltered = [];
let _capComputed = [];
let _capPage = 1;
const CAP_PAGE_SIZE = 25;

let _capChart = null;
let _capChartDrillCompany = null; // null = top-level, string = drilled into company

function _capSameMonth(ts, monthStr) {
  if (!ts || !monthStr) return false;
  const d = new Date(ts);
  if (isNaN(d)) return false;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === monthStr;
}

async function loadCapaian() {
  const tbody = document.getElementById('capTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:20px">Memuat data...</td></tr>';

  try {
    const [karRes, hrRes, insRes] = await Promise.all([
      fetch('/api?action=getKaryawan').then(r => r.json()),
      fetch('/api?action=getHazardReports').then(r => r.json()),
      fetch('/api?action=getInspectionReports').then(r => r.json()),
    ]);

    if (karRes.status !== 'success') throw new Error(karRes.message || 'Gagal memuat data karyawan');

    _capKaryawan = (karRes.data || []).filter(r =>
      String(r['ROLE'] || '').toUpperCase().replace(/\s+/g, '_') !== 'DELETED'
    );
    _capHazardReports = hrRes.data || [];
    _capInsReports    = insRes.data || [];
    _capLoaded = true;

    const isSA = isSuperAdminRole(getCurrentUser()?.role);

    const depts = [...new Set(_capKaryawan.map(k => k['DEPARTEMEN'] || '').filter(Boolean))].sort();
    const deptSel = document.getElementById('capDept');
    if (deptSel) {
      const cur = deptSel.value;
      deptSel.innerHTML = '<option value="">Semua Departemen</option>' +
        depts.map(d => `<option value="${escapeHTML(d)}"${d === cur ? ' selected' : ''}>${escapeHTML(d)}</option>`).join('');
    }

    if (isSA) {
      const cos = [...new Set(_capKaryawan.map(k => k['PERUSAHAAN'] || '').filter(Boolean))].sort();
      const coSel = document.getElementById('capPerusahaan');
      if (coSel) {
        const cur = coSel.value;
        coSel.innerHTML = '<option value="">Semua Perusahaan</option>' +
          cos.map(c => `<option value="${escapeHTML(c)}"${c === cur ? ' selected' : ''}>${escapeHTML(c)}</option>`).join('');
      }
    }

    const thead = document.getElementById('capTableHead');
    if (thead) {
      thead.innerHTML = `<tr>
        ${isSA ? '<th>Perusahaan</th>' : ''}
        <th>Nama</th><th>NIK</th><th>Jabatan</th><th>Departemen</th>
        <th class="um-center">OBJ HR</th><th class="um-center">Capaian HR</th><th class="um-center">% HR</th>
        <th class="um-center">OBJ INS</th><th class="um-center">Capaian INS</th><th class="um-center">% INS</th>
        <th class="um-center">% Total</th>
        <th class="um-center">PIC Open</th><th class="um-center">% Closing</th>
      </tr>`;
    }

    computeAndRender();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#ef4444;padding:20px">${escapeHTML(e.message)}</td></tr>`;
  }
}

function computeAndRender() {
  if (!_capLoaded) return;

  const monthStr = document.getElementById('capMonth')?.value || '';
  const coF      = (document.getElementById('capPerusahaan')?.value || '').toLowerCase();

  // Update dropdown departemen berdasarkan perusahaan yang dipilih
  const deptSel = document.getElementById('capDept');
  if (deptSel) {
    const prevDept = deptSel.value;
    const coKaryawan = coF
      ? _capKaryawan.filter(k => String(k['PERUSAHAAN'] || '').toLowerCase() === coF)
      : _capKaryawan;
    const depts = [...new Set(coKaryawan.map(k => k['DEPARTEMEN'] || '').filter(Boolean))].sort();
    deptSel.innerHTML = '<option value="">Semua Departemen</option>' +
      depts.map(d => `<option value="${escapeHTML(d)}"${d === prevDept ? ' selected' : ''}>${escapeHTML(d)}</option>`).join('');
    // Reset jika dept sebelumnya tidak ada di perusahaan yang baru dipilih
    if (prevDept && !depts.includes(prevDept)) deptSel.value = '';
  }

  const deptF = (deptSel?.value || '').toLowerCase();
  const allRep   = [..._capHazardReports, ..._capInsReports];

  _capComputed = _capKaryawan.map(k => {
    const nik  = String(k['NIK']  || '').trim();
    const nama = String(k['NAMA'] || '').trim().toLowerCase();

    // Laporan sebagai PELAPOR (filter by month untuk capaian)
    const mine = monthStr ? allRep.filter(r => {
      const rNik  = String(r.nik || r.nik_pelapor || '').trim();
      const rNama = String(r.nama || r.pelapor || '').trim().toLowerCase();
      return ((nik && rNik === nik) || (nama && rNama === nama)) &&
             _capSameMonth(r.timestamp || r.tanggal_laporan || r.tgl_laporan || r.tanggal_inspeksi, monthStr);
    }) : [];

    // Laporan sebagai PIC — all-time untuk "PIC Open", month-filter untuk "%Closing"
    const isPic = r => {
      const rNikPic  = String(r.nik_pic || '').trim();
      const rNamaPic = String(r.nama_pic || r.pic || '').trim().toLowerCase();
      return (nik && rNikPic === nik) || (nama && rNamaPic === nama);
    };
    const picAll   = allRep.filter(isPic);
    const picMonth = monthStr ? picAll.filter(r =>
      _capSameMonth(r.timestamp || r.tanggal_laporan || r.tgl_laporan || r.tanggal_inspeksi, monthStr)
    ) : [];

    const picOpen    = picAll.filter(r => String(r.status_perbaikan || '').toUpperCase() !== 'CLOSED').length;
    const picClosed  = picMonth.filter(r => String(r.status_perbaikan || '').toUpperCase() === 'CLOSED').length;
    const pctClosing = picMonth.length > 0 ? Math.round(picClosed / picMonth.length * 100) : null;

    const achHR    = mine.filter(r => r.report_type === 'HAZARD').length;
    const achINS   = mine.filter(r => r.report_type === 'INSPECTION').length;
    const objHR    = parseInt(k['OBJ HR']  || 0) || 0;
    const objINS   = parseInt(k['OBJ INS'] || 0) || 0;
    const pctHR    = objHR  > 0 ? Math.round(achHR  / objHR  * 100) : null;
    const pctINS   = objINS > 0 ? Math.round(achINS / objINS * 100) : null;
    const totalObj = objHR + objINS;
    const pctTotal = totalObj > 0 ? Math.round((achHR + achINS) / totalObj * 100) : null;
    return { k, achHR, achINS, objHR, objINS, pctHR, pctINS, pctTotal, picOpen, pctClosing };
  });

  _capFiltered = _capComputed.filter(row => {
    // Exact match — bukan includes — agar "CA" tidak cocok dengan "HCA"
    const dept = String(row.k['DEPARTEMEN'] || '').toLowerCase();
    const co   = String(row.k['PERUSAHAAN'] || '').toLowerCase();
    return (!deptF || dept === deptF) && (!coF || co === coF);
  });

  _capPage = 1;
  renderTable();
  renderKpi();
  renderChart();
}

function _capPctCell(pct) {
  if (pct === null) return '<td class="um-center" style="color:#cbd5e1">-</td>';
  const color = pct >= 100 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  const bg    = pct >= 100 ? '#f0fdf4' : pct >= 50 ? '#fffbeb' : '#fff1f2';
  return `<td class="um-center"><span style="background:${bg};color:${color};font-weight:700;padding:2px 8px;border-radius:6px;font-size:.78rem">${pct}%</span></td>`;
}

function renderTable() {
  const tbody = document.getElementById('capTableBody');
  if (!tbody) return;

  const monthStr = document.getElementById('capMonth')?.value || '';
  const isSA     = isSuperAdminRole(getCurrentUser()?.role);
  const colSpan  = isSA ? 14 : 13;

  if (!monthStr) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:24px;color:#94a3b8">Pilih bulan untuk melihat capaian SAP</td></tr>`;
    document.getElementById('capPagination').innerHTML = '';
    return;
  }

  if (!_capFiltered.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada data</td></tr>`;
    renderPagination();
    return;
  }

  const start = (_capPage - 1) * CAP_PAGE_SIZE;
  tbody.innerHTML = _capFiltered.slice(start, start + CAP_PAGE_SIZE).map(row => {
    const picOpenColor = row.picOpen > 0 ? '#ef4444' : '#22c55e';
    return `<tr>
      ${isSA ? `<td>${escapeHTML(row.k['PERUSAHAAN'] || '')}</td>` : ''}
      <td>${escapeHTML(row.k['NAMA'] || '')}</td>
      <td>${escapeHTML(String(row.k['NIK'] || '-'))}</td>
      <td>${escapeHTML(row.k['JABATAN'] || '')}</td>
      <td>${escapeHTML(row.k['DEPARTEMEN'] || '')}</td>
      <td class="um-center">${row.objHR || '-'}</td>
      <td class="um-center"><b>${row.achHR}</b></td>
      ${_capPctCell(row.pctHR)}
      <td class="um-center">${row.objINS || '-'}</td>
      <td class="um-center"><b>${row.achINS}</b></td>
      ${_capPctCell(row.pctINS)}
      ${_capPctCell(row.pctTotal)}
      <td class="um-center"><b style="color:${picOpenColor}">${row.picOpen}</b></td>
      ${_capPctCell(row.pctClosing)}
    </tr>`;
  }).join('');

  renderPagination();
}

function renderPagination() {
  const el = document.getElementById('capPagination');
  if (!el) return;
  const pages = Math.ceil(_capFiltered.length / CAP_PAGE_SIZE);
  if (pages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = Array.from({length: pages}, (_, i) => i + 1)
    .map(p => `<button class="um-page-btn${p === _capPage ? ' active' : ''}" onclick="_capGoPage(${p})">${p}</button>`)
    .join('');
}

window._capGoPage = function(p) { _capPage = p; renderTable(); };

function renderKpi() {
  const el = document.getElementById('capKpi');
  if (!el) return;
  const monthStr = document.getElementById('capMonth')?.value || '';
  if (!monthStr || !_capFiltered.length) { el.style.display = 'none'; return; }

  const avg = (key) => {
    const valid = _capFiltered.filter(r => r[key] !== null);
    return valid.length ? Math.round(valid.reduce((s, r) => s + r[key], 0) / valid.length) : null;
  };

  const kpiItem = (label, val, icon) => {
    if (val === null) return '';
    const color = val >= 100 ? '#22c55e' : val >= 50 ? '#f59e0b' : '#ef4444';
    return `<div class="ach-kpi-cell">
      <i class="fa-solid ${icon}" style="color:${color};font-size:1.1rem"></i>
      <div class="ach-kpi-num" style="color:${color}">${val}%</div>
      <div class="ach-kpi-label">${label}</div>
    </div>`;
  };

  el.style.display = 'flex';
  el.innerHTML = `
    <div class="ach-kpi-cell">
      <i class="fa-solid fa-users" style="color:#64748b;font-size:1.1rem"></i>
      <div class="ach-kpi-num" style="color:#0f172a">${_capFiltered.length}</div>
      <div class="ach-kpi-label">Total Karyawan</div>
    </div>
    ${kpiItem('Rata-rata HR',    avg('pctHR'),    'fa-triangle-exclamation')}
    ${kpiItem('Rata-rata INS',   avg('pctINS'),   'fa-clipboard-check')}
    ${kpiItem('Rata-rata Total', avg('pctTotal'), 'fa-trophy')}`;
}

function _capAggregateBy(rows, keyFn) {
  const map = {};
  rows.forEach(row => {
    const key = keyFn(row) || 'Lainnya';
    if (!map[key]) map[key] = { sum: 0, n: 0 };
    if (row.pctTotal !== null) { map[key].sum += row.pctTotal; map[key].n++; }
  });
  return map;
}

function renderChart() {
  const wrap = document.getElementById('capChartWrap');
  const back = document.getElementById('capChartBack');
  if (!wrap || !_capLoaded || !_capComputed.length) {
    if (wrap) wrap.style.display = 'none';
    return;
  }
  const user  = getCurrentUser();
  const isSA  = isSuperAdminRole(user?.role);
  const isAdm = isAdminOrAbove(user?.role);
  if (!isAdm) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';

  let aggMap, title, clickable;

  if (isSA && _capChartDrillCompany) {
    // Drill-down: departemen dalam satu perusahaan
    const coRows = _capComputed.filter(r => String(r.k['PERUSAHAAN'] || '').trim() === _capChartDrillCompany);
    aggMap    = _capAggregateBy(coRows, r => r.k['DEPARTEMEN']);
    title     = `${_capChartDrillCompany} — Per Departemen`;
    clickable = false;
    if (back) back.style.display = '';
  } else if (isSA) {
    // Top-level: per perusahaan
    aggMap    = _capAggregateBy(_capComputed, r => r.k['PERUSAHAAN']);
    title     = 'Capaian SAP per Perusahaan (klik untuk detail departemen)';
    clickable = true;
    if (back) back.style.display = 'none';
  } else {
    // ADMIN: per departemen perusahaan sendiri
    aggMap    = _capAggregateBy(_capComputed, r => r.k['DEPARTEMEN']);
    title     = 'Capaian SAP per Departemen';
    clickable = false;
    if (back) back.style.display = 'none';
  }

  const labels = Object.keys(aggMap).sort();
  const values = labels.map(k => aggMap[k].n > 0 ? Math.round(aggMap[k].sum / aggMap[k].n) : 0);
  const colors = values.map(v => v >= 100 ? '#22c55e' : v >= 50 ? '#f59e0b' : '#ef4444');

  document.getElementById('capChartTitle').textContent = title;

  const ctx = document.getElementById('capChart').getContext('2d');
  if (_capChart) { _capChart.destroy(); _capChart = null; }

  _capChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => `${c.parsed.y}%${clickable ? ' — klik untuk detail' : ''}`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } },
        x: { ticks: { maxRotation: 35, font: { size: 11 } } }
      },
      onClick: clickable ? (_, els) => {
        if (!els.length) return;
        _capChartDrillCompany = labels[els[0].index];
        renderChart();
      } : undefined,
      onHover: clickable ? (evt, els) => {
        evt.native.target.style.cursor = els.length ? 'pointer' : 'default';
      } : undefined,
    }
  });
}

window.capChartBack = function() {
  _capChartDrillCompany = null;
  renderChart();
};

function exportCsv() {
  if (!_capFiltered.length) { alert('Tidak ada data untuk di-export.'); return; }
  const monthStr = document.getElementById('capMonth')?.value || 'semua';
  const isSA     = isSuperAdminRole(getCurrentUser()?.role);

  const headers = [
    ...(isSA ? ['Perusahaan'] : []),
    'Nama', 'NIK', 'Jabatan', 'Departemen',
    'OBJ HR', 'Capaian HR', '% HR',
    'OBJ INS', 'Capaian INS', '% INS', '% Total',
    'PIC Open', '% Closing',
  ];

  const rows = _capFiltered.map(r => [
    ...(isSA ? [r.k['PERUSAHAAN'] || ''] : []),
    r.k['NAMA'] || '', String(r.k['NIK'] || ''), r.k['JABATAN'] || '', r.k['DEPARTEMEN'] || '',
    r.objHR, r.achHR, r.pctHR    !== null ? r.pctHR    + '%' : '-',
    r.objINS, r.achINS, r.pctINS !== null ? r.pctINS   + '%' : '-',
    r.pctTotal   !== null ? r.pctTotal   + '%' : '-',
    r.picOpen,
    r.pctClosing !== null ? r.pctClosing + '%' : '-',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = `capaian_sap_${monthStr}.csv`;
  a.click();
}
