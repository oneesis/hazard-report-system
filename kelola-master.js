// Kelola Master deteksi dini (Super Admin, 2026-10-14): antrean sub-lokasi laporan,
// taksonomi temuan (keparahan/kemungkinan/kritis/aktif), dan lokasi + jenis area.
const JENIS_AREA = ['Operasional', 'Kritis', 'Fasilitas', 'Lingkungan', 'Kendaraan', ''];
let KM = { kategori: [], temuan: [], lokasi: [], antrean: [] };
const esc = (v) => escapeHTML(v ?? '');
const opsi = (arr, sel) => arr.map((v) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(v === '' ? '(kosong)' : v)}</option>`).join('');
const opsi15 = (sel, N) => [1, 2, 3, 4, 5].map((i) => `<option value="${i}"${i === Number(sel) ? ' selected' : ''}>${i} ${N[i]}</option>`).join('');

async function kmApi(action, data) {
  const res = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.status === 'error') throw new Error(j.message || 'Gagal menyimpan.');
  return j;
}

async function kmMuat() {
  try {
    const res = await fetch('/api?action=getMasterAdmin');
    const j = await res.json();
    if (!res.ok || j.status === 'error') throw new Error(j.message || 'Gagal memuat.');
    KM = j;
    renderAntrean(); renderTemuan(); renderLokasi(); isiFormTambah();
    if (!INS.length) muatInsiden();
  } catch (e) {
    for (const id of ['antreanList', 'temuanList', 'lokasiList']) document.getElementById(id).innerHTML = `<div class="km-kosong">${esc(e.message)}</div>`;
  }
}

// ── Tab ──
document.querySelectorAll('.km-tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.km-tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.km-panel').forEach((p) => { p.hidden = p.id !== 'tab-' + b.dataset.tab; });
}));

// ── Antrean sub-lokasi ──
function renderAntrean() {
  const el = document.getElementById('antreanList');
  document.getElementById('cntAntrean').textContent = KM.antrean.length;
  if (!KM.antrean.length) { el.innerHTML = '<div class="km-kosong"><i class="fa-solid fa-circle-check"></i> Semua laporan sudah punya sub-lokasi.</div>'; return; }
  const grup = {};
  KM.antrean.forEach((r) => { const k = `${r.lokasi}||${(r.lainnya || '').trim()}`; (grup[k] ||= []).push(r); });
  const urut = Object.entries(grup).sort((a, b) => (b[0].split('||')[1] ? 1 : 0) - (a[0].split('||')[1] ? 1 : 0) || b[1].length - a[1].length);
  el.className = '';
  el.innerHTML = urut.map(([k, rows], gi) => {
    const [lok, lain] = k.split('||');
    const subs = KM.lokasi.filter((l) => l.lokasi === lok && l.aktif).map((l) => l.sub);
    return `<div class="km-grup" data-lok="${esc(lok)}" data-g="${gi}">
      <div class="km-grup-head">
        <label class="km-check"><input type="checkbox" class="km-semua"> <b>${esc(lok)}</b>${lain ? ` · ditulis pelapor: <span class="km-lain">"${esc(lain)}"</span>` : ''}</label>
        <span class="km-badge">${rows.length}</span>
      </div>
      <div class="km-aksi">
        <select class="km-pilih-sub"><option value="">Pilih sub-lokasi…</option>${opsi(subs)}</select>
        <button class="btn-primary km-tetapkan"><i class="fa-solid fa-check"></i> Tetapkan</button>
        ${lain ? `<span class="km-atau">atau</span><input class="km-sub-baru" value="${esc(lain)}" maxlength="80" />
          <button class="btn-secondary km-jadikan"><i class="fa-solid fa-plus"></i> Jadikan sub baru</button>` : ''}
      </div>
      <div class="km-rows">${rows.map((r) => `
        <label class="km-row">
          <input type="checkbox" value="${esc(r.id)}">
          <span class="km-row-main">
            <span class="km-row-top"><a href="laporan-detail.html?id=${encodeURIComponent(r.id)}" target="_blank">${esc(r.id)}</a> · ${esc(String(r.tanggal || '').slice(0, 10))}${r.kode ? ` · ${esc(r.kode)}` : ''}</span>
            <span class="km-row-detail">${esc(r.detail || '(detail kosong)')}</span>
            <span class="km-row-desk">${esc(r.deskripsi || '')}</span>
          </span>
        </label>`).join('')}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('.km-grup').forEach((g) => {
    const cek = () => [...g.querySelectorAll('.km-rows input:checked')].map((i) => i.value);
    g.querySelector('.km-semua').addEventListener('change', (e) => g.querySelectorAll('.km-rows input').forEach((i) => { i.checked = e.target.checked; }));
    const kirim = async (sub, buatBaru, btn) => {
      const ids = cek();
      if (!ids.length) return showToast('Centang laporan dulu.', 'error');
      if (!sub) return showToast('Pilih atau tulis sub-lokasi.', 'error');
      btn.disabled = true;
      try { const j = await kmApi('tetapkanSubLokasi', { ids, lokasi: g.dataset.lok, sub, buat_baru: buatBaru }); showToast(j.message); await kmMuat(); }
      catch (e) { showToast(e.message, 'error'); btn.disabled = false; }
    };
    g.querySelector('.km-tetapkan').addEventListener('click', (e) => kirim(g.querySelector('.km-pilih-sub').value, false, e.currentTarget));
    g.querySelector('.km-jadikan')?.addEventListener('click', (e) => {
      if (!cek().length) g.querySelectorAll('.km-rows input').forEach((i) => { i.checked = true; }); // default: semua di grup ini
      kirim(g.querySelector('.km-sub-baru').value.trim(), true, e.currentTarget);
    });
  });
}

