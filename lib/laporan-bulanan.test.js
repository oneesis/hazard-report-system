const test = require('node:test');
const assert = require('node:assert');
const { ringkasanBulan, akhirBulan } = require('./laporan-bulanan');
const { siapkan } = require('./indeks-risiko');

test('akhirBulan', () => {
  assert.strictEqual(akhirBulan('2026-02'), '2026-02-28');
  assert.strictEqual(akhirBulan('2026-10'), '2026-10-31');
});

test('ringkasan bulan: hitungan, status per akhir bulan, bulan berjalan dipotong', () => {
  const t = (o) => ({ sumber: 'Hazard', pelapor: o.id, sub: '', tipe: 'Kondisi', kritis: false, departemen: 'PT EBL — OPERATION', ...o });
  const siap = siapkan([
    t({ id: 'a', tanggal: '2026-09-05', lokasi: 'Mine Road', kode: 'LL-01', keparahan: 4, status: 'CLOSED', tanggalClosing: '2026-10-02', batasWaktu: '2026-09-06' }),
    t({ id: 'b', tanggal: '2026-09-10', lokasi: 'Office', kode: 'HK-01', keparahan: 2, status: 'CLOSED', tanggalClosing: '2026-09-11', tipe: 'Tindakan' }),
    t({ id: 'c', tanggal: '2026-10-20', lokasi: 'Office', kode: 'HK-01', keparahan: 2, status: 'OPEN' }),
  ]);
  const h = ringkasanBulan({ bulan: '2026-09', hariIni: '2026-10-15', siap, jenisArea: (l) => (l === 'Mine Road' ? 'Operasional' : 'Fasilitas'),
    insiden: [{ tanggal: '2026-09-07', klasifikasi: 'NM' }], peringatan: [{ tanggal: '2026-09-08', tanggapan: 'Ditindaklanjuti' }],
    cuaca: [{ tanggal: '2026-09-01', hujan_mm: 25 }, { tanggal: '2026-09-02', hujan_mm: 0 }] });
  assert.strictEqual(h.jumlah.temuan, 2);
  assert.strictEqual(h.jumlah.mayor, 1);
  assert.strictEqual(h.pctTindakan, 50);
  assert.strictEqual(h.pctAreaOperasional, 50);
  // ditutup 2 Okt → per 30 Sep masih terbuka & lewat batas
  assert.strictEqual(h.mayorTerbuka, 1);
  assert.strictEqual(h.mayorTerlambat, 1);
  assert.strictEqual(h.areaTeratas[0].nama, 'Mine Road');
  assert.strictEqual(h.piramida.nearMiss, 1);
  assert.deepStrictEqual(h.peringatan, { total: 1, ditindaklanjuti: 1, tidakRelevan: 0, belum: 0 });
  assert.strictEqual(h.cuaca.hariHujanLebat, 1);
  assert.ok(h.rekomendasi.some((r) => r.includes('lewat batas')));

  const okt = ringkasanBulan({ bulan: '2026-10', hariIni: '2026-10-15', siap });
  assert.strictEqual(okt.akhir, '2026-10-15');
  assert.strictEqual(okt.jumlah.temuan, 0); // temuan 20 Okt belum terjadi per hari ini
  assert.strictEqual(okt.mayorTerbuka, 0); // sudah ditutup 2 Okt
});
