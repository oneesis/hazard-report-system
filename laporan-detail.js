let detailReport = null;
let detailStatus = 'OPEN';
let detailAfterPhotos = [];

function renderWaBadge(r, isInspection) {
  const badge = document.getElementById('dfWaBadge');
  const btn   = document.getElementById('dfWaResendBtn');
  if (!badge) return;
  const raw = (r['WA_PIC_STATUS'] || r['wa_pic_status'] || '').trim().toUpperCase();
  const map = {
    'TERKIRIM':    { label: '✓ Terkirim', cls: 'terkirim' },
    'GAGAL':       { label: '✗ Gagal',    cls: 'gagal' },
    'TIDAK ADA WA':{ label: 'Tidak ada nomor WA', cls: 'tidak-ada' },
  };
  const info = map[raw] || { label: raw || '-', cls: 'tidak-ada' };
  badge.textContent = info.label;
  badge.className   = `detail-wa-badge ${info.cls}`;
  if (btn) btn.style.display = (raw !== 'TIDAK ADA WA') ? '' : 'none';
}

async function resendWaPic() {
  const r = detailReport;
  if (!r) return;
  const id   = getReportId(r);
  const isInspection = String(id).startsWith('INSP-');
  const sheet = isInspection
    ? (r['inspection_sheet'] || r['INSPECTION_SHEET'] || r['jenis_inspeksi'] || r['JENIS INSPEKSI'] || '').trim().toUpperCase()
    : 'Hazard_Report';

  const btn = document.getElementById('dfWaResendBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }

  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resendWaPic', data: { report_id: id, sheet_name: sheet } })
    });
    const result = await res.json();
    if (result.wa_pic_status) {
      r['WA_PIC_STATUS'] = result.wa_pic_status;
      renderWaBadge(r, isInspection);
    }
    const msg = result.message || (result.status === 'success' ? 'WA berhasil dikirim.' : 'Gagal mengirim WA.');
    showToast(msg, result.status === 'success' ? 'success' : 'error');
  } catch (e) { showToast(e.message, 'error'); }
  finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Kirim Ulang'; }
  }
}

async function initDetailPage() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) return showError('Tidak ada ID laporan pada URL.');

  try {
    const all = await fetchAllReports();
    const report = all.find(r => getReportId(r) === id);
    if (!report) return showError(`Laporan "${id}" tidak ditemukan.`);

    detailReport = report;
    renderDetail(report);
    document.getElementById('detailLoading').style.display = 'none';
    document.getElementById('detailMain').style.display = '';

    // Photo zoom setup
    document.getElementById('photoZoomClose')?.addEventListener('click', () => {
      document.getElementById('photoZoomOverlay')?.classList.remove('active');
    });
  } catch (e) {
    showError('Gagal memuat data: ' + e.message);
  }
}

function showError(msg) {
  document.getElementById('detailLoading').style.display = 'none';
  document.getElementById('detailError').style.display = '';
  document.getElementById('detailErrorMsg').textContent = msg;
}

