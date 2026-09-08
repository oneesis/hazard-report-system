// Personal Contact Form — ONE-SAP
const BASE_URL = '/api';
const PC_STEPS = 3;
let pcStep = 1;
let pcPhotos = [];
let _pcMaster = [];

// ── Step UI ─────────────────────────────────────────────────
const PROGRESS_PCT = [16, 50, 100];

function updatePcStepUI() {
  for (let i = 1; i <= PC_STEPS; i++) {
    const el = document.getElementById(`pcStep${i}`);
    if (!el) continue;
    el.classList.toggle('active', i === pcStep);
    el.style.display = i === pcStep ? 'block' : 'none';
    const dot  = document.getElementById(`dot${i}`);
    const circ = document.getElementById(`circ${i}`);
    if (!dot || !circ) continue;
    dot.classList.remove('active','done');
    if (i === pcStep)   { dot.classList.add('active'); circ.innerHTML = i; }
    else if (i < pcStep){ dot.classList.add('done');   circ.innerHTML = '<i class="fa-solid fa-check" style="font-size:.7rem"></i>'; }
    else                { circ.innerHTML = i; }
  }
  const bar = document.getElementById('pcProgressBar');
  if (bar) bar.style.width = PROGRESS_PCT[pcStep - 1] + '%';
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
    if (!val('nama_coachee'))       return showStepErr(2,'Nama Coachee wajib diisi.'), false;
    if (!val('perusahaan_coachee')) return showStepErr(2,'Perusahaan Coachee wajib diisi.'), false;
    if (!val('jabatan_coachee'))    return showStepErr(2,'Jabatan Coachee wajib diisi.'), false;
    if (!val('departemen_coachee')) return showStepErr(2,'Departemen Coachee wajib diisi.'), false;
    if (!val('no_wa_coachee'))      return showStepErr(2,'No WhatsApp Coachee wajib diisi.'), false;
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
      `<img src="${d}" style="height:72px;border-radius:10px;border:1.5px solid #e2e8f0;object-fit:cover">`
    ).join('');
  });
}

// ── Coachee autocomplete ─────────────────────────────────────
async function loadPcMaster() {
  try {
    const res  = await fetch(`${BASE_URL}?action=masterKaryawan`);
    const json = await res.json();
    _pcMaster = Array.isArray(json) ? json : (json.data || []);
  } catch { _pcMaster = []; }
}

function filterCoacheeDropdown() {
  const q  = (document.getElementById('coacheeSearch')?.value || '').trim().toLowerCase();
  const dd = document.getElementById('coacheeDropdown');
  if (!dd) return;
  if (!q) { dd.style.display = 'none'; return; }
  const matches = _pcMaster.filter(k =>
    String(k['NAMA']||'').toLowerCase().includes(q) || String(k['NIK']||'').includes(q)
  ).slice(0, 10);
  if (!matches.length) { dd.style.display = 'none'; return; }
  dd.style.display = '';
  dd.innerHTML = matches.map(k => `
    <div class="pc-dropdown-item" onclick='selectCoachee(${JSON.stringify(k)})'>
      <div>
        <div style="font-weight:600">${k['NAMA']||'-'}</div>
        <div class="pc-dropdown-meta">${k['JABATAN']||''}</div>
      </div>
      <div class="pc-dropdown-meta" style="text-align:right">
        ${k['PERUSAHAAN']||''}<br>${k['DEPARTEMEN']||''}
      </div>
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
  document.getElementById('coacheeDropdown').style.display = 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#coacheeSearch') && !e.target.closest('#coacheeDropdown'))
    document.getElementById('coacheeDropdown')?.style && (document.getElementById('coacheeDropdown').style.display = 'none');
});

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
    document.getElementById('pcSuccessModal').classList.add('show');
  } catch (e) {
    showStepErr(3, 'Gagal: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Personal Contact';
  }
}

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  renderUserProfile();
  const user = getCurrentUser();
  if (user) {
    const el = id => document.getElementById(id);
    if (el('coachInitial')) el('coachInitial').textContent = (user.nama || '?').charAt(0).toUpperCase();
    if (el('coachName'))    el('coachName').textContent    = user.nama || '-';
    if (el('coachSub'))     el('coachSub').textContent     =
      [user.jabatan, user.departemen, user.perusahaan].filter(Boolean).join(' • ');
  }
  const today = new Date().toISOString().slice(0, 10);
  const tgl = document.getElementById('tgl_pc');
  if (tgl) tgl.value = today;

  updatePcStepUI();
  loadPcMaster();
});
