// Form SBO — Safe Behavior Observation
let sboStep = 1;
const SBO_TOTAL_STEPS = 4;
let sboSelectedPhotos = [];

const SBO_TINDAKAN_SEGERA = [
  'Perubahan posisi',
  'Penghentian pekerjaan',
  'Kembali ke pekerjaan',
  'Menyembunyikan atau menghindar',
  'Penggantian Perkakas / tools',
  'Memasang Danger Tag / Lock-out',
  'Membetulkan posisi APD',
];

const SBO_CATEGORIES = [
  {
    key: 'potensi_bahaya',
    label: 'A. Potensi Bahaya',
    icon: 'fa-triangle-exclamation',
    items: [
      'Potensi Menabrak',
      'Potensi Terjepit',
      'Potensi Terhirup / terpapar debu atau bahan kimia',
      'Potensi Terseret / tertarik',
      'Potensi Terkena Listrik',
      'Potensi Terjatuh / kejatuhan / tenggelam',
      'Potensi Terpukul / tertusuk',
    ],
  },
  {
    key: 'apd',
    label: 'B. Alat Pelindung Diri (APD)',
    icon: 'fa-helmet-safety',
    items: [
      'Pelindung Kepala',
      'Pelindung Telinga dan mata',
      'Pelindung Muka dan pernafasan',
      'Pelindung Tangan dan lengan',
      'Harness & pelampung',
      'Pelindung Kaki dan tungkai',
    ],
  },
  {
    key: 'alat_peralatan',
    label: 'C. Alat & Peralatan',
    icon: 'fa-wrench',
    items: [
      'Sesuai untuk pekerjaan',
      'Benar menggunakannya',
      'Kondisi peralatan aman',
      'Pelindung dan rambu peringatan terpasang',
      'Pengendalian memadai',
      'Pengecekan keselamatan sebelum kerja',
    ],
  },
  {
    key: 'prosedur',
    label: 'D. Prosedur',
    icon: 'fa-file-lines',
    items: [
      'Prosedur telah dibuat',
      'Prosedur memadai dan telah disosialisasikan',
      'Ijin kerja telah dibuat dan disahkan',
      'Mengetahui nomer emergency dan jalur komunikasi',
    ],
  },
  {
    key: 'kebersihan',
    label: 'E. Kebersihan & Kerapian (5R)',
    icon: 'fa-broom',
    items: [
      'Sampah / Limbah dibersihkan',
      'Perkakas tangan ditata rapi',
      'Penyimpanan barang diatur',
      'Hambatan / gangguan dibuang',
      'Tangga dan tempat berpijakan kuat & kokoh',
    ],
  },
];

