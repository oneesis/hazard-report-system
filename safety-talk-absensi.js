// Safety Talk — halaman kelola absensi per jadwal

let _abSchedule = null;
let _abKaryawan  = [];   // list karyawan (filter by PERUSAHAAN_TARGET)
let _abStatus    = {};   // NIK → status kehadiran
let _abQuiz      = {};   // NIK → boolean (quiz sudah dikerjakan)
let _abFiltered  = [];   // karyawan setelah filter search

const STATUS_OPTIONS = [
  { value: 'HADIR',       label: 'Hadir',        color: '#16a34a', bg: '#dcfce7' },
  { value: 'CUTI',        label: 'Cuti',          color: '#d97706', bg: '#fef3c7' },
  { value: 'DINAS_LUAR',  label: 'Dinas Luar',    color: '#0284c7', bg: '#e0f2fe' },
  { value: 'SHIFT_MALAM', label: 'Shift Malam',   color: '#7c3aed', bg: '#ede9fe' },
  { value: 'LIBUR',       label: 'Libur',         color: '#64748b', bg: '#f1f5f9' },
  { value: 'MANGKIR',     label: 'Mangkir',       color: '#dc2626', bg: '#fee2e2' },
];
const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o]));
// Status yang boleh isi quiz (bukan HADIR dan bukan MANGKIR)
const QUIZ_ALLOWED = new Set(['CUTI','DINAS_LUAR','SHIFT_MALAM','LIBUR']);

function _getScheduleId() {
  const p = new URLSearchParams(window.location.search);
  return p.get('id') || '';
}

async function initAbsensi() {
  const schedId = _getScheduleId();
  if (!schedId) { window.location.href = 'safety-talk.html'; return; }

  const tbody = document.getElementById('abTbody');
  tbody.innerHTML = '<tr><td colspan="7" class="um-loading">Memuat data...</td></tr>';

  try {
    const [schRes, abRes, karRes] = await Promise.all([
      fetch('/api?action=getSafetyTalkSchedules').then(r => r.json()),
      fetch(`/api?action=getSafetyTalkAbsensi&schedule_id=${encodeURIComponent(schedId)}`).then(r => r.json()),
      fetch('/api?action=masterKaryawan').then(r => r.json()),
    ]);

    // Cari jadwal
    const allSched = schRes.data || [];
    _abSchedule = allSched.find(s => String(s['ID'] || '') === schedId);
    if (!_abSchedule) { window.location.href = 'safety-talk.html'; return; }

    // Render info card
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
        </div>`;
    }

    // Karyawan
    const allKar = Array.isArray(karRes) ? karRes : (karRes.data || []);
    const targetCo = String(_abSchedule['PERUSAHAAN_TARGET'] || '').trim();
    _abKaryawan = targetCo
      ? allKar.filter(k => String(k['PERUSAHAAN'] || '').trim() === targetCo)
      : allKar;
    _abKaryawan = _abKaryawan
      .filter(k => String(k['ROLE'] || '').toUpperCase().replace(/\s+/g,'_') !== 'DELETED')
      .sort((a, b) => String(a['NAMA'] || '').localeCompare(String(b['NAMA'] || '')));

    // Status kehadiran dari data absensi yang sudah ada
    _abStatus = {};
    _abQuiz   = {};
    (abRes.data || []).forEach(r => {
      const nik = String(r['NIK'] || '').trim();
      if (!nik) return;
      const status = String(r['STATUS_KEHADIRAN'] || 'HADIR').toUpperCase();
      _abStatus[nik] = status;
      _abQuiz[nik]   = String(r['QUIZ_DONE'] || '').toUpperCase() === 'YA';
    });

    renderTable();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#ef4444;text-align:center;padding:20px">Gagal memuat: ${e.message}</td></tr>`;
  }
}

function filterTable() { renderTable(); }

