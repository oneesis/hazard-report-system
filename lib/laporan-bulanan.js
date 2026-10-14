// Laporan bulanan deteksi dini (tahap 6, keputusan user 2026-10-14: tanpa email manajemen,
// hanya masuk Laporan Eksekutif SIKAP). Murni — dipanggil cron harian ONE-SAP, hasilnya disimpan
// tabel laporan_dd_bulanan lalu dibaca SIKAP (SIKAP tidak menghitung ulang indeks).
// Status temuan "per akhir bulan": temuan yang ditutup SETELAH akhir bulan dihitung masih terbuka,
// supaya laporan bulan lalu tidak berubah hanya karena laporan baru ditutup sekarang.
const Indeks = require('./indeks-risiko');

const tgl = (s) => String(s || '').slice(0, 10);
const tutupPada = (t, akhir) => String(t.status || '').toUpperCase() === 'CLOSED' && (!t.tanggalClosing || tgl(t.tanggalClosing) <= akhir);

/** Keadaan temuan per tanggal: hanya temuan s/d tanggal itu, yang ditutup sesudahnya dianggap terbuka. */
function keadaanPada(siap, tanggal) {
  return siap.filter((t) => tgl(t.tanggal) <= tanggal).map((t) => (tutupPada(t, tanggal) ? t : { ...t, status: 'OPEN' }));
}

/** Hari terakhir bulan 'YYYY-MM' → 'YYYY-MM-DD'. */
function akhirBulan(bulan) {
  const [y, m] = bulan.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * @param o.bulan 'YYYY-MM'  @param o.hariIni 'YYYY-MM-DD' (bulan berjalan dipotong di sini)
 * @param o.siap temuan hasil Indeks.siapkan  @param o.insiden [{tanggal, lokasi, klasifikasi, kode_penyebab}]
 * @param o.peringatan [{tanggal, jenis, tanggapan}]  @param o.cuaca [{tanggal, hujan_mm}]
 * @param o.nama kode → nama sub  @param o.jenisArea lokasi → jenis area  @param o.penyebabInsiden Set kode
 */
function ringkasanBulan({ bulan, hariIni, siap, insiden = [], peringatan = [], cuaca = [], nama = (k) => k, jenisArea = () => '', penyebabInsiden = new Set() }) {
  const awal = bulan + '-01';
  const akhir = [akhirBulan(bulan), hariIni].sort()[0];
  const dalam = (s) => tgl(s) >= awal && tgl(s) <= akhir;
  const sampaiAkhir = keadaanPada(siap, akhir);
  const bln = sampaiAkhir.filter((t) => dalam(t.tanggal));
  const now = Date.parse(akhir + 'T12:00:00Z');
  const mulai = siap.length ? Date.parse(tgl(siap[0].tanggal) + 'T00:00:00Z') : null;
  const indeks = (kunci) => Indeks.hitungIndeks(sampaiAkhir, { now, kunci, penyebabInsiden, mulai });
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

  // Skor bulan per entitas = jumlah skor temuan bulan ini (bobot sama dengan indeks mingguan).
  const teratas = (kunci, status) => {
    const per = new Map();
    for (const t of bln) {
      const k = kunci(t); if (!k) continue;
      if (!per.has(k)) per.set(k, { nama: k, skor: 0, temuan: 0, mayor: 0 });
      const x = per.get(k); x.skor += Indeks.skorTemuan(t, penyebabInsiden); x.temuan++; if (t.keparahan >= 4) x.mayor++;
    }
    const st = new Map(status.map((s) => [s.nama, s]));
    return [...per.values()].sort((a, b) => b.skor - a.skor).slice(0, 5)
      .map((x) => ({ ...x, status: st.get(x.nama)?.status || 'hijau', alasan: st.get(x.nama)?.alasan || [] }));
  };
  const iLokasi = indeks((t) => t.lokasi), iDept = indeks((t) => t.departemen);

  const hitung = (arr, f) => arr.reduce((a, x) => { const k = f(x); if (k) a[k] = (a[k] || 0) + 1; return a; }, {});
  const penyebab = Object.entries(hitung(bln, (t) => t.kode)).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([kode, jumlah]) => ({ kode, nama: nama(kode), jumlah, pernahInsiden: penyebabInsiden.has(kode) }));
  const mayorTerbuka = sampaiAkhir.filter((t) => t.keparahan >= 4 && !tutupPada(t, akhir));
  const terlambat = mayorTerbuka.filter((t) => t.batasWaktu && tgl(t.batasWaktu) < akhir);
  const ins = insiden.filter((i) => dalam(i.tanggal));
  const per = peringatan.filter((p) => dalam(p.tanggal));
  const cu = cuaca.filter((c) => dalam(c.tanggal));
  const kls = (arr) => ins.filter((i) => arr.includes(i.klasifikasi)).length;

  const jumlah = {
    temuan: bln.length, hazard: bln.filter((t) => t.sumber === 'Hazard').length, inspeksi: bln.filter((t) => t.sumber === 'Inspeksi').length,
    sbo: bln.filter((t) => t.sumber === 'SBO').length, mayor: bln.filter((t) => t.keparahan >= 4).length,
    tindakan: bln.filter((t) => t.tipe === 'Tindakan').length, kritis: bln.filter((t) => t.kritis).length, berulang: bln.filter((t) => t.berulang).length,
  };
  const hasil = {
    bulan, awal, akhir, jumlah,
    pctTindakan: pct(jumlah.tindakan, jumlah.temuan),
    pctAreaOperasional: pct(bln.filter((t) => ['Operasional', 'Kritis'].includes(jenisArea(t.lokasi))).length, jumlah.temuan),
    mayorTerbuka: mayorTerbuka.length, mayorTerlambat: terlambat.length,
    statusArea: { merah: iLokasi.filter((x) => x.status === 'merah').map((x) => x.nama), kuning: iLokasi.filter((x) => x.status === 'kuning').map((x) => x.nama) },
    areaTeratas: teratas((t) => t.lokasi, iLokasi),
    departemenTeratas: teratas((t) => t.departemen, iDept),
    penyebab,
    peringatan: { total: per.length, ditindaklanjuti: per.filter((p) => p.tanggapan === 'Ditindaklanjuti').length,
      tidakRelevan: per.filter((p) => p.tanggapan === 'Tidak relevan').length, belum: per.filter((p) => !p.tanggapan).length },
    piramida: { berat: kls(['FAT', 'LTI']), ringan: kls(['MTI', 'FAI']), kerugian: kls(['PD', 'FC', 'EC']), nearMiss: kls(['NM']),
      temuanMayor: jumlah.mayor, temuan: jumlah.temuan },
    cuaca: { hari: cu.length, hariHujan: cu.filter((c) => Number(c.hujan_mm) >= 0.5).length,
      hariHujanLebat: cu.filter((c) => Number(c.hujan_mm) >= 20).length, totalMm: Math.round(cu.reduce((a, c) => a + (Number(c.hujan_mm) || 0), 0)) },
  };
  hasil.rekomendasi = rekomendasi(hasil);
  return hasil;
}

