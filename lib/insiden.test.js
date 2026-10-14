const test = require('node:test');
const assert = require('node:assert');
const { normalisasi, keparahanAktual, tanggal, jam, angka } = require('./insiden');

test('format tanggal, jam, angka dari Excel', () => {
  assert.equal(tanggal('23/04/2025'), '2025-04-23');
  assert.equal(tanggal('2025-04-23'), '2025-04-23');
  assert.equal(tanggal('31/02/2025'), '');
  assert.equal(jam('5:45'), '05:45'); assert.equal(jam('14.30'), '14:30'); assert.equal(jam('25:00'), '');
  assert.equal(angka('Rp 1.200.000'), 1200000); assert.equal(angka(' 1,200,000 '), 1200000); assert.equal(angka(''), null);
});

test('keparahan aktual', () => {
  assert.deepEqual(['NM', 'FAI', 'MTI', 'LTI', 'FAT'].map((k) => keparahanAktual(k)), [1, 1, 2, 3, 5]);
  assert.deepEqual([5e6, 20e6, 300e6].map((b) => keparahanAktual('PD', b)), [2, 3, 4]);
});

test('baris template → rekaman + validasi', () => {
  const ctx = { kodeAda: new Set(['LL-04', 'JL-03']), lokasiAda: new Map([['Mine Road', ['Jalan Dekat Validasi']]]) };
  const ok = normalisasi({ 'No. Register *': 'CK/015/X/2026', 'Tanggal *': '12/10/2026', 'Jam (HH:MM) *': '3:40', 'Perusahaan *': 'PT CK',
    'Lokasi *': 'Mine Road', 'Sub-Lokasi *': 'Jalan Dekat Validasi', 'Klasifikasi *': 'nm', 'Kode Penyebab Utama *': 'LL-04 — Mengemudi lelah',
    'Kode Penyebab Tambahan': 'ZZ-99 — x', 'Potensi Keparahan *': '5 Bencana', 'Kronologi *': 'microsleep', 'Personel Terlibat (tidak diimpor ke ONE-SAP)': 'Budi' }, ctx);
  assert.deepEqual(ok.galat, []);
  assert.equal(ok.rec.kode_penyebab, 'LL-04'); assert.equal(ok.rec.kode_tambahan, ''); assert.equal(ok.rec.potensi_keparahan, 5);
  assert.equal(ok.rec.klasifikasi, 'NM'); assert.equal(ok.rec.jam, '03:40'); assert.equal(ok.rec.keparahan_aktual, 1);
  assert.equal('personel' in ok.rec, false);
  assert.equal(ok.peringatan.length, 1);
  const salah = normalisasi({ 'No. Register *': 'X', 'Klasifikasi *': 'ABC', 'Kode Penyebab Utama *': 'QQ-01' }, ctx);
  assert.ok(salah.galat.some((g) => g.includes('Tanggal')));
  assert.ok(salah.galat.some((g) => g.includes('Klasifikasi "ABC"')));
  assert.ok(salah.galat.some((g) => g.includes('QQ-01')));
  assert.equal(normalisasi({ 'Tanggal *': '' }).rec, null);
});