// ── Temuan ──
function renderTemuan() {
  const el = document.getElementById('temuanList');
  const q = document.getElementById('cariTemuan').value.trim().toLowerCase();
  const kat = document.getElementById('filterKategori').value;
  const non = document.getElementById('tampilNonaktif').checked;
  const N = Taksonomi.NAMA_KEPARAHAN, K = Taksonomi.NAMA_KEMUNGKINAN;
  const rows = KM.temuan.filter((t) => (non || t.aktif) && (!kat || t.kategori_kode === kat)
    && (!q || `${t.kode} ${t.sub} ${t.kategori}`.toLowerCase().includes(q)));
  el.className = '';
  el.innerHTML = rows.length ? rows.map((t) => {
    const r = Taksonomi.hitung({ keparahan: t.keparahan, kemungkinan: t.kemungkinan });
    return `<div class="km-item${t.aktif ? '' : ' nonaktif'}" data-kode="${esc(t.kode)}">
      <div class="km-item-kode">${esc(t.kode)}<small>${esc(t.kategori)}</small></div>
      <input data-f="sub" value="${esc(t.sub)}" maxlength="140" aria-label="Sub" />
      <div class="km-item-isi">
        <select data-f="tipe">${opsi(['Kondisi', 'Tindakan'], t.tipe)}</select>
        <select data-f="keparahan" title="Keparahan">${opsi15(t.keparahan, N)}</select>
        <select data-f="kemungkinan" title="Kemungkinan default">${opsi15(t.kemungkinan, K)}</select>
        <span class="pr-tingkat ${r.tingkat.toLowerCase()}">${r.tingkat}</span>
        <label class="km-check"><input type="checkbox" data-f="kritis"${t.kritis ? ' checked' : ''}> Kritis</label>
        <label class="km-check"><input type="checkbox" data-f="aktif"${t.aktif ? ' checked' : ''}> Aktif</label>
        <button class="btn-primary km-simpan" disabled><i class="fa-solid fa-floppy-disk"></i> Simpan</button>
      </div>
    </div>`;
  }).join('') : '<div class="km-kosong">Tidak ada yang cocok.</div>';

  el.querySelectorAll('.km-item').forEach((it) => {
    const btn = it.querySelector('.km-simpan');
    it.addEventListener('input', () => { btn.disabled = false; });
    it.addEventListener('change', () => { btn.disabled = false; });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const v = (f) => it.querySelector(`[data-f="${f}"]`);
      try {
        const j = await kmApi('simpanMasterTemuan', { kode: it.dataset.kode, sub: v('sub').value, tipe: v('tipe').value,
          keparahan: v('keparahan').value, kemungkinan: v('kemungkinan').value, kritis: v('kritis').checked, aktif: v('aktif').checked });
        showToast(j.message); await kmMuat();
      } catch (e) { showToast(e.message, 'error'); btn.disabled = false; }
    });
  });
}
['cariTemuan', 'filterKategori', 'tampilNonaktif'].forEach((id) => document.getElementById(id).addEventListener('input', renderTemuan));