// ponytail: rekomendasi berbasis aturan (bisa diganti narasi AI SIKAP bila perlu).
function rekomendasi(h) {
  const r = [];
  if (h.statusArea.merah.length) r.push(`Prioritaskan verifikasi lapangan di area MERAH: ${h.statusArea.merah.join(', ')}.`);
  if (h.mayorTerlambat) r.push(`Tuntaskan ${h.mayorTerlambat} temuan Mayor yang lewat batas waktu; eskalasi ke Section Head terkait.`);
  const p = h.penyebab[0];
  if (p) r.push(`Penyebab terbanyak "${p.nama}" (${p.jumlah} temuan)${p.pernahInsiden ? ', pernah menjadi penyebab insiden' : ''} — jadikan topik Safety Talk & inspeksi terarah.`);
  if (h.pctAreaOperasional !== null && h.pctAreaOperasional < 50) r.push(`Baru ${h.pctAreaOperasional}% temuan dari area operasional/kritis — dorong pelaporan di Mine Road, Front Loading & Hauling.`);
  if (h.pctTindakan !== null && h.pctTindakan < 20) r.push(`Tindakan tidak aman hanya ${h.pctTindakan}% dari temuan — perkuat observasi perilaku (SBO).`);
  if (h.cuaca.hariHujanLebat >= 3) r.push(`${h.cuaca.hariHujanLebat} hari hujan ≥ 20 mm — pastikan inspeksi jalan angkut setelah hujan.`);
  return r;
}

module.exports = { ringkasanBulan, akhirBulan, keadaanPada };
