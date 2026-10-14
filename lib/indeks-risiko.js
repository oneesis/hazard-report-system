// Indeks risiko deteksi dini (tahap 4, keputusan user 2026-10-14). Murni — dipakai API deteksiDini.
// Temuan seragam dari Hazard, Inspeksi (butir abnormal) & SBO (butir tidak aman):
//   { sumber, id, tanggal 'YYYY-MM-DD', perusahaan, departemen, lokasi, sub, pelapor, kode,
//     keparahan 1–5, tipe 'Kondisi'|'Tindakan', kritis bool, status, batasWaktu }
// Skor mingguan per entitas (lokasi / departemen / perusahaan):
//   +3 Mayor baru · +1 Minor baru · +2 tindakan tidak aman · +2 risiko kritis · +3 berulang (≤30 hari,
//   kode & lokasi+sub sama) · +2 kode yang pernah jadi penyebab insiden · +4 per Mayor terbuka lewat batas ≤ 60 hari.
// Status (merah = potensi fatal, agar tidak "merah di mana-mana" karena laporan belum ditutup di sistem):
//   MERAH  = temuan keparahan 5 (Bencana) belum ditutup — baru (≤ 7 hari) atau lewat batas ≤ 60 hari;
//            atau lonjakan temuan Mayor baru (≥ 3 & ≥ 2× rata-rata).
//   KUNING = temuan Mayor lewat batas ≤ 60 hari; atau skor temuan baru ≥ 10 & ≥ 1,5× rata-rata.
//   Rata-rata hanya dari minggu sejak data mulai (min. 4 minggu); lewat batas > 60 hari = "data lama belum
//   ditutup" (info saja) — eskalasi A4 yang menanganinya, agar merah tetap bermakna.
// ponytail: belum dinormalisasi paparan (jumlah orang/jam kerja per area) — tambah bila data paparan tersedia.

const BOBOT = { mayor: 3, minor: 1, tindakan: 2, kritis: 2, berulang: 3, penyebabInsiden: 2, terlambat: 4 };
const HARI = 864e5;
const MINGGU = 12;
const MAKS_TERLAMBAT = 60; // hari
const MIN_MINGGU_RATA = 4;

const tgl = (s) => Date.parse(String(s || '').slice(0, 10) + 'T00:00:00Z');
const terbuka = (t) => String(t.status || '').toUpperCase() !== 'CLOSED';

/** Buang dobel (pelapor, kode, lokasi+sub, hari sama) & tandai berulang ≤ 30 hari. */
function siapkan(temuan) {
  const lihat = new Set(), out = [];
  for (const t of [...temuan].sort((a, b) => tgl(a.tanggal) - tgl(b.tanggal))) {
    if (!t.kode || Number.isNaN(tgl(t.tanggal))) continue;
    const k = [t.pelapor, t.kode, t.lokasi, t.sub, String(t.tanggal).slice(0, 10)].join('|');
    if (t.pelapor && lihat.has(k)) continue;
    lihat.add(k);
    out.push(t);
  }
  const terakhir = new Map(); // kode|lokasi|sub → tanggal temuan sebelumnya
  for (const t of out) {
    const k = [t.kode, t.lokasi, t.sub].join('|');
    const sblm = terakhir.get(k);
    const jarak = sblm === undefined ? -1 : (tgl(t.tanggal) - sblm) / HARI;
    t.berulang = jarak >= 1 && jarak <= 30; // hari yang sama = laporan ganda, bukan berulang
    if (jarak !== 0) terakhir.set(k, tgl(t.tanggal));
  }
  return out;
}

function skorTemuan(t, penyebabInsiden) {
  return (t.keparahan >= 4 ? BOBOT.mayor : BOBOT.minor) + (t.tipe === 'Tindakan' ? BOBOT.tindakan : 0)
    + (t.kritis ? BOBOT.kritis : 0) + (t.berulang ? BOBOT.berulang : 0) + (penyebabInsiden.has(t.kode) ? BOBOT.penyebabInsiden : 0);
}