function val(id) { return document.getElementById(id)?.value?.trim() || ''; }
function showErr(msg) {
  const el = document.getElementById('alertError');
  const msg2 = document.getElementById('alertErrorMsg');
  if (el) { el.style.display = ''; if (msg2) msg2.textContent = msg; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
function hideErr() { document.getElementById('alertError').style.display = 'none'; }

// Build checklist HTML
function buildChecklist() {
  // Tindakan segera
  const ts = document.getElementById('sboTindakanSegera');
  ts.innerHTML = SBO_TINDAKAN_SEGERA.map((item, i) => `
    <div class="sbo-segera-item">
      <input type="checkbox" id="ts_${i}" value="${item}" />
      <label for="ts_${i}">${item}</label>
    </div>`).join('');

  // Kategori + poin
  const cats = document.getElementById('sboChecklistCategories');
  cats.innerHTML = SBO_CATEGORIES.map(cat => `
    <div class="sbo-cat-title"><i class="fa-solid ${cat.icon}"></i>${cat.label}</div>
    ${cat.items.map((item, i) => `
      <div class="sbo-checklist-item" id="ci_${cat.key}_${i}">
        <span class="sbo-checklist-label">${i + 1}. ${item}</span>
        <div class="sbo-radio-group">
          <label class="sbo-radio-label" title="Aman">
            <input type="radio" name="cl_${cat.key}_${i}" value="AMAN" onchange="onChecklistChange('${cat.key}','${i}',this)"> ✅ Aman
          </label>
          <label class="sbo-radio-label" title="Tidak Aman">
            <input type="radio" name="cl_${cat.key}_${i}" value="TIDAK_AMAN" onchange="onChecklistChange('${cat.key}','${i}',this)"> ❌ Tidak Aman
          </label>
          <label class="sbo-radio-label" title="Tidak Berlaku">
            <input type="radio" name="cl_${cat.key}_${i}" value="NA" onchange="onChecklistChange('${cat.key}','${i}',this)"> — N.A.
          </label>
        </div>
      </div>`).join('')}
  `).join('');
}

function onChecklistChange(catKey, idx, radio) {
  const row = document.getElementById(`ci_${catKey}_${idx}`);
  if (row) row.classList.toggle('has-tidak', radio.value === 'TIDAK_AMAN');
  // Style the labels
  const labels = radio.closest('.sbo-radio-group')?.querySelectorAll('.sbo-radio-label');
  if (labels) labels.forEach(lbl => {
    lbl.classList.remove('checked-aman', 'checked-tidak', 'checked-na');
    const r = lbl.querySelector('input[type=radio]');
    if (r?.checked) {
      if (r.value === 'AMAN')       lbl.classList.add('checked-aman');
      else if (r.value === 'TIDAK_AMAN') lbl.classList.add('checked-tidak');
      else if (r.value === 'NA')    lbl.classList.add('checked-na');
    }
  });
  updateChecklistCounter();
}

function updateChecklistCounter() {
  const total = SBO_CATEGORIES.reduce((s, c) => s + c.items.length, 0);
  const done  = SBO_CATEGORIES.reduce((s, c) =>
    s + c.items.filter((_, i) => document.querySelector(`input[name="cl_${c.key}_${i}"]:checked`)).length, 0);
  const el = document.getElementById('counterText');
  if (el) el.textContent = `${done} dari ${total} poin dinilai`;
  const cnt = document.getElementById('sboChecklistCounter');
  if (cnt) { cnt.classList.toggle('all-done', done === total); cnt.classList.toggle('partial', done < total); }
}

function getChecklistData() {
  const result = {};
  for (const cat of SBO_CATEGORIES) {
    const obj = {};
    cat.items.forEach((item, i) => {
      const checked = document.querySelector(`input[name="cl_${cat.key}_${i}"]:checked`);
      if (checked) obj[String(i + 1)] = checked.value;
    });
    result[cat.key] = JSON.stringify(obj);
  }
  return result;
}

function getTindakanSegera() {
  const checked = [...document.querySelectorAll('#sboTindakanSegera input[type=checkbox]:checked')];
  return JSON.stringify(checked.map(c => c.value));
}

function hasTidakAman() {
  return !!document.querySelector('[name^="cl_"]:checked[value="TIDAK_AMAN"]');
}

function allChecklistAnswered() {
  return SBO_CATEGORIES.every(cat =>
    cat.items.every((_, i) => document.querySelector(`input[name="cl_${cat.key}_${i}"]:checked`))
  );
}

// Build step 4 content
function buildStep4() {
  const hasFinding = hasTidakAman();
  const content = document.getElementById('sboStep4Content');

  if (!hasFinding) {
    content.innerHTML = `
      <div class="sbo-safe-alert"><i class="fa-solid fa-circle-check"></i>&nbsp; Semua poin dinilai Aman — tidak ada temuan yang perlu dilaporkan.</div>
      <div class="sbo-section-title"><i class="fa-solid fa-pen"></i> Pernyataan</div>
      <div class="form-group">
        <label>Pernyataan Observer <span class="required">*</span></label>
        <textarea id="pernyataan" rows="3" placeholder="Saya menyatakan bahwa observasi ini dilakukan dengan jujur dan objektif..." required></textarea>
      </div>`;
    return;
  }

  content.innerHTML = `
    <div class="sbo-finding-alert"><i class="fa-solid fa-triangle-exclamation"></i>&nbsp; Terdapat poin Tidak Aman. Lengkapi data temuan dan PIC di bawah.</div>

    <div class="sbo-section-title"><i class="fa-solid fa-magnifying-glass"></i> Detail Temuan</div>
    <div class="sbo-form-grid">
      <div class="form-group">
        <label>Jenis Temuan <span class="required">*</span></label>
        <select id="jenis_temuan" required>
          <option value="">-- Pilih --</option>
          <option value="Unsafe Act">Unsafe Act (Tindakan Tidak Aman)</option>
          <option value="Unsafe Condition">Unsafe Condition (Kondisi Tidak Aman)</option>
          <option value="Unsafe Act & Condition">Unsafe Act & Condition</option>
        </select>
      </div>
      <div class="form-group">
        <label>Kategori Temuan <span class="required">*</span></label>
        <input type="text" id="kategori_temuan" placeholder="Mis: APD tidak lengkap, Prosedur tidak dipatuhi" required />
      </div>
    </div>
    <div class="form-group">
      <label>Deskripsi Temuan <span class="required">*</span></label>
      <textarea id="deskripsi_temuan" rows="3" placeholder="Jelaskan temuan secara rinci..." required></textarea>
    </div>
    <div class="form-group">
      <label>Foto Temuan</label>
      <input type="file" id="foto_temuan" accept="image/*" multiple onchange="onSboFotoChange(this)" />
      <div id="sboFotoPreview" class="foto-preview-wrap"></div>
    </div>

    <div class="sbo-section-title" style="margin-top:20px"><i class="fa-solid fa-clipboard-check"></i> Rencana Tindakan</div>
    <div class="form-group">
      <label>Rencana Tindakan Perbaikan <span class="required">*</span></label>
      <textarea id="rencana_tindakan" rows="3" placeholder="Tindakan apa yang harus dilakukan PIC..." required></textarea>
    </div>
    <div class="sbo-form-grid">
      <div class="form-group">
        <label>Referensi SOP Terkait <em style="font-weight:400">(opsional)</em></label>
        <input type="text" id="referensi_sop" placeholder="Nomor/nama SOP terkait" />
      </div>
      <div class="form-group">
        <label>Batas Waktu <span class="required">*</span></label>
        <input type="date" id="batas_waktu" required />
      </div>
    </div>

    <div class="sbo-section-title" style="margin-top:20px"><i class="fa-solid fa-user-tie"></i> Data PIC</div>
    <p style="font-size:.8rem;color:#64748b;margin-bottom:12px">Pilih dari daftar karyawan atau isi manual.</p>
    <div class="form-group pic-search-wrap">
      <label>Cari Karyawan PIC</label>
      <input type="text" id="picSearch" placeholder="Ketik nama atau NIK..." oninput="filterPicDropdown()" autocomplete="off" />
      <div id="picDropdown" class="pic-dropdown"></div>
    </div>
    <div class="sbo-form-grid">
      <div class="form-group">
        <label>Nama PIC <span class="required">*</span></label>
        <input type="text" id="nama_pic" placeholder="Nama lengkap PIC" required />
      </div>
      <div class="form-group">
        <label>NIK PIC</label>
        <input type="text" id="nik_pic" placeholder="NIK (opsional)" />
      </div>
      <div class="form-group">
        <label>Perusahaan PIC <span class="required">*</span></label>
        <input type="text" id="perusahaan_pic" required />
      </div>
      <div class="form-group">
        <label>Subcont PIC</label>
        <input type="text" id="subcont_pic" />
      </div>
      <div class="form-group">
        <label>Departemen PIC <span class="required">*</span></label>
        <input type="text" id="departemen_pic" required />
      </div>
      <div class="form-group">
        <label>Jabatan PIC <span class="required">*</span></label>
        <input type="text" id="jabatan_pic" required />
      </div>
    </div>
    <div class="form-group">
      <label>No WhatsApp PIC <span class="required">*</span></label>
      <input type="tel" id="no_wa_pic" placeholder="08xx atau 62xx" required />
    </div>

    <div class="sbo-section-title" style="margin-top:20px"><i class="fa-solid fa-pen"></i> Pernyataan</div>
    <div class="form-group">
      <label>Pernyataan Observer <span class="required">*</span></label>
      <textarea id="pernyataan" rows="3" placeholder="Saya menyatakan bahwa observasi ini dilakukan dengan jujur dan objektif..." required></textarea>
    </div>`;

  // Muat master karyawan untuk dropdown PIC
  loadMasterForPic();
}

let _sboMasterKaryawan = [];
async function loadMasterForPic() {
  try {
    const res = await fetch(`${BASE_URL}?action=masterKaryawan`);
    const json = await res.json();
    _sboMasterKaryawan = Array.isArray(json) ? json : (json.data || []);
  } catch { _sboMasterKaryawan = []; }
}

function filterPicDropdown() {
  const q = (document.getElementById('picSearch')?.value || '').trim().toLowerCase();
  const dd = document.getElementById('picDropdown');
  if (!dd) return;
  if (!q) { dd.style.display = 'none'; return; }
  const matches = _sboMasterKaryawan.filter(k => {
    return String(k['NAMA'] || '').toLowerCase().includes(q) || String(k['NIK'] || '').includes(q);
  }).slice(0, 10);
  if (!matches.length) { dd.style.display = 'none'; return; }
  dd.style.display = '';
  dd.innerHTML = matches.map(k => `
    <div onclick='selectPic(${JSON.stringify(k)})' style="padding:10px 14px;cursor:pointer;font-size:.85rem;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between">
      <span>${k['NAMA'] || '-'}</span>
      <span style="color:#94a3b8;font-size:.78rem">${k['PERUSAHAAN']||''} · ${k['DEPARTEMEN']||''}</span>
    </div>`).join('');
}

function selectPic(k) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('nama_pic', k['NAMA']);
  set('nik_pic', k['NIK']);
  set('perusahaan_pic', k['PERUSAHAAN']);
  set('subcont_pic', k['SUBCONT'] || '');
  set('departemen_pic', k['DEPARTEMEN']);
  set('jabatan_pic', k['JABATAN']);
  set('no_wa_pic', k['NO WHATSAPP'] || '');
  set('picSearch', k['NAMA']);
  const dd = document.getElementById('picDropdown');
  if (dd) dd.style.display = 'none';
}

// Close dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('#picSearch') && !e.target.closest('#picDropdown')) {
    const dd = document.getElementById('picDropdown');
    if (dd) dd.style.display = 'none';
  }
});

