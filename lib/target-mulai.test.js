const test = require('node:test');
const assert = require('node:assert');
const { targetBulan } = require('./target-mulai');

test('target karyawan baru', () => {
  assert.strictEqual(targetBulan(4, '2026-10-19', '2026-09'), 0);  // belum kerja
  assert.strictEqual(targetBulan(4, '2026-10-19', '2026-10'), 2);  // 13/31 × 4
  assert.strictEqual(targetBulan(4, '2026-10-19', '2026-11'), 4);  // penuh
  assert.strictEqual(targetBulan(4, '2026-10-01', '2026-10'), 4);  // masuk tgl 1 = penuh
  assert.strictEqual(targetBulan(4, '2026-09-28', '2026-09'), 0);  // 3/30 × 4 → 0
  assert.strictEqual(targetBulan(4, '', '2026-10'), 4);            // tanpa tanggal = penuh
});
