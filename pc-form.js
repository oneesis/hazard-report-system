// Personal Contact (PC) Form — ONE-SAP

const BASE_URL = '/api';
const PC_TOTAL_STEPS = 3;
let pcStep = 1;
let pcSelectedPhotos = [];
let _pcMasterKaryawan = [];

// ── Step navigation ─────────────────────────────────────────
function updatePcStepUI() {
  for (let i = 1; i <= PC_TOTAL_STEPS; i++) {
    const el = document.getElementById(`pcStep${i}`);
    if (!el) continue;
    if (i === pcStep) {
      el.classList.add('active');
      el.style.display = 'block';
    } else {
      el.classList.remove('active');
      el.style.display = 'none';
    }
  }
  document.querySelectorAll('#pcStepIndicator .step').forEach(el => {
    const n = parseInt(el.dataset.step);
    el.classList.toggle('active', n === pcStep);
    el.classList.toggle('completed', n < pcStep);
  });
}

function validatePcStep(step) {
  const req = id => {
    const el = document.getElementById(id);
    return el && String(el.value || '').trim() !== '';
  };
  if (step === 1) {
    if (!req('tgl_pc'))    return showErr('Tanggal PC wajib diisi.'), false;
    if (!req('lokasi_pc')) return showErr('Lokasi wajib diisi.'), false;
  }
  if (step === 2) {
    if (!req('nama_coachee'))      return showErr('Nama Coachee wajib diisi.'), false;
    if (!req('perusahaan_coachee')) return showErr('Perusahaan Coachee wajib diisi.'), false;
    if (!req('jabatan_coachee'))    return showErr('Jabatan Coachee wajib diisi.'), false;
    if (!req('departemen_coachee')) return showErr('Departemen Coachee wajib diisi.'), false;
    if (!req('no_wa_coachee'))      return showErr('No WhatsApp Coachee wajib diisi.'), false;
  }
  if (step === 3) {
    if (!req('topik_coaching'))    return showErr('Topik Coaching wajib dipilih.'), false;
    if (!req('judul_coaching'))    return showErr('Judul Coaching wajib diisi.'), false;
    if (!req('deskripsi_coaching')) return showErr('Deskripsi Coaching wajib diisi.'), false;
    if (!req('komitmen_perbaikan')) return showErr('Komitmen Perbaikan wajib diisi.'), false;
    if (!req('batas_waktu_pc'))    return showErr('Batas Waktu Komitmen wajib diisi.'), false;
  }
  return true;
}