function renderDetail(r) {
  const isInspection = (r.report_type || 'HAZARD').toString().toUpperCase() === 'INSPECTION';
  const status       = r.status_perbaikan || 'OPEN';
  const id           = getReportId(r);
  detailStatus       = status;

  // Breadcrumb
  document.getElementById('bcType').textContent = isInspection ? 'Inspeksi' : 'Hazard';
  document.getElementById('bcId').textContent   = id;
  document.title = `${id} - ONE-SAP`;

  // Hero
  const heroType = document.getElementById('heroTypeBadge');
  heroType.textContent = isInspection ? 'Inspeksi' : 'Hazard';
  heroType.className   = `report-type-badge ${isInspection ? 'inspection' : 'hazard'}`;

  const heroStatus = document.getElementById('heroStatusBadge');
  heroStatus.textContent = status;
  heroStatus.className   = `status-badge status-${status.toLowerCase()}`;

  const due = new Date(r.batas_waktu || r.due_date || '');
  if (!isNaN(due) && status !== 'CLOSED' && due < new Date()) {
    document.getElementById('heroOverdueBadge').style.display = '';
  }

  document.getElementById('heroId').textContent = id;
  document.getElementById('heroDate').innerHTML =
    `<i class="fa-regular fa-calendar"></i> ${fmt(getReportValue(r, ['timestamp','tanggal_laporan','tgl_laporan','tanggal_inspeksi'], ''))}`;

  // Info fields
  set('dfId',       id);
  set('dfDate',     fmt(getReportValue(r, ['timestamp','tanggal_laporan','tgl_laporan','tanggal_inspeksi','tanggal_kejadian'], '-')));
  set('dfReporter', getReportValue(r, ['nama','pelapor'], '-'));
  set('dfDept',     getReportValue(r, ['departemen','department','bagian'], '-'));
  set('dfLokasi',   getDashboardLocation(r) || '-');

  document.getElementById('dfCategoryLabel').textContent = isInspection ? 'Jenis Inspeksi' : 'Kategori';
  set('dfCategory', getDashboardCategory(r));

  document.getElementById('dfRiskLabel').textContent = isInspection ? 'Shift' : 'Tingkat Risiko';
  const riskVal = isInspection
    ? getReportValue(r, ['shift_inspeksi','shift_kejadian'], '-')
    : getReportValue(r, ['tingkat_resiko','tingkat_risiko','risiko','risk_level'], '-');
  set('dfRisk', riskVal);

  // Description & recommendation
  document.getElementById('dfDescTitle').textContent = isInspection ? 'Temuan Inspeksi' : 'Deskripsi Temuan';
  set('dfDesc', getDashboardDescription(r) || '-');
  set('dfReko', getReportValue(r, [
    'tindakan_perbaikan_yang_diusulkan_kepada_penanggungjawab_pic',
    'tindakan_perbaikan_yang_langsung_dilakukan',
    'tindakan_usulan_pic','rekomendasi_perbaikan','recommendation','rekomendasi','tindakan_perbaikan'
  ], '-'));

  // Pernyataan + signature
  const stmt = getReportValue(r, ['pernyataan'], '-');
  set('dfStatement', stmt === 'Ya' ? 'Pelapor telah menyetujui pernyataan laporan.' : stmt);
  const sig = getReportValue(r, ['tanda_tangan','signature'], '');
  if (sig) {
    const sigEl = document.getElementById('dfSignature');
    sigEl.src = sig; sigEl.style.display = '';
  }

  // Tindak lanjut
  set('dfPic',     getReportValue(r, ['nama_pic','pic','penanggung_jawab'], '-'));
  set('dfDueDate', fmt(getReportValue(r, ['batas_waktu','due_date','tanggal_due','tgl_jatuh_tempo'], '-')));

  // WA PIC badge
  renderWaBadge(r, isInspection);

  const statusBadge = document.getElementById('dfStatusBadge');
  statusBadge.textContent = status;
  statusBadge.className   = `status-badge status-${status.toLowerCase()}`;

  if (status === 'CLOSED') {
    const closingDate = getReportValue(r, ['tanggal_closing','closing_date','tgl_closing','tanggal_selesai','tgl_selesai'], '');
    if (closingDate) {
      document.getElementById('dfClosingDateRow').style.display = '';
      set('dfClosingDate', fmt(closingDate));
    }
  }

  // Photos
  renderGallery('galleryBefore', getImages(r, ['upload_foto_bahaya','upload_foto_inspeksi','upload_foto_bahaya_pic','foto_temuan','foto_before','foto_before_url','foto_bahaya']));
  renderGallery('galleryAfter',  getImages(r, ['upload_foto_perbaikan_pic','upload_foto_perbaikan','foto_perbaikan','foto_after','foto_after_url','after_photo']));

  // Closing form — show for admin or non-closed
  const user    = getCurrentUser();
  const isAdmin = isAdminOrAbove(user?.role);
  if (isAdmin || status !== 'CLOSED') {
    document.getElementById('closingForm').style.display = '';
    wireClosingForm(r, status);
  }

  // Timeline
  renderTimeline(r, status, isInspection);
}

// ── Closing form wiring ──
function wireClosingForm(r, status) {
  const noteTa = document.getElementById('detailClosingNote');
  noteTa.value = getReportValue(r, ['catatan_closing','closing_note','catatan','catatan_closing_pic'], '');

  // Status buttons
  document.querySelectorAll('#detailStatusButtons .status-button').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.status === status);
    btn.addEventListener('click', () => {
      detailStatus = btn.dataset.status;
      document.querySelectorAll('#detailStatusButtons .status-button')
        .forEach(b => b.classList.toggle('selected', b === btn));
      document.getElementById('closingRequired').style.display =
        detailStatus === 'CLOSED' ? '' : 'none';
    });
  });

  // After photo upload
  document.getElementById('detailAfterPhoto')?.addEventListener('change', handleDetailPhoto);
}

function handleDetailPhoto(e) {
  const files = Array.from(e.target.files || []);
  detailAfterPhotos = [];
  const preview = document.getElementById('afterPhotoPreview');
  preview.innerHTML = '';

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      detailAfterPhotos.push(ev.target.result);
      const wrap = document.createElement('div');
      wrap.className = 'detail-gallery-img';
      wrap.innerHTML = `<img src="${ev.target.result}" alt="preview">`;
      preview.appendChild(wrap);
    };
    reader.readAsDataURL(file);
  });
}