function onSboFotoChange(input) {
  const preview = document.getElementById('sboFotoPreview');
  sboSelectedPhotos = [];
  if (!input.files?.length) { if (preview) preview.innerHTML = ''; return; }
  const reads = [...input.files].map(f => new Promise(res => {
    const fr = new FileReader();
    fr.onload = e => res(e.target.result);
    fr.readAsDataURL(f);
  }));
  Promise.all(reads).then(results => {
    sboSelectedPhotos = results;
    if (preview) preview.innerHTML = results.map(d =>
      `<img src="${d}" style="height:64px;border-radius:8px;border:1.5px solid #e2e8f0;object-fit:cover">`
    ).join('');
  });
}

// Step navigation
function updateStepUI() {
  for (let i = 1; i <= SBO_TOTAL_STEPS; i++) {
    const stepEl = document.getElementById(`sboStep${i}`);
    if (!stepEl) continue;
    if (i === sboStep) {
      stepEl.classList.add('active');
      stepEl.style.display = 'block';
    } else {
      stepEl.classList.remove('active');
      stepEl.style.display = 'none';
    }
  }
  document.querySelectorAll('#sboStepIndicator .step').forEach(el => {
    const n = parseInt(el.dataset.step);
    el.classList.toggle('active', n === sboStep);
    el.classList.toggle('completed', n < sboStep);
  });
}

