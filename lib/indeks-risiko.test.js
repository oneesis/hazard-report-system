const test = require('node:test');
const assert = require('node:assert');
const { siapkan, skorTemuan, hitungIndeks, berulangAktif } = require('./indeks-risiko');

const NOW = Date.parse('2026-10-14T05:00:00Z');
const t = (o) => ({ sumber: 'HZ', pelapor: 'A', lokasi: 'Mine Road', sub: 'S1', departemen: 'OPS', keparahan: 2, tipe: 'Kondisi', status: 'OPEN', ...o });

test('dobel dibuang, berulang ≤ 30 hari ditandai', () => {
  const s = siapkan([t({ id: 1, kode: 'JL-03', tanggal: '2026-10-01' }), t({ id: 2, kode: 'JL-03', tanggal: '2026-10-01' }),
    t({ id: 3, kode: 'JL-03', tanggal: '2026-10-20', pelapor: 'B' }), t({ id: 4, kode: 'JL-03', tanggal: '2026-12-30' })]);
  assert.deepEqual(s.map((x) => x.id), [1, 3, 4]);
  assert.deepEqual(s.map((x) => x.berulang), [false, true, false]);
});

test('skor temuan', () => {
  const P = new Set(['LL-04']);
  assert.equal(skorTemuan({ keparahan: 2, tipe: 'Kondisi' }, P), 1);
  assert.equal(skorTemuan({ keparahan: 5, tipe: 'Tindakan', kritis: true, berulang: true, kode: 'LL-04' }, P), 3 + 2 + 2 + 3 + 2);
});

test('status merah/kuning/hijau', () => {
  const data = siapkan([
    // Mine Road: temuan Bencana baru belum ditutup → merah
    t({ id: 'm1', kode: 'LL-04', keparahan: 5, tipe: 'Tindakan', kritis: true, tanggal: '2026-10-13' }),
    // Disposal: lonjakan 3 Mayor (sudah ditutup) setelah minggu-minggu sepi → merah
    ...[1, 2, 3].map((i) => t({ id: 'd' + i, lokasi: 'Disposal', sub: 'D' + i, pelapor: 'P' + i, kode: 'DS-02', keparahan: 4, tanggal: '2026-10-13', status: 'CLOSED' })),
    t({ id: 'd0', lokasi: 'Disposal', sub: 'D0', kode: 'HK-01', tanggal: '2026-08-10', status: 'CLOSED' }),
    // Office: Mayor terbuka lewat batas (bukan kritis) → kuning; yang lewat > 60 hari hanya info
    t({ id: 'o1', lokasi: 'Office', sub: 'Office 32', kode: 'BI-01', keparahan: 4, tanggal: '2026-08-20', batasWaktu: '2026-08-21' }),
    t({ id: 'o2', lokasi: 'Office', sub: 'Office 42', kode: 'LS-01', keparahan: 4, kritis: true, tanggal: '2026-06-01', batasWaktu: '2026-06-02' }),
    // Mess: temuan rutin tiap minggu, stabil → hijau
    ...[0, 7, 14, 21, 28, 35, 42, 49, 56].map((d, i) => t({ id: 'h' + i, lokasi: 'Mess', sub: 'M', kode: 'HK-01', pelapor: 'Q' + i,
      tanggal: new Date(NOW - d * 864e5).toISOString().slice(0, 10) })),
  ]);
  const r = hitungIndeks(data, { now: NOW, kunci: (x) => x.lokasi, penyebabInsiden: new Set(['LL-04']), mulai: Date.parse('2026-06-01') });
  const by = Object.fromEntries(r.map((x) => [x.nama, x]));
  assert.equal(by['Mine Road'].status, 'merah'); assert.equal(by['Disposal'].status, 'merah');
  assert.match(by['Disposal'].alasan.join(), /lonjakan temuan Mayor/);
  assert.equal(by['Office'].status, 'kuning'); assert.equal(by['Office'].terlambat, 1); assert.equal(by['Office'].terlambatLama, 1);
  assert.equal(by['Mess'].status, 'hijau');
  assert.equal(by['Mine Road'].seri.length, 12);
});

test('berulang aktif 30 hari', () => {
  const s = siapkan([t({ id: 1, kode: 'JL-03', tanggal: '2026-10-01' }), t({ id: 2, kode: 'JL-03', tanggal: '2026-10-10', pelapor: 'B' }), t({ id: 3, kode: 'HK-01', tanggal: '2026-10-10' })]);
  assert.deepEqual(berulangAktif(s, NOW).map((x) => [x.kode, x.jumlah]), [['JL-03', 2]]);
});

test('rata-rata hanya dari minggu sejak data mulai — data baru tidak otomatis "melonjak"', () => {
  const d = siapkan([1, 2, 3, 4].map((i) => t({ id: i, pelapor: 'P' + i, kode: 'HK-01', keparahan: 4, tanggal: '2026-10-12', status: 'CLOSED' })));
  const r = hitungIndeks(d, { now: NOW, kunci: (x) => x.lokasi, mulai: Date.parse('2026-10-01') })[0];
  assert.equal(r.baseline, null); assert.equal(r.status, 'hijau'); assert.equal(r.skorBaru, 12);
});