/** → [{ nama, skor, baseline, status, alasan[], baru, mayorTerbuka, terlambat, seri[12] }] terurut skor. */
function hitungIndeks(temuanSiap, { now = Date.now(), kunci, penyebabInsiden = new Set(), mulai = null }) {
  const hari0 = Math.floor(now / HARI) * HARI + HARI; // akhir hari ini (UTC)
  const per = new Map();
  const ent = (n) => {
    if (!per.has(n)) per.set(n, { nama: n, seri: Array(MINGGU).fill(0), seriMayor: Array(MINGGU).fill(0), baru: 0, mayorTerbuka: 0, terlambat: [], terlambatLama: 0, fatal: 0 });
    return per.get(n);
  };
  for (const t of temuanSiap) {
    const nama = kunci(t);
    if (!nama) continue;
    const e = ent(nama);
    const w = Math.floor((hari0 - tgl(t.tanggal) - 1) / (7 * HARI));
    if (w >= 0 && w < MINGGU) {
      e.seri[MINGGU - 1 - w] += skorTemuan(t, penyebabInsiden);
      if (t.keparahan >= 4) e.seriMayor[MINGGU - 1 - w]++;
      if (w === 0) e.baru++;
    }
    if (t.keparahan >= 4 && terbuka(t)) {
      e.mayorTerbuka++;
      const lewat = t.batasWaktu ? (now - tgl(t.batasWaktu)) / HARI : -1;
      if (lewat > 1 && lewat <= MAKS_TERLAMBAT) e.terlambat.push(t);
      else if (lewat > MAKS_TERLAMBAT) e.terlambatLama++;
      if (t.keparahan >= 5 && (w === 0 || (lewat > 1 && lewat <= MAKS_TERLAMBAT))) e.fatal++;
    }
  }
  return [...per.values()].map((e) => {
    const skorBaru = e.seri[MINGGU - 1];
    e.seri[MINGGU - 1] += e.terlambat.length * BOBOT.terlambat;
    const skor = e.seri[MINGGU - 1];
    // minggu ke-i (0 = terlama) berawal di hari0 - (MINGGU - i) × 7 hari; hanya minggu setelah data mulai.
    const valid = (j) => mulai === null || hari0 - (9 - j) * 7 * HARI >= mulai; // minggu setelah data mulai
    const rata = (arr) => { const v = arr.slice(MINGGU - 9, MINGGU - 1).filter((_, j) => valid(j));
      return v.length >= MIN_MINGGU_RATA ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
    const baseline = rata(e.seri), baseMayor = rata(e.seriMayor);
    const mayorBaru = e.seriMayor[MINGGU - 1];
    const alasan = [];
    let status = 'hijau';
    if (e.fatal) { status = 'merah'; alasan.push(`${e.fatal} temuan berpotensi fatal belum ditutup`); }
    if (baseMayor !== null && mayorBaru >= 3 && mayorBaru >= 2 * Math.max(baseMayor, 1)) { status = 'merah'; alasan.push(`lonjakan temuan Mayor: ${mayorBaru} minggu ini (rata-rata ${baseMayor})`); }
    if (status !== 'merah') {
      if (e.terlambat.length) { status = 'kuning'; alasan.push(`${e.terlambat.length} temuan Mayor lewat batas waktu`); }
      if (baseline !== null && skorBaru >= 10 && skorBaru >= 1.5 * Math.max(baseline, 1)) { status = 'kuning'; alasan.push(`temuan baru naik: skor ${skorBaru} (rata-rata ${baseline})`); }
    }
    return { nama: e.nama, skor, skorBaru, baseline, status, alasan, baru: e.baru, mayorTerbuka: e.mayorTerbuka,
      terlambat: e.terlambat.length, terlambatLama: e.terlambatLama, mayorBaru, fatal: e.fatal, seri: e.seri };
  }).sort((a, b) => ({ merah: 0, kuning: 1, hijau: 2 })[a.status] - ({ merah: 0, kuning: 1, hijau: 2 })[b.status] || b.skor - a.skor);
}

/** Temuan kode sama di lokasi+sub sama pada ≥ 2 hari berbeda dalam 30 hari terakhir. */
function berulangAktif(temuanSiap, now = Date.now()) {
  const g = new Map();
  for (const t of temuanSiap) {
    if ((now - tgl(t.tanggal)) / HARI > 30) continue;
    const k = [t.kode, t.lokasi, t.sub].join('|');
    if (!g.has(k)) g.set(k, { kode: t.kode, lokasi: t.lokasi, sub: t.sub, jumlah: 0, id: [], hari: new Set() });
    const x = g.get(k); x.jumlah++; x.id.push(t.id); x.hari.add(String(t.tanggal).slice(0, 10));
  }
  return [...g.values()].filter((x) => x.hari.size >= 2).map(({ hari, ...x }) => ({ ...x, hari: hari.size }))
    .sort((a, b) => b.hari - a.hari || b.jumlah - a.jumlah);
}

module.exports = { BOBOT, MINGGU, MAKS_TERLAMBAT, siapkan, skorTemuan, hitungIndeks, berulangAktif };
