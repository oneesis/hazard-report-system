// Matriks risiko 5×5 ONE-SAP (deteksi dini, keputusan user 2026-10-14). Murni, dipakai
// form Hazard (browser: window.Taksonomi) & API (Node: require).
//   Skor = Kemungkinan × Keparahan → Rendah 1–4, Sedang 5–9, Tinggi 10–16, Ekstrem 20–25.
//   Kemungkinan otomatis = default master per sub, +1 area Operasional/Kritis,
//   +1 temuan kode sama berulang di sub-lokasi sama ≤ 30 hari (dibatasi 1–5).
//   Kelas: Mayor = keparahan 4–5, Minor = 1–3.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Taksonomi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const NAMA_KEPARAHAN = ['', 'Tidak Signifikan', 'Minor', 'Sedang', 'Mayor', 'Bencana'];
  const NAMA_KEMUNGKINAN = ['', 'Jarang', 'Kecil kemungkinan', 'Mungkin', 'Sangat mungkin', 'Hampir pasti'];
  const BATAS_HARI = { Rendah: 7, Sedang: 3, Tinggi: 1, Ekstrem: 1 };
  const AREA_NAIK = ['Operasional', 'Kritis'];
  const HARI_BERULANG = 30;

  const batas = (n) => Math.max(1, Math.min(5, Math.round(Number(n) || 0) || 1));
  const tingkat = (skor) => (skor <= 4 ? 'Rendah' : skor <= 9 ? 'Sedang' : skor <= 16 ? 'Tinggi' : 'Ekstrem');

  /** { keparahan, kemungkinan (default master), jenisArea, berulang } → hasil matriks. */
  function hitung({ keparahan, kemungkinan, jenisArea = '', berulang = false }) {
    const p = batas(keparahan);
    const k = batas(batas(kemungkinan) + (AREA_NAIK.includes(jenisArea) ? 1 : 0) + (berulang ? 1 : 0));
    const skor = k * p;
    const t = tingkat(skor);
    return { keparahan: p, kemungkinan: k, skor, tingkat: t, kelas: p >= 4 ? 'Mayor' : 'Minor', batasHari: BATAS_HARI[t] };
  }

  /** Ada laporan kode sama di lokasi+sub-lokasi sama dalam 30 hari sebelum `tanggal`? */
  function berulang(laporanLain, { kode, lokasi, sub, tanggal }) {
    if (!kode || !sub) return false;
    const t = Date.parse(tanggal);
    return laporanLain.some((l) => {
      if (l.kode !== kode || l.lokasi !== lokasi || l.sub !== sub) return false;
      const d = (t - Date.parse(l.tanggal)) / 864e5;
      return d >= 0 && d <= HARI_BERULANG;
    });
  }

  return { NAMA_KEPARAHAN, NAMA_KEMUNGKINAN, BATAS_HARI, tingkat, hitung, berulang };
});
