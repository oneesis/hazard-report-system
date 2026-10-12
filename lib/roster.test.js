// node --test lib/roster.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRosterCsv, normTanggal } = require('./roster');

test('format usulan (koma, YYYY-MM-DD)', () => {
  const r = parseRosterCsv('NIK,NAMA,2026-11-01,2026-11-02\n10230035,ANDRE,D,n\n10240031,IRWAN,OFF,\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.tanggal, ['2026-11-01', '2026-11-02']);
  assert.deepEqual(r.rows, [
    { nik: '10230035', tanggal: '2026-11-01', kode: 'D' },
    { nik: '10230035', tanggal: '2026-11-02', kode: 'N' },
    { nik: '10240031', tanggal: '2026-11-01', kode: 'OFF' },
    { nik: '10240031', tanggal: '2026-11-02', kode: '' },
  ]);
});

test('Excel ID: titik koma, header DD/MM/YYYY, BOM', () => {
  const r = parseRosterCsv('﻿NIK;NAMA;01/11/2026;2/11/2026\r\n1;"A; B";SJ;DL\r\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => x.tanggal + x.kode), ['2026-11-01SJ', '2026-11-02DL']);
});

test('kode & header salah dilaporkan', () => {
  const r = parseRosterCsv('NIK,NAMA,2026-11-01,besok\n1,A,X\n');
  assert.equal(r.errors.length, 2);
  assert.equal(normTanggal('31/02/2026'), null);
});

test('FB = cuti, C tidak dikenal', () => {
  const r = parseRosterCsv('NIK,NAMA,2026-11-01,2026-11-02\n1,A,fb,C\n');
  assert.equal(r.rows[0].kode, 'FB');
  assert.equal(r.errors.length, 1);
});