async function submitDetailClosing() {
  if (!detailReport) return;
  const note = document.getElementById('detailClosingNote')?.value.trim() || '';

  if (detailStatus === 'CLOSED' && !note) {
    showToast('Catatan Closing wajib diisi.', 'error');
    document.getElementById('detailClosingNote')?.focus();
    return;
  }

  const existingAfter = getReportValue(detailReport, ['upload_foto_perbaikan_pic','upload_foto_perbaikan','foto_perbaikan'], '');
  if (detailStatus === 'CLOSED' && !detailAfterPhotos.length && !existingAfter) {
    showToast('Upload Foto Perbaikan wajib jika status CLOSED.', 'error');
    return;
  }

  const btn = document.getElementById('btnDetailSubmit');
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

  try {
    const payload = {
      id: detailReport.id,
      inspection_sheet: detailReport.inspection_sheet || '',
      catatan_closing: note,
      tanggal_closing: new Date().toISOString(),
      status_perbaikan: detailStatus
    };
    if (detailAfterPhotos.length) payload.upload_foto_perbaikan_pic = JSON.stringify(detailAfterPhotos);

    const isInspection = (detailReport.report_type || '').toUpperCase() === 'INSPECTION';
    const res  = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: isInspection ? 'updateInspectionReport' : 'updateHazardReport', data: payload })
    });

    const result = await res.json();
    if (result.status !== 'success') throw new Error(result.message || 'Gagal menyimpan.');

    detailReport.status_perbaikan  = detailStatus;
    detailReport.catatan_closing   = note;
    detailReport.tanggal_closing   = payload.tanggal_closing;

    showToast('Status berhasil diupdate!');
    setTimeout(() => window.location.reload(), 1200);

  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Closing';
  }
}

// ── Timeline ──
function renderTimeline(r, status, isInspection) {
  const el = document.getElementById('detailTimeline');
  if (!el) return;

  const dateCreated = getReportValue(r, ['timestamp','tanggal_laporan','tgl_laporan','tanggal_inspeksi','tanggal_kejadian'], '');
  const pic         = getReportValue(r, ['nama_pic','pic','penanggung_jawab'], '');
  const dateClosing = getReportValue(r, ['tanggal_closing','closing_date','tgl_closing','tanggal_selesai'], '');
  const closingNote = getReportValue(r, ['catatan_closing','closing_note','catatan_closing_pic'], '');

  const items = [];

  items.push({
    dot: 'done', label: isInspection ? 'Inspeksi Dibuat' : 'Laporan Dibuat',
    date: fmt(dateCreated)
  });

  if (pic) {
    items.push({
      dot: 'done', label: 'PIC Ditugaskan',
      date: fmt(dateCreated),
      note: pic
    });
  }

  if (status === 'PROGRESS' || status === 'CLOSED') {
    items.push({
      dot: 'progress', label: 'Sedang Ditangani (PROGRESS)',
      date: '-'
    });
  }

  if (status === 'CLOSED') {
    items.push({
      dot: 'closed', label: 'Laporan Ditutup',
      date: fmt(dateClosing) || '-',
      note: closingNote || ''
    });
  } else {
    items.push({
      dot: 'pending', label: 'Menunggu Closing',
      date: '-'
    });
  }

  el.innerHTML = items.map(item => `
    <div class="timeline-item">
      <div class="timeline-dot timeline-dot--${item.dot}">
        <i class="fa-solid ${item.dot === 'done' ? 'fa-check' : item.dot === 'closed' ? 'fa-flag-checkered' : item.dot === 'progress' ? 'fa-rotate' : 'fa-clock'}"></i>
      </div>
      <div class="timeline-body">
        <div class="timeline-label">${escapeHTML(item.label)}</div>
        <div class="timeline-date">${escapeHTML(item.date)}</div>
        ${item.note ? `<div class="timeline-note">${escapeHTML(item.note)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ── Helpers ──
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function fmt(val) {
  if (!val || val === '-') return '-';
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
}

function getImages(report, keys) {
  const raw = getReportValue(report, keys, '');
  if (!raw) return [];
  return String(raw).split(/[\n,;]+/).map(u => u.trim()).filter(Boolean).map(normalizeImageUrl);
}

function normalizeImageUrl(url) {
  const trimmed = String(url || '').trim();
  const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w2000`;
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w2000`;
  return trimmed;
}

function getDashboardLocation(r) {
  return String(getReportValue(r, ['lokasi_bahaya','lokasi_inspeksi','lokasi','location'], ''));
}

function getDashboardDescription(r) {
  return String(getReportValue(r, ['deskripsi_bahaya','temuan_inspeksi','deskripsi','description'], ''));
}

function getDashboardCategory(r) {
  return getReportValue(r, ['jenis_bahaya','jenis_inspeksi','kategori_hazard','kategori'], '-');
}

function renderGallery(containerId, urls) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!urls.length) {
    el.innerHTML = '<p class="gallery-empty">Tidak ada foto.</p>';
    return;
  }
  el.innerHTML = urls.map((url, i) => `
    <div class="detail-gallery-img" onclick="zoomPhoto('${url}')">
      <img src="${url}" alt="Foto ${i + 1}" loading="lazy">
    </div>
  `).join('');
}

function zoomPhoto(url) {
  const overlay = document.getElementById('photoZoomOverlay');
  const img     = document.getElementById('zoomedPhoto');
  if (overlay && img) { img.src = url; overlay.classList.add('active'); }
}

function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 3000);
}
