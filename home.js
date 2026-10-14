document.addEventListener('DOMContentLoaded', initHomePage);

let _currentObj = null;
let _extraActivities = []; // SBO/PC/ST milik user (feed "Laporan Terakhir")
let _stRows = [];   // riwayat ST milik sendiri (getMySafetyTalkHistory) — panel ST & capaian ST
let _stCounts = []; // jumlah jadwal ST per bulan×perusahaan (OBJ ST, lihat stObjForMonth)

const INSPECTION_AREAS = [
  { type: 'INS_CB', name: 'Conveyor Belt',     sub: 'Area Produksi',    icon: 'fa-gears' },
  { type: 'INS_JA', name: 'Jalan Angkut',       sub: 'Main Hauling',     icon: 'fa-truck' },
  { type: 'INS_MD', name: 'Mess dan Dapur',     sub: 'Camp Utama',       icon: 'fa-utensils' },
  { type: 'INS_KG', name: 'Kantor & Gudang',    sub: 'Logistics Center', icon: 'fa-building' },
  { type: 'INS_SP', name: 'Settling Pond',      sub: 'Water Management', icon: 'fa-water' },
  { type: 'INS_T',  name: 'Tambang',            sub: 'Pit West Wing',    icon: 'fa-helmet-safety' },
  { type: 'INS_TB', name: 'Tangki BBM',         sub: 'Fuel Station',     icon: 'fa-gas-pump' },
  { type: 'INS_WS', name: 'Workshop',           sub: 'Maintenance Yard', icon: 'fa-wrench' },
];

// Satu palet warna modul — dipakai ikon beranda, label "Laporan Terakhir", dll.
const MOD_COLORS = { HAZARD: '#d97706', INSPECTION: '#16a34a', SBO: '#4f46e5', PC: '#0d9488', ST: '#7c3aed' };

// Badge angka di pojok ikon modul (0 = sembunyi).
function setModBadge(key, n) {
  const b = document.querySelector(`.mod-badge[data-badge="${key}"]`);
  if (!b) return;
  b.textContent = n > 9 ? '9+' : String(n);
  b.hidden = !(n > 0);
}

const DAYS_ID  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// ── Status data di bawah salam: waktu update / offline / laporan offline tertunda.
let _lastUpdated = null, _pendingOffline = 0, _syncState = 'idle';
function renderSyncStatus() {
  const el = document.getElementById('greetingSync');
  if (!el) return;
  let icon, color, text;
  if (!navigator.onLine) {
    icon = 'fa-cloud'; color = '#b45309';
    text = 'Offline · ' + (_pendingOffline ? `${_pendingOffline} laporan menunggu jaringan` : 'menampilkan data terakhir');
  } else if (_syncState === 'syncing') {
    icon = 'fa-arrows-rotate fa-spin'; color = '#2563eb'; text = 'Mengirim laporan offline…';
  } else if (_pendingOffline) {
    icon = 'fa-cloud-arrow-up'; color = '#b45309'; text = `${_pendingOffline} laporan offline menunggu dikirim`;
  } else {
    icon = 'fa-circle-check'; color = '#22c55e';
    text = _lastUpdated ? 'Diperbarui ' + _lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Memuat data…';
  }
  el.innerHTML = `<i class="fa-solid ${icon}" style="color:${color};font-size:.7rem"></i> ${text}`;
}
window.addEventListener('online', renderSyncStatus);
window.addEventListener('offline', renderSyncStatus);
window.addEventListener('offlinequeuechange', e => {
  _pendingOffline = e.detail?.pending || 0;
  _syncState = e.detail?.state || 'idle';
  if (_syncState === 'done') _lastUpdated = new Date();
  renderSyncStatus();
});

