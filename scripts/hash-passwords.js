/**
 * SCRIPT MIGRASI SATU KALI — Hash semua password plaintext di Master_Karyawan.
 *
 * Cara pakai (jalankan di laptop, BUKAN di Vercel):
 *   1. npm install
 *   2. set env var:
 *      export SPREADSHEET_ID="..."
 *      export GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
 *   3. node scripts/hash-passwords.js          (dry-run: hanya menampilkan rencana)
 *   4. node scripts/hash-passwords.js --apply  (benar-benar menulis ke sheet)
 *
 * Aman dijalankan ulang: password yang sudah berbentuk hash bcrypt ($2a/$2b/$2y) dilewati.
 * PENTING: deploy dulu api/index.js versi baru SEBELUM menjalankan script ini,
 * karena versi lama membandingkan plaintext dan semua user akan terkunci.
 */
const { google } = require('googleapis');
const bcrypt = require('bcryptjs');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const APPLY = process.argv.includes('--apply');

function colIndexToLetter(index) {
  let col = '', n = index + 1;
  while (n > 0) { const rem = (n - 1) % 26; col = String.fromCharCode(65 + rem) + col; n = Math.floor((n - 1) / 26); }
  return col;
}

async function main() {
  if (!SPREADSHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error('Set dulu env var SPREADSHEET_ID dan GOOGLE_SERVICE_ACCOUNT_JSON.');
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Master_Karyawan' });
  const rows = res.data.values || [];
  if (rows.length < 2) { console.log('Sheet kosong.'); return; }

  const headers = rows[0].map(h => String(h).trim().toUpperCase());
  const pwCol = headers.indexOf('PASSWORD');
  const nikCol = headers.indexOf('NIK');
  if (pwCol === -1) { console.error('Kolom PASSWORD tidak ditemukan.'); process.exit(1); }

  const updates = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const pw = String(rows[i][pwCol] || '').trim();
    if (!pw) { skipped++; continue; }
    if (/^\$2[aby]\$/.test(pw)) { skipped++; continue; } // sudah di-hash
    const hash = bcrypt.hashSync(pw, 10);
    updates.push({
      range: `Master_Karyawan!${colIndexToLetter(pwCol)}${i + 1}`,
      values: [[hash]],
      nik: nikCol !== -1 ? rows[i][nikCol] : `baris ${i + 1}`
    });
  }

  console.log(`Total baris data : ${rows.length - 1}`);
  console.log(`Akan di-hash     : ${updates.length}`);
  console.log(`Dilewati         : ${skipped} (kosong / sudah hash)`);

  if (!updates.length) { console.log('Tidak ada yang perlu diubah. Selesai.'); return; }

  if (!APPLY) {
    updates.forEach(u => console.log(`  [dry-run] NIK ${u.nik} -> ${u.range}`));
    console.log('\nJalankan dengan --apply untuk menulis ke sheet.');
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data: updates.map(({ range, values }) => ({ range, values })) }
  });
  console.log(`\nBerhasil: ${updates.length} password di-hash. Password asli TIDAK bisa dikembalikan.`);
  console.log('Simpan daftar password awal di tempat aman jika perlu reset manual.');
}

main().catch(err => { console.error('Gagal:', err.message); process.exit(1); });
