// Personal Contact Form — ONE-SAP
// BASE_URL sudah dideklarasikan di reports-utils.js
const PC_STEPS = 3;
let pcStep = 1;
let pcPhotos = [];
let _pcMaster = [];

// ── Step UI — same pattern as SBO ──────────────────────────────
function updatePcStepUI() {
  for (let i = 1; i <= PC_STEPS; i++) {
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

// ── Topik pill ───────────────────────────────────────────────
function selectTopik(val) {
  document.getElementById('topik_coaching').value = val;
  ['Pekerjaan','Pribadi'].forEach(t => {
    document.getElementById(`pill_${t.toLowerCase()}`)?.classList.toggle('selected', t === val);
  });
}

// ── Validation ───────────────────────────────────────────────
function showStepErr(step, msg) {
  const el = document.getElementById(`pcErr${step}`);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  if (typeof showToast === 'function') showToast(msg, 'error');
}
function clearErr(step) {
  const el = document.getElementById(`pcErr${step}`);
  if (el) el.style.display = 'none';
}
function val(id) { return String(document.getElementById(id)?.value || '').trim(); }

function validateStep(step) {
  clearErr(step);
  if (step === 1) {
    if (!val('tgl_pc'))    return showStepErr(1,'Tanggal PC wajib diisi.'), false;
    if (!val('lokasi_pc')) return showStepErr(1,'Lokasi wajib diisi.'), false;
  }
  if (step === 2) {
    if (!val('perusahaan_coachee')) return showStepErr(2,'Perusahaan Coachee wajib dipilih.'), false;
    if (!val('nama_coachee'))       return showStepErr(2,'Nama Coachee wajib dipilih.'), false;
  }
  if (step === 3) {
    if (!val('topik_coaching'))    return showStepErr(3,'Topik Coaching wajib dipilih.'), false;
    if (!val('judul_coaching'))    return showStepErr(3,'Judul Coaching wajib diisi.'), false;
    if (!val('deskripsi_coaching')) return showStepErr(3,'Deskripsi Coaching wajib diisi.'), false;
    if (!val('komitmen_perbaikan')) return showStepErr(3,'Komitmen Perbaikan wajib diisi.'), false;
    if (!val('batas_waktu_pc'))    return showStepErr(3,'Batas Waktu Komitmen wajib diisi.'), false;
  }
  return true;
}

function pcNext() {
  if (!validateStep(pcStep)) return;
  pcStep = Math.min(pcStep + 1, PC_STEPS);
  updatePcStepUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function pcPrev() {
  pcStep = Math.max(pcStep - 1, 1);
  updatePcStepUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Foto ─────────────────────────────────────────────────────
function onPcFotoChange(input) {
  const preview = document.getElementById('pcFotoPreview');
  pcPhotos = [];
  if (!input.files?.length) { if (preview) preview.innerHTML = ''; return; }
  Promise.all([...input.files].map(f => new Promise(res => {
    const fr = new FileReader();
    fr.onload = e => res(e.target.result);
    fr.readAsDataURL(f);
  }))).then(results => {
    pcPhotos = results;
    if (preview) preview.innerHTML = results.map(d =>
      `<img src="${d}">`
    ).join('');
  });
}

// ── Coachee cascade (Perusahaan → Subcont → Nama) ────────────
let _pcCoacheeChoices;

async function loadPcMaster() {
  try {
    const res  = await fetch(`${BASE_URL}?action=masterKaryawan`);
    const json = await res.json();
    _pcMaster = Array.isArray(json) ? json : (json.data || []);
  } catch { _pcMaster = []; }
}

function loadCoacheePerusahaan() {
  const sel = document.getElementById('perusahaan_coachee');
  if (!sel) return;
  const companies = [...new Set(_pcMaster.map(k => k['PERUSAHAAN']).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Pilih Perusahaan</option>' +
    companies.map(c => `<option value="${c}">${c}</option>`).join('');
  loadCoacheeSubcont();
}

function loadCoacheeSubcont() {
  const perusahaan = document.getElementById('perusahaan_coachee')?.value;
  const sel = document.getElementById('subcont_coachee');
  if (!sel) return;
  const subconts = [...new Set(
    _pcMaster.filter(k => k['PERUSAHAAN'] === perusahaan).map(k => k['SUBCONT']).filter(Boolean)
  )].sort();
  sel.innerHTML = '<option value="">Semua / Tidak ada</option>' +
    subconts.map(s => `<option value="${s}">${s}</option>`).join('');
  loadCoacheeNama();
}

function loadCoacheeNama() {
  const perusahaan = document.getElementById('perusahaan_coachee')?.value;
  const subcont    = document.getElementById('subcont_coachee')?.value;
  const sel        = document.getElementById('nama_coachee');
  if (!sel) return;
  ['jabatan_coachee','departemen_coachee','nik_coachee'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const filtered = _pcMaster.filter(k =>
    (!perusahaan || k['PERUSAHAAN'] === perusahaan) &&
    (!subcont    || k['SUBCONT']    === subcont)
  );
  const names = [...new Set(filtered.map(k => k['NAMA']).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Pilih Nama Coachee</option>' +
    names.map(n => `<option value="${n}">${n}</option>`).join('');
  if (_pcCoacheeChoices) _pcCoacheeChoices.destroy();
  _pcCoacheeChoices = new Choices('#nama_coachee', {
    searchEnabled: true, itemSelectText: '', shouldSort: false,
    placeholder: true, placeholderValue: 'Cari dan pilih nama coachee',
    noResultsText: 'Tidak ditemukan', noChoicesText: 'Pilih perusahaan dulu', searchFloor: 1
  });
}

function autoFillCoachee() {
  const perusahaan = document.getElementById('perusahaan_coachee')?.value;
  const subcont    = document.getElementById('subcont_coachee')?.value;
  const nama       = document.getElementById('nama_coachee')?.value;
  const found = _pcMaster.find(k =>
    k['NAMA'] === nama &&
    (!perusahaan || k['PERUSAHAAN'] === perusahaan) &&
    (!subcont    || k['SUBCONT']    === subcont)
  );
  if (!found) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('jabatan_coachee',   found['JABATAN']);
  set('departemen_coachee',found['DEPARTEMEN']);
  set('no_wa_coachee',     found['NO WHATSAPP'] || '');
  set('nik_coachee',       found['NIK'] || '');
}

// ── Submit ────────────────────────────────────────────────────
async function submitPcReport() {
  if (!validateStep(3)) return;
  const btn = document.getElementById('pcSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

  try {
    const res = await fetch(BASE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submitPCReport',
        data: {
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
          foto_pc:            pcPhotos.length ? pcPhotos : null,
        }
      }),
    });
    const json = await res.json();
    if (!res.ok || json.status === 'error') throw new Error(json.message || 'Gagal menyimpan.');

    const msgEl = document.getElementById('pcSuccessMsg');
    if (msgEl) msgEl.textContent = json.message || `PC ${json.id} berhasil disimpan.`;
    document.getElementById('pcSuccessModal').style.display = 'flex';
  } catch (e) {
    showStepErr(3, 'Gagal: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Personal Contact';
  }
}

// ── Init ──────────────────────────────────────────────────────
function fillCoachCard() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user) return false;
  const el = id => document.getElementById(id);
  if (el('coachInitial')) el('coachInitial').textContent = (user.nama || '?').charAt(0).toUpperCase();
  if (el('coachName'))    el('coachName').textContent    = user.nama || '-';
  if (el('coachSub'))     el('coachSub').textContent     =
    [user.jabatan, user.departemen, user.perusahaan].filter(Boolean).join(' • ');
  return true;
}

window.addEventListener('DOMContentLoaded', () => {
  requireLogin();

  // Isi coach card — retry sekali jika belum ready
  if (!fillCoachCard()) {
    setTimeout(fillCoachCard, 300);
  }

  const today = new Date().toISOString().slice(0, 10);
  const tgl = document.getElementById('tgl_pc');
  if (tgl && !tgl.value) tgl.value = today;

  updatePcStepUI();
  loadPcMaster().then(loadCoacheePerusahaan);
});
