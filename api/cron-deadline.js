// #5 — Cron harian 08:00 WIB: reminder WA ke PIC laporan HR/INS yang belum
// CLOSED dan jatuh tempo dalam ≤ 3 hari (hari ini … H-3).
// [6 Okt 2026] Dulu baca Google Sheets (basi sejak migrasi Neon) DAN mencari
// kolom 'no_whatsapp_pic' — padahal header aslinya salah ketik 'no_whattsapp_pic'
// → reminder praktis tak pernah terkirim. Kini baca Neon + fallback WA dari roster.
// Query uji: ?dry=1 (tak kirim, balas daftar)
const { neon } = require('@neondatabase/serverless');
const https = require('https');

const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
const CRON_SECRET  = process.env.CRON_SECRET;
const WARN_DAYS    = 3; // kirim reminder jika sisa ≤ 3 hari
const APP          = 'https://sap-ebl.vercel.app';

const low = v => String(v ?? '').trim().toLowerCase();

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

// Selisih hari kalender (WIB) dari hari ini ke tanggal jatuh tempo.
function daysUntil(batas, now = Date.now()) {
  const m = String(batas || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  const due = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (isNaN(due)) {
    const d = new Date(batas);
    if (isNaN(d)) return null;
    return daysUntil(d.toISOString().slice(0, 10), now);
  }
  const w = new Date(now + 7 * 3600_000); // hari ini WIB
  const today = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate());
  return Math.round((due - today) / 86_400_000);
}

// Inti (murni): daftar reminder dari laporan open + roster.
function buildReminders(hazard, inspection, karyawan, now = Date.now()) {
  const waByNik = new Map(), waByNama = new Map();
  for (const k of karyawan) {
    const d = k.data || {};
    const wa = String(d['NO WHATSAPP'] || '').replace(/\D/g, '');
    if (!wa) continue;
    if (d.NIK) waByNik.set(String(d.NIK).trim(), wa);
    if (d.NAMA) waByNama.set(low(d.NAMA), wa);
  }
  const out = [];
  const seen = new Set();
  const take = (rows, isIns) => {
    for (const r of rows) {
      const d = r.data || {};
      if (String(r.status_perbaikan || d.status_perbaikan || '').toUpperCase() === 'CLOSED') continue;
      if (d.pic_dispute?.status === 'PENDING') continue; // PIC sedang dipersoalkan — reminder dijeda
      const left = daysUntil(d.batas_waktu, now);
      if (left === null || left < 0 || left > WARN_DAYS) continue;
      const id = String(r.id || d.id || '').trim();
      if (!id || seen.has(id)) continue;
      const wa = String(d.no_whattsapp_pic || d.no_whatsapp_pic || '').replace(/\D/g, '')
        || waByNik.get(String(d.nik_pic || '').trim()) || waByNama.get(low(d.nama_pic)) || '';
      if (!wa) continue;
      seen.add(id);
      const desc = String(isIns ? d.temuan_inspeksi : d.deskripsi_bahaya || '').replace(/^\s*\d+\.\s*/, '').trim();
      out.push({ id, wa, left, isIns, batas: d.batas_waktu,
        namaPic: String(d.nama_pic || 'PIC').trim(), desc,
        lokasi: String(isIns ? d.lokasi : d.lokasi_bahaya || '').trim() });
    }
  };
  take(hazard, false);
  take(inspection, true);
  return out;
}

function buildMessage(r) {
  const tgl = (() => { const d = new Date(String(r.batas).slice(0, 10)); return isNaN(d) ? r.batas
    : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); })();
  const urg = r.left === 0 ? '🚨 *HARI INI*' : r.left === 1 ? '⚠️ *Besok*' : `📅 *${r.left} hari lagi*`;
  const first = (r.namaPic.split(/\s+/)[0] || 'PIC').toLowerCase().replace(/^./, c => c.toUpperCase());
  return `Halo ${first}, pengingat laporan ${r.isIns ? 'Inspeksi' : 'Hazard'} yang kamu tangani sebagai PIC:\n\n`
    + `📋 *${r.id}*\n`
    + (r.desc ? `📝 ${r.desc.slice(0, 140)}\n` : '')
    + (r.lokasi ? `📍 ${r.lokasi}\n` : '')
    + `⏰ Jatuh tempo: ${tgl} (${urg})\n\n`
    + `Segera selesaikan tindakan perbaikan sebelum deadline.\n`
    + `🔗 ${APP}/laporan-detail.html?id=${encodeURIComponent(r.id)}`;
}

