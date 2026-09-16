// Safety Talk — halaman list jadwal (admin only)

const QUIZ_URL = 'https://quiz-she.vercel.app';

let _stSchedules = [];
let _stAbsensiMap = {}; // schedule_id → jumlah hadir
let _stAbsensiRows = []; // baris mentah SafetyTalk_Absensi untuk dashboard
let _stCharts = {};      // instance Chart.js dashboard, destroy sebelum render ulang
let _stKaryawan  = [];
let _stPemateriChoices;
let _editingStId = null; // null = buat baru, string = edit jadwal
// ID jadwal Safety Talk yang sudah punya sesi quiz di quiz-she.
// Linkage: quiz-she menyalin ID jadwal jadi kode topik saat "Import dari Safety Talk",
// lalu sesi menunjuk topik itu — jadi topicCode sesi === ID jadwal ini.
let _quizLinked = new Set();

// ── Load ──────────────────────────────────────────────────────────
// Kumpulkan ID jadwal yang sudah punya sesi quiz. Gagal fetch = set kosong
// (indikator tidak tampil), bukan error — quiz-she opsional bagi halaman ini.
async function _loadQuizLinks() {
  try {
    const res  = await fetch(`${QUIZ_URL}/api/data?action=sessions`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.value || data.sessions || []);
    _quizLinked = new Set(
      list.filter(s => s.status === 'published')
          .map(s => String(s.topicCode || '').trim())
          .filter(Boolean)
    );
  } catch { _quizLinked = new Set(); }
}

async function loadAll() {
  document.getElementById('stGrid').innerHTML =
    '<div class="st-empty"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>';
  try {
    const [schRes, abRes, karRes] = await Promise.all([
      fetch('/api?action=getSafetyTalkSchedules').then(r => r.json()),
      fetch('/api?action=getSafetyTalkAbsensi').then(r => r.json()),
      fetch('/api?action=masterKaryawan').then(r => r.json()),
      _loadQuizLinks(),
    ]);
    _stSchedules = schRes.data || [];
    _stAbsensiRows = abRes.data || [];
    // Build absensi count map
    _stAbsensiMap = {};
    (abRes.data || []).forEach(row => {
      const id     = row['SCHEDULE_ID'];
      const status = String(row['STATUS_KEHADIRAN'] || 'HADIR').toUpperCase();
      const quiz   = String(row['QUIZ_DONE'] || '').toUpperCase() === 'YA';
      if (!_stAbsensiMap[id]) _stAbsensiMap[id] = { hadir:0, quiz:0, mangkir:0, total:0 };
      _stAbsensiMap[id].total++;
      if (status === 'HADIR')   _stAbsensiMap[id].hadir++;
      else if (status === 'MANGKIR') _stAbsensiMap[id].mangkir++;
      else if (quiz) _stAbsensiMap[id].quiz++;
    });
    _stKaryawan = Array.isArray(karRes) ? karRes : (karRes.data || []);
    _populatePemateriDropdown();
    _populateTargetCoDropdown();
    renderSchedules();
  } catch (e) {
    document.getElementById('stGrid').innerHTML =
      `<div class="st-empty" style="color:#ef4444"><i class="fa-solid fa-circle-exclamation"></i> Gagal memuat: ${e.message}</div>`;
  }
}

