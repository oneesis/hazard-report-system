// Safety Talk — halaman kelola absensi per jadwal

const QUIZ_URL = 'https://quiz-she.vercel.app';

let _abSchedule  = null;
let _abKaryawan  = [];   // list karyawan
let _abStatus    = {};   // NIK → status kehadiran string
let _abQuizResult = {};  // NIK → { passed, score, certificateNo } dari quizsheebl.org
let _abFiltered  = [];
// Sesi quiz yang tertaut ke jadwal ini. Linkage otomatis: saat admin quiz-she
// pakai "Import dari Safety Talk", ID jadwal disalin jadi kode topik — jadi
// sesi dengan topicCode === ID jadwal adalah quiz untuk safety talk ini.
// Bisa lebih dari satu (mis. pre-test & post-test); lulus di salah satu = lulus.
let _quizSessionIds = [];
let _quizTopicLabel = '';

const STATUS_OPTIONS = [
  { value: 'HADIR',       label: 'Hadir',       color: '#16a34a', bg: '#dcfce7' },
  { value: 'CUTI',        label: 'Cuti',         color: '#d97706', bg: '#fef3c7' },
  { value: 'DINAS_LUAR',  label: 'Dinas Luar',   color: '#0284c7', bg: '#e0f2fe' },
  { value: 'SHIFT_MALAM', label: 'Shift Malam',  color: '#7c3aed', bg: '#ede9fe' },
  { value: 'LIBUR',       label: 'Off',          color: '#0f766e', bg: '#ccfbf1' },
  { value: 'SECURITY_JAGA',label:'Security Jaga', color: '#db2777', bg: '#fce7f3' },
  { value: 'MANGKIR',     label: 'Mangkir',      color: '#dc2626', bg: '#fee2e2' },
];
// Status yang wajib quiz (bukan Hadir, bukan Mangkir)
const QUIZ_REQUIRED = new Set(['CUTI','DINAS_LUAR','SHIFT_MALAM','LIBUR','SECURITY_JAGA']);

function _getScheduleId() {
  return new URLSearchParams(window.location.search).get('id') || '';
}

