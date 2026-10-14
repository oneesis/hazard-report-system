const test = require('node:test');
const assert = require('node:assert');
const { hitung, tingkat, berulang, kodeInspeksi, kodeSbo } = require('./taksonomi');
const peta = require('./peta-checklist.json');
const master = require('./master-temuan.json');
const lokasi = require('./master-lokasi.json');

test('batas tingkat 5×5', () => {
  assert.deepEqual([4, 5, 9, 10, 16, 20, 25].map(tingkat), ['Rendah', 'Sedang', 'Sedang', 'Tinggi', 'Tinggi', 'Ekstrem', 'Ekstrem']);
});

test('kemungkinan otomatis: default + area + berulang, dibatasi 1–5', () => {
  assert.deepEqual(hitung({ keparahan: 2, kemungkinan: 2 }), { keparahan: 2, kemungkinan: 2, skor: 4, tingkat: 'Rendah', kelas: 'Minor', batasHari: 7 });
  assert.equal(hitung({ keparahan: 3, kemungkinan: 3, jenisArea: 'Operasional' }).tingkat, 'Tinggi'); // 4×3
  assert.equal(hitung({ keparahan: 5, kemungkinan: 3, jenisArea: 'Kritis' }).tingkat, 'Ekstrem'); // 4×5
  const r = hitung({ keparahan: 5, kemungkinan: 5, jenisArea: 'Kritis', berulang: true });
  assert.equal(r.kemungkinan, 5); assert.equal(r.kelas, 'Mayor');
  assert.equal(hitung({ keparahan: 0, kemungkinan: 9 }).skor, 5); // dibatasi
});

test('berulang ≤ 30 hari di sub-lokasi sama', () => {
  const lain = [{ kode: 'JL-03', lokasi: 'Mine Road', sub: 'Jalan Dekat Validasi', tanggal: '2026-10-01' }];
  const q = { kode: 'JL-03', lokasi: 'Mine Road', sub: 'Jalan Dekat Validasi', tanggal: '2026-10-20' };
  assert.equal(berulang(lain, q), true);
  assert.equal(berulang(lain, { ...q, tanggal: '2026-11-15' }), false);
  assert.equal(berulang(lain, { ...q, sub: 'Bottom Blok 2' }), false);
});

test('master: kode unik, keparahan & kemungkinan 1–5, prioritas lokasi dikenal', () => {
  const kode = master.temuan.map((t) => t.kode);
  assert.equal(new Set(kode).size, kode.length);
  for (const t of master.temuan) {
    assert.ok(t.keparahan >= 1 && t.keparahan <= 5 && t.kemungkinan >= 1 && t.kemungkinan <= 5, t.kode);
    assert.ok(master.kategori.some((k) => k.kode === t.kategori_kode), t.kode);
  }
  const nama = new Set(lokasi.map((l) => l.lokasi));
  for (const k of master.kategori) for (const p of k.lokasi_prioritas) assert.ok(nama.has(p), `${k.kode}: ${p}`);
});

test('checklist Inspeksi & SBO → kode taksonomi yang ada di master', () => {
  const ada = new Set(master.temuan.map((t) => t.kode));
  for (const [jenis, isi] of Object.entries(peta)) {
    if (jenis.startsWith('_')) continue;
    for (const [k, kode] of Object.entries(isi)) assert.ok(ada.has(kode), `${jenis} ${k} → ${kode}`);
  }
  const d = { '12_drainase_jalan': 'Abnormal', '14_culvert__saluran_bawah_jalan': 'Abnormal ', '19_penerangan_jalan_shift_malam': 'abnormal', '4_lebar_jalan_angkut': 'Normal', lokasi: 'x' };
  assert.deepEqual(kodeInspeksi('ins_ja', d, peta), ['JL-13', 'PN-02']);
  assert.deepEqual(kodeSbo({ apd: '{"1":"TIDAK_AMAN","5":"TIDAK_AMAN"}', kebersihan: { 1: 'AMAN' }, prosedur: 'rusak' }, peta), ['AP-01', 'KT-01']);
});
