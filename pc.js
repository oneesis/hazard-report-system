// Personal Contact List — ONE-SAP
// BASE_URL sudah dideklarasikan di reports-utils.js
let _pcData = [];
let _pcTab  = 'semua';   // 'semua' | 'coach' | 'coachee'
let _buktiFotos = [];

function escH(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function v(r, k) { return String(r[k] || r[k.toUpperCase()] || '').trim(); }

// ── Load ─────────────────────────────────────────────────────
async function loadPcReports() {
  try {
    const res  = await fetch(`${BASE_URL}?action=getPCReports`);
    const json = await res.json();
    _pcData = Array.isArray(json) ? json : (json.data || []);
  } catch { _pcData = []; }
  renderStats();
  renderPcList();
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  const total  = _pcData.length;
  const open   = _pcData.filter(r => (v(r,'status')||'OPEN').toUpperCase() === 'OPEN').length;
  const closed = total - open;
  document.getElementById('statTotal').textContent  = total;
  document.getElementById('statOpen').textContent   = open;
  document.getElementById('statClosed').textContent = closed;
}

// ── Tabs ─────────────────────────────────────────────────────
function switchTab(tab) {
  _pcTab = tab;
  ['semua','coach','coachee'].forEach(t => {
    document.getElementById(`tab${t.charAt(0).toUpperCase()+t.slice(1)}`)
      ?.classList.toggle('active', t === tab);
  });
  renderPcList();
}

function getUser() { return typeof getCurrentUser === 'function' ? getCurrentUser() : null; }

function matchesTab(r) {
  const user     = getUser();
  const nik      = String(user?.nik  || '').toLowerCase();
  const nama     = String(user?.nama || '').toLowerCase();
  if (_pcTab === 'semua') return true;
  const coachNik   = v(r,'nik_coach').toLowerCase();
  const coachNama  = v(r,'nama_coach').toLowerCase();
  const coacheeNik  = v(r,'nik_coachee').toLowerCase();
  const coacheeNama = v(r,'nama_coachee').toLowerCase();
  if (_pcTab === 'coach')   return (nik && coachNik  === nik)  || (nama && coachNama  === nama);
  if (_pcTab === 'coachee') return (nik && coacheeNik === nik) || (nama && coacheeNama === nama);
  return true;
}

// ── Render list ───────────────────────────────────────────────
function renderPcList() {
  const user      = getUser();
  const nik       = String(user?.nik  || '').toLowerCase();
  const nama      = String(user?.nama || '').toLowerCase();
  const q         = (document.getElementById('pcSearch')?.value || '').toLowerCase();
  const status    = document.getElementById('pcFilterStatus')?.value || '';
  const topik     = document.getElementById('pcFilterTopik')?.value  || '';

  // Tab counts
  const tabData = {
    semua:   _pcData,
    coach:   _pcData.filter(r => { const n=v(r,'nik_coach').toLowerCase(),nm=v(r,'nama_coach').toLowerCase(); return (nik&&n===nik)||(nama&&nm===nama); }),
    coachee: _pcData.filter(r => { const n=v(r,'nik_coachee').toLowerCase(),nm=v(r,'nama_coachee').toLowerCase(); return (nik&&n===nik)||(nama&&nm===nama); }),
  };
  document.getElementById('countSemua').textContent   = tabData.semua.length;
  document.getElementById('countCoach').textContent   = tabData.coach.length;
  document.getElementById('countCoachee').textContent = tabData.coachee.length;

  let data = _pcData.filter(r => {
    if (!matchesTab(r)) return false;
    if (status && v(r,'status').toUpperCase() !== status) return false;
    if (topik  && v(r,'topik_coaching') !== topik) return false;
    if (q) {
      const hay = [v(r,'id'),v(r,'nama_coachee'),v(r,'nama_coach'),v(r,'judul_coaching'),v(r,'topik_coaching')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const list = document.getElementById('pcList');

  if (!data.length) {
    list.innerHTML = `
      <div class="pc-empty">
        <span class="pc-empty-icon">💬</span>
        <div class="pc-empty-title">Belum ada Personal Contact</div>
        <div class="pc-empty-sub">PC yang kamu buat atau terima akan muncul di sini.</div>
      </div>`;
    return;
  }

  list.innerHTML = data.map(r => {
    const st = (v(r,'status') || 'OPEN').toUpperCase();
    const stClass = st === 'CLOSED' ? 'closed' : 'open';
    const stLabel = st === 'CLOSED' ? '✅ Closed' : '⏳ Open';
    const topikEmoji = v(r,'topik_coaching') === 'Pribadi' ? '👤' : '🏗️';

    const coacheeNik  = v(r,'nik_coachee').toLowerCase();
    const coacheeNama = v(r,'nama_coachee').toLowerCase();
    const isCoachee   = (nik && coacheeNik === nik) || (nama && coacheeNama === nama);
    const canConfirm  = isCoachee && st === 'OPEN';

    const deadline = v(r,'batas_waktu_pc');
    const deadlineEl = deadline
      ? `<span><i class="fa-solid fa-clock"></i> ${escH(deadline)}</span>`
      : '';

    return `
    <div class="pc-card">
      <div class="pc-card-accent ${stClass}"></div>
      <div class="pc-card-body">
        <div class="pc-card-top">
          <div style="min-width:0">
            <div class="pc-card-id">${escH(v(r,'id'))}</div>
            <div class="pc-card-title">${escH(v(r,'judul_coaching') || '-')}</div>
          </div>
          <span class="pc-badge ${stClass}">${stLabel}</span>
        </div>
        <div class="pc-card-meta">
          <span class="pc-card-topik">${topikEmoji} ${escH(v(r,'topik_coaching'))}</span>
          <span><i class="fa-solid fa-calendar"></i> ${escH(v(r,'tgl_pc') || '-')}</span>
          <span><i class="fa-solid fa-user-tie"></i> ${escH(v(r,'nama_coach') || '-')}</span>
          <span><i class="fa-solid fa-user"></i> ${escH(v(r,'nama_coachee') || '-')}</span>
          ${deadlineEl}
        </div>
        <div class="pc-card-footer">
          <button class="pc-btn-detail" onclick='showDetail(${JSON.stringify(r).replace(/'/g,"&#39;")})'>
            <i class="fa-solid fa-eye"></i> Lihat Detail
          </button>
          ${canConfirm ? `
          <button class="pc-btn-komitmen" onclick='openKomitmenModal("${escH(v(r,'id'))}")'>
            <i class="fa-solid fa-handshake"></i> Konfirmasi Komitmen
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Detail modal ──────────────────────────────────────────────
function showDetail(r) {
  const row = (label, val) =>
    `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${escH(val)}</span></div>`;
  const rowPre = (label, val) =>
    `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value" style="white-space:pre-wrap">${escH(val)}</span></div>`;

  const foto = v(r,'foto_pc');
  const fotoKomitmen = v(r,'foto_komitmen');

  document.getElementById('detailContent').innerHTML = `
    ${row('ID', v(r,'id'))}
    ${row('Tanggal PC', v(r,'tgl_pc'))}
    ${row('Lokasi', v(r,'lokasi_pc'))}
    <hr class="detail-divider">
    ${row('Coach', v(r,'nama_coach'))}
    ${row('Coachee', v(r,'nama_coachee'))}
    ${row('Jabatan', v(r,'jabatan_coachee'))}
    ${row('Departemen', v(r,'departemen_coachee'))}
    ${row('Perusahaan', v(r,'perusahaan_coachee'))}
    <hr class="detail-divider">
    ${row('Topik', v(r,'topik_coaching'))}
    ${row('Judul', v(r,'judul_coaching'))}
    ${rowPre('Deskripsi', v(r,'deskripsi_coaching'))}
    ${rowPre('Komitmen', v(r,'komitmen_perbaikan'))}
    ${row('Batas Waktu', v(r,'batas_waktu_pc'))}
    ${row('Status', v(r,'status') || 'OPEN')}
    ${foto ? `<div class="detail-row"><span class="detail-label">Foto Sesi</span><a href="${escH(foto)}" target="_blank" style="color:#0d9488;font-weight:600">Lihat Foto →</a></div>` : ''}
    ${fotoKomitmen ? `<div class="detail-row"><span class="detail-label">Foto Bukti</span><a href="${escH(fotoKomitmen)}" target="_blank" style="color:#0d9488;font-weight:600">Lihat Bukti →</a></div>` : ''}
    ${v(r,'pesan_komitmen') ? rowPre('Pesan Coachee', v(r,'pesan_komitmen')) : ''}
  `;
  openModal('detailModal');
}

// ── Komitmen modal ────────────────────────────────────────────
function openKomitmenModal(id) {
  document.getElementById('komitmenPcId').value = id;
  document.getElementById('fotoBukti').value = '';
  document.getElementById('buktiFotoPreview').innerHTML = '';
  document.getElementById('pesanKomitmen').value = '';
  document.getElementById('komitmenErr').style.display = 'none';
  _buktiFotos = [];
  openModal('komitmenModal');
}

function onBuktiFotoChange(input) {
  const preview = document.getElementById('buktiFotoPreview');
  _buktiFotos = [];
  if (!input.files?.length) { preview.innerHTML = ''; return; }
  Promise.all([...input.files].map(f => new Promise(res => {
    const fr = new FileReader(); fr.onload = e => res(e.target.result); fr.readAsDataURL(f);
  }))).then(results => {
    _buktiFotos = results;
    preview.innerHTML = results.map(d =>
      `<img src="${d}" style="height:64px;border-radius:8px;border:1.5px solid #e2e8f0;object-fit:cover">`
    ).join('');
  });
}

async function submitKomitmen() {
  const id  = document.getElementById('komitmenPcId').value;
  const err = document.getElementById('komitmenErr');
  if (!_buktiFotos.length) {
    err.textContent = 'Foto bukti wajib diupload.';
    err.style.display = 'block';
    return;
  }
  const btn = document.getElementById('komitmenSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

  try {
    const res = await fetch(BASE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updatePCReport',
        data: {
          id,
          foto_komitmen:  _buktiFotos,
          pesan_komitmen: String(document.getElementById('pesanKomitmen')?.value || '').trim(),
          status:         'CLOSED',
        }
      })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal.');

    closeModal('komitmenModal');
    if (typeof showToast === 'function') showToast('Komitmen berhasil dikonfirmasi! 🤝');
    await loadPcReports();
  } catch (e) {
    err.textContent = 'Gagal: ' + e.message;
    err.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Konfirmasi Komitmen';
  }
}

// ── Modal helpers ─────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => {
  ['detailModal','komitmenModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el?.classList.contains('open') && e.target === el) closeModal(id);
  });
});

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  renderUserProfile();
  loadPcReports();
});