async function initAbsensi() {
  const schedId = _getScheduleId();
  if (!schedId) { window.location.href = 'safety-talk.html'; return; }

  const tbody = document.getElementById('abTbody');
  tbody.innerHTML = '<tr><td colspan="9" class="um-loading">Memuat data...</td></tr>';

  try {
    const [schRes, abRes, karRes] = await Promise.all([
      fetch('/api?action=getSafetyTalkSchedules').then(r => r.json()),
      fetch(`/api?action=getSafetyTalkAbsensi&schedule_id=${encodeURIComponent(schedId)}`).then(r => r.json()),
      fetch('/api?action=masterKaryawan').then(r => r.json()),
    ]);

    const allSched = schRes.data || [];
    _abSchedule = allSched.find(s => String(s['ID'] || '') === schedId);
    if (!_abSchedule) { window.location.href = 'safety-talk.html'; return; }

    await _resolveQuizSessions(schedId);

    // Info card
    const infoCard = document.getElementById('stInfoCard');
    if (infoCard) {
      const tgl = _abSchedule['TANGGAL']
        ? new Date(_abSchedule['TANGGAL']).toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
        : '-';
      infoCard.style.display = '';
      infoCard.innerHTML = `
        <h2><i class="fa-solid fa-chalkboard-user"></i> ${escapeHTML(_abSchedule['JUDUL_MATERI'] || '-')}</h2>
        <div class="st-info-meta">
          <span><i class="fa-regular fa-calendar"></i> ${tgl}</span>
          ${_abSchedule['NAMA_PEMATERI'] ? `<span><i class="fa-solid fa-person-chalkboard"></i> ${escapeHTML(_abSchedule['NAMA_PEMATERI'])}</span>` : ''}
          ${_abSchedule['PERUSAHAAN_TARGET'] ? `<span><i class="fa-solid fa-building"></i> ${escapeHTML(_abSchedule['PERUSAHAAN_TARGET'])}</span>` : '<span><i class="fa-solid fa-building"></i> Semua Perusahaan</span>'}
          ${_quizSessionIds.length ? `<span style="color:#c7d2fe;font-size:.78rem"><i class="fa-solid fa-clipboard-check"></i> Quiz tertaut${_quizTopicLabel ? ': ' + escapeHTML(_quizTopicLabel) : ''}</span>` : ''}
        </div>`;
    }

    // Peringatan bila belum ada quiz — admin perlu buat dulu di quiz-she
    const warnEl = document.getElementById('stQuizWarn');
    if (warnEl) {
      if (_quizSessionIds.length) { warnEl.style.display = 'none'; }
      else {
        warnEl.style.display = '';
        warnEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>
          <span><b>Belum ada quiz untuk jadwal ini.</b> Karyawan berstatus Cuti / Dinas Luar / Shift Malam / Off / Security Jaga
          tidak bisa memenuhi capaian sampai quiz dibuat. Buat di
          <a href="${QUIZ_URL}/admin.html" target="_blank" style="color:#b45309;font-weight:700;text-decoration:underline">quiz-she</a>
          → Topik Baru → <b>Import dari Safety Talk</b> → pilih jadwal ini.</span>`;
      }
    }

    // Karyawan
    const allKar = Array.isArray(karRes) ? karRes : (karRes.data || []);
    const targetCo = String(_abSchedule['PERUSAHAAN_TARGET'] || '').trim();
    _abKaryawan = (targetCo
      ? allKar.filter(k => String(k['PERUSAHAAN'] || '').trim() === targetCo)
      : allKar
    ).filter(k => String(k['ROLE'] || '').toUpperCase().replace(/\s+/g,'_') !== 'DELETED')
     .sort((a, b) => String(a['NAMA'] || '').localeCompare(String(b['NAMA'] || '')));

    // Status dari data tersimpan
    _abStatus = {};
    (abRes.data || []).forEach(r => {
      const nik = String(r['NIK'] || '').trim();
      if (nik) _abStatus[nik] = String(r['STATUS_KEHADIRAN'] || 'HADIR').toUpperCase();
    });

    renderTable();

    // Auto-cek quiz (background, setelah tabel tampil)
    if (_quizSessionIds.length) _fetchQuizStatuses();

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:#ef4444;text-align:center;padding:20px">Gagal memuat: ${e.message}</td></tr>`;
  }
}

// ── Resolusi sesi quiz untuk jadwal ini ─────────────────────────────────────
// Sesi quiz-she yang topicCode-nya sama dengan ID jadwal Safety Talk = quiz
// untuk jadwal ini (ditetapkan quiz-she saat "Import dari Safety Talk").
async function _resolveQuizSessions(schedId) {
  try {
    const res  = await fetch(`${QUIZ_URL}/api/data?action=sessions`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.value || data.sessions || []);
    const matched = list.filter(s =>
      String(s.topicCode || '').trim() === schedId && s.status === 'published'
    );
    _quizSessionIds = matched.map(s => s.id);
    _quizTopicLabel = matched.find(s => s.title)?.title || '';
  } catch {
    _quizSessionIds = [];
    _quizTopicLabel = '';
  }
}

// ── Fetch quiz statuses ─────────────────────────────────────────────────────
// Lulus di SALAH SATU sesi tertaut sudah dihitung lulus.
async function _checkOneNik(nik) {
  const results = await Promise.all(_quizSessionIds.map(async sid => {
    try {
      const res  = await fetch(`${QUIZ_URL}/api/data?action=existing&nik=${encodeURIComponent(nik)}&sessionId=${encodeURIComponent(sid)}`);
      const json = await res.json();
      return json.certificateNo ? { passed: true, score: json.score, certificateNo: json.certificateNo } : null;
    } catch { return null; }
  }));
  return results.find(Boolean) || { passed: false };
}

async function _fetchQuizStatuses() {
  const toCheck = _abKaryawan.filter(k =>
    QUIZ_REQUIRED.has(_abStatus[String(k['NIK'] || '').trim()] || '')
  );
  if (!toCheck.length) return;

  // Maks 10 karyawan bersamaan agar tidak membanjiri backend quiz-she
  const BATCH = 10;
  for (let i = 0; i < toCheck.length; i += BATCH) {
    await Promise.all(toCheck.slice(i, i + BATCH).map(async k => {
      const nik = String(k['NIK'] || '').trim();
      _abQuizResult[nik] = await _checkOneNik(nik);
      _updateQuizCell(nik);
    }));
  }
  updateSummary();
}

function _updateQuizCell(nik) {
  const cell = document.getElementById(`quiz-${nik}`);
  if (!cell) return;
  const status = _abStatus[nik] || '';
  cell.innerHTML = _quizCellHtml(nik, status);
}

function _quizCellHtml(nik, status) {
  if (!_quizSessionIds.length) return '<span class="ab-quiz-na" title="Belum ada quiz untuk jadwal ini">—</span>';
  if (status === 'HADIR') return '<span class="ab-quiz-na">—</span>';
  if (status === 'MANGKIR') return '<span class="ab-quiz-locked" title="Mangkir boleh mengerjakan kuis, tapi tidak menambah capaian"><i class="fa-solid fa-ban"></i> Tidak dihitung</span>';
  if (!QUIZ_REQUIRED.has(status)) return '<span class="ab-quiz-na">—</span>';

  const r = _abQuizResult[nik];
  if (!r) return '<span class="ab-quiz-loading"><i class="fa-solid fa-spinner fa-spin"></i></span>';
  if (r.passed) return `<span class="ab-quiz-lulus" title="Sertifikat: ${escapeHTML(r.certificateNo||'')}"><i class="fa-solid fa-circle-check"></i> Lulus ${r.score ? '('+r.score+'%)' : ''}</span>`;
  return '<span class="ab-quiz-belum"><i class="fa-solid fa-circle-xmark"></i> Belum</span>';
}

// ── Render ──────────────────────────────────────────────────────────────────
function filterTable() { renderTable(); }

function renderTable() {
  const q  = (document.getElementById('abSearch')?.value || '').toLowerCase().trim();
  const sf = document.getElementById('abFilterStatus')?.value || '';
  _abFiltered = _abKaryawan.filter(k => {
    if (q && !String(k['NAMA'] || '').toLowerCase().includes(q)) return false;
    if (sf && (_abStatus[String(k['NIK']||'').trim()] || '') !== sf) return false;
    return true;
  });

  updateSummary();

  const tbody = document.getElementById('abTbody');
  if (!_abFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada karyawan</td></tr>';
    return;
  }

  tbody.innerHTML = _abFiltered.map(k => {
    const nik    = String(k['NIK'] || '').trim();
    const status = _abStatus[nik] || '';

    const radioButtons = STATUS_OPTIONS.map(o => `
      <label class="ab-radio-label ${status === o.value ? 'ab-radio-selected' : ''}" style="${status === o.value ? `background:${o.bg};color:${o.color};border-color:${o.color}` : ''}">
        <input type="radio" name="status-${escapeHTML(nik)}" value="${o.value}"
          ${status === o.value ? 'checked' : ''} onclick="onStatusChange(this)">
        ${o.label}
      </label>`).join('');

    const rowCls = status ? `ab-row-${status.toLowerCase()}` : '';
    return `<tr class="${rowCls}" id="row-${escapeHTML(nik)}">
      <td><b>${escapeHTML(k['NAMA'] || '-')}</b><br><span style="font-size:.72rem;color:#94a3b8">${escapeHTML(nik)}</span></td>
      <td style="font-size:.8rem">${escapeHTML(k['DEPARTEMEN'] || '')}</td>
      <td style="font-size:.8rem">${escapeHTML(k['JABATAN'] || '')}</td>
      <td class="ab-radio-group">${radioButtons}</td>
      <td id="quiz-${escapeHTML(nik)}" class="ab-quiz-cell">${_quizCellHtml(nik, status)}</td>
    </tr>`;
  }).join('');
}

function onStatusChange(radio) {
  const nik    = radio.name.replace(/^status-/, '');
  // Klik ulang pill yang sudah aktif = batalkan (radio bawaan tidak bisa
  // di-uncheck, jadi pakai onclick + bandingkan dengan status tersimpan).
  const status = _abStatus[nik] === radio.value ? "" : radio.value;
  if (!status) radio.checked = false;
  _abStatus[nik] = status;

  // Update row class
  const row = document.getElementById(`row-${nik}`);
  if (row) {
    row.className = status ? `ab-row-${status.toLowerCase()}` : '';
    // Update label styling
    row.querySelectorAll('.ab-radio-label').forEach(lbl => {
      const inp = lbl.querySelector('input[type=radio]');
      const opt = STATUS_OPTIONS.find(o => o.value === inp?.value);
      if (inp?.checked && opt) {
        lbl.className = 'ab-radio-label ab-radio-selected';
        lbl.style.cssText = `background:${opt.bg};color:${opt.color};border-color:${opt.color}`;
      } else {
        lbl.className = 'ab-radio-label';
        lbl.style.cssText = '';
      }
    });
  }

  // Refresh quiz cell
  const cell = document.getElementById(`quiz-${nik}`);
  if (cell) {
    cell.innerHTML = _quizCellHtml(nik, status);
    // Jika status baru wajib quiz dan belum pernah dicek, fetch sekarang
    if (QUIZ_REQUIRED.has(status) && _quizSessionIds.length && !_abQuizResult[nik]) {
      _fetchOneDirect(nik);
    }
  }
  updateSummary();
}

async function _fetchOneDirect(nik) {
  _abQuizResult[nik] = await _checkOneNik(nik);
  _updateQuizCell(nik);
  updateSummary();
}

function updateSummary() {
  // Hitung jumlah per status kehadiran + yang belum diberi status
  // ("Belum Teridentifikasi") + rekap quiz (lulus/belum).
  const cnt = {}; STATUS_OPTIONS.forEach(s => { cnt[s.value] = 0; });
  let quizLulus = 0, quizBelum = 0, belumId = 0;
  _abKaryawan.forEach(k => {
    const nik = String(k['NIK'] || '').trim();
    const st  = _abStatus[nik] || '';
    if (!st) { belumId++; return; }
    if (cnt[st] !== undefined) cnt[st]++;
    if (QUIZ_REQUIRED.has(st)) {
      if (_abQuizResult[nik]?.passed) quizLulus++; else quizBelum++;
    }
  });
  const el = document.getElementById('abSummary');
  if (!el) return;
  const chip = (label, val, color, bg, icon) =>
    `<span class="ab-chip" style="background:${bg};color:${color}">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${label}: <b>${val}</b></span>`;
  let html = STATUS_OPTIONS.map(s => chip(s.label, cnt[s.value], s.color, s.bg)).join('');
  html += chip('Belum Teridentifikasi', belumId, '#475569', '#e2e8f0', 'fa-circle-question');
  html += chip('Quiz Lulus', quizLulus, '#4338ca', '#e0e7ff', 'fa-clipboard-check');
  html += chip('Belum Quiz', quizBelum, '#b45309', '#fef3c7', 'fa-clock');
  html += `<span style="font-size:.78rem;color:#94a3b8;margin-left:4px;align-self:center">dari <b>${_abKaryawan.length}</b></span>`;
  el.innerHTML = html;
}

function isiSemua(status) {
  _abFiltered.forEach(k => { _abStatus[String(k['NIK'] || '').trim()] = status; });
  renderTable();
  if (_quizSessionIds.length && QUIZ_REQUIRED.has(status)) _fetchQuizStatuses();
}

// ── Save ────────────────────────────────────────────────────────────────────
async function saveAbsensi() {
  const btn = document.getElementById('saveBtn');
  const msg = document.getElementById('saveMsg');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  msg.style.display = 'none';

  const absensi = _abKaryawan
    .filter(k => !!_abStatus[String(k['NIK'] || '').trim()])
    .map(k => {
      const nik = String(k['NIK'] || '').trim();
      const st  = _abStatus[nik] || 'HADIR';
      const qr  = _abQuizResult[nik];
      return {
        nik, nama: String(k['NAMA'] || ''),
        perusahaan: String(k['PERUSAHAAN'] || ''),
        departemen: String(k['DEPARTEMEN'] || ''),
        jabatan:    String(k['JABATAN'] || ''),
        status_kehadiran: st,
        quiz_done: QUIZ_REQUIRED.has(st) && qr?.passed ? true : false,
      };
    });

  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveSafetyTalkAbsensi', data: { schedule_id: _getScheduleId(), absensi } }),
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal menyimpan.');
    msg.textContent = `✓ ${json.message}`;
    msg.style.display = 'inline';
    if (typeof showToast === 'function') showToast(`Absensi disimpan. ${json.message}`);
    setTimeout(() => { msg.style.display = 'none'; }, 5000);
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Absensi';
  }
}

// ── Salin rekap kehadiran ke WhatsApp (jumlah saja, tanpa nama) ──────────────
function salinRekapWA() {
  // Hitung per status dari SEMUA karyawan yang sudah diberi status
  const cnt = {};
  STATUS_OPTIONS.forEach(o => { cnt[o.value] = 0; });
  let diabsen = 0, quizLulus = 0, quizBelum = 0;
  _abKaryawan.forEach(k => {
    const nik = String(k['NIK'] || '').trim();
    const st  = _abStatus[nik] || '';
    if (!st) return;
    diabsen++;
    if (cnt[st] !== undefined) cnt[st]++;
    if (QUIZ_REQUIRED.has(st)) { if (_abQuizResult[nik]?.passed) quizLulus++; else quizBelum++; }
  });
  const terpenuhi = cnt.HADIR + quizLulus;
  const pct = diabsen > 0 ? Math.round(terpenuhi / diabsen * 100) : 0;
  const belumId = _abKaryawan.length - diabsen; // belum diberi status kehadiran

  const tgl = _abSchedule?.['TANGGAL']
    ? new Date(_abSchedule['TANGGAL']).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '-';
  const co = _abSchedule?.['PERUSAHAAN_TARGET'] || 'Semua Perusahaan';

  // Baris per status yang jumlahnya > 0 (label ikut yang tampil, mis. Off)
  const baris = STATUS_OPTIONS
    .filter(o => cnt[o.value] > 0)
    .map(o => `- ${o.label}: ${cnt[o.value]}`)
    .join('\n');

  const teks =
`📋 *Rekap Kehadiran Safety Talk*
${_abSchedule?.['JUDUL_MATERI'] || '-'}
🗓️ ${tgl}
🏢 ${co}

Total karyawan: ${_abKaryawan.length} orang
Sudah diabsen: ${diabsen} orang
${baris || '- (belum ada yang diabsen)'}
${belumId > 0 ? `- Belum Teridentifikasi: ${belumId}\n` : ''}
📝 Wajib quiz: ${quizLulus + quizBelum} (lulus ${quizLulus}, belum ${quizBelum})
✅ Kepatuhan: ${terpenuhi}/${diabsen} (${pct}%)

_Hadir + yang lulus quiz = capaian terpenuhi._`;

  const done = () => { if (typeof showToast === 'function') showToast('Rekap kehadiran disalin!'); };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(teks).then(done).catch(() => _fallbackCopy(teks, done));
  } else { _fallbackCopy(teks, done); }
}

function _fallbackCopy(teks, done) {
  const ta = document.createElement('textarea');
  ta.value = teks; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch {}
  document.body.removeChild(ta);
}

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
