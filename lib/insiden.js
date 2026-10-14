// Register insiden SHE (deteksi dini tahap 3, 2026-10-14). Murni — dipakai API imporInsiden.
// Baris = objek {judul kolom template: nilai teks} hasil baca Excel (SheetJS, raw:false).
// Kunci unik = No. Register; unggah ulang memperbarui, bukan menggandakan.

const KLASIFIKASI = ['FAT', 'LTI', 'MTI', 'FAI', 'PD', 'FC', 'EC', 'NM'];
const KOLOM = {
  'No. Register': 'id', 'Tanggal': 'tanggal', 'Jam (HH:MM)': 'jam', 'Shift': 'shift', 'Perusahaan': 'perusahaan',
  'Departemen': 'departemen', 'Lokasi': 'lokasi', 'Sub-Lokasi': 'sub_lokasi', 'Detail Lokasi (patokan)': 'detail_lokasi',
  'Klasifikasi': 'klasifikasi', 'Jenis Kecelakaan': 'jenis', 'Tipe Unit': 'tipe_unit', 'Unit Terlibat': 'unit',
  'Kerusakan': 'kerusakan', 'Estimasi Biaya (Rp)': 'biaya', 'Bagian Luka': 'luka', 'Hari Hilang': 'hari_hilang',
  'Jabatan': 'jabatan', 'Umur': 'umur', 'Masa Kerja (bulan)': 'masa_kerja_bulan', 'Kode Penyebab Utama': 'kode_penyebab',
  'Kode Penyebab Tambahan': 'kode_tambahan', 'Potensi Keparahan': 'potensi_keparahan', 'Faktor Pribadi': 'faktor_pribadi',
  'Faktor Pekerjaan': 'faktor_pekerjaan', 'Kronologi': 'kronologi',
}; // kolom nama personel & pengawas sengaja tidak dibaca (tidak diimpor)
const WAJIB = ['id', 'tanggal', 'perusahaan', 'lokasi', 'klasifikasi', 'kode_penyebab', 'potensi_keparahan', 'kronologi'];

const teks = (v) => String(v ?? '').trim();
const pad = (n) => String(n).padStart(2, '0');

function tanggal(v) {
  const s = teks(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return '';
}
function valid(y, mo, d) {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && y >= 2000 ? `${y}-${pad(mo)}-${pad(d)}` : '';
}
function jam(v) {
  const m = teks(v).match(/^(\d{1,2})[:.](\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${pad(m[1])}:${m[2]}` : '';
}
/** "Rp 1.200.000" / "1,200,000" / "1200000" → 1200000. */
const angka = (v) => { const d = teks(v).replace(/,00$|\.00$/, '').replace(/[^\d]/g, ''); return d ? Number(d) : null; };
const kode = (v) => (teks(v).toUpperCase().match(/^[A-Z]{2}-\d{2}/) || [''])[0];

/** Keparahan aktual (skala 5×5) dari klasifikasi; kerusakan aset dari biaya. */
function keparahanAktual(klas, biaya) {
  if (klas === 'NM' || klas === 'FAI') return 1;
  if (klas === 'MTI') return 2;
  if (klas === 'LTI' || klas === 'EC') return 3;
  if (klas === 'FAT') return 5;
  const b = biaya || 0;
  return b >= 100e6 ? 4 : b >= 10e6 ? 3 : 2;
}

/** baris Excel → { rec, galat[], peringatan[] }. rec null bila baris kosong. */
function normalisasi(baris, { kodeAda = new Set(), lokasiAda = new Map() } = {}) {
  const r = {};
  for (const [judul, nilai] of Object.entries(baris || {})) {
    const f = KOLOM[teks(judul).replace(/\s*\*$/, '')];
    if (f) r[f] = teks(nilai);
  }
  if (!Object.values(r).some(Boolean)) return { rec: null, galat: [], peringatan: [] };
  const galat = [], peringatan = [];
  r.tanggal = tanggal(r.tanggal);
  r.jam = jam(r.jam);
  r.klasifikasi = teks(r.klasifikasi).toUpperCase();
  r.kode_penyebab = kode(r.kode_penyebab);
  r.kode_tambahan = kode(r.kode_tambahan);
  r.potensi_keparahan = Number((teks(r.potensi_keparahan).match(/^[1-5]/) || [0])[0]) || 0;
  for (const f of ['biaya', 'hari_hilang', 'umur', 'masa_kerja_bulan']) r[f] = angka(r[f]);
  for (const f of WAJIB) if (!r[f]) galat.push(`${Object.keys(KOLOM).find((k) => KOLOM[k] === f)} kosong / tidak terbaca`);
  if (!r.jam) peringatan.push('Jam kosong / tidak terbaca');
  if (r.klasifikasi && !KLASIFIKASI.includes(r.klasifikasi)) galat.push(`Klasifikasi "${r.klasifikasi}" tidak dikenal`);
  if (r.kode_penyebab && kodeAda.size && !kodeAda.has(r.kode_penyebab)) galat.push(`Kode penyebab ${r.kode_penyebab} tidak ada di master`);
  if (r.kode_tambahan && kodeAda.size && !kodeAda.has(r.kode_tambahan)) peringatan.push(`Kode tambahan ${r.kode_tambahan} tidak ada di master — diabaikan`), (r.kode_tambahan = '');
  if (r.lokasi && lokasiAda.size && !lokasiAda.has(r.lokasi)) peringatan.push(`Lokasi "${r.lokasi}" tidak ada di master`);
  else if (r.sub_lokasi && lokasiAda.size && !(lokasiAda.get(r.lokasi) || []).includes(r.sub_lokasi)) peringatan.push(`Sub-lokasi "${r.sub_lokasi}" tidak ada di master`);
  if (r.umur !== null && (r.umur < 15 || r.umur > 70)) peringatan.push(`Umur ${r.umur} tidak wajar — dikosongkan`), (r.umur = null);
  r.keparahan_aktual = keparahanAktual(r.klasifikasi, r.biaya);
  return { rec: r, galat, peringatan };
}

module.exports = { KLASIFIKASI, KOLOM, normalisasi, keparahanAktual, tanggal, jam, angka };
