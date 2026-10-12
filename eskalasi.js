// Paging + pencarian (2026-10-12, evaluasi UX U5): dulu SEMUA kartu (400+) dirender
// sekaligus → halaman ±80.000px di HP. Sekarang 12 per kelompok + "Tampilkan lagi".
const ESK_PER = 12;
const _eskData = { overdue: [], warning: [], ok: [] };
const _eskShown = { overdue: ESK_PER, warning: ESK_PER, ok: ESK_PER };
let _eskQuery = '';
const ESK_TARGET = { overdue: ['cardsOverdue', 'countOverdue'], warning: ['cardsWarning', 'countWarning'], ok: ['cardsOk', 'countOk'] };

function eskCocok(r) {
  if (!_eskQuery) return true;
  const teks = [getReportId(r), r.nama_pic, r.nama, r.perusahaan, r.company, getDashboardLocation(r), r.deskripsi_bahaya, r.temuan]
    .map((x) => String(x || '').toLowerCase()).join(' ');
  return _eskQuery.split(/\s+/).every((q) => teks.includes(q));
}

function eskCari(v) {
  _eskQuery = String(v || '').trim().toLowerCase();
  for (const t of Object.keys(_eskShown)) _eskShown[t] = ESK_PER;
  for (const t of Object.keys(ESK_TARGET)) renderGroup(...ESK_TARGET[t], _eskData[t], t);
}

function eskLagi(type) {
  _eskShown[type] += ESK_PER;
  renderGroup(...ESK_TARGET[type], _eskData[type], type);
}

async function loadEskalasi() {
  const btn = document.getElementById('btnRefresh');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...'; }

  try {
    const user = getCurrentUser();
    let all = await fetchAllReports();

    // ADMIN (bukan SUPER_ADMIN): filter by perusahaan atau sebagai PIC
    if (!isSuperAdminRole(user?.role)) {
      const myPerusahaan = String(user?.perusahaan || '').trim().toLowerCase();
      const myNama = String(user?.nama || '').trim().toLowerCase();
      const myNik  = String(user?.nik  || '').trim().toLowerCase();
      all = all.filter(r => {
        const rPerusahaan = String(r.perusahaan || r.company || '').trim().toLowerCase();
        const rPic        = String(r.nama_pic || '').trim().toLowerCase();
        const rNikPic     = String(r.nik_pic || '').trim().toLowerCase();
        return (myPerusahaan && rPerusahaan === myPerusahaan) ||
               (myNama && rPic === myNama) ||
               (myNik  && rNikPic === myNik);
      });
    }

    const active = all.filter(r => r.status_perbaikan !== 'CLOSED');

    const overdue = [], warning = [], ok = [], nodue = [];

    active.forEach(r => {
      const due = new Date(r.batas_waktu || r.due_date || '');
      if (isNaN(due)) { nodue.push(r); return; }
      const days = Math.round((due - new Date()) / 86400000);
      if (days < 0)       overdue.push({ ...r, _days: days });
      else if (days <= 3) warning.push({ ...r, _days: days });
      else                ok.push({ ...r, _days: days });
    });

    // Sort each group by urgency
    overdue.sort((a, b) => a._days - b._days);
    warning.sort((a, b) => a._days - b._days);
    ok.sort((a, b) => a._days - b._days);

    // Summary
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('sumOverdue', overdue.length);
    set('sumWarning', warning.length);
    set('sumOk',      ok.length);
    set('sumNoDue',   nodue.length);

    Object.assign(_eskData, { overdue, warning, ok });
    renderGroup('cardsOverdue', 'countOverdue', overdue, 'overdue');
    renderGroup('cardsWarning', 'countWarning', warning, 'warning');
    renderGroup('cardsOk',      'countOk',      ok,      'ok');

  } catch (e) {
    console.error('Eskalasi load error', e);
    ['cardsOverdue','cardsWarning','cardsOk'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p class="esk-empty">Gagal memuat data.</p>';
    });
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh'; }
  }
}

function renderGroup(cardsId, countId, allReports, type) {
  const count = document.getElementById(countId);
  const cards = document.getElementById(cardsId);
  const reports = allReports.filter(eskCocok);
  if (count) count.textContent = _eskQuery ? `${reports.length} / ${allReports.length}` : reports.length;
  if (!cards) return;

  if (!reports.length) {
    const labels = { overdue: 'Tidak ada laporan overdue.', warning: 'Tidak ada laporan dalam warning.', ok: 'Semua laporan aktif on track.' };
    cards.innerHTML = `<p class="esk-empty">${_eskQuery ? 'Tidak ada yang cocok dengan pencarian.' : labels[type]}</p>`;
    return;
  }

  const shown = reports.slice(0, _eskShown[type] || ESK_PER);
  const sisa = reports.length - shown.length;
  cards.innerHTML = shown.map(r => eskCard(r, type)).join('')
    + (sisa > 0 ? `<div class="esk-more"><button type="button" onclick="eskLagi('${type}')">Tampilkan ${Math.min(ESK_PER, sisa)} lagi</button><small>Menampilkan ${shown.length} dari ${reports.length}</small></div>` : '');
}

