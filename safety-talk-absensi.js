// Safety Talk — halaman kelola absensi per jadwal

const QUIZ_URL = 'https://quiz-she.vercel.app';

let _abSchedule  = null;
let _abKaryawan  = [];   // list karyawan
let _abStatus    = {};   // NIK → status kehadiran string
let _abQuizResult = {};  // NIK → { passed, score, certificateNo } dari quizsheebl.org
let _abFiltered  = [];
let _quizSessionId = ''; // dari jadwal

const STATUS_OPTIONS = [
  { value: 'HADIR',       label: 'Hadir',       color: '#16a34a', bg: '#dcfce7' },
  { value: 'CUTI',        label: 'Cuti',         color: '#d97706', bg: '#fef3c7' },
  { value: 'DINAS_LUAR',  label: 'Dinas Luar',   color: '#0284c7', bg: '#e0f2fe' },
  { value: 'SHIFT_MALAM', label: 'Shift Malam',  color: '#7c3aed', bg: '#ede9fe' },
  { value: 'LIBUR',       label: 'Libur',        color: '#64748b', bg: '#f1f5f9' },
  { value: 'MANGKIR',     label: 'Mangkir',      color: '#dc2626', bg: '#fee2e2' },
];
// Status yang wajib quiz (bukan Hadir, bukan Mangkir)
const QUIZ_REQUIRED = new Set(['CUTI','DINAS_LUAR','SHIFT_MALAM','LIBUR']);

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

    _quizSessionId = String(_abSchedule['QUIZ_SESSION_ID'] || '').trim();

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
          ${_quizSessionId ? `<span style="color:#fde68a;font-size:.78rem"><i class="fa-solid fa-clipboard-question"></i> Quiz: ${escapeHTML(_quizSessionId)}</span>` : ''}
        </div>`;
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

    // Auto-cek quiz dari quizsheebl.org (background, setelah tabel tampil)
    if (_quizSessionId) _fetchQuizStatuses();

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:#ef4444;text-align:center;padding:20px">Gagal memuat: ${e.message}</td></tr>`;
  }
}

// ── Fetch quiz statuses dari quizsheebl.org ─────────────────────────────────
async function _fetchQuizStatuses() {
  const toCheck = _abKaryawan.filter(k => {
    const nik = String(k['NIK'] || '').trim();
    return QUIZ_REQUIRED.has(_abStatus[nik] || '');
  });
  if (!toCheck.length) return;

  // Parallel fetch, max 10 bersamaan
  const BATCH = 10;
  for (let i = 0; i < toCheck.length; i += BATCH) {
    const batch = toCheck.slice(i, i + BATCH);
    await Promise.all(batch.map(async k => {
      const nik = String(k['NIK'] || '').trim();
      try {
        const res = await fetch(`${QUIZ_URL}/api/data?action=existing&nik=${encodeURIComponent(nik)}&sessionId=${encodeURIComponent(_quizSessionId)}`);
        const json = await res.json();
        _abQuizResult[nik] = json.certificateNo
          ? { passed: true, score: json.score, certificateNo: json.certificateNo }
          : { passed: false };
      } catch { _abQuizResult[nik] = { passed: false }; }
      // Update cell langsung tanpa full re-render
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
  if (!_quizSessionId) return '<span class="ab-quiz-na">—</span>';
  if (status === 'HADIR') return '<span class="ab-quiz-na">—</span>';
  if (status === 'MANGKIR') return '<span class="ab-quiz-locked"><i class="fa-solid fa-lock"></i> Terkunci</span>';
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

  document.getElementById('totalCount').textContent = _abFiltered.length;
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
          ${status === o.value ? 'checked' : ''} onchange="onStatusChange(this)">
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
  const status = radio.value;
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
    if (QUIZ_REQUIRED.has(status) && _quizSessionId && !_abQuizResult[nik]) {
      _fetchOneDirect(nik);
    }
  }
  updateSummary();
}

async function _fetchOneDirect(nik) {
  try {
    const res = await fetch(`${QUIZ_URL}/api/data?action=existing&nik=${encodeURIComponent(nik)}&sessionId=${encodeURIComponent(_quizSessionId)}`);
    const json = await res.json();
    _abQuizResult[nik] = json.certificateNo
      ? { passed: true, score: json.score, certificateNo: json.certificateNo }
      : { passed: false };
  } catch { _abQuizResult[nik] = { passed: false }; }
  _updateQuizCell(nik);
  updateSummary();
}

function updateSummary() {
  let hadir = 0, quizLulus = 0, mangkir = 0, quizBelum = 0;
  _abKaryawan.forEach(k => {
    const nik = String(k['NIK'] || '').trim();
    const st  = _abStatus[nik] || '';
    if (st === 'HADIR')   hadir++;
    else if (st === 'MANGKIR') mangkir++;
    else if (QUIZ_REQUIRED.has(st)) {
      if (_abQuizResult[nik]?.passed) quizLulus++; else quizBelum++;
    }
  });
  document.getElementById('hadirCount').textContent   = hadir;
  document.getElementById('quizCount').textContent    = quizLulus;
  document.getElementById('mangkirCount').textContent = mangkir;
  document.getElementById('belumCount').textContent   = quizBelum;
}

function isiSemua(status) {
  _abFiltered.forEach(k => { _abStatus[String(k['NIK'] || '').trim()] = status; });
  renderTable();
  if (_quizSessionId && STATUS_OPTIONS.some(o => o.value === status) && QUIZ_REQUIRED.has(status)) {
    _fetchQuizStatuses();
  }
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

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
