const test = require('node:test');
const assert = require('node:assert');
const { evaluasiInsiden } = require('./evaluasi-dd');
const { siapkan } = require('./indeks-risiko');

test('evaluasi: insiden setelah area kuning terdeteksi; insiden sebelum data mulai diabaikan', () => {
  const t = (o) => ({ sumber: 'Hazard', sub: '', tipe: 'Kondisi', kritis: false, departemen: 'X', status: 'OPEN', ...o });
  const siap = siapkan([
    t({ id: 'a', pelapor: 'a', tanggal: '2026-09-01', lokasi: 'Mine Road', kode: 'LL-12', keparahan: 4, batasWaktu: '2026-09-02' }),
    t({ id: 'b', pelapor: 'b', tanggal: '2026-09-01', lokasi: 'Office', kode: 'HK-01', keparahan: 1, status: 'CLOSED', tanggalClosing: '2026-09-02' }),
  ]);
  const e = evaluasiInsiden({ siap, insiden: [
    { id: 'I1', tanggal: '2026-09-10', lokasi: 'Mine Road', klasifikasi: 'NM', kode_penyebab: 'LL-12' },
    { id: 'I2', tanggal: '2026-09-10', lokasi: 'Office', klasifikasi: 'FAI', kode_penyebab: 'HK-04' },
    { id: 'I0', tanggal: '2026-04-01', lokasi: 'Mine Road', klasifikasi: 'PD' },
  ], peringatan: [{ tanggal: '2026-09-05', jenis: 'indeks', dimensi: 'lokasi', nama: 'Mine Road', tanggapan: 'Ditindaklanjuti' }] });
  assert.strictEqual(e.insiden, 2);
  const mr = e.daftar.find((x) => x.id === 'I1');
  assert.strictEqual(mr.status, 'kuning'); // Mayor lewat batas sejak 3 Sep
  assert.ok(mr.diperingatkan && mr.penyebabTerlapor);
  const of = e.daftar.find((x) => x.id === 'I2');
  assert.strictEqual(of.status, 'hijau');
  assert.ok(!of.penyebabTerlapor);
  assert.strictEqual(e.pctTerdeteksi, 50);
  assert.strictEqual(e.tanggapan.ditindaklanjuti, 1);
});