// ── Lokasi ──
function renderLokasi() {
  const el = document.getElementById('lokasiList');
  const per = {};
  KM.lokasi.forEach((l) => (per[l.lokasi] ||= []).push(l));
  el.className = '';
  el.innerHTML = Object.entries(per).map(([lok, subs]) => `
    <div class="km-grup">
      <div class="km-grup-head"><b>${esc(lok)}</b><span class="km-badge">${subs.length}</span></div>
      ${subs.map((l) => `<div class="km-item km-item-lok${l.aktif ? '' : ' nonaktif'}" data-lok="${esc(lok)}" data-sub="${esc(l.sub)}">
        <input data-f="sub" value="${esc(l.sub)}" maxlength="80" aria-label="Sub-lokasi" />
        <div class="km-item-isi">
          <select data-f="jenis_area" title="Jenis area">${opsi(JENIS_AREA, l.jenis_area)}</select>
          <label class="km-check"><input type="checkbox" data-f="aktif"${l.aktif ? ' checked' : ''}> Aktif</label>
          <button class="btn-primary km-simpan" disabled><i class="fa-solid fa-floppy-disk"></i> Simpan</button>
        </div>
      </div>`).join('')}
    </div>`).join('');

  el.querySelectorAll('.km-item-lok').forEach((it) => {
    const btn = it.querySelector('.km-simpan');
    it.addEventListener('input', () => { btn.disabled = false; });
    it.addEventListener('change', () => { btn.disabled = false; });
    btn.addEventListener('click', async () => {
      const v = (f) => it.querySelector(`[data-f="${f}"]`);
      const baru = v('sub').value.trim();
      if (baru !== it.dataset.sub && !confirm(`Ganti nama "${it.dataset.sub}" menjadi "${baru}"? Laporan yang memakai nama lama ikut diganti.`)) return;
      btn.disabled = true;
      try {
        const j = await kmApi('simpanMasterLokasi', { lokasi: it.dataset.lok, sub: baru, sub_lama: it.dataset.sub, jenis_area: v('jenis_area').value, aktif: v('aktif').checked });
        showToast(j.message); await kmMuat();
      } catch (e) { showToast(e.message, 'error'); btn.disabled = false; }
    });
  });
}

// ── Form tambah ──
function isiFormTambah() {
  const N = Taksonomi.NAMA_KEPARAHAN, K = Taksonomi.NAMA_KEMUNGKINAN;
  const ft = document.getElementById('formTemuanBaru');
  ft.querySelector('[data-f="kategori_kode"]').innerHTML = KM.kategori.map((k) => `<option value="${esc(k.kode)}">${esc(k.kode)} — ${esc(k.nama)}</option>`).join('');
  ft.querySelector('[data-f="keparahan"]').innerHTML = opsi15(3, N);
  ft.querySelector('[data-f="kemungkinan"]').innerHTML = opsi15(3, K);
  const fk = document.getElementById('filterKategori');
  const pilih = fk.value;
  fk.innerHTML = '<option value="">Semua kategori</option>' + KM.kategori.map((k) => `<option value="${esc(k.kode)}"${k.kode === pilih ? ' selected' : ''}>${esc(k.kode)} — ${esc(k.nama)}</option>`).join('');
  document.getElementById('daftarLokasi').innerHTML = [...new Set(KM.lokasi.map((l) => l.lokasi))].map((l) => `<option value="${esc(l)}">`).join('');
  document.querySelector('#formLokasiBaru [data-f="jenis_area"]').innerHTML = opsi(JENIS_AREA, 'Operasional');
}

document.getElementById('btnTambahTemuan').addEventListener('click', async (e) => {
  const f = (n) => document.querySelector(`#formTemuanBaru [data-f="${n}"]`);
  e.currentTarget.disabled = true;
  try {
    const j = await kmApi('simpanMasterTemuan', { kategori_kode: f('kategori_kode').value, sub: f('sub').value, tipe: f('tipe').value,
      keparahan: f('keparahan').value, kemungkinan: f('kemungkinan').value, kritis: f('kritis').checked });
    showToast(j.message); f('sub').value = ''; await kmMuat();
  } catch (err) { showToast(err.message, 'error'); }
  e.currentTarget.disabled = false;
});

document.getElementById('btnTambahLokasi').addEventListener('click', async (e) => {
  const f = (n) => document.querySelector(`#formLokasiBaru [data-f="${n}"]`);
  e.currentTarget.disabled = true;
  try {
    const j = await kmApi('simpanMasterLokasi', { lokasi: f('lokasi').value, sub: f('sub').value, jenis_area: f('jenis_area').value });
    showToast(j.message); f('sub').value = ''; await kmMuat();
  } catch (err) { showToast(err.message, 'error'); }
  e.currentTarget.disabled = false;
});

// ── Insiden (register SHE, tahap 3) ──
let INS = [], insTampil = 30;
const KLAS_NAMA = { FAT: 'Fatality', LTI: 'Lost Time Injury', MTI: 'Medical Treatment', FAI: 'First Aid', PD: 'Property Damage', FC: 'Fire Case', EC: 'Enviro Case', NM: 'Near Miss' };

async function muatInsiden() {
  try {
    const res = await fetch('/api?action=getInsiden');
    const j = await res.json();
    if (!res.ok || j.status === 'error') throw new Error(j.message || 'Gagal memuat insiden.');
    INS = j.data || [];
    renderInsiden();
  } catch (e) { document.getElementById('insidenList').innerHTML = `<div class="km-kosong">${esc(e.message)}</div>`; }
}