async function initHomePage() {
  renderGreeting();
  renderSyncStatus();
  renderInsGrid();
  renderHazardDraft();
  const stPromise = renderPenggantiST(); // resolve = jumlah kuis pengganti yg belum
  initNotificationBell();
  // popup konfirmasi onsite pasca cuti dulu; kuis ST menunggu buka berikutnya (tak menumpuk)
  maybeShowOnsitePopup().then(shown => { if (!shown) maybeShowStQuizPopup(); }); // kuis: capaian ST belum 100% & bukan mangkir
  renderPushBanner();     // ajakan aktifkan notifikasi PWA (U3)
  renderBerandaDD();      // cuaca & fokus minggu ini (deteksi dini) — tidak menunggu

  try {
    const [reports, obj, extras, stCounts] = await Promise.all([refreshNotifications(), fetchMyObj(), fetchMyActivityExtras(),
      fetch('/api?action=getStScheduleCounts').then(r => r.json()).then(j => j.data || []).catch(() => [])]);
    _stCounts = stCounts;
    _currentObj = obj;
    _extraActivities = extras;

    // Banner & quick-stats tetap HANYA HR/INS (punya siklus OPEN/CLOSED & PIC).
    // Feed "Laporan Terakhir" + capaian SAP gabung SBO/PC/ST.
    const feed = [...reports, ...extras];
    renderActionBanner(reports);
    renderMyReports(feed);
    renderQuickStats(reports);
    renderSapAchievement(feed, obj);
    renderInsAreaInfo(reports);
    _lastUpdated = new Date(); renderSyncStatus();
    stPromise.then(() => renderSapAchievement()); // tambah baris Safety Talk begitu riwayat ST tiba

    // Buka otomatis panel yang butuh tindakan: Safety Talk bila ada kuis tertunda.
    const stPending = await stPromise;
    if (stPending > 0 && !document.querySelector('.mod-panel.open')) toggleModule('st');

    // search filter
    let _allReports = feed;
    document.getElementById('myReportsSearch')?.addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      renderMyReports(_allReports, q);
    });

    // update saat auto-refresh dari layout.js (e.detail = HR/INS terbaru)
    document.addEventListener('reportsRefreshed', e => {
      const merged = [...(e.detail || []), ..._extraActivities];
      _allReports = merged;
      const q = (document.getElementById('myReportsSearch')?.value || '').trim().toLowerCase();
      renderActionBanner(e.detail);
      renderMyReports(merged, q);
      renderQuickStats(e.detail);
      renderSapAchievement(merged, _currentObj);
      renderInsAreaInfo(e.detail);
      _lastUpdated = new Date(); renderSyncStatus();
    });
  } catch (e) {
    console.error('Home load error', e);
    const el = document.getElementById('myReportsList');
    if (el) el.innerHTML = `<div style="text-align:center;padding:24px 16px">
      <p style="color:#ef4444;font-size:.9rem;margin-bottom:12px"><i class="fa-solid fa-circle-exclamation"></i> Gagal memuat laporan.</p>
      <button onclick="location.reload()" style="padding:8px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer"><i class="fa-solid fa-arrows-rotate"></i> Coba Lagi</button>
    </div>`;
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

// SBO/PC/ST milik user untuk feed "Laporan Terakhir". Fail-open ([]) supaya
// beranda tetap tampil kalau endpoint gagal.
async function fetchMyActivityExtras() {
  try {
    const res = await fetch('/api?action=getMyActivityExtras');
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch { return []; }
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

  const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
  const roleChip = role === 'SUPER_ADMIN' ? 'SUPER ADMIN' : role === 'ADMIN' ? 'ADMIN' : '';
  if (dayEl) dayEl.innerHTML = dateStr +
    (roleChip ? ` <span class="role-chip"><i class="fa-solid fa-shield-halved"></i> ${roleChip}</span>` : '');
  // Nama dari roster huruf besar semua ("ANDRE") → kapital awal ("Andre").
  const first = String(user?.nama || '').trim().split(/\s+/)[0] || '';
  const nice  = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  if (nameEl) nameEl.textContent = nice ? `${greet}, ${nice}` : greet;

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
      <div class="ins-card-meta" data-ins="${area.type}"></div>
      <span class="ins-card-go">Mulai <i class="fa-solid fa-arrow-right"></i></span>
    </a>
  `).join('');
}

// Info kecil per area: kapan terakhir diinspeksi (dari laporan yang terlihat user).
function renderInsAreaInfo(reports) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last = {};
  (reports || []).forEach(r => {
    if (String(r.report_type || '').toUpperCase() !== 'INSPECTION') return;
    const code = String(r.inspection_sheet || r.jenis_inspeksi || r.tipe_inspeksi || '').trim().toUpperCase();
    const d = new Date(r.tanggal_inspeksi || r.timestamp || '');
    if (!code || isNaN(d)) return;
    if (!last[code] || d > last[code]) last[code] = d;
  });
  document.querySelectorAll('.ins-card-meta[data-ins]').forEach(el => {
    const d = last[el.dataset.ins];
    if (!d) { el.textContent = 'Belum ada'; el.className = 'ins-card-meta ins-meta-none'; return; }
    const days = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    el.textContent = 'Terakhir: ' + (days <= 0 ? 'hari ini' : days === 1 ? 'kemarin'
      : days < 30 ? `${days} hr lalu` : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }));
    el.className = 'ins-card-meta' + (days > 30 ? ' ins-meta-old' : '');
  });
}

// ── Accordion modul beranda: klik ikon → slide-down panelnya, tutup yang lain.
function _closeModPanel(p, b) {
  if (b) { b.classList.remove('active'); b.setAttribute('aria-expanded', 'false'); }
  if (p.classList.contains('open')) {
    // dari 'none' (atau px) → px dulu supaya bisa dianimasikan ke 0
    p.style.maxHeight = p.scrollHeight + 'px';
    requestAnimationFrame(() => { p.classList.remove('open'); p.style.maxHeight = '0px'; });
  } else {
    p.classList.remove('open'); p.style.maxHeight = '0px';
  }
}
function _openModPanel(p, b) {
  if (b) { b.classList.add('active'); b.setAttribute('aria-expanded', 'true'); }
  p.classList.add('open');
  p.style.maxHeight = p.scrollHeight + 'px';
  // setelah animasi selesai, lepas batas supaya konten async (pengganti ST/draft) tak terpotong
  const te = () => { if (p.classList.contains('open')) p.style.maxHeight = 'none'; p.removeEventListener('transitionend', te); };
  p.addEventListener('transitionend', te);
}
function toggleModule(key) {
  const panel = document.getElementById('modPanel-' + key);
  const btn   = document.querySelector('.mod-btn[data-mod="' + key + '"]');
  const isOpen = panel && panel.classList.contains('open');
  document.querySelectorAll('.mod-panel').forEach(p => {
    const b = document.querySelector('.mod-btn[data-mod="' + p.id.replace('modPanel-', '') + '"]');
    _closeModPanel(p, b);
  });
  if (!isOpen && panel) _openModPanel(panel, btn);
}
window.toggleModule = toggleModule;

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
  const descOf = r => (r.deskripsi_bahaya || r.temuan || r.deskripsi_temuan ||
    r.judul_coaching || r.topik_coaching || r.deskripsi_coaching || r.deskripsi || '');
  const recent = query
    ? sorted.filter(r => {
        const id   = (getReportId(r) || '').toLowerCase();
        const desc = descOf(r).toLowerCase();
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

  const TYPE_META = {
    HAZARD:     { label: 'HR',  color: MOD_COLORS.HAZARD },
    INSPECTION: { label: 'INS', color: MOD_COLORS.INSPECTION },
    SBO:        { label: 'SBO', color: MOD_COLORS.SBO },
    PC:         { label: 'PC',  color: MOD_COLORS.PC },
    ST:         { label: 'ST',  color: MOD_COLORS.ST },
  };

  el.innerHTML = recent.map(r => {
    const type    = String(r.report_type || 'HAZARD').toUpperCase();
    const meta    = TYPE_META[type] || TYPE_META.HAZARD;
    const id      = escapeHTML(getReportId(r) || '-');
    const desc    = escapeHTML((descOf(r) || '-').substring(0, 60));
    const dateVal = r.tanggal_laporan || r.tgl_laporan || r.tanggal_inspeksi || r.tgl_observasi || r.tgl_pc || r.timestamp || '';
    const date    = dateVal ? new Date(dateVal).toLocaleDateString('id-ID', { day:'2-digit', month:'short' }) : '';

    // ST tak punya siklus OPEN/CLOSED → pakai status kehadiran. Sisanya OPEN/CLOSED.
    let statusLabel, badgeCls, dotCls, isOverdue = false;
    if (type === 'ST') {
      statusLabel = String(r.status_kehadiran || 'HADIR').toUpperCase();
      const ok = statusLabel === 'HADIR';
      badgeCls = ok ? 'badge-closed' : 'badge-open';
      dotCls   = ok ? 'dot-closed' : 'dot-open';
    } else {
      const status = (getReportStatus(r) || 'OPEN').toUpperCase();
      statusLabel  = status;
      const due     = r.batas_waktu || r.due_date || '';
      const dueDate = due ? new Date(due) : null;
      isOverdue = dueDate && !isNaN(dueDate) && status !== 'CLOSED' && dueDate < new Date();
      dotCls   = `dot-${status.toLowerCase()}`;
      badgeCls = `badge-${status.toLowerCase()}`;
    }

    // HR/INS punya halaman detail; SBO/PC/ST diarahkan ke modulnya masing-masing.
    const href = type === 'SBO' ? 'sbo.html'
      : type === 'PC' ? 'pc.html'
      : type === 'ST' ? 'capaian-sap.html'
      : `laporan-detail.html?id=${encodeURIComponent(getReportId(r) || '')}`;

    const typeChip = `<span style="display:inline-block;font-size:.6rem;font-weight:700;letter-spacing:.03em;color:#fff;background:${meta.color};padding:1px 6px;border-radius:5px;margin-right:6px;vertical-align:middle">${meta.label}</span>`;

    return `<a class="report-item${isOverdue ? ' report-item--overdue' : ''}" href="${href}">
      <div class="report-item-dot ${dotCls}"></div>
      <div class="report-item-body">
        <div class="report-item-id">${typeChip}${id}${isOverdue ? ' <span class="overdue-tag">OVERDUE</span>' : ''}</div>
        <div class="report-item-desc">${desc}</div>
        ${date ? `<div class="report-item-meta">${date}</div>` : ''}
      </div>
      <span class="report-item-badge ${badgeCls}">${statusLabel}</span>
    </a>`;
  }).join('');
}

function renderHazardDraft() {
  const section = document.getElementById('hazardDraftSection');
  const card    = document.getElementById('hazardDraftCard');
  if (!section || !card) return;
  try {
    // Key HARUS sama dengan AUTOSAVE_KEY di script.js (per-NIK), kalau tidak
    // kartu draft tak pernah ketemu → seolah "draft belum ada".
    const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
    const draftKey = `hazard_draft_${u?.nik || u?.nama || 'guest'}`;
    const raw = localStorage.getItem(draftKey) || localStorage.getItem('hazard_draft');
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

// Kartu "Pengganti Safety Talk" — buka quiz-she dgn NRP karyawan (auto-login,
// tanpa ketik NIK) untuk mengganti Safety Talk yang tak dihadiri (Cuti/Dinas/
// Shift/Off) dengan kuis. Terhubung via data NRP.
// Panel Safety Talk di beranda: riwayat kehadiran sendiri (ringkas). Tidak
// hadir (Cuti/Dinas/Shift/Off) → tanda kuis pengganti sudah/belum; Mangkir →
// tak bisa diganti kuis. Tombol kuis hanya muncul bila ada yang belum.
async function renderPenggantiST() {
  const el = document.getElementById('penggantiST');
  if (!el) return;
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const nik = String(u?.nik || '').trim();
  if (!nik) { el.innerHTML = ''; return 0; }
  const quizUrl = `https://quiz-she.vercel.app/?nik=${encodeURIComponent(nik)}`;
  el.innerHTML = '<div class="st-empty">Memuat riwayat…</div>';

  let rows = [];
  try {
    const res = await fetch('/api?action=getMySafetyTalkHistory');
    const json = await res.json();
    rows = Array.isArray(json.data) ? json.data : [];
  } catch {}

  _stRows = rows;
  rows = rows.slice(0, 12); // panel: 12 sesi terakhir
  if (!rows.length) { el.innerHTML = '<div class="st-empty">Belum ada riwayat Safety Talk.</div>'; setModBadge('st', 0); return 0; }

  let pending = 0;
  const fmt = v => { const d = new Date(v); return isNaN(d) ? String(v || '').slice(0, 7) : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const items = rows.map(r => {
    const st = String(r.status_kehadiran || 'HADIR').toUpperCase();
    const quizDone = String(r.quiz_done || '').toUpperCase() === 'YA';
    let badge, needQuiz = false;
    if (st === 'HADIR') badge = '<span class="st-b st-ok"><i class="fa-solid fa-check"></i> Hadir</span>';
    else if (st === 'MANGKIR') badge = '<span class="st-b st-bad">Mangkir</span>';
    else if (quizDone) badge = `<span class="st-b st-ok"><i class="fa-solid fa-check"></i> Kuis selesai</span>`;
    else { pending++; needQuiz = true; badge = '<span class="st-b st-warn">Kerjakan kuis <i class="fa-solid fa-arrow-right"></i></span>'; }
    const sub = st === 'HADIR' || st === 'MANGKIR' ? '' : `<span class="st-why">${escapeHTML(st.charAt(0) + st.slice(1).toLowerCase())}</span>`;
    const inner = `<div class="st-main">
        <div class="st-topic">${escapeHTML(r.judul_materi || 'Safety Talk')}</div>
        <div class="st-date">${fmt(r.tanggal || r.bulan)} ${sub}</div>
      </div>${badge}`;
    // Belum kuis → seluruh baris langsung membuka laman kuis pengganti.
    return needQuiz
      ? `<a class="st-row st-row-link" href="${quizUrl}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<div class="st-row">${inner}</div>`;
  }).join('');

  el.innerHTML = `<div class="st-list">${items}</div>`;
  setModBadge('st', pending);
  return pending;
}

// Popup "sudah onsite?" pasca cuti (2026-10-12). Data JadwalCuti SISTER MINER; tombol
// membuka halaman konfirmasi bertoken yang sama dengan email (tanpa login). Muncul
// sekali per buka aplikasi sampai dikonfirmasi. Resolve true bila popup tampil.
async function maybeShowOnsitePopup() {
  try { if (sessionStorage.getItem('onsite_popup_shown')) return false; } catch {}
  let d = null;
  try { d = (await (await fetch('/api?action=getCutiOnsite')).json()).data; } catch { return false; }
  if (!d || !/^https:\/\//.test(d.tautan || '')) return false;
  try { sessionStorage.setItem('onsite_popup_shown', '1'); } catch {}
  const tgl = v => { const x = new Date(String(v) + 'T00:00:00'); return isNaN(x) ? v : x.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }); };
  const tutup = "document.getElementById('onsitePopup')?.remove()";
  const ov = document.createElement('div');
  ov.id = 'onsitePopup';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:390px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center">
      <div style="width:60px;height:60px;border-radius:16px;background:#15803d;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.7rem;margin:0 auto 14px"><i class="fa-solid fa-person-walking-arrow-right"></i></div>
      <h3 style="margin:0 0 6px;font-size:1.15rem;color:#1e293b">Selamat Datang Kembali</h3>
      <p style="margin:0 0 14px;color:#64748b;font-size:.88rem;line-height:1.5">Menurut jadwal, cuti kamu berakhir <b>${escapeHTML(tgl(d.akhir))}</b>. Apakah kamu sudah kembali onsite?</p>
      <a href="${escapeHTML(d.tautan)}/aksi?jenis=onsite" target="_blank" rel="noopener noreferrer" onclick="${tutup}" style="display:block;background:#15803d;color:#fff;text-decoration:none;padding:13px;border-radius:12px;font-weight:700;font-size:.95rem;margin-bottom:8px">Ya, saya sudah onsite</a>
      <a href="${escapeHTML(d.tautan)}?perpanjang=1" target="_blank" rel="noopener noreferrer" onclick="${tutup}" style="display:block;background:#f1f5f9;color:#1e293b;text-decoration:none;padding:12px;border-radius:12px;font-weight:700;font-size:.9rem;margin-bottom:10px">Cuti saya diperpanjang</a>
      <p style="margin:0 0 8px;color:#64748b;font-size:.8rem;line-height:1.45">Setelah onsite, wajib mengerjakan <b>Reinduksi Pasca Cuti</b> di SIMANTRA K3.</p>
      <button type="button" onclick="${tutup}" style="background:none;border:none;color:#94a3b8;font-size:.9rem;cursor:pointer;padding:6px">Nanti saja</button>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  return true;
}

// Popup kuis pengganti Safety Talk saat buka app (diperbarui 2026-10-11).
// Muncul bila ada sesi ST bulan ini dgn status wajib-kuis (Cuti/Dinas/Shift Malam/
// Libur/Jaga) yang kuisnya belum lulus DAN kuisnya sudah terbit di quiz-she.
// Sekali per buka aplikasi (bisa ditunda "Nanti saja"); dari notifikasi PWA
// (?kuis=1) selalu muncul. Tidak mengunci aplikasi — lapor bahaya tetap bisa.
async function maybeShowStQuizPopup() {
  const dariNotif = new URLSearchParams(location.search).get('kuis') === '1';
  try { if (!dariNotif && sessionStorage.getItem('st_quiz_popup_shown')) return; } catch {}
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const nik = String(u?.nik || '').trim();
  if (!nik) return;
  const WAJIB = ['CUTI', 'DINAS_LUAR', 'SHIFT_MALAM', 'LIBUR', 'SECURITY_JAGA'];
  const LABEL = { CUTI: 'Cuti', DINAS_LUAR: 'Dinas luar', SHIFT_MALAM: 'Shift malam', LIBUR: 'Libur', SECURITY_JAGA: 'Jaga' };
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let pending = [];
  try {
    const json = await (await fetch('/api?action=getMySafetyTalkHistory')).json();
    pending = (Array.isArray(json.data) ? json.data : []).filter(r =>
      String(r.bulan || '').slice(0, 7) === ym
      && WAJIB.includes(String(r.status_kehadiran || '').toUpperCase())
      && String(r.quiz_done || '').toUpperCase() !== 'YA');
  } catch { return; }
  if (!pending.length) return;
  // Hanya sesi yang kuisnya sudah terbit (jangan arahkan ke kuis yang belum ada).
  try {
    const j = await (await fetch('https://quiz-she.vercel.app/api/data?action=sessions')).json();
    const list = Array.isArray(j) ? j : (j.value || j.sessions || []);
    const terbit = new Set(list.filter(x => x.status === 'published').map(x => String(x.topicCode || '').trim()));
    pending = pending.filter(r => terbit.has(String(r.schedule_id || '').trim()));
  } catch { return; }
  if (!pending.length) return;
  try { sessionStorage.setItem('st_quiz_popup_shown', '1'); } catch {}
  if (dariNotif) history.replaceState(null, '', location.pathname);

  const url = `https://quiz-she.vercel.app/?nik=${encodeURIComponent(nik)}`;
  const akhir = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
  const fmt = v => { const d = new Date(String(v) + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); };
  const daftar = pending.map(r => `
      <div style="display:flex;gap:10px;align-items:flex-start;text-align:left;padding:10px 12px;background:#f5f3ff;border-radius:10px;margin-bottom:6px">
        <i class="fa-solid fa-clipboard-question" style="color:#6366f1;margin-top:3px"></i>
        <div style="min-width:0"><div style="font-weight:700;color:#1e293b;font-size:.9rem">${escapeHTML(r.judul_materi || 'Safety Talk')}</div>
        <div style="color:#64748b;font-size:.78rem">${fmt(r.tanggal)} · ${LABEL[String(r.status_kehadiran).toUpperCase()] || ''}</div></div>
      </div>`).join('');
  document.getElementById('stQuizPopup')?.remove();
  const ov = document.createElement('div');
  ov.id = 'stQuizPopup';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:390px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center;max-height:90vh;overflow:auto">
      <div style="width:60px;height:60px;border-radius:16px;background:#6366f1;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.7rem;margin:0 auto 14px"><i class="fa-solid fa-graduation-cap"></i></div>
      <h3 style="margin:0 0 6px;font-size:1.15rem;color:#1e293b">Kerjakan Kuis Pengganti Dulu</h3>
      <p style="margin:0 0 14px;color:#64748b;font-size:.88rem;line-height:1.5">Kamu tidak mengikuti Safety Talk berikut. Kerjakan kuis penggantinya sebelum <b>${akhir}</b> agar capaian Safety Talk-mu terpenuhi.</p>
      ${daftar}
      <a href="${url}" target="_blank" rel="noopener noreferrer" onclick="document.getElementById('stQuizPopup')?.remove()" style="display:block;background:#6366f1;color:#fff;text-decoration:none;padding:13px;border-radius:12px;font-weight:700;font-size:.95rem;margin:14px 0 10px">Kerjakan Kuis Sekarang</a>
      <button type="button" onclick="document.getElementById('stQuizPopup')?.remove()" style="background:none;border:none;color:#94a3b8;font-size:.9rem;cursor:pointer;padding:6px">Nanti saja</button>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}

// Ajakan aktifkan notifikasi PWA (2026-10-12, evaluasi UX U3). Pengingat PIC, kuis
// pengganti Safety Talk, dll. dikirim lewat push — tombolnya selama ini hanya ikon
// lonceng tanpa label di sidebar. Muncul bila didukung & belum berlangganan; "Nanti"
// menyembunyikan 7 hari. Izin diblokir → petunjuk membuka pengaturan browser.
async function renderPushBanner() {
  const el = document.getElementById('pushBanner');
  if (!el || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  try { if (Number(localStorage.getItem('push_banner_nanti') || 0) > Date.now()) return; } catch {}
  let aktif = false;
  try { aktif = !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()); } catch {}
  if (aktif) { el.style.display = 'none'; return; }
  const diblokir = Notification.permission === 'denied';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:14px;padding:12px 14px;margin:0 0 14px">
      <div style="width:38px;height:38px;border-radius:10px;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fa-solid fa-bell"></i></div>
      <div style="flex:1;min-width:180px">
        <div style="font-weight:700;color:#1e293b;font-size:.92rem">${diblokir ? 'Notifikasi diblokir' : 'Aktifkan notifikasi ONE-SAP'}</div>
        <div style="color:#475569;font-size:.8rem;line-height:1.45">${diblokir
          ? 'Buka pengaturan browser / aplikasi, izinkan notifikasi untuk ONE-SAP, lalu muat ulang halaman.'
          : 'Supaya langsung tahu saat ditunjuk jadi PIC, laporan perlu ditinjau, atau ada kuis pengganti Safety Talk.'}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${diblokir ? '' : '<button type="button" id="pushBannerOn" style="background:#4f46e5;color:#fff;border:none;border-radius:10px;padding:10px 16px;font-weight:700;font-size:.85rem;cursor:pointer;min-height:40px">Aktifkan</button>'}
        <button type="button" id="pushBannerNanti" style="background:none;border:none;color:#64748b;font-size:.85rem;cursor:pointer;padding:10px 8px;min-height:40px">Nanti</button>
      </div>
    </div>`;
  el.style.display = '';
  document.getElementById('pushBannerNanti').onclick = () => {
    try { localStorage.setItem('push_banner_nanti', String(Date.now() + 7 * 864e5)); } catch {}
    el.style.display = 'none';
  };
  const on = document.getElementById('pushBannerOn');
  if (on) on.onclick = async () => {
    on.disabled = true; on.textContent = 'Mengaktifkan...';
    if (typeof window.togglePushNotification === 'function') await window.togglePushNotification();
    renderPushBanner();
  };
}

function deleteHazardDraft() {
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  localStorage.removeItem(`hazard_draft_${u?.nik || u?.nama || 'guest'}`);
  localStorage.removeItem('hazard_draft'); // jaga-jaga key lama
  if (typeof _draftClearServer === 'function') _draftClearServer('Hazard');
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

  const rencana = [], review = [], closing = [], rejected = [], disputed = [];
  const role = String(user?.role || "").toUpperCase().replace(/s+/g, "_");
  const myCo = String(user?.perusahaan || "").trim().toUpperCase();

  for (const r of (reports || [])) {
    const status     = String(r.status_perbaikan || 'OPEN').toUpperCase();
    const planStatus = String(r.plan_status || '').trim().toLowerCase();
    if (status === 'CLOSED') continue;
    // PIC dipersoalkan: admin yang berwenang memutuskan; tugas PIC dijeda.
    if (r.pic_dispute?.status === 'PENDING') {
      if (role === 'SUPER_ADMIN' || (role === 'ADMIN' && String(r.perusahaan || '').trim().toUpperCase() === myCo)) disputed.push(r);
      continue;
    }

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
  if (disputed.length) items.push({ reports: disputed, label: 'PIC dipersoalkan',         hint: 'PIC menyatakan bukan PIC yang tepat — tentukan PIC yang benar', color: 'red', icon: 'fa-user-xmark' });
  if (rejected.length) items.push({ reports: rejected, label: 'Rencana kamu ditolak',      hint: 'Revisi rencana perbaikan segera',      color: 'red',    icon: 'fa-circle-xmark' });
  if (rencana.length)  items.push({ reports: rencana,  label: 'Perlu rencana tindakan',    hint: 'Kamu PIC — isi rencana perbaikannya',  color: 'orange', icon: 'fa-pen-to-square' });
  if (review.length)   items.push({ reports: review,   label: 'Rencana PIC perlu ditinjau', hint: 'Setujui atau tolak rencana dari PIC',  color: 'blue',   icon: 'fa-magnifying-glass' });
  if (closing.length)  items.push({ reports: closing,  label: 'Siap untuk closing',        hint: 'Rencana disetujui — kirim bukti closing', color: 'green', icon: 'fa-flag-checkered' });
  return items;
}

function renderActionBanner(reports) {
  const el = document.getElementById('actionBanner');
  if (!el) return;
  const user  = getCurrentUser();
  const items = computeActionItems(reports, user);
  setModBadge('hr', items.reduce((s, it) => s + it.reports.length, 0));
  if (!items.length) { el.style.display = 'none'; return; }

  // Baris laporan: deskripsi jadi utama, ID+lokasi kecil, batas waktu relatif.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueInfo = r => {
    const d = new Date(r.batas_waktu || r.due_date || '');
    if (isNaN(d)) return { days: Infinity, html: '' };
    d.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / 864e5);
    const html = days < 0 ? `<span class="ab-due ab-due--over">Terlambat ${-days} hr</span>`
      : days === 0 ? '<span class="ab-due ab-due--over">Batas hari ini</span>'
      : days <= 3 ? `<span class="ab-due ab-due--soon">${days} hr lagi</span>`
      : `<span class="ab-due">s/d ${d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}</span>`;
    return { days, html };
  };
  const insName = code => (INSPECTION_AREAS.find(a => a.type === code)?.name) || '';
  const reportRow = r => {
    const isIns = String(r.report_type || '').toUpperCase() === 'INSPECTION';
    const code  = String(r.inspection_sheet || r.jenis_inspeksi || '').trim().toUpperCase();
    let desc = String(r.deskripsi_bahaya || r.temuan_inspeksi || r.temuan || r.deskripsi_temuan || '')
      .replace(/^\s*\d+\.\s*/, '').trim(); // buang nomor butir checklist "15. "
    if (!desc) desc = isIns ? `Temuan inspeksi ${insName(code)}`.trim() : 'Tanpa deskripsi';
    const lokasi = r.lokasi_bahaya || r.lokasi_inspeksi || r.lokasi || insName(code);
    const href = `laporan-detail.html?id=${encodeURIComponent(getReportId(r) || '')}`;
    const due  = dueInfo(r);
    const chip = isIns
      ? `<span class="ab-chip" style="background:${MOD_COLORS.INSPECTION}">INS</span>`
      : `<span class="ab-chip" style="background:${MOD_COLORS.HAZARD}">HR</span>`;
    return `<a href="${href}" class="ab-row${due.days < 0 ? ' ab-row--over' : ''}">
      <div class="ab-row-main">
        <div class="ab-row-desc">${chip}${escapeHTML(desc)}</div>
        <div class="ab-row-meta"><span class="ab-row-where">${lokasi ? `<i class="fa-solid fa-location-dot"></i> ${escapeHTML(lokasi)} · ` : ''}${escapeHTML(getReportId(r) || '-')}</span>${due.html}</div>
      </div>
      <i class="fa-solid fa-chevron-right ab-row-go"></i>
    </a>`;
  };
  // Paling terlambat dulu; maks 5 baris per kelompok + tautan sisanya.
  const sortByDue = list => [...list].sort((a, b) => dueInfo(a).days - dueInfo(b).days);
  const MAX_ROWS = 5;

  el.style.display = '';
  el.innerHTML = `<div class="action-banner">
    <div class="action-banner-title"><i class="fa-solid fa-circle-exclamation"></i> Perlu Tindakan Kamu</div>
    ${items.map((it, i) => `
      <div class="action-banner-item action-banner-item--${it.color}" data-ab="${i}">
        <div class="ab-header" onclick="toggleActionItem(${i})">
          <span class="action-banner-count">${it.reports.length}</span>
          <span class="action-banner-label">
            <span class="ab-title"><i class="fa-solid ${it.icon}"></i> ${it.label}</span>
            <span class="ab-hint">${it.hint}${(() => { const o = it.reports.filter(r => dueInfo(r).days < 0).length; return o ? ` · <b>${o} terlambat</b>` : ''; })()}</span>
          </span>
          <i class="fa-solid fa-chevron-down ab-chevron"></i>
        </div>
        <div class="ab-list" style="display:none">
          ${sortByDue(it.reports).slice(0, MAX_ROWS).map(reportRow).join('')}
          ${it.reports.length > MAX_ROWS ? `<div style="display:none">${sortByDue(it.reports).slice(MAX_ROWS).map(reportRow).join('')}</div>
          <button type="button" class="ab-more" onclick="this.previousElementSibling.style.display='';this.remove()">Tampilkan ${it.reports.length - MAX_ROWS} laporan lainnya <i class="fa-solid fa-chevron-down"></i></button>` : ''}
        </div>
      </div>`).join('')}
  </div>`;
}

let _sapFeed = [], _sapObj = null, _sapMonthOffset = 0;

// Navigasi bulan: geser kiri = bulan sebelumnya, kanan = berikutnya (maks bulan ini).
window.sapMonthNav = function (delta) {
  const next = _sapMonthOffset + delta;
  if (next > 0 || next < -24) return; // tak ke masa depan; batas 24 bln ke belakang
  renderSapAchievement(undefined, undefined, next);
};

function renderSapAchievement(reports, obj, offset) {
  const el = document.getElementById('sapAchievement');
  // Simpan data utk navigasi bulan; offset dipertahankan saat refresh data.
  if (reports !== undefined) _sapFeed = reports || [];
  if (obj !== undefined) _sapObj = obj;
  if (offset !== undefined) _sapMonthOffset = offset;
  reports = _sapFeed; obj = _sapObj;
  if (!el || !obj) { if (el) el.style.display = 'none'; return; }

  const user   = getCurrentUser();
  const myNik  = String(user?.nik  || '').trim();
  const myNama = String(user?.nama || '').trim().toLowerCase();
  const base   = new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + _sapMonthOffset, 1);
  const y = target.getFullYear(), m = target.getMonth();

  // Hanya laporan bulan terpilih di mana user adalah PELAPOR
  const mine = (reports || []).filter(r => {
    const rNik  = String(r.nik_pelapor || r.nik || '').trim();
    const rNama = String(r.nama || r.pelapor || '').trim().toLowerCase();
    if (!((myNik && rNik === myNik) || (myNama && rNama === myNama))) return false;
    const d = new Date(r.timestamp || r.tanggal_laporan || r.tgl_laporan || r.tanggal_inspeksi || '');
    return !isNaN(d) && d.getFullYear() === y && d.getMonth() === m;
  });

  const cnt = t => mine.filter(r => String(r.report_type || '').toUpperCase() === t).length;
  const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;

  const rows = [
    { label: 'Hazard Report', icon: 'fa-triangle-exclamation', count: cnt('HAZARD'),     target: obj.hr  },
    { label: 'Inspeksi',      icon: 'fa-clipboard-check',       count: cnt('INSPECTION'), target: obj.ins },
    { label: 'SBO',           icon: 'fa-eye',                   count: cnt('SBO'),        target: obj.sbo },
    { label: 'Personal Contact', icon: 'fa-handshake',           count: cnt('PC'),         target: obj.pc  },
    // Safety Talk: terpenuhi = HADIR, atau tidak hadir (bukan mangkir) tapi kuis pengganti lulus.
    { label: 'Safety Talk', icon: 'fa-bullhorn', target: stObjForMonth(obj.st, monthKey, user?.perusahaan, _stCounts),
      count: _stRows.filter(s => String(s.bulan || '').slice(0, 7) === monthKey).filter(s => {
        const st = String(s.status_kehadiran || 'HADIR').toUpperCase();
        return st === 'HADIR' || (st !== 'MANGKIR' && String(s.quiz_done || '').toUpperCase() === 'YA');
      }).length },
  ].filter(r => r.target > 0);

  if (!rows.length) { el.style.display = 'none'; return; }

  const pct      = (c, t) => t > 0 ? Math.min(100, Math.round(c / t * 100)) : 0;
  const barColor = p => p >= 100 ? '#22c55e' : p >= 50 ? '#F2A900' : '#3b82f6';

  // Ringkasan 1 angka: total capaian (dibatasi per target) / total target.
  const sumT = rows.reduce((s, r) => s + r.target, 0);
  const sumC = rows.reduce((s, r) => s + Math.min(r.count, r.target), 0);
  const tot  = sumT ? Math.round(sumC / sumT * 100) : 0;
  const doneN = rows.filter(r => r.count >= r.target).length;

  const canNext = _sapMonthOffset < 0;
  const navBtn = 'width:26px;height:26px;border:none;border-radius:8px;background:#eef2ff;color:#4338ca;font-size:1rem;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center';
  el.style.display = '';
  el.innerHTML = `
    <div class="sap-ach-card" id="sapAchCard">
      <div class="sap-ach-header">
        <span class="sap-ach-title"><i class="fa-solid fa-trophy"></i> Capaian SAP</span>
        <span style="display:flex;align-items:center;gap:8px">
          <button type="button" onclick="sapMonthNav(-1)" aria-label="Bulan sebelumnya" style="${navBtn}">‹</button>
          <span class="sap-ach-month" style="min-width:84px;text-align:center">${MONTHS_ID[m]} ${y}</span>
          <button type="button" onclick="sapMonthNav(1)" aria-label="Bulan berikutnya" style="${navBtn};${canNext ? '' : 'opacity:.35;cursor:default;pointer-events:none'}">›</button>
        </span>
      </div>
      <a href="capaian-sap.html" class="sap-ring-wrap">
        <div class="sap-ring" style="--p:${tot};--c:${barColor(tot)}"><span>${tot}%</span></div>
        <div class="sap-ring-txt">
          <b>Capaian ${_sapMonthOffset === 0 ? 'bulan ini' : MONTHS_ID[m]}</b>
          <small>${doneN} dari ${rows.length} target tercapai · Lihat detail <i class="fa-solid fa-arrow-right"></i></small>
        </div>
      </a>
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

  // Geser (swipe) untuk pindah bulan: kiri = sebelumnya, kanan = berikutnya.
  const card = document.getElementById('sapAchCard');
  if (card) {
    let sx = null;
    card.addEventListener('touchstart', e => { sx = e.changedTouches[0].clientX; }, { passive: true });
    card.addEventListener('touchend', e => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) < 40) return;
      window.sapMonthNav(dx < 0 ? -1 : 1);
    }, { passive: true });
  }
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