function _populatePemateriDropdown() {
  const sel = document.getElementById('stPemateri');
  if (!sel) return;
  const names = [...new Set(_stKaryawan.map(k => k['NAMA']).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Pilih Pemateri</option>' +
    names.map(n => `<option value="${n}">${n}</option>`).join('');
  if (_stPemateriChoices) _stPemateriChoices.destroy();
  _stPemateriChoices = new Choices('#stPemateri', {
    searchEnabled: true, itemSelectText: '', shouldSort: false,
    placeholder: true, placeholderValue: 'Cari nama pemateri',
    noResultsText: 'Tidak ditemukan', searchFloor: 1,
  });
}

function _populateTargetCoDropdown() {
  const sel = document.getElementById('stTargetCo');
  if (!sel) return;
  const cos = [...new Set(_stKaryawan.map(k => k['PERUSAHAAN']).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Semua Perusahaan</option>' +
    cos.map(c => `<option value="${c}">${c}</option>`).join('');
}

// ── Render ────────────────────────────────────────────────────────
function renderSchedules() {
  renderStDashboard();
  const grid = document.getElementById('stGrid');
  const monthF  = document.getElementById('stFilterMonth')?.value || '';
  const statusF = document.getElementById('stFilterStatus')?.value || '';

  const filtered = _stSchedules.filter(s => {
    const bulan  = String(s['BULAN'] || '');
    const status = String(s['STATUS'] || '').toUpperCase();
    return (!monthF || bulan === monthF) && (!statusF || status === statusF);
  }).sort((a, b) => (b['TANGGAL'] || '').localeCompare(a['TANGGAL'] || ''));

  if (!filtered.length) {
    grid.innerHTML = '<div class="st-empty"><i class="fa-solid fa-calendar-xmark" style="font-size:2rem;opacity:.3"></i><br>Tidak ada jadwal ditemukan</div>';
    return;
  }

  grid.innerHTML = filtered.map(s => {
    const id     = s['ID'] || '';
    const status = String(s['STATUS'] || 'AKTIF').toUpperCase();
    const ab     = _stAbsensiMap[id] || { hadir:0, quiz:0, mangkir:0, total:0 };
    const hadir  = ab.hadir;
    const tgl    = s['TANGGAL'] ? new Date(s['TANGGAL']).toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' }) : '-';
    const badgeCls = status === 'SELESAI' ? 'selesai' : 'aktif';
    const badgeIcon = status === 'SELESAI' ? 'fa-circle-check' : 'fa-circle-play';
    return `<div class="st-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div class="st-card-title">${escapeHTML(s['JUDUL_MATERI'] || '-')}</div>
        <span class="st-badge ${badgeCls}"><i class="fa-solid ${badgeIcon}"></i> ${status}</span>
      </div>
      <div class="st-card-meta"><i class="fa-regular fa-calendar"></i> ${tgl}</div>
      ${s['NAMA_PEMATERI'] ? `<div class="st-card-meta"><i class="fa-solid fa-person-chalkboard"></i> ${escapeHTML(s['NAMA_PEMATERI'])}${s['JABATAN_PEMATERI'] ? ' · ' + escapeHTML(s['JABATAN_PEMATERI']) : ''}</div>` : ''}
      ${s['PERUSAHAAN_TARGET'] ? `<div class="st-card-meta"><i class="fa-solid fa-building"></i> ${escapeHTML(s['PERUSAHAAN_TARGET'])}</div>` : '<div class="st-card-meta"><i class="fa-solid fa-building"></i> Semua Perusahaan</div>'}
      ${s['DESKRIPSI_MATERI'] ? `<div class="st-card-desc">${escapeHTML(s['DESKRIPSI_MATERI'])}</div>` : ''}
      ${_quizLinked.has(id)
        ? '<div class="st-card-meta" style="color:#7c3aed"><i class="fa-solid fa-clipboard-check"></i> Quiz tertaut</div>'
        : '<div class="st-card-meta" style="color:#cbd5e1"><i class="fa-solid fa-clipboard-question"></i> Belum ada quiz</div>'}
      <div class="st-absensi-count">
        <i class="fa-solid fa-users-line" style="color:#6366f1"></i>
        <span style="color:#16a34a;font-weight:700">${ab.hadir} Hadir</span>
        ${ab.quiz    ? `<span style="color:#7c3aed;font-weight:700;margin-left:6px">${ab.quiz} Quiz</span>` : ''}
        ${ab.mangkir ? `<span style="color:#dc2626;font-weight:700;margin-left:6px">${ab.mangkir} Mangkir</span>` : ''}
      </div>
      <div class="st-card-footer">
        <a href="safety-talk-absensi.html?id=${encodeURIComponent(id)}" class="btn-indigo-soft">
          <i class="fa-solid fa-clipboard-list"></i> Kelola Absensi
        </a>
        <button class="btn-indigo-soft" onclick="editJadwal('${id}')" title="Edit jadwal ini">
          <i class="fa-solid fa-pen"></i>
        </button>
        ${status === 'AKTIF' ? `<button class="btn-danger-soft" onclick="selesaikan('${id}')">
          <i class="fa-solid fa-circle-check"></i> Selesaikan
        </button>` : ''}
        <button class="btn-indigo-soft" onclick="salinWA('${id}')" title="Salin teks undangan WA">
          <i class="fa-brands fa-whatsapp"></i> Salin WA
        </button>
        <button class="btn-danger-soft" onclick="hapusJadwal('${id}', '${escapeHTML(s['JUDUL_MATERI'] || '')}')" title="Hapus jadwal ini">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── Create / Edit ─────────────────────────────────────────────────
function openCreateModal() {
  _editingStId = null;
  document.getElementById('createModalTitle').textContent = 'Buat Jadwal Safety Talk';
  document.getElementById('createBtn').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
  document.getElementById('stTanggal').value = new Date().toISOString().slice(0, 10);
  document.getElementById('stJudul').value = '';
  document.getElementById('stDeskripsi').value = '';
  if (_stPemateriChoices) _stPemateriChoices.setChoiceByValue('');
  document.getElementById('stTargetCo').value = '';
  document.getElementById('createErr').style.display = 'none';
  document.getElementById('createModal').classList.add('open');
}

function editJadwal(id) {
  const s = _stSchedules.find(r => r['ID'] === id);
  if (!s) return;
  _editingStId = id;
  document.getElementById('createModalTitle').textContent = 'Edit Jadwal Safety Talk';
  document.getElementById('createBtn').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Perbarui';
  document.getElementById('stTanggal').value = s['TANGGAL'] || '';
  document.getElementById('stJudul').value = s['JUDUL_MATERI'] || '';
  document.getElementById('stDeskripsi').value = s['DESKRIPSI_MATERI'] || '';
  if (_stPemateriChoices) _stPemateriChoices.setChoiceByValue(s['NAMA_PEMATERI'] || '');
  document.getElementById('stTargetCo').value = s['PERUSAHAAN_TARGET'] || '';
  document.getElementById('createErr').style.display = 'none';
  document.getElementById('createModal').classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

async function submitCreate() {
  const btn = document.getElementById('createBtn');
  const errEl = document.getElementById('createErr');
  const tanggal = document.getElementById('stTanggal').value;
  const judul   = document.getElementById('stJudul').value.trim();
  const pemateri = document.getElementById('stPemateri').value;

  errEl.style.display = 'none';
  if (!tanggal) { errEl.textContent = 'Tanggal wajib diisi.'; errEl.style.display = 'block'; return; }
  if (!judul)   { errEl.textContent = 'Judul materi wajib diisi.'; errEl.style.display = 'block'; return; }

  // Resolve pemateri info dari master
  const karFound = _stKaryawan.find(k => k['NAMA'] === pemateri);

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  const payload = {
    tanggal,
    judul_materi:     judul,
    deskripsi_materi: document.getElementById('stDeskripsi').value.trim(),
    nama_pemateri:    pemateri || '',
    nik_pemateri:     karFound?.['NIK']     || '',
    jabatan_pemateri: karFound?.['JABATAN'] || '',
    perusahaan_target: document.getElementById('stTargetCo').value,
  };
  try {
    const isEdit = !!_editingStId;
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: isEdit ? 'updateSafetyTalkSchedule' : 'createSafetyTalkSchedule',
        data: isEdit ? { id: _editingStId, ...payload } : payload,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal menyimpan.');
    closeModal('createModal');
    if (typeof showToast === 'function') showToast(isEdit ? 'Jadwal berhasil diperbarui!' : 'Jadwal berhasil dibuat!');
    await loadAll();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = _editingStId
      ? '<i class="fa-solid fa-floppy-disk"></i> Perbarui'
      : '<i class="fa-solid fa-floppy-disk"></i> Simpan';
  }
}

async function hapusJadwal(id, judul) {
  if (!confirm(`Hapus jadwal "${judul}"?\n\nData absensi juga akan ikut dihapus. Tindakan ini tidak dapat dibatalkan.`)) return;
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteSafetyTalkSchedule', data: { id } }),
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal.');
    if (typeof showToast === 'function') showToast('Jadwal berhasil dihapus.');
    await loadAll();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

async function selesaikan(id) {
  if (!confirm('Tandai jadwal ini sebagai Selesai?')) return;
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateSafetyTalkSchedule', data: { id, status: 'SELESAI' } }),
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal.');
    if (typeof showToast === 'function') showToast('Jadwal ditandai selesai.');
    await loadAll();
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  }
}

function salinWA(id) {
  const s = _stSchedules.find(r => r['ID'] === id);
  if (!s) return;
  const tgl = s['TANGGAL']
    ? new Date(s['TANGGAL']).toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    : '-';
  const perusahaan = s['PERUSAHAAN_TARGET'] || 'PT Energi Batubara Lestari';
  const pemateri   = s['NAMA_PEMATERI']    || '-';
  const karPemateri = _stKaryawan.find(k => k['NIK'] === s['NIK_PEMATERI'] || k['NAMA'] === s['NAMA_PEMATERI']);
  const deptPemateri = karPemateri?.['DEPARTEMEN'] || '';
  const topik      = s['JUDUL_MATERI']     || '-';
  const deskripsi  = s['DESKRIPSI_MATERI'] ? `\nDeskripsi  : ${s['DESKRIPSI_MATERI']}\n` : '';

  const teks =
`🚨 *Safety Talk – ${perusahaan}*

Kepada Yth.
Bapak/Ibu Karyawan ${perusahaan}

Dengan hormat,
Kami mengundang Bapak/Ibu untuk hadir dalam kegiatan Safety Talk yang akan dilaksanakan pada:

Hari/Tanggal : ${tgl}
Waktu        : 07.00 WITA - Selesai
Pemateri     : ${pemateri}
${deptPemateri ? `Departemen   : ${deptPemateri}\n` : ''}Topik        : ${topik}${deskripsi}

*Atribut Peserta:*
∙ Menggunakan seragam perusahaan dalam kondisi rapi.
∙ Membawa serta mengenakan Alat Pelindung Diri (APD) lengkap sesuai standar.

*YEL-YEL HASNUR GROUP*
Hasnur Group! Semangat
Hasnur Group! Bangkit
Hasnur Group! Jaya
Hasnur Group! Mulia

Berkat! 🤲
لَا إِلَٰهَ إِلَّا اللَّٰهُ مُحَمَّدٌ رَّسُولُ اللَّٰهِ

Demikian undangan ini kami sampaikan. Atas perhatian dan kehadiran Bapak/Ibu tepat waktu, kami ucapkan terima kasih.`;

  navigator.clipboard.writeText(teks).then(() => {
    if (typeof showToast === 'function') showToast('Teks undangan berhasil disalin!');
  }).catch(() => {
    // Fallback: textarea trick
    const ta = document.createElement('textarea');
    ta.value = teks; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    if (typeof showToast === 'function') showToast('Teks undangan berhasil disalin!');
  });
}

// ── Dashboard kehadiran ──────────────────────────────────────────────────────
// Aturan kepatuhan (sama dengan capaian-sap.js & quiz-she): HADIR = terpenuhi;
// MANGKIR = tidak; status lain terpenuhi hanya bila QUIZ_DONE = YA.
const _ST_STATUS_META = {
  HADIR:       { label: 'Hadir',       color: '#16a34a' },
  CUTI:        { label: 'Cuti',        color: '#d97706' },
  DINAS_LUAR:  { label: 'Dinas Luar',  color: '#0284c7' },
  SHIFT_MALAM: { label: 'Shift Malam', color: '#7c3aed' },
  LIBUR:       { label: 'Libur',       color: '#64748b' },
  MANGKIR:     { label: 'Mangkir',     color: '#dc2626' },
};
function _stStatusOf(row) { return String(row['STATUS_KEHADIRAN'] || 'HADIR').toUpperCase(); }
function _stQuizOf(row)   { return String(row['QUIZ_DONE'] || '').toUpperCase() === 'YA'; }
function _stTerpenuhi(row) {
  const st = _stStatusOf(row);
  if (st === 'HADIR')   return true;
  if (st === 'MANGKIR') return false;
  return _stQuizOf(row);
}
function _stPct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }
function _stChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (_stCharts[id]) _stCharts[id].destroy();
  _stCharts[id] = new Chart(el.getContext('2d'), cfg);
}

function renderStDashboard() {
  const monthF = document.getElementById('stFilterMonth')?.value || '';
  const rows = monthF
    ? _stAbsensiRows.filter(r => String(r['BULAN'] || '').slice(0, 7) === monthF)
    : _stAbsensiRows;
  const jadwalCount = _stSchedules.filter(s => !monthF || String(s['BULAN'] || '') === monthF).length;

  // ── KPI ──
  const total     = rows.length;
  const hadir     = rows.filter(r => _stStatusOf(r) === 'HADIR').length;
  const mangkir   = rows.filter(r => _stStatusOf(r) === 'MANGKIR').length;
  const wajibQuiz = rows.filter(r => !['HADIR','MANGKIR'].includes(_stStatusOf(r)));
  const quizLulus = wajibQuiz.filter(_stQuizOf).length;
  const quizBelum = wajibQuiz.length - quizLulus;
  const patuh     = rows.filter(_stTerpenuhi).length;
  const pctPatuh  = _stPct(patuh, total);
  const patuhColor = pctPatuh >= 80 ? '#16a34a' : pctPatuh >= 50 ? '#d97706' : '#dc2626';

  const kpi = (val, lbl, color, sub) => `<div class="st-kpi">
    <div class="st-kpi-val" style="color:${color}">${val}</div>
    <div class="st-kpi-lbl">${lbl}</div>${sub ? `<div class="st-kpi-sub">${sub}</div>` : ''}</div>`;
  document.getElementById('stDashKpis').innerHTML =
    kpi(jadwalCount, 'Jadwal', '#6366f1', monthF ? 'bulan terpilih' : 'semua bulan') +
    kpi(total, 'Diabsen', '#0f172a', 'total baris absensi') +
    kpi(hadir, 'Hadir', '#16a34a', `${_stPct(hadir, total)}% dari diabsen`) +
    kpi(quizLulus, 'Quiz Lulus', '#7c3aed', `dari ${wajibQuiz.length} wajib quiz`) +
    kpi(quizBelum, 'Belum Quiz', '#d97706', 'capaian belum terpenuhi') +
    kpi(mangkir, 'Mangkir', '#dc2626', 'tidak bisa diganti quiz') +
    kpi(pctPatuh + '%', 'Kepatuhan', patuhColor, `${patuh} / ${total} terpenuhi`);

  // ── Chart 1: distribusi status (doughnut) ──
  const statusKeys = Object.keys(_ST_STATUS_META).filter(k => rows.some(r => _stStatusOf(r) === k));
  _stChart('stChartStatus', {
    type: 'doughnut',
    data: {
      labels: statusKeys.map(k => _ST_STATUS_META[k].label),
      datasets: [{ data: statusKeys.map(k => rows.filter(r => _stStatusOf(r) === k).length),
                   backgroundColor: statusKeys.map(k => _ST_STATUS_META[k].color), borderWidth: 2, borderColor: '#fff' }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed} (${_stPct(c.parsed, total)}%)` } } } },
  });

  // ── Chart 2: kepatuhan per departemen (stacked bar horizontal, urut % terendah) ──
  const byDept = {};
  rows.forEach(r => {
    const d = String(r['DEPARTEMEN'] || '').trim() || '(tanpa dept)';
    if (!byDept[d]) byDept[d] = { ok: 0, no: 0 };
    if (_stTerpenuhi(r)) byDept[d].ok++; else byDept[d].no++;
  });
  const depts = Object.entries(byDept)
    .sort((a, b) => _stPct(a[1].ok, a[1].ok + a[1].no) - _stPct(b[1].ok, b[1].ok + b[1].no))
    .slice(0, 12);
  _stChart('stChartDept', {
    type: 'bar',
    data: {
      labels: depts.map(([d]) => d.length > 18 ? d.slice(0, 16) + '…' : d),
      datasets: [
        { label: 'Terpenuhi', data: depts.map(([, v]) => v.ok), backgroundColor: '#16a34a', borderRadius: 4, stack: 's' },
        { label: 'Belum',     data: depts.map(([, v]) => v.no), backgroundColor: '#fca5a5', borderRadius: 4, stack: 's' },
      ],
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { footer: items => {
          const v = depts[items[0].dataIndex] && depts[items[0].dataIndex][1];
          return v ? `Kepatuhan ${_stPct(v.ok, v.ok + v.no)}%` : ''; } } } },
      scales: { x: { stacked: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,.05)' } },
                y: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: false } } } },
  });

  // ── Chart 3: tren kepatuhan 6 bulan (dari bulan terpilih mundur, atau bulan ini) ──
  const anchor = monthF ? new Date(monthF + '-01') : new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const trend = months.map(m => {
    const mr = _stAbsensiRows.filter(r => String(r['BULAN'] || '').slice(0, 7) === m);
    return mr.length ? _stPct(mr.filter(_stTerpenuhi).length, mr.length) : null;
  });
  _stChart('stChartTrend', {
    type: 'line',
    data: {
      labels: months.map(m => new Date(m + '-01').toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })),
      datasets: [{ label: 'Kepatuhan %', data: trend, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.12)',
                   fill: true, tension: .35, spanGaps: true, pointRadius: 4, pointBackgroundColor: '#6366f1' }],
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y == null ? ' tidak ada absensi' : ` ${c.parsed.y}% kepatuhan` } } },
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,.05)' } },
                x: { grid: { display: false } } } },
  });

  // ── Perlu perhatian: mangkir dulu, lalu belum quiz ──
  const attn = rows
    .filter(r => !_stTerpenuhi(r))
    .sort((a, b) => (_stStatusOf(b) === 'MANGKIR') - (_stStatusOf(a) === 'MANGKIR')
                 || String(a['NAMA'] || '').localeCompare(String(b['NAMA'] || '')));
  document.getElementById('stAttnList').innerHTML = attn.length
    ? attn.map(r => {
        const st = _stStatusOf(r), isM = st === 'MANGKIR';
        const lbl = _ST_STATUS_META[st] ? _ST_STATUS_META[st].label : st;
        return `<div class="st-attn-row">
          <div><b>${escapeHTML(r['NAMA'] || r['NIK'] || '-')}</b><div class="dept">${escapeHTML(r['DEPARTEMEN'] || '')}</div></div>
          <span class="st-attn-badge ${isM ? 'mangkir' : 'belum'}">${isM ? 'Mangkir' : 'Belum quiz · ' + lbl}</span>
        </div>`;
      }).join('')
    : '<div class="st-dash-empty"><i class="fa-solid fa-circle-check" style="color:#16a34a;font-size:1.4rem"></i><br>Semua kehadiran terpenuhi</div>';
}

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}