function renderInsiden() {
  document.getElementById('cntInsiden').textContent = INS.length;
  const per = (f) => INS.reduce((a, r) => ((a[f(r)] = (a[f(r)] || 0) + 1), a), {});
  const klas = per((r) => r.klasifikasi), th = per((r) => String(r.tanggal).slice(0, 4));
  document.getElementById('ringkasInsiden').innerHTML = INS.length ? `
    <div>${Object.keys(KLAS_NAMA).filter((k) => klas[k]).map((k) => `<span class="km-chip k-${k.toLowerCase()}" title="${KLAS_NAMA[k]}">${k} <b>${klas[k]}</b></span>`).join('')}</div>
    <div>${Object.entries(th).sort().map(([t, n]) => `<span class="km-chip">${esc(t)} <b>${n}</b></span>`).join('')}</div>` : '';
  const q = document.getElementById('cariInsiden').value.trim().toLowerCase();
  const rows = INS.filter((r) => !q || `${r.id} ${r.lokasi} ${r.sub_lokasi} ${r.kode_penyebab} ${r.perusahaan} ${r.jenis}`.toLowerCase().includes(q));
  const el = document.getElementById('insidenList');
  el.className = '';
  el.innerHTML = rows.length ? rows.slice(0, insTampil).map((r) => `
    <div class="km-ins">
      <div class="km-ins-top"><span class="km-chip k-${esc(String(r.klasifikasi).toLowerCase())}">${esc(r.klasifikasi)}</span>
        <b>${esc(r.tanggal)}${r.jam ? ' ' + esc(r.jam) : ''}</b> · ${esc(r.id)} · ${esc(r.perusahaan || '')}</div>
      <div class="km-ins-mid"><i class="fa-solid fa-location-dot"></i> ${esc(r.lokasi || '-')}${r.sub_lokasi ? ' — ' + esc(r.sub_lokasi) : ''}
        · <b>${esc(r.kode_penyebab || '-')}</b> · ${esc(r.jenis || '')} · potensi ${esc(r.potensi_keparahan || '-')}</div>
      <div class="km-row-desk">${esc(r.kronologi || '')}…</div>
    </div>`).join('') + (rows.length > insTampil ? `<button class="btn-secondary km-lagi" onclick="insTampil += 30; renderInsiden()">Tampilkan lagi (${rows.length - insTampil})</button>` : '')
    : `<div class="km-kosong">${INS.length ? 'Tidak ada yang cocok.' : 'Belum ada data insiden. Unggah Excel dari template.'}</div>`;
}
document.getElementById('cariInsiden').addEventListener('input', () => { insTampil = 30; renderInsiden(); });

function muatSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, gagal) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = ok; s.onerror = () => gagal(new Error('Gagal memuat pembaca Excel. Cek koneksi.'));
    document.head.appendChild(s);
  });
}

document.getElementById('fileInsiden').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const box = document.getElementById('hasilImpor');
  box.innerHTML = '<div class="km-loading"><i class="fa-solid fa-spinner fa-spin"></i> Membaca & mengunggah…</div>';
  try {
    await muatSheetJS();
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const nama = wb.SheetNames.find((n) => n === 'Isi Insiden') || wb.SheetNames.find((n) => {
      const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, range: 0 })[0] || [];
      return r.some((h) => String(h).startsWith('No. Register'));
    });
    if (!nama) throw new Error('Sheet "Isi Insiden" tidak ditemukan. Pakai file dari template.');
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nama], { raw: false, defval: '' });
    const j = await kmApi('imporInsiden', { rows, nama_file: f.name });
    const daftar = (arr, k) => arr.slice(0, 50).map((x) => `<li>Baris ${x.baris}${x.register ? ` (${esc(x.register)})` : ''}: ${esc(x[k].join('; '))}</li>`).join('');
    const nol = !(j.baru + j.diperbarui);
    box.innerHTML = `<div class="km-hasil${nol ? ' km-hasil--galat' : ''}">
      <div><i class="fa-solid ${nol ? 'fa-circle-xmark' : 'fa-circle-check'}" style="color:${nol ? '#dc2626' : '#16a34a'}"></i> ${esc(j.message)}</div>
      ${j.gagal.length ? `<details open><summary>${j.gagal.length} baris dilewati — perbaiki lalu unggah ulang</summary><ul>${daftar(j.gagal, 'galat')}</ul></details>` : ''}
      ${j.peringatan.length ? `<details><summary>${j.peringatan.length} peringatan (tetap tersimpan)</summary><ul>${daftar(j.peringatan, 'peringatan')}</ul></details>` : ''}
    </div>`;
    await muatInsiden();
  } catch (err) { box.innerHTML = `<div class="km-hasil km-hasil--galat">${esc(err.message)}</div>`; }
});
