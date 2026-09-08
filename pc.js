// Personal Contact (PC) List — ONE-SAP

const BASE_URL = '/api';
let _pcData = [];
let _buktiFotos = [];

function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function loadPcReports() {
  try {
    const res  = await fetch(`${BASE_URL}?action=getPCReports`, { headers: getAuthHeaders() });
    const json = await res.json();
    _pcData = Array.isArray(json) ? json : (json.data || []);
  } catch {
    _pcData = [];
  }
  renderPcList();
}

function renderPcList() {
  const list      = document.getElementById('pcList');
  const q         = (document.getElementById('pcSearch')?.value || '').toLowerCase();
  const status    = document.getElementById('pcFilterStatus')?.value || '';
  const topik     = document.getElementById('pcFilterTopik')?.value || '';
  const user      = getCurrentUser();
  const userNik   = String(user?.nik  || '').trim().toLowerCase();
  const userNama  = String(user?.nama  || '').trim().toLowerCase();
  const isSA      = user?.role === 'SUPER_ADMIN';
  const isAdmin   = user?.role === 'ADMIN' || isSA;

  let data = _pcData.filter(r => {
    // Scoping: coach atau coachee bisa lihat, admin lihat semua perusahaan sendiri
    const coachNik   = String(r.nik_coach   || '').toLowerCase();
    const coachNama  = String(r.nama_coach  || '').toLowerCase();
    const coacheeNik  = String(r.nik_coachee  || '').toLowerCase();
    const coacheeNama = String(r.nama_coachee || '').toLowerCase();

    if (!isSA) {
      const isCoach   = (userNik && coachNik   === userNik)  || (userNama && coachNama  === userNama);
      const isCoachee = (userNik && coacheeNik === userNik)  || (userNama && coacheeNama === userNama);
      if (!isAdmin && !isCoach && !isCoachee) return false;
    }

    if (status && String(r.status || '').toUpperCase() !== status) return false;
    if (topik  && String(r.topik_coaching || '') !== topik) return false;
    if (q) {
      const haystack = [r.id, r.nama_coachee, r.nama_coach, r.judul_coaching, r.topik_coaching].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (!data.length) {
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-comments" style="font-size:2rem;margin-bottom:12px;display:block"></i>Belum ada data Personal Contact.</div>`;
    return;
  }

  list.innerHTML = data.map(r => {
    const st = String(r.status || 'OPEN').toUpperCase();
    const badgeClass = st === 'CLOSED' ? 'closed' : 'open';
    const badgeLabel = st === 'CLOSED' ? 'Closed' : 'Open';

    const coacheeNik  = String(r.nik_coachee  || '').toLowerCase();
    const coacheeNama = String(r.nama_coachee || '').toLowerCase();
    const isCoachee   = (userNik && coacheeNik === userNik) || (userNama && coacheeNama === userNama);

    return `
    <div class="pc-card">
      <div class="pc-card-top">
        <div>
          <div class="pc-card-id">${escH(r.id)}</div>
          <div class="pc-card-title">${escH(r.judul_coaching || '-')}</div>
        </div>
        <span class="pc-badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="pc-card-meta">
        <span><i class="fa-solid fa-tag"></i> ${escH(r.topik_coaching || '-')}</span>
        <span><i class="fa-solid fa-calendar"></i> ${escH(r.tgl_pc || '-')}</span>
        <span><i class="fa-solid fa-user-tie"></i> Coach: ${escH(r.nama_coach || '-')}</span>
        <span><i class="fa-solid fa-user"></i> Coachee: ${escH(r.nama_coachee || '-')}</span>
        <span><i class="fa-solid fa-clock"></i> Deadline: ${escH(r.batas_waktu_pc || '-')}</span>
      </div>
      <div class="pc-card-actions">
        <button class="pc-btn-detail" onclick='showDetail(${JSON.stringify(r)})'>
          <i class="fa-solid fa-eye"></i> Detail
        </button>
        ${isCoachee && st === 'OPEN' ? `
        <button class="pc-btn-komitmen" onclick='openKomitmenModal("${escH(r.id)}")'>
          <i class="fa-solid fa-handshake"></i> Konfirmasi Komitmen
        </button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Detail modal ─────────────────────────────────────────────
function showDetail(r) {
  const row = (label, val) =>
    `<div class="modal-row"><span class="modal-row-label">${label}</span><span class="modal-row-value">${escH(val)}</span></div>`;

  document.getElementById('detailContent').innerHTML = `
    ${row('ID',           r.id)}
    ${row('Tanggal PC',   r.tgl_pc)}
    ${row('Lokasi',       r.lokasi_pc)}
    <hr style="border:none;border-top:1px solid #f1f5f9;margin:10px 0">
    ${row('Coach',        r.nama_coach)}
    ${row('Coachee',      r.nama_coachee)}
    ${row('Jabatan',      r.jabatan_coachee)}
    ${row('Departemen',   r.departemen_coachee)}
    ${row('Perusahaan',   r.perusahaan_coachee)}
    <hr style="border:none;border-top:1px solid #f1f5f9;margin:10px 0">
    ${row('Topik',        r.topik_coaching)}
    ${row('Judul',        r.judul_coaching)}
    <div class="modal-row"><span class="modal-row-label">Deskripsi</span><span class="modal-row-value" style="white-space:pre-wrap">${escH(r.deskripsi_coaching)}</span></div>
    <div class="modal-row"><span class="modal-row-label">Komitmen</span><span class="modal-row-value" style="white-space:pre-wrap">${escH(r.komitmen_perbaikan)}</span></div>
    ${row('Batas Waktu',  r.batas_waktu_pc)}
    ${row('Status',       r.status)}
    ${r.foto_pc ? `<div class="modal-row"><span class="modal-row-label">Foto PC</span><a href="${r.foto_pc}" target="_blank" style="color:#0d9488">Lihat Foto</a></div>` : ''}
    ${r.foto_komitmen ? `<div class="modal-row"><span class="modal-row-label">Foto Komitmen</span><a href="${r.foto_komitmen}" target="_blank" style="color:#0d9488">Lihat Bukti</a></div>` : ''}
    ${r.pesan_komitmen ? `<div class="modal-row"><span class="modal-row-label">Pesan Coachee</span><span class="modal-row-value">${escH(r.pesan_komitmen)}</span></div>` : ''}
  `;
  document.getElementById('detailModal').classList.add('open');
}
function closeDetailModal() { document.getElementById('detailModal').classList.remove('open'); }

// ── Konfirmasi Komitmen modal ─────────────────────────────────
function openKomitmenModal(id) {
  document.getElementById('komitmenPcId').value = id;
  document.getElementById('fotoBukti').value = '';
  document.getElementById('buktiFotoPreview').innerHTML = '';
  document.getElementById('pesanKomitmen').value = '';
  const err = document.getElementById('komitmenErrMsg');
  if (err) err.style.display = 'none';
  _buktiFotos = [];
  document.getElementById('komitmenModal').classList.add('open');
}
function closeKomitmenModal() { document.getElementById('komitmenModal').classList.remove('open'); }

function onBuktiFotoChange(input) {
  const preview = document.getElementById('buktiFotoPreview');
  _buktiFotos = [];
  if (!input.files?.length) { preview.innerHTML = ''; return; }
  const reads = [...input.files].map(f => new Promise(res => {
    const fr = new FileReader(); fr.onload = e => res(e.target.result); fr.readAsDataURL(f);
  }));
  Promise.all(reads).then(results => {
    _buktiFotos = results;
    preview.innerHTML = results.map(d =>
      `<img src="${d}" style="height:64px;border-radius:8px;border:1.5px solid #e2e8f0;object-fit:cover">`
    ).join('');
  });
}

async function submitKomitmen() {
  const id  = document.getElementById('komitmenPcId').value;
  const err = document.getElementById('komitmenErrMsg');
  if (!_buktiFotos.length) { err.textContent='Foto bukti wajib diupload.'; err.style.display='block'; return; }

  const btn = document.getElementById('komitmenSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

  try {
    const res  = await fetch(BASE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body:    JSON.stringify({
        action:         'updatePCReport',
        id,
        foto_komitmen:  _buktiFotos,
        pesan_komitmen: String(document.getElementById('pesanKomitmen')?.value || '').trim(),
        status:         'CLOSED',
      })
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal.');

    closeKomitmenModal();
    if (typeof showToast === 'function') showToast('Komitmen berhasil dikonfirmasi! ✅');
    await loadPcReports();
  } catch (e) {
    err.textContent = 'Gagal: ' + e.message;
    err.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Konfirmasi Komitmen';
  }
}

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  renderUserProfile();
  loadPcReports();
});
