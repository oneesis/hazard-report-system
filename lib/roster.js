// Roster harian karyawan (2026-10-12) — referensi keterangan kehadiran saat absensi
// manual Safety Talk. Format CSV per bulan: NIK,NAMA,<tanggal>,<tanggal>,... dengan kode
// per sel. Pemisah koma atau titik koma (Excel ID); header tanggal YYYY-MM-DD atau
// DD/MM/YYYY (Excel suka mengubah format tanggal).

const KODE = {
  D: { status: 'HADIR', label: 'Shift Pagi' },
  N: { status: 'SHIFT_MALAM', label: 'Shift Malam' },
  OFF: { status: 'LIBUR', label: 'Off' },
  DL: { status: 'DINAS_LUAR', label: 'Dinas Luar' },
  SJ: { status: 'SECURITY_JAGA', label: 'Security Jaga' },
  FB: { status: 'CUTI', label: 'Cuti (FB)' },
};

function normTanggal(h) {
  const s = String(h || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return pad(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return pad(m[3], m[2], m[1]);
  return null;
}
function pad(y, mo, d) {
  const t = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(t + 'T00:00:00Z');
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === t ? t : null;
}

// Satu baris CSV → sel (dukung tanda kutip sederhana).
function sel(line, sep) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** → { rows: [{nik, tanggal, kode}], tanggal: [...], errors: [...] }. Sel kosong → kode ''
 * (artinya hapus/tak ada data untuk tanggal itu). */
function parseRosterCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const errors = [];
  if (lines.length < 2) return { rows: [], tanggal: [], errors: ['File kosong atau hanya berisi header.'] };
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const head = sel(lines[0], sep);
  if (String(head[0]).toUpperCase() !== 'NIK') errors.push('Kolom pertama harus NIK.');
  const kolTgl = [];
  head.forEach((h, i) => {
    if (i < 2) return;
    const t = normTanggal(h);
    if (t) kolTgl.push([i, t]);
    else if (h) errors.push(`Header kolom ${i + 1} ("${h}") bukan tanggal (pakai 2026-11-01 atau 01/11/2026).`);
  });
  if (!kolTgl.length) errors.push('Tidak ada kolom tanggal di header.');
  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const c = sel(lines[r], sep);
    const nik = String(c[0] || '').trim();
    if (!nik) continue;
    for (const [i, tanggal] of kolTgl) {
      const kode = String(c[i] || '').trim().toUpperCase();
      if (kode && !KODE[kode]) { errors.push(`Baris ${r + 1} (${nik}) tanggal ${tanggal}: kode "${c[i]}" tidak dikenal.`); continue; }
      rows.push({ nik, tanggal, kode });
    }
  }
  return { rows, tanggal: kolTgl.map(([, t]) => t), errors: errors.slice(0, 20) };
}

module.exports = { KODE, parseRosterCsv, normTanggal };
