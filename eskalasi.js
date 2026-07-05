async function loadEskalasi() {
  const btn = document.getElementById('btnRefresh');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...'; }

  try {
    const all = await fetchAllReports();
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

function renderGroup(cardsId, countId, reports, type) {
  const count = document.getElementById(countId);
  const cards = document.getElementById(cardsId);
  if (count) count.textContent = reports.length;
  if (!cards) return;

  if (!reports.length) {
    const labels = { overdue: 'Tidak ada laporan overdue.', warning: 'Tidak ada laporan dalam warning.', ok: 'Semua laporan aktif on track.' };
    cards.innerHTML = `<p class="esk-empty">${labels[type]}</p>`;
    return;
  }

  cards.innerHTML = reports.map(r => eskCard(r, type)).join('');
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

  const waBtn = picWa
    ? `<button class="btn-wa-reminder" onclick="sendWaReminder('${escapeHTML(picWa)}','${escapeHTML(id)}','${escapeHTML(pic)}')">
        <i class="fa-brands fa-whatsapp"></i> Ingatkan PIC
       </button>`
    : `<button class="btn-wa-reminder" disabled title="No. WA PIC tidak tersedia">
        <i class="fa-brands fa-whatsapp"></i> Ingatkan PIC
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
        <div class="esk-due-label">Due Date</div>
        <div class="esk-due-date ${dueCls}">${escapeHTML(dueFmt)}</div>
      </div>
      ${waBtn}
    </div>
  </div>`;
}

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