function renderTable() {
  const q = (document.getElementById('abSearch')?.value || '').toLowerCase().trim();
  const sf = (document.getElementById('abFilterStatus')?.value || '');
  _abFiltered = _abKaryawan.filter(k => {
    const nama = String(k['NAMA'] || '').toLowerCase();
    if (q && !nama.includes(q)) return false;
    if (sf) {
      const st = _abStatus[String(k['NIK'] || '').trim()] || '';
      if (st !== sf) return false;
    }
    return true;
  });

  document.getElementById('totalCount').textContent = _abFiltered.length;
  updateSummary();

  const tbody = document.getElementById('abTbody');
  if (!_abFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada karyawan</td></tr>';
    return;
  }

  tbody.innerHTML = _abFiltered.map(k => {
    const nik    = String(k['NIK'] || '').trim();
    const status = _abStatus[nik] || '';
    const quiz   = !!_abQuiz[nik];
    const opt    = STATUS_MAP[status];
    const badgeStyle = opt ? `background:${opt.bg};color:${opt.color};border:1px solid ${opt.color}33` : '';

    const statusSelect = `<select class="ab-status-sel" data-nik="${escapeHTML(nik)}" onchange="onStatusChange(this)">
      <option value="">— pilih —</option>
      ${STATUS_OPTIONS.map(o =>
        `<option value="${o.value}" ${status === o.value ? 'selected' : ''}>${o.label}</option>`
      ).join('')}
    </select>`;

    const quizAllowed = QUIZ_ALLOWED.has(status);
    const isMangkir   = status === 'MANGKIR';
    let quizCell = '';
    if (!status || status === 'HADIR') {
      quizCell = '<span class="ab-quiz-na">—</span>';
    } else if (isMangkir) {
      quizCell = '<span class="ab-quiz-locked" title="Mangkir tidak dapat diganti dengan quiz"><i class="fa-solid fa-lock"></i> Terkunci</span>';
    } else {
      quizCell = `<label class="ab-quiz-label">
        <input type="checkbox" class="ab-quiz-cb" data-nik="${escapeHTML(nik)}"
          ${quiz ? 'checked' : ''} onchange="onQuizChange(this)">
        <span>${quiz ? '✓ Sudah' : 'Belum'}</span>
      </label>`;
    }

    const rowCls = status ? `ab-row-${status.toLowerCase()}` : '';
    return `<tr class="${rowCls}" id="row-${escapeHTML(nik)}">
      <td><b>${escapeHTML(k['NAMA'] || '-')}</b></td>
      <td style="color:#64748b;font-size:.8rem">${escapeHTML(nik || '-')}</td>
      <td style="font-size:.8rem">${escapeHTML(k['DEPARTEMEN'] || '')}</td>
      <td style="font-size:.8rem">${escapeHTML(k['JABATAN'] || '')}</td>
      <td>${statusSelect}${opt ? `<span class="ab-status-badge" style="${badgeStyle}">${opt.label}</span>` : ''}</td>
      <td class="ab-quiz-cell">${quizCell}</td>
    </tr>`;
  }).join('');
}

function onStatusChange(sel) {
  const nik    = sel.dataset.nik;
  const status = sel.value;
  _abStatus[nik] = status;
  // Reset quiz jika ganti ke HADIR atau MANGKIR
  if (status === 'HADIR' || status === 'MANGKIR' || !status) _abQuiz[nik] = false;
  updateSummary();
  renderTable();  // re-render baris (badge + quiz cell update)
}

function onQuizChange(cb) {
  _abQuiz[cb.dataset.nik] = cb.checked;
  updateSummary();
  // Update label tanpa full re-render
  const span = cb.nextElementSibling;
  if (span) span.textContent = cb.checked ? '✓ Sudah' : 'Belum';
}

function updateSummary() {
  const counts = { HADIR:0, CUTI:0, DINAS_LUAR:0, SHIFT_MALAM:0, LIBUR:0, MANGKIR:0, QUIZ:0, BELUM:0 };
  _abKaryawan.forEach(k => {
    const nik = String(k['NIK'] || '').trim();
    const st  = _abStatus[nik] || '';
    if (counts[st] !== undefined) counts[st]++;
    if (QUIZ_ALLOWED.has(st)) {
      if (_abQuiz[nik]) counts.QUIZ++; else counts.BELUM++;
    }
  });
  document.getElementById('hadirCount').textContent    = counts.HADIR;
  document.getElementById('quizCount').textContent     = counts.QUIZ;
  document.getElementById('mangkirCount').textContent  = counts.MANGKIR;
  document.getElementById('belumCount').textContent    = counts.BELUM;
}

function isiSemua(status) {
  _abFiltered.forEach(k => {
    const nik = String(k['NIK'] || '').trim();
    _abStatus[nik] = status;
    if (status === 'HADIR' || status === 'MANGKIR') _abQuiz[nik] = false;
  });
  renderTable();
}

async function saveAbsensi() {
  const btn = document.getElementById('saveBtn');
  const msg = document.getElementById('saveMsg');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  msg.style.display = 'none';

  // Sertakan SEMUA karyawan yang sudah punya status; yang belum pilih status diabaikan
  const absensi = _abKaryawan
    .filter(k => !!_abStatus[String(k['NIK'] || '').trim()])
    .map(k => {
      const nik = String(k['NIK'] || '').trim();
      return {
        nik,
        nama:       String(k['NAMA'] || ''),
        perusahaan: String(k['PERUSAHAAN'] || ''),
        departemen: String(k['DEPARTEMEN'] || ''),
        jabatan:    String(k['JABATAN'] || ''),
        status_kehadiran: _abStatus[nik] || 'HADIR',
        quiz_done:  !!_abQuiz[nik],
      };
    });

  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveSafetyTalkAbsensi', data: {
        schedule_id: _getScheduleId(),
        absensi,
      }}),
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
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}