// ── Deteksi dini di Beranda (2026-10-15): satu kartu ringkas — prakiraan cuaca (kategori BMKG) & fokus minggu ini ──
async function renderBerandaDD() {
  const el = document.getElementById('berandaDD');
  if (!el) return;
  try {
    const j = await fetch('/api?action=beranda').then((r) => r.json());
    if (j.status !== 'success') return;
    const hariIni = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Makassar' });
    const label = (t) => (t === hariIni ? 'Hari ini' : t < hariIni ? 'Kemarin' : 'Besok');
    const mm = (v) => (v >= 0.1 ? `${(+v).toFixed(1).replace('.', ',')} mm` : 'tanpa hujan');
    const kelas = (k) => 'k-' + String(k || '').toLowerCase().replace(/\s+/g, '-'); // warna ikon per kategori
    const cuaca = (j.cuaca || []).map((c) => `<div class="bdd-hari${c.tanggal === hariIni ? ' kini' : ''}">
        <span class="bdd-lbl">${label(c.tanggal)}</span>
        <span class="bdd-kat ${kelas(c.kategori)}"><i class="fa-solid ${escapeHTML(c.ikon)}"></i>${escapeHTML(c.kategori)}</span>
        <small>${mm(c.hujan_mm)}</small></div>`).join('');
    const lebat = (j.cuaca || []).some((c) => c.hujan_mm >= 20);
    const f = j.fokus;
    const STATUS = { merah: 'Waspada tinggi', kuning: 'Perlu perhatian', hijau: 'Normal' };
    el.innerHTML = `<div class="bdd-kartu">
        ${cuaca ? `<div class="bdd-judul"><span><i class="fa-solid fa-cloud-sun-rain"></i> Prakiraan cuaca</span><small>area tambang · kategori BMKG</small></div>
        <div class="bdd-hari-row">${cuaca}</div>` : ''}
        ${lebat ? '<div class="bdd-awas"><i class="fa-solid fa-triangle-exclamation"></i> Hujan sedang/lebat — jalan licin & lereng rawan, lakukan inspeksi jalan.</div>' : ''}
        ${f ? `<div class="bdd-fokus ${escapeHTML(f.status)}">
          <div class="bdd-judul"><span><i class="fa-solid fa-bullseye"></i> Fokus minggu ini</span><small class="bdd-st">${STATUS[f.status] || ''}</small></div>
          <div class="bdd-area"><i class="fa-solid fa-location-dot"></i> ${escapeHTML(f.lokasi)}</div>
          ${f.alasan?.length ? `<div class="bdd-alasan">${escapeHTML(f.alasan[0])}</div>` : ''}
          ${f.penyebab?.length ? `<div class="bdd-sub">Penyebab insiden terbanyak di sini — laporkan bila menemukannya:</div>
          <ol class="bdd-daftar">${f.penyebab.map((p) => `<li><span>${escapeHTML(p.nama)}</span><em>${p.jumlah} insiden</em></li>`).join('')}</ol>` : ''}
          <a class="bdd-aksi" href="index.html"><i class="fa-solid fa-plus"></i> Laporkan temuan</a>
        </div>` : ''}
      </div>`;
    el.hidden = false;
  } catch { /* opsional — Beranda tetap jalan tanpa kartu ini */ }
}
