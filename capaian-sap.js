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
let _capSortCol = null;
let _capSortDir = 1; // 1 = asc, -1 = desc

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

    _capRestoreFilter(); // #6 — restore filter sebelumnya
    computeAndRender();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#ef4444;padding:20px">${escapeHTML(e.message)}</td></tr>`;
  }
}

function _capSaveFilter() {
  try {
    const key = 'cap_filter_' + (getCurrentUser()?.nik || 'guest');
    sessionStorage.setItem(key, JSON.stringify({
      month:   document.getElementById('capMonth')?.value || '',
      company: document.getElementById('capPerusahaan')?.value || '',
      dept:    document.getElementById('capDept')?.value || '',
    }));
  } catch {}
}

function _capRestoreFilter() {
  try {
    const key = 'cap_filter_' + (getCurrentUser()?.nik || 'guest');
    const s = JSON.parse(sessionStorage.getItem(key) || '{}');
    if (s.month)   { const el = document.getElementById('capMonth');      if (el) el.value = s.month; }
    if (s.company) { const el = document.getElementById('capPerusahaan'); if (el) el.value = s.company; }
    if (s.dept)    { const el = document.getElementById('capDept');        if (el) el.value = s.dept; }
  } catch {}
}

function computeAndRender() {
  if (!_capLoaded) return;
  _capSaveFilter(); // #6 — simpan filter ke sessionStorage

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
    // Cap di 100% — kelebihan capaian tidak menambah persentase
    const pctHR    = objHR  > 0 ? Math.min(100, Math.round(achHR  / objHR  * 100)) : null;
    const pctINS   = objINS > 0 ? Math.min(100, Math.round(achINS / objINS * 100)) : null;
    // %Total = rata-rata %HR dan %INS (hanya yang memiliki target)
    const pctVals  = [pctHR, pctINS].filter(v => v !== null);
    const pctTotal = pctVals.length > 0 ? Math.round(pctVals.reduce((a, b) => a + b, 0) / pctVals.length) : null;
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

  // Thead sortable — re-render setiap kali agar ikon sort update
  const thead = document.getElementById('capTableHead');
  if (thead) {
    const th = (col, label, center) =>
      `<th class="${center ? 'um-center' : ''}" style="cursor:pointer;white-space:nowrap;user-select:none" onclick="_capThClick('${col}')">${label}${_capSortIcon(col)}</th>`;
    thead.innerHTML = `<tr>
      ${isSA ? th('co', 'Perusahaan') : ''}
      ${th('nama', 'Nama')}${th('nik', 'NIK')}${th('jabatan', 'Jabatan')}${th('dept', 'Departemen')}
      ${th('objHR', 'OBJ HR', true)}${th('achHR', 'Capaian HR', true)}${th('pctHR', '% HR', true)}
      ${th('objINS', 'OBJ INS', true)}${th('achINS', 'Capaian INS', true)}${th('pctINS', '% INS', true)}
      ${th('pctTotal', '% Total', true)}
      ${th('picOpen', 'PIC Open', true)}${th('pctClosing', '% Closing', true)}
    </tr>`;
  }

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

  // Sort sebelum paginate
  const sorted = _capSortCol
    ? [..._capFiltered].sort((a, b) => {
        const va = _capSortVal(a, _capSortCol), vb = _capSortVal(b, _capSortCol);
        return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * _capSortDir;
      })
    : _capFiltered;

  const start = (_capPage - 1) * CAP_PAGE_SIZE;
  tbody.innerHTML = sorted.slice(start, start + CAP_PAGE_SIZE).map(row => {
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

function _capSortIcon(col) {
  if (_capSortCol !== col) return '<span style="opacity:.2;font-size:.65rem;margin-left:2px">⇅</span>';
  return _capSortDir === 1
    ? '<span style="font-size:.65rem;margin-left:2px;color:#6366f1">▲</span>'
    : '<span style="font-size:.65rem;margin-left:2px;color:#6366f1">▼</span>';
}

window._capThClick = function(col) {
  if (_capSortCol === col) { _capSortDir *= -1; } else { _capSortCol = col; _capSortDir = 1; }
  _capPage = 1;
  renderTable();
};

function _capSortVal(row, col) {
  switch (col) {
    case 'co':         return String(row.k['PERUSAHAAN'] || '').toLowerCase();
    case 'nama':       return String(row.k['NAMA'] || '').toLowerCase();
    case 'nik':        return String(row.k['NIK'] || '').toLowerCase();
    case 'jabatan':    return String(row.k['JABATAN'] || '').toLowerCase();
    case 'dept':       return String(row.k['DEPARTEMEN'] || '').toLowerCase();
    case 'objHR':      return row.objHR;
    case 'achHR':      return row.achHR;
    case 'pctHR':      return row.pctHR      ?? -1;
    case 'objINS':     return row.objINS;
    case 'achINS':     return row.achINS;
    case 'pctINS':     return row.pctINS     ?? -1;
    case 'pctTotal':   return row.pctTotal   ?? -1;
    case 'picOpen':    return row.picOpen;
    case 'pctClosing': return row.pctClosing ?? -1;
    default:           return 0;
  }
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

  let aggMap, title, subtitle, clickable;

  if (isSA && _capChartDrillCompany) {
    const coRows = _capComputed.filter(r => String(r.k['PERUSAHAAN'] || '').trim() === _capChartDrillCompany);
    aggMap   = _capAggregateBy(coRows, r => r.k['DEPARTEMEN']);
    title    = _capChartDrillCompany;
    subtitle = 'Klik batang untuk filter tabel ke departemen tersebut';
    clickable = true;
    if (back) back.style.display = '';
  } else if (isSA) {
    aggMap   = _capAggregateBy(_capComputed, r => r.k['PERUSAHAAN']);
    title    = 'Capaian SAP per Perusahaan';
    subtitle = 'Klik batang untuk lihat rincian & filter per perusahaan';
    clickable = true;
    if (back) back.style.display = 'none';
  } else {
    aggMap   = _capAggregateBy(_capComputed, r => r.k['DEPARTEMEN']);
    title    = 'Capaian SAP per Departemen';
    subtitle = 'Klik batang untuk filter tabel ke departemen tersebut';
    clickable = true;
    if (back) back.style.display = 'none';
  }

  document.getElementById('capChartTitle').textContent = title;
  const subtitleEl = document.getElementById('capChartSubtitle');
  if (subtitleEl) subtitleEl.textContent = subtitle;

  const labels = Object.keys(aggMap).sort();
  const values = labels.map(k => aggMap[k].n > 0 ? Math.round(aggMap[k].sum / aggMap[k].n) : 0);

  const canvas = document.getElementById('capChart');
  const ctx = canvas.getContext('2d');
  if (_capChart) { _capChart.destroy(); _capChart = null; }

  // Gradient fills — dibuat sebelum chart init (height estimasi 260px)
  const gradH = 260;
  const bgColors = values.map(v => {
    const g = ctx.createLinearGradient(0, 0, 0, gradH);
    if (v >= 100) {
      g.addColorStop(0, 'rgba(34,197,94,.92)');
      g.addColorStop(1, 'rgba(16,185,129,.4)');
    } else if (v >= 50) {
      g.addColorStop(0, 'rgba(245,158,11,.92)');
      g.addColorStop(1, 'rgba(251,191,36,.4)');
    } else {
      g.addColorStop(0, 'rgba(239,68,68,.92)');
      g.addColorStop(1, 'rgba(248,113,113,.4)');
    }
    return g;
  });
  const hoverColors = values.map(v =>
    v >= 100 ? 'rgba(34,197,94,1)' :
    v >= 50  ? 'rgba(245,158,11,1)' :
               'rgba(239,68,68,1)'
  );

  // Plugin: angka % di atas setiap bar
  const datalabelPlugin = {
    id: 'capDatalabels',
    afterDatasetsDraw(chart) {
      const { ctx: c, data } = chart;
      c.save();
      c.font = 'bold 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      data.datasets[0].data.forEach((val, i) => {
        const bar = chart.getDatasetMeta(0).data[i];
        c.fillStyle = val >= 100 ? '#15803d' : val >= 50 ? '#92400e' : '#991b1b';
        c.fillText(val + '%', bar.x, bar.y - 4);
      });
      c.restore();
    }
  };

  // Plugin: garis putus-putus target 100%
  const targetLinePlugin = {
    id: 'capTargetLine',
    afterDraw(chart) {
      const { ctx: c, scales: { y }, chartArea } = chart;
      if (!y) return;
      const yPos = y.getPixelForValue(100);
      if (yPos < chartArea.top || yPos > chartArea.bottom) return;
      c.save();
      c.beginPath();
      c.setLineDash([5, 4]);
      c.strokeStyle = 'rgba(99,102,241,.5)';
      c.lineWidth = 1.5;
      c.moveTo(chartArea.left, yPos);
      c.lineTo(chartArea.right, yPos);
      c.stroke();
      c.setLineDash([]);
      c.restore();
    }
  };

  const yMax = Math.max(110, Math.max(...(values.length ? values : [0])) + 15);

  _capChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        hoverBackgroundColor: hoverColors,
        borderRadius: { topLeft: 7, topRight: 7 },
        borderSkipped: false,
        borderWidth: 0,
        barPercentage: 0.62,
        categoryPercentage: 0.8,
      }]
    },
    plugins: [datalabelPlugin, targetLinePlugin],
    options: {
      responsive: true,
      animation: { duration: 520, easing: 'easeOutQuart' },
      layout: { padding: { top: 18, right: 6 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,.93)',
          titleColor: '#f8fafc',
          bodyColor: '#94a3b8',
          padding: { x: 13, y: 10 },
          cornerRadius: 9,
          displayColors: false,
          callbacks: {
            title: items => items[0].label,
            label: c => {
              const n = aggMap[labels[c.dataIndex]]?.n || 0;
              const hint = (isSA && !_capChartDrillCompany)
                ? ' · Klik untuk detail departemen'
                : ' · Klik untuk filter tabel';
              return [` Rata-rata capaian: ${c.parsed.y}%`, ` ${n} karyawan${hint}`];
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: yMax,
          grid: { color: 'rgba(148,163,184,.12)', drawBorder: false },
          border: { display: false },
          ticks: {
            callback: v => v + '%',
            color: '#94a3b8',
            font: { size: 11 },
            stepSize: 25,
            padding: 8,
          }
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: '#475569',
            font: { size: 11, weight: '600' },
            maxRotation: 30,
            padding: 6,
          }
        }
      },
      onClick: (_, els) => {
        if (!els.length) return;
        const picked = labels[els[0].index];
        if (isSA && !_capChartDrillCompany) {
          // Top-level: drill-down ke dept + filter tabel ke perusahaan
          _capChartDrillCompany = picked;
          const coSel = document.getElementById('capPerusahaan');
          if (coSel) coSel.value = picked;
        } else {
          // Dept chart (SA drill-down atau ADMIN): filter tabel ke dept
          const deptSel = document.getElementById('capDept');
          if (deptSel) deptSel.value = picked;
        }
        computeAndRender();
      },
      onHover: (evt, els) => {
        evt.native.target.style.cursor = els.length ? 'pointer' : 'default';
      },
    }
  });
}