function validateStep(step) {
  hideErr();
  if (step === 1) {
    if (!val('tgl_observasi')) return showErr('Tanggal observasi wajib diisi.'), false;
    if (!val('nama_pekerjaan')) return showErr('Nama pekerjaan wajib diisi.'), false;
    if (!val('lokasi')) return showErr('Lokasi wajib diisi.'), false;
  }
  if (step === 2) {
    if (!val('nama_observee')) return showErr('Nama observee wajib diisi.'), false;
    if (!val('perusahaan_observee')) return showErr('Perusahaan observee wajib diisi.'), false;
    if (!val('jabatan_observee')) return showErr('Jabatan observee wajib diisi.'), false;
    if (!val('departemen_observee')) return showErr('Departemen observee wajib diisi.'), false;
  }
  if (step === 3) {
    if (!allChecklistAnswered()) return showErr('Semua poin checklist harus dinilai (Aman / Tidak Aman / N.A.).'), false;
  }
  if (step === 4) {
    if (!val('pernyataan')) return showErr('Pernyataan observer wajib diisi.'), false;
    if (hasTidakAman()) {
      if (!val('jenis_temuan')) return showErr('Jenis temuan wajib dipilih.'), false;
      if (!val('kategori_temuan')) return showErr('Kategori temuan wajib diisi.'), false;
      if (!val('deskripsi_temuan')) return showErr('Deskripsi temuan wajib diisi.'), false;
      if (!val('rencana_tindakan')) return showErr('Rencana tindakan wajib diisi.'), false;
      if (!val('batas_waktu')) return showErr('Batas waktu wajib diisi.'), false;
      if (!val('nama_pic')) return showErr('Nama PIC wajib diisi.'), false;
      if (!val('perusahaan_pic')) return showErr('Perusahaan PIC wajib diisi.'), false;
      if (!val('departemen_pic')) return showErr('Departemen PIC wajib diisi.'), false;
      if (!val('jabatan_pic')) return showErr('Jabatan PIC wajib diisi.'), false;
      if (!val('no_wa_pic')) return showErr('No WhatsApp PIC wajib diisi.'), false;
    }
  }
  return true;
}

