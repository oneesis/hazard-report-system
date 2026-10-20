// Target SAP/ST karyawan baru (keputusan user 2026-10-20), sama dgn SISTER MINER
// sap-capaian.ts: bulan sebelum mulai kerja tidak dinilai (0); bulan mulai kerja
// target proporsional sisa hari (masuk 19 Okt → 13/31 × 4 ≈ 2); setelahnya penuh.
// Tanggal dari roster 'TGL MULAI KERJA' (disinkron SISTER MINER). Dipakai browser
// (window.TargetMulai) & Node (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TargetMulai = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Bagian bulan yang wajib: 1 penuh, 0 belum kerja, pecahan = bulan mulai kerja.
  function porsiBulan(tglMulai, bulan) {
    const t = String(tglMulai || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !/^\d{4}-\d{2}$/.test(String(bulan || '')) || t <= `${bulan}-01`) return 1;
    if (t.slice(0, 7) > bulan) return 0;
    const [y, m] = bulan.split('-').map(Number);
    const hari = new Date(y, m, 0).getDate();
    return (hari - Number(t.slice(8)) + 1) / hari;
  }
  function targetBulan(obj, tglMulai, bulan) {
    const p = porsiBulan(tglMulai, bulan);
    return p === 1 ? obj : Math.round((Number(obj) || 0) * p);
  }
  return { porsiBulan, targetBulan };
});
