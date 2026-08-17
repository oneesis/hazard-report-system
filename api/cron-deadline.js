// #5 — Cron harian: reminder WA ke PIC laporan yang mendekati deadline
// Dijadwalkan setiap hari 08:00 WIB (01:00 UTC) via vercel.json
const { google } = require('googleapis');
const https = require('https');

const SPREADSHEET_ID    = process.env.SPREADSHEET_ID;
const FONNTE_TOKEN      = process.env.FONNTE_TOKEN;
const CRON_SECRET       = process.env.CRON_SECRET;
const INSPECTION_SHEETS = ['INS_CB','INS_JA','INS_MD','INS_KG','INS_SP','INS_T','INS_TB','INS_WS'];
const WARN_DAYS         = 3;   // kirim reminder jika sisa ≤ 3 hari
const DAY_MS            = 86_400_000;

async function getRows(sheets, sheetName) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
    const rows = res.data.values || [];
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => String(h).trim());
    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });
  } catch { return []; }
}

function sendWa(target, message) {
  return new Promise(resolve => {
    const phone   = String(target).replace(/\D/g, '').replace(/^0/, '62');
    const payload = new URLSearchParams({ target: phone, message, delay: '3', countryCode: '62' }).toString();
    const req = https.request({
      hostname: 'api.fonnte.com', path: '/send', method: 'POST',
      headers: { Authorization: FONNTE_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body).status === true); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.write(payload); req.end();
  });
}

module.exports = async (req, res) => {
  // Vercel memanggil cron dengan header Authorization: Bearer <CRON_SECRET>
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' });

  if (!SPREADSHEET_ID || !FONNTE_TOKEN)
    return res.status(500).json({ error: 'Env belum lengkap (SPREADSHEET_ID / FONNTE_TOKEN)' });

  const creds  = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth   = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const now = Date.now();

  // Kumpulkan semua laporan yang masih open
  const hazard = await getRows(sheets, 'Hazard_Report');
  const insAll = [];
  for (const s of INSPECTION_SHEETS) insAll.push(...await getRows(sheets, s));
  const allOpen = [...hazard, ...insAll].filter(r => {
    const status = String(r['STATUS_PERBAIKAN'] || r['status_perbaikan'] || '').toUpperCase();
    return status !== 'CLOSED';
  });

  let sent = 0;
  const notified = new Set(); // cegah duplikat notif per ID dalam satu run

  for (const report of allOpen) {
    const batas = report['BATAS WAKTU'] || report['BATAS_WAKTU'] || report['batas_waktu'] || '';
    if (!batas) continue;
    const due = new Date(batas);
    if (isNaN(due)) continue;
    const daysLeft = Math.ceil((due.getTime() - now) / DAY_MS);
    if (daysLeft < 0 || daysLeft > WARN_DAYS) continue; // sudah lewat atau masih jauh

    const id = String(report['ID'] || report['id'] || report['NOMOR_HAZARD'] || '').trim();
    if (!id || notified.has(id)) continue;
    notified.add(id);

    const noWa    = report['NO WHATSAPP PIC'] || report['NO_WHATSAPP_PIC'] || report['no_whatsapp_pic'] || '';
    const namaPic = report['NAMA PIC'] || report['NAMA_PIC'] || report['nama_pic'] || 'PIC';
    if (!noWa) continue;

    const urgLabel = daysLeft === 0 ? '🚨 *HARI INI!*' : daysLeft === 1 ? '⚠️ *Besok*' : `📅 *${daysLeft} hari lagi*`;
    const msg =
      `Halo ${namaPic}, ini pengingat laporan SAP yang kamu tangani:\n\n` +
      `📋 ID: *${id}*\n` +
      `⏰ Jatuh tempo: ${batas} (${urgLabel})\n\n` +
      `Segera selesaikan tindakan perbaikan sebelum deadline.\n` +
      `🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${encodeURIComponent(id)}`;

    await sendWa(noWa, msg);
    await new Promise(r => setTimeout(r, 2500)); // jeda antar pesan
    sent++;
  }

  return res.json({ status: 'ok', sent, checked: allOpen.length, ts: new Date().toISOString() });
};