function sboNext() {
  if (!validateStep(sboStep)) return;
  if (sboStep === 3) buildStep4();
  sboStep++;
  updateStepUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function sboPrev() {
  sboStep = Math.max(1, sboStep - 1);
  updateStepUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function collectFormData() {
  const hasFinding = hasTidakAman();
  const checklist = getChecklistData();
  return {
    tgl_observasi:      val('tgl_observasi'),
    nama_pekerjaan:     val('nama_pekerjaan'),
    lokasi:             val('lokasi'),
    nama_observee:      val('nama_observee'),
    perusahaan_observee:val('perusahaan_observee'),
    subcont_observee:   val('subcont_observee'),
    jabatan_observee:   val('jabatan_observee'),
    departemen_observee:val('departemen_observee'),
    tindakan_segera:    getTindakanSegera(),
    ...checklist,
    status_observasi:   hasFinding ? 'ADA_TEMUAN' : 'AMAN',
    jenis_temuan:       hasFinding ? val('jenis_temuan') : '',
    kategori_temuan:    hasFinding ? val('kategori_temuan') : '',
    deskripsi_temuan:   hasFinding ? val('deskripsi_temuan') : '',
    foto_temuan:        hasFinding && sboSelectedPhotos.length ? JSON.stringify(sboSelectedPhotos) : '',
    rencana_tindakan:   hasFinding ? val('rencana_tindakan') : '',
    referensi_sop:      hasFinding ? val('referensi_sop') : '',
    batas_waktu:        hasFinding ? val('batas_waktu') : '',
    nama_pic:           hasFinding ? val('nama_pic') : '',
    nik_pic:            hasFinding ? val('nik_pic') : '',
    perusahaan_pic:     hasFinding ? val('perusahaan_pic') : '',
    subcont_pic:        hasFinding ? val('subcont_pic') : '',
    departemen_pic:     hasFinding ? val('departemen_pic') : '',
    jabatan_pic:        hasFinding ? val('jabatan_pic') : '',
    no_wa_pic:          hasFinding ? val('no_wa_pic') : '',
    pernyataan:         val('pernyataan'),
  };
}

async function submitSboForm() {
  if (!validateStep(4)) return;
  const btn = document.getElementById('sboSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

  try {
    const formData = collectFormData();
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submitSBOReport', data: formData }),
    });
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'Gagal menyimpan laporan.');
    const hasFinding = formData.status_observasi === 'ADA_TEMUAN';
    const msgEl = document.getElementById('successModalMsg');
    if (msgEl) {
      msgEl.textContent = hasFinding
        ? `Laporan SBO ${json.id} berhasil disimpan. WA notifikasi dikirim ke PIC.`
        : `Laporan SBO ${json.id} berhasil disimpan. Observasi dinyatakan aman.`;
    }
    document.getElementById('successModal').style.display = 'flex';
  } catch (e) {
    showErr('Gagal: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Laporan';
  }
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  const user = getCurrentUser();
  if (user) {
    // Populate observer card
    const initEl = document.getElementById('observerInitial');
    if (initEl) initEl.textContent = (user.nama || '?').charAt(0).toUpperCase();
    const nameEl = document.getElementById('observerName');
    if (nameEl) nameEl.textContent = user.nama || '-';
    const subEl = document.getElementById('observerSub');
    if (subEl) subEl.textContent = `${user.jabatan || ''} • ${user.departemen || ''} • ${user.perusahaan || ''}`;
  }
  // Default tanggal hari ini
  const today = new Date().toISOString().slice(0, 10);
  const tglEl = document.getElementById('tgl_observasi');
  if (tglEl) tglEl.value = today;

  buildChecklist();
  updateChecklistCounter();
  updateStepUI();
});