window.capChartBack = function() {
  _capChartDrillCompany = null;
  // Reset filter perusahaan & dept agar tabel kembali ke semua data
  const coSel   = document.getElementById('capPerusahaan');
  const deptSel = document.getElementById('capDept');
  if (coSel)   coSel.value   = '';
  if (deptSel) deptSel.value = '';
  computeAndRender();
};

function copyWa() {
  if (!_capFiltered.length) { alert('Tidak ada data untuk disalin.'); return; }

  const monthStr = document.getElementById('capMonth')?.value || '';
  const coF      = document.getElementById('capPerusahaan')?.value || '';
  const deptF    = document.getElementById('capDept')?.value || '';

  // Hanya yang belum 100%
  const belum = _capFiltered.filter(r => r.pctTotal === null || r.pctTotal < 100);
  if (!belum.length) {
    alert('Semua karyawan sudah mencapai 100%! 🎉');
    return;
  }

  // Format bulan Indonesia
  let bulan = monthStr;
  if (monthStr) {
    const d = new Date(monthStr + '-01');
    bulan = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  }

  const filterParts = [coF, deptF].filter(Boolean);
  let text = `*Rekap Capaian SAP — ${bulan}*\n`;
  if (filterParts.length) text += `_${filterParts.join(' · ')}_\n`;
  text += `_Karyawan dengan capaian < 100%_\n`;

  // Group by departemen
  const byDept = {};
  belum.forEach(r => {
    const dept = r.k['DEPARTEMEN'] || 'Lainnya';
    if (!byDept[dept]) byDept[dept] = [];
    byDept[dept].push(r);
  });

  Object.keys(byDept).sort().forEach(dept => {
    text += `\n*${dept}*\n`;
    // Urutkan dari capaian terendah
    byDept[dept]
      .sort((a, b) => (a.pctTotal ?? -1) - (b.pctTotal ?? -1))
      .forEach(r => {
        const nama  = r.k['NAMA'] || '-';
        const total = r.pctTotal !== null ? r.pctTotal + '%' : '-';
        const hr    = r.pctHR    !== null ? `HR: ${r.pctHR}%` : '';
        const ins   = r.pctINS   !== null ? `INS: ${r.pctINS}%` : '';
        const detail = [hr, ins].filter(Boolean).join(' | ');
        text += `• ${nama}: *${total}*${detail ? ` (${detail})` : ''}\n`;
      });
  });

  text += `\n_Total ${belum.length} karyawan belum mencapai 100%_`;

  const btn = document.getElementById('capWaBtn');
  const setFeedback = (ok) => {
    if (!btn) return;
    const orig = `<i class="fa-brands fa-whatsapp"></i> Salin ke WA`;
    btn.innerHTML = ok
      ? '<i class="fa-solid fa-check"></i> Tersalin!'
      : '<i class="fa-solid fa-xmark"></i> Gagal';
    btn.style.color = ok ? '#22c55e' : '#ef4444';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2200);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => setFeedback(true)).catch(() => setFeedback(false));
  } else {
    // fallback untuk browser lama
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); setFeedback(true); } catch { setFeedback(false); }
    document.body.removeChild(ta);
  }
}

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