function eskCard(r, type) {
  const id    = escapeHTML(getReportId(r) || '-');
  const desc  = escapeHTML((r.deskripsi_bahaya || r.temuan || '-').substring(0, 120));
  const pic   = escapeHTML(r.nama_pic || '-');
  const picWa = (r.wa_pic || r.whatsapp_pic || '').replace(/\D/g, '');
  const pelapor = escapeHTML(r.nama || '-');
  const lokasi  = escapeHTML(getDashboardLocation(r));
  const status  = r.status_perbaikan || 'OPEN';
  const days    = r._days ?? null;
  const due     = new Date(r.batas_waktu || r.due_date || '');

  const dueFmt = isNaN(due) ? '-' : due.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

  let pillLabel, dueCls;
  if (type === 'overdue') {
    pillLabel = `${Math.abs(days)} hari telat`;
    dueCls = 'esk-due-date--overdue';
  } else if (type === 'warning') {
    pillLabel = days === 0 ? 'Hari ini!' : `${days} hari lagi`;
    dueCls = 'esk-due-date--warning';
  } else {
    pillLabel = `${days} hari lagi`;
    dueCls = '';
  }

  const badgeCls = status === 'OPEN' ? 'status-open' : 'status-progress';

  const adaPic = (r.nama_pic || r.nik_pic) && pic !== '-';
  const waBtn = adaPic
    ? `<button class="btn-wa-reminder" onclick="ingatkanPic(this,'${id}')" title="Kirim pengingat ke PIC lewat email & notifikasi">
        <i class="fa-solid fa-bell"></i> Ingatkan PIC
       </button>`
    : `<button class="btn-wa-reminder" disabled title="PIC belum ditentukan">
        <i class="fa-solid fa-bell"></i> Ingatkan PIC
       </button>`;

  return `<div class="esk-card esk-card--${type}">
    <div class="esk-card-top">
      <span class="esk-card-id">${id}</span>
      <span class="esk-sla-pill esk-sla-pill--${type}">${escapeHTML(pillLabel)}</span>
    </div>
    <p class="esk-card-desc">${desc}</p>
    <div class="esk-card-meta">
      <div class="esk-meta-item"><i class="fa-solid fa-user"></i> ${pelapor}</div>
      <div class="esk-meta-item"><i class="fa-solid fa-location-dot"></i> ${lokasi}</div>
      <div class="esk-meta-item"><i class="fa-solid fa-user-tie"></i> PIC: ${pic}</div>
      <div class="esk-meta-item"><span class="status-badge ${badgeCls}" style="font-size:.62rem;padding:2px 6px">${escapeHTML(status)}</span></div>
    </div>
    <div class="esk-card-footer">
      <div>
        <div class="esk-due-label">Batas Waktu</div>
        <div class="esk-due-date ${dueCls}">${escapeHTML(dueFmt)}</div>
      </div>
      ${waBtn}
    </div>
  </div>`;
}

// Pengingat PIC lewat server — email + notifikasi PWA (2026-10-12, dulu buka WhatsApp).
async function ingatkanPic(btn, reportId) {
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';
  try {
    const res = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ingatkanPic', data: { report_id: reportId } }) });
    const j = await res.json();
    if (!res.ok || j.status !== 'success') throw new Error(j.message || 'Gagal mengirim pengingat.');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Terkirim';
    if (typeof showToast === 'function') showToast(j.message, 'success');
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-bell"></i> Ingatkan PIC';
    if (typeof showToast === 'function') showToast(e.message, 'error'); else alert(e.message);
  }
}

// (lama, tidak dipakai lagi) buka WhatsApp manual
function sendWaReminder(waNumber, reportId, picName) {
  const user = getCurrentUser();
  const sender = user?.nama || 'Tim ONE-SAP';
  const msg = encodeURIComponent(
    `Halo ${picName},\n\nIni adalah pengingat dari sistem ONE-SAP.\n\n` +
    `Laporan *${reportId}* yang Anda tangani memerlukan tindak lanjut segera.\n\n` +
    `Mohon segera update status atau lakukan closing melalui sistem.\n\n` +
    `— ${sender}`
  );
  const url = `https://wa.me/${waNumber}?text=${msg}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