module.exports = async (req, res) => {
  // Vercel memanggil cron dengan header Authorization: Bearer <CRON_SECRET>
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' });
  const dry = (req.query || {}).dry === '1';
  // WA Fonnte DINONAKTIFKAN (2026-10-06, akun sering kena banned). Nyalakan lagi: env WA_ENABLED=1 lalu redeploy.
  if (!dry && process.env.WA_ENABLED !== '1') return res.status(200).json({ skipped: 'WA dinonaktifkan (WA_ENABLED != 1)' });
  if (!dry && !FONNTE_TOKEN) return res.status(500).json({ error: 'Env FONNTE_TOKEN belum diset' });

  const sql = neon(process.env.DATABASE_URL);
  const [hazard, inspection, karyawan] = await Promise.all([
    sql`SELECT id, status_perbaikan, data FROM hazard_report WHERE upper(coalesce(status_perbaikan,'')) <> 'CLOSED'`,
    sql`SELECT id, status_perbaikan, data FROM inspection_report WHERE upper(coalesce(status_perbaikan,'')) <> 'CLOSED'`,
    sql`SELECT data FROM karyawan`,
  ]);
  const list = buildReminders(hazard, inspection, karyawan);

  if (dry) return res.json({ status: 'dry', open: hazard.length + inspection.length, akanDikirim: list.length,
    daftar: list.map(r => ({ id: r.id, pic: r.namaPic, sisaHari: r.left, desc: r.desc.slice(0, 50) })) });

  let sent = 0;
  for (const r of list) {
    if (await sendWa(r.wa, buildMessage(r))) sent++;
    await new Promise(t => setTimeout(t, 2500)); // jeda antar pesan
  }
  console.log(`[cron-deadline] open=${hazard.length + inspection.length} target=${list.length} terkirim=${sent}`);
  return res.json({ status: 'ok', sent, target: list.length, checked: hazard.length + inspection.length, ts: new Date().toISOString() });
};

// Self-check (node api/cron-deadline.js)
if (require.main === module) {
  const assert = require('assert');
  const now = Date.UTC(2026, 9, 6, 1); // 6 Okt 2026 08:00 WIB
  assert.strictEqual(daysUntil('2026-10-06', now), 0);
  assert.strictEqual(daysUntil('2026-10-09', now), 3);
  assert.strictEqual(daysUntil('2026-10-05', now), -1);
  const kar = [{ data: { NIK: '7', NAMA: 'BUDI', 'NO WHATSAPP': '0812' } }];
  const hz = [
    { id: 'H1', status_perbaikan: 'OPEN', data: { batas_waktu: '2026-10-07', no_whattsapp_pic: '0811', nama_pic: 'ANDI', deskripsi_bahaya: 'Oli tumpah' } }, // field typo
    { id: 'H2', status_perbaikan: 'OPEN', data: { batas_waktu: '2026-10-08', nama_pic: 'BUDI' } },        // WA dari roster (nama)
    { id: 'H3', status_perbaikan: 'OPEN', data: { batas_waktu: '2026-10-20', no_whattsapp_pic: '0811' } }, // masih jauh
    { id: 'H4', status_perbaikan: 'CLOSED', data: { batas_waktu: '2026-10-07', no_whattsapp_pic: '0811' } },
    { id: 'H5', status_perbaikan: 'OPEN', data: { batas_waktu: '2026-10-07', nama_pic: 'TANPA WA' } },  // tak ada WA → lewati
    { id: 'H6', status_perbaikan: 'OPEN', data: { batas_waktu: '2026-10-07', no_whattsapp_pic: '0811', pic_dispute: { status: 'PENDING' } } }, // PIC dipersoalkan → jeda
  ];
  const ins = [{ id: 'I1', status_perbaikan: 'OPEN', data: { batas_waktu: '2026-10-06', nik_pic: '7', temuan_inspeksi: '15. Guarding lepas', lokasi: 'Workshop' } }];
  const out = buildReminders(hz, ins, kar, now);
  assert.deepStrictEqual(out.map(r => r.id + ':' + r.wa), ['H1:0811', 'H2:0812', 'I1:0812']);
  assert.strictEqual(out[2].desc, 'Guarding lepas'); // nomor butir dibuang
  console.log('cron-deadline self-check OK');
}
