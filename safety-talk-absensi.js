// Safety Talk — halaman kelola absensi per jadwal

let _abSchedule = null;
let _abKaryawan  = [];   // list karyawan (filter by PERUSAHAAN_TARGET)
let _abHadir     = new Set(); // NIK yang hadir
let _abFiltered  = [];   // karyawan setelah filter search

function _getScheduleId() {
  const p = new URLSearchParams(window.location.search);
  return p.get('id') || '';
}

async function initAbsensi() {
  const schedId = _getScheduleId();
  if (!schedId) { window.location.href = 'safety-talk.html'; return; }

  const tbody = document.getElementById('abTbody');
  tbody.innerHTML = '<tr><td colspan="6" class="um-loading">Memuat data...</td></tr>';

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

    // Karyawan — filter by target perusahaan kalau ada
    const allKar = Array.isArray(karRes) ? karRes : (karRes.data || []);
    const targetCo = String(_abSchedule['PERUSAHAAN_TARGET'] || '').trim();
    _abKaryawan = targetCo
      ? allKar.filter(k => String(k['PERUSAHAAN'] || '').trim() === targetCo)
      : allKar;
    // Exclude DELETED role
    _abKaryawan = _abKaryawan.filter(k =>
      String(k['ROLE'] || '').toUpperCase().replace(/\s+/g,'_') !== 'DELETED'
    ).sort((a, b) => String(a['NAMA'] || '').localeCompare(String(b['NAMA'] || '')));

    // NIK yang sudah hadir
    _abHadir = new Set((abRes.data || []).map(r => String(r['NIK'] || '').trim()).filter(Boolean));

    renderTable();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#ef4444;text-align:center;padding:20px">Gagal memuat: ${e.message}</td></tr>`;
  }
}

function filterTable() {
  renderTable();
}

function renderTable() {
  const q = (document.getElementById('abSearch')?.value || '').toLowerCase().trim();
  _abFiltered = q
    ? _abKaryawan.filter(k => String(k['NAMA'] || '').toLowerCase().includes(q))
    : _abKaryawan;

  document.getElementById('totalCount').textContent = _abFiltered.length;
  updateHadirCount();

  const tbody = document.getElementById('abTbody');
  if (!_abFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada karyawan</td></tr>';
    return;
  }

  tbody.innerHTML = _abFiltered.map(k => {
    const nik = String(k['NIK'] || '').trim();
    const checked = _abHadir.has(nik);
    return `<tr class="${checked ? 'checked' : ''}" id="row-${escapeHTML(nik)}">
      <td class="um-center">
        <input type="checkbox" class="ab-cb" data-nik="${escapeHTML(nik)}"
          ${checked ? 'checked' : ''} onchange="onCheck(this)">
      </td>
      <td><b>${escapeHTML(k['NAMA'] || '-')}</b></td>
      <td style="color:#64748b">${escapeHTML(String(nik || '-'))}</td>
      <td>${escapeHTML(k['PERUSAHAAN'] || '')}</td>
      <td>${escapeHTML(k['DEPARTEMEN'] || '')}</td>
      <td>${escapeHTML(k['JABATAN'] || '')}</td>
    </tr>`;
  }).join('');
}

function onCheck(cb) {
  const nik = cb.dataset.nik;
  if (cb.checked) { _abHadir.add(nik); }
  else { _abHadir.delete(nik); }
  const row = document.getElementById(`row-${nik}`);
  if (row) row.className = cb.checked ? 'checked' : '';
  updateHadirCount();
}

function updateHadirCount() {
  // Count hadir dari yang tampil di filter
  const visibleHadir = _abFiltered.filter(k => _abHadir.has(String(k['NIK'] || '').trim())).length;
  document.getElementById('hadirCount').textContent = visibleHadir;
}

function toggleAll() {
  const allChecked = _abFiltered.every(k => _abHadir.has(String(k['NIK'] || '').trim()));
  _abFiltered.forEach(k => {
    const nik = String(k['NIK'] || '').trim();
    if (allChecked) { _abHadir.delete(nik); } else { _abHadir.add(nik); }
  });
  renderTable();
}

async function saveAbsensi() {
  const btn = document.getElementById('saveBtn');
  const msg = document.getElementById('saveMsg');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  msg.style.display = 'none';

  // Build niks_hadir dari semua karyawan yang tercentang
  const niks_hadir = _abKaryawan.filter(k => _abHadir.has(String(k['NIK'] || '').trim())).map(k => ({
    nik:        String(k['NIK'] || ''),
    nama:       String(k['NAMA'] || ''),
    perusahaan: String(k['PERUSAHAAN'] || ''),
    departemen: String(k['DEPARTEMEN'] || ''),
    jabatan:    String(k['JABATAN'] || ''),
  }));

  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveSafetyTalkAbsensi', data: {
        schedule_id: _getScheduleId(),
        niks_hadir,
      }}),
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal menyimpan.');
    msg.textContent = `✓ ${json.count} karyawan tersimpan`;
    msg.style.display = 'inline';
    if (typeof showToast === 'function') showToast(`Absensi disimpan: ${json.count} karyawan hadir.`);
    setTimeout(() => { msg.style.display = 'none'; }, 4000);
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