function showErr(msg) {
  const el = document.getElementById('pcErrMsg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  if (typeof showToast === 'function') showToast(msg, 'error');
}

function pcNext() {
  const el = document.getElementById('pcErrMsg');
  if (el) el.style.display = 'none';
  if (!validatePcStep(pcStep)) return;
  pcStep++;
  updatePcStepUI();
  window.scrollTo(0, 0);
}

function pcPrev() {
  pcStep--;
  updatePcStepUI();
  window.scrollTo(0, 0);
}

// ── Foto ────────────────────────────────────────────────────
function onPcFotoChange(input) {
  const preview = document.getElementById('pcFotoPreview');
  pcSelectedPhotos = [];
  if (!input.files?.length) { if (preview) preview.innerHTML = ''; return; }
  const reads = [...input.files].map(f => new Promise(res => {
    const fr = new FileReader();
    fr.onload = e => res(e.target.result);
    fr.readAsDataURL(f);
  }));
  Promise.all(reads).then(results => {
    pcSelectedPhotos = results;
    if (preview) preview.innerHTML = results.map(d =>
      `<img src="${d}" style="height:64px;border-radius:8px;border:1.5px solid #e2e8f0;object-fit:cover">`
    ).join('');
  });
}

// ── Coachee autocomplete ─────────────────────────────────────
async function loadPcMasterKaryawan() {
  try {
    const res  = await fetch(`${BASE_URL}?action=masterKaryawan`);
    const json = await res.json();
    _pcMasterKaryawan = Array.isArray(json) ? json : (json.data || []);
  } catch { _pcMasterKaryawan = []; }
}

function filterCoacheeDropdown() {
  const q  = (document.getElementById('coacheeSearch')?.value || '').trim().toLowerCase();
  const dd = document.getElementById('coacheeDropdown');
  if (!dd) return;
  if (!q) { dd.style.display = 'none'; return; }
  const matches = _pcMasterKaryawan.filter(k =>
    String(k['NAMA'] || '').toLowerCase().includes(q) || String(k['NIK'] || '').includes(q)
  ).slice(0, 10);
  if (!matches.length) { dd.style.display = 'none'; return; }
  dd.style.display = '';
  dd.innerHTML = matches.map(k => `
    <div onclick='selectCoachee(${JSON.stringify(k)})' style="padding:10px 14px;cursor:pointer;font-size:.85rem;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between">
      <span>${k['NAMA'] || '-'}</span>
      <span style="color:#94a3b8;font-size:.78rem">${k['PERUSAHAAN']||''} · ${k['DEPARTEMEN']||''}</span>
    </div>`).join('');
}

function selectCoachee(k) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('nama_coachee',       k['NAMA']);
  set('perusahaan_coachee', k['PERUSAHAAN']);
  set('subcont_coachee',    k['SUBCONT'] || '');
  set('jabatan_coachee',    k['JABATAN']);
  set('departemen_coachee', k['DEPARTEMEN']);
  set('no_wa_coachee',      k['NO WHATSAPP'] || '');
  set('nik_coachee',        k['NIK'] || '');
  set('coacheeSearch',      k['NAMA']);
  const dd = document.getElementById('coacheeDropdown');
  if (dd) dd.style.display = 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#coacheeSearch') && !e.target.closest('#coacheeDropdown')) {
    const dd = document.getElementById('coacheeDropdown');
    if (dd) dd.style.display = 'none';
  }
});

// ── Submit ───────────────────────────────────────────────────
async function submitPcReport() {
  const el = document.getElementById('pcErrMsg');
  if (el) el.style.display = 'none';
  if (!validatePcStep(3)) return;

  const btn = document.getElementById('pcSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

  const val = id => String(document.getElementById(id)?.value || '').trim();

  try {
    const body = {
      action: 'submitPCReport',
      tgl_pc:             val('tgl_pc'),
      lokasi_pc:          val('lokasi_pc'),
      nama_coachee:       val('nama_coachee'),
      nik_coachee:        val('nik_coachee'),
      perusahaan_coachee: val('perusahaan_coachee'),
      subcont_coachee:    val('subcont_coachee'),
      jabatan_coachee:    val('jabatan_coachee'),
      departemen_coachee: val('departemen_coachee'),
      no_wa_coachee:      val('no_wa_coachee'),
      topik_coaching:     val('topik_coaching'),
      judul_coaching:     val('judul_coaching'),
      deskripsi_coaching: val('deskripsi_coaching'),
      komitmen_perbaikan: val('komitmen_perbaikan'),
      batas_waktu_pc:     val('batas_waktu_pc'),
      foto_pc:            pcSelectedPhotos.length ? pcSelectedPhotos : null,
    };

    const res  = await fetch(BASE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body:    JSON.stringify(body)
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal menyimpan.');

    const msgEl = document.getElementById('pcSuccessMsg');
    if (msgEl) msgEl.textContent = json.message || `PC ${json.id} berhasil disimpan.`;
    document.getElementById('pcSuccessModal').style.display = 'flex';
  } catch (e) {
    showErr('Gagal: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim PC';
  }
}

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  const user = getCurrentUser();
  if (user) {
    const init = document.getElementById('coachInitial');
    if (init) init.textContent = (user.nama || '?').charAt(0).toUpperCase();
    const name = document.getElementById('coachName');
    if (name) name.textContent = user.nama || '-';
    const sub  = document.getElementById('coachSub');
    if (sub)  sub.textContent  = `${user.jabatan || ''} • ${user.departemen || ''} • ${user.perusahaan || ''}`;
  }
  const today = new Date().toISOString().slice(0, 10);
  const tglEl = document.getElementById('tgl_pc');
  if (tglEl) tglEl.value = today;

  loadPcMasterKaryawan();
  updatePcStepUI();
});
