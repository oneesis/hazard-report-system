// node --test lib/alur-laporan.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rencanakanAlur } = require('./alur-laporan');

const now = Date.parse('2026-10-12T01:00:00Z');
const hariLalu = (n) => new Date(now - n * 864e5).toISOString();
const aksi = (laporan) => rencanakanAlur(laporan, now, '2026-10-12').map((a) => `${a.id}:${a.aksi}`);

test('A3 rencana > 2 hari disetujui, yang baru tidak', () => {
  assert.deepEqual(aksi([
    { tabel: 'hazard_report', id: 'H1', status: 'OPEN', data: { plan_status: 'pending_review', plan_submitted_at: hariLalu(3), rencana_tindakan: 'x', timestamp: hariLalu(4) } },
    { tabel: 'hazard_report', id: 'H2', status: 'OPEN', data: { plan_status: 'pending_review', plan_submitted_at: hariLalu(1), rencana_tindakan: 'x', timestamp: hariLalu(1) } },
  ]), ['H1:setujuiRencana']);
});

test('A5 closing > 3 hari dikonfirmasi; laporan tahap closing tak dieskalasi', () => {
  assert.deepEqual(aksi([
    { tabel: 'hazard_report', id: 'H3', status: 'FOLLOWUP', data: { closing_status: 'pending_review', closing_submitted_at: hariLalu(4), batas_waktu: '2026-09-01', timestamp: hariLalu(40) } },
    { tabel: 'hazard_report', id: 'H4', status: 'FOLLOWUP', data: { closing_status: 'pending_review', closing_submitted_at: hariLalu(1), batas_waktu: '2026-09-01', timestamp: hariLalu(40) } },
  ]), ['H3:konfirmasiClosing']);
});

test('A4 eskalasi bertingkat, sekali per tingkat, CLOSED & PIC dipersoalkan dilewati', () => {
  assert.deepEqual(aksi([
    { tabel: 'hazard_report', id: 'H5', status: 'OPEN', data: { timestamp: hariLalu(4), batas_waktu: '2026-10-20' } },
    { tabel: 'hazard_report', id: 'H6', status: 'OPEN', data: { timestamp: hariLalu(8), batas_waktu: '2026-10-05' } },
    { tabel: 'hazard_report', id: 'H7', status: 'OPEN', data: { timestamp: hariLalu(8), batas_waktu: '2026-10-05', eskalasi_pic_at: 'x', eskalasi_sect_at: 'x', eskalasi_she_at: 'x' } },
    { tabel: 'hazard_report', id: 'H8', status: 'CLOSED', data: { timestamp: hariLalu(30), batas_waktu: '2026-09-01' } },
    { tabel: 'hazard_report', id: 'H9', status: 'OPEN', data: { timestamp: hariLalu(30), batas_waktu: '2026-09-01', pic_dispute: { status: 'PENDING' } } },
    { tabel: 'hazard_report', id: 'H10', status: 'PROGRESS', data: { timestamp: hariLalu(30), rencana_tindakan: 'x', batas_waktu: '2026-09-01' } },
  ]), ['H5:ingatkanPic', 'H6:ingatkanPic', 'H6:eskalasiSect', 'H6:eskalasiShe', 'H10:eskalasiShe']);
});
