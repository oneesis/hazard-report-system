// Safety Talk — halaman list jadwal (admin only)

let _stSchedules = [];
let _stAbsensiMap = {}; // schedule_id → jumlah hadir
let _stKaryawan  = [];
let _stPemateriChoices;

// ── Load ──────────────────────────────────────────────────────────
async function loadAll() {
  document.getElementById('stGrid').innerHTML =
    '<div class="st-empty"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>';
  try {
    const [schRes, abRes, karRes] = await Promise.all([
      fetch('/api?action=getSafetyTalkSchedules').then(r => r.json()),
      fetch('/api?action=getSafetyTalkAbsensi').then(r => r.json()),
      fetch('/api?action=masterKaryawan').then(r => r.json()),
    ]);
    _stSchedules = schRes.data || [];
    // Build absensi count map
    _stAbsensiMap = {};
    (abRes.data || []).forEach(row => {
      const id = row['SCHEDULE_ID'];
      _stAbsensiMap[id] = (_stAbsensiMap[id] || 0) + 1;
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
    const hadir  = _stAbsensiMap[id] || 0;
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
      <div class="st-absensi-count"><i class="fa-solid fa-users-line" style="color:#6366f1"></i> <b>${hadir}</b> karyawan hadir</div>
      <div class="st-card-footer">
        <a href="safety-talk-absensi.html?id=${encodeURIComponent(id)}" class="btn-indigo-soft">
          <i class="fa-solid fa-clipboard-list"></i> Kelola Absensi
        </a>
        ${status === 'AKTIF' ? `<button class="btn-danger-soft" onclick="selesaikan('${id}')">
          <i class="fa-solid fa-circle-check"></i> Selesaikan
        </button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Create ────────────────────────────────────────────────────────
function openCreateModal() {
  document.getElementById('stTanggal').value = new Date().toISOString().slice(0, 10);
  document.getElementById('stJudul').value = '';
  document.getElementById('stDeskripsi').value = '';
  if (_stPemateriChoices) _stPemateriChoices.setChoiceByValue('');
  document.getElementById('stTargetCo').value = '';
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
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createSafetyTalkSchedule', data: {
        tanggal,
        judul_materi:    judul,
        deskripsi_materi: document.getElementById('stDeskripsi').value.trim(),
        nama_pemateri:   pemateri || '',
        nik_pemateri:    karFound?.['NIK']     || '',
        jabatan_pemateri:karFound?.['JABATAN'] || '',
        perusahaan_target: document.getElementById('stTargetCo').value,
      }}),
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal menyimpan.');
    closeModal('createModal');
    if (typeof showToast === 'function') showToast('Jadwal berhasil dibuat!');
    await loadAll();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
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

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}
