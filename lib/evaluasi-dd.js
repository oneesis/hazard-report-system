// Evaluasi peringatan dini terhadap insiden nyata (tahap 7 — bahan kalibrasi bobot). Murni.
// Untuk tiap insiden SETELAH data temuan mulai: apakah lokasinya sudah KUNING/MERAH dalam
// 14 hari sebelumnya (dihitung ulang dengan keadaan temuan per hari itu), apakah peringatan
// terkirim, dan apakah kode penyebabnya sudah pernah dilaporkan sebagai temuan di lokasi itu ≤ 30 hari.
const Indeks = require('./indeks-risiko');
const { keadaanPada } = require('./laporan-bulanan');

const HARI = 864e5;
const geser = (tanggal, n) => new Date(Date.parse(tanggal + 'T00:00:00Z') + n * HARI).toISOString().slice(0, 10);
const tgl = (s) => String(s || '').slice(0, 10);

/**
 * @param o.siap temuan Indeks.siapkan (terurut tanggal)  @param o.insiden [{id, tanggal, lokasi, klasifikasi, kode_penyebab}]
 * @param o.peringatan [{tanggal, jenis, dimensi, nama, tanggapan}]  @param o.penyebabInsiden Set kode
 */
function evaluasiInsiden({ siap, insiden, peringatan = [], penyebabInsiden = new Set(), hariSebelum = 14 }) {
  const mulai = siap.length ? tgl(siap[0].tanggal) : null;
  const daftar = [];
  for (const i of insiden) {
    if (!mulai || !i.lokasi || tgl(i.tanggal) <= mulai) continue;
    let status = 'hijau', skorMaks = 0, hariPertama = null;
    for (let n = hariSebelum; n >= 1; n--) {
      const h = geser(tgl(i.tanggal), -n);
      if (h < mulai) continue;
      const e = Indeks.hitungIndeks(keadaanPada(siap, h), { now: Date.parse(h + 'T12:00:00Z'), kunci: (t) => t.lokasi,
        penyebabInsiden, mulai: Date.parse(mulai + 'T00:00:00Z') }).find((x) => x.nama === i.lokasi);
      if (!e) continue;
      skorMaks = Math.max(skorMaks, e.skor);
      if (e.status !== 'hijau' && !hariPertama) hariPertama = n;
      if (e.status === 'merah' || (e.status === 'kuning' && status === 'hijau')) status = e.status;
    }
    const awal = geser(tgl(i.tanggal), -hariSebelum), akhir = geser(tgl(i.tanggal), -1);
    const diperingatkan = peringatan.some((p) => p.dimensi === 'lokasi' && p.nama === i.lokasi && p.tanggal >= awal && p.tanggal <= akhir);
    const penyebabTerlapor = !!i.kode_penyebab && siap.some((t) => t.kode === i.kode_penyebab && t.lokasi === i.lokasi
      && tgl(t.tanggal) < tgl(i.tanggal) && tgl(t.tanggal) >= geser(tgl(i.tanggal), -30));
    daftar.push({ id: i.id, tanggal: tgl(i.tanggal), lokasi: i.lokasi, klasifikasi: i.klasifikasi, kode: i.kode_penyebab || '',
      status, hariSebelum: hariPertama, skorMaks, diperingatkan, penyebabTerlapor });
  }
  const pct = (a) => (daftar.length ? Math.round((a / daftar.length) * 100) : null);
  const ind = peringatan.filter((p) => p.jenis === 'indeks');
  return {
    mulai, hariSebelum, insiden: daftar.length,
    terdeteksi: daftar.filter((x) => x.status !== 'hijau').length, pctTerdeteksi: pct(daftar.filter((x) => x.status !== 'hijau').length),
    diperingatkan: daftar.filter((x) => x.diperingatkan).length, penyebabTerlapor: daftar.filter((x) => x.penyebabTerlapor).length,
    pctPenyebabTerlapor: pct(daftar.filter((x) => x.penyebabTerlapor).length),
    tanggapan: { total: ind.length, ditindaklanjuti: ind.filter((p) => p.tanggapan === 'Ditindaklanjuti').length,
      tidakRelevan: ind.filter((p) => p.tanggapan === 'Tidak relevan').length, belum: ind.filter((p) => !p.tanggapan).length },
    daftar: daftar.sort((a, b) => b.tanggal.localeCompare(a.tanggal)),
  };
}

module.exports = { evaluasiInsiden };
