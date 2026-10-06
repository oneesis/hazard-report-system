// #5 — Cron harian 08:00 WIB: reminder WA ke PIC laporan HR/INS yang belum
// CLOSED dan jatuh tempo dalam ≤ 3 hari (hari ini … H-3).
// [6 Okt 2026] Dulu baca Google Sheets (basi sejak migrasi Neon) DAN mencari
// kolom 'no_whatsapp_pic' — padahal header aslinya salah ketik 'no_whattsapp_pic'
// → reminder praktis tak pernah terkirim. Kini baca Neon + fallback WA dari roster.
// Query uji: ?dry=1 (tak kirim, balas daftar)
// [6 Okt 2026] WA Fonnte dinonaktifkan → reminder dikirim lewat EMAIL ke PIC
// (email dicari via NIK / nama / nomor WA di roster). WA_ENABLED=1 → kembali WA.
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
const normWa = v => String(v ?? '').replace(/\D/g, '').replace(/^62/, '0');

function buildReminders(hazard, inspection, karyawan, now = Date.now()) {
  const waByNik = new Map(), waByNama = new Map();
  const emByNik = new Map(), emByNama = new Map(), emByWa = new Map();
  for (const k of karyawan) {
    const d = k.data || {};
    const wa = String(d['NO WHATSAPP'] || '').replace(/\D/g, '');
    const em = String(d.EMAIL || '').trim();
    if (wa && d.NIK) waByNik.set(String(d.NIK).trim(), wa);
    if (wa && d.NAMA) waByNama.set(low(d.NAMA), wa);
    if (em && d.NIK) emByNik.set(String(d.NIK).trim(), em);
    if (em && d.NAMA) emByNama.set(low(d.NAMA), em);
    if (em && wa) emByWa.set(normWa(wa), em);
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
      const email = emByNik.get(String(d.nik_pic || '').trim()) || emByNama.get(low(d.nama_pic))
        || (wa && emByWa.get(normWa(wa))) || '';
      if (!wa && !email) continue;
      seen.add(id);
      const desc = String(isIns ? d.temuan_inspeksi : d.deskripsi_bahaya || '').replace(/^\s*\d+\.\s*/, '').trim();
      out.push({ id, wa, email, left, isIns, batas: d.batas_waktu,
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
  // WA Fonnte DINONAKTIFKAN (2026-10-06, akun sering kena banned) → kirim EMAIL.
  // Nyalakan WA lagi: env WA_ENABLED=1 lalu redeploy.
  const viaWa = process.env.WA_ENABLED === '1';
  if (!dry && viaWa && !FONNTE_TOKEN) return res.status(500).json({ error: 'Env FONNTE_TOKEN belum diset' });
  if (!dry && !viaWa && !(process.env.GMAIL_SENDER && process.env.GMAIL_APP_PASSWORD))
    return res.status(500).json({ error: 'Env GMAIL_SENDER/GMAIL_APP_PASSWORD belum diset' });

  const sql = neon(process.env.DATABASE_URL);
  const [hazard, inspection, karyawan] = await Promise.all([
    sql`SELECT id, status_perbaikan, data FROM hazard_report WHERE upper(coalesce(status_perbaikan,'')) <> 'CLOSED'`,
    sql`SELECT id, status_perbaikan, data FROM inspection_report WHERE upper(coalesce(status_perbaikan,'')) <> 'CLOSED'`,
    sql`SELECT data FROM karyawan`,
  ]);
  const list = buildReminders(hazard, inspection, karyawan);

  const targets = list.filter(r => (viaWa ? r.wa : r.email));
  if (dry) return res.json({ status: 'dry', kanal: viaWa ? 'WA' : 'EMAIL', open: hazard.length + inspection.length,
    akanDikirim: targets.length, tanpaKontak: list.length - targets.length,
    daftar: list.map(r => ({ id: r.id, pic: r.namaPic, sisaHari: r.left, email: r.email ? 'ada' : '-', desc: r.desc.slice(0, 50) })) });

  let sent = 0;
  const mailer = viaWa ? null : require('nodemailer').createTransport({ service: 'gmail',
    auth: { user: process.env.GMAIL_SENDER, pass: process.env.GMAIL_APP_PASSWORD } });
  for (const r of targets) {
    if (viaWa) {
      if (await sendWa(r.wa, buildMessage(r))) sent++;
      await new Promise(t => setTimeout(t, 2500)); // jeda antar pesan
    } else {
      const url = `${APP}/laporan-detail.html?id=${encodeURIComponent(r.id)}`;
      const text = buildMessage(r).replace(/\*/g, '');
      try {
        await mailer.sendMail({ from: `ONE-SAP <${process.env.GMAIL_SENDER}>`, to: r.email,
          subject: `[ONE-SAP] Pengingat batas waktu ${r.id} (${r.left === 0 ? 'hari ini' : r.left + ' hari lagi'})`,
          text, html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2 style="color:#00205B;margin:0 0 12px">ONE-SAP</h2>
            <div style="white-space:pre-line;font-size:14px;line-height:1.55;color:#0f172a">${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>
            <p style="margin:20px 0"><a href="${url}" style="background:#00205B;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Buka Laporan</a></p></div>` });
        sent++;
      } catch (e) { console.error('[cron-deadline] email gagal', r.id, e.message); }
    }
  }
  console.log(`[cron-deadline] open=${hazard.length + inspection.length} target=${list.length} terkirim=${sent}`);
  return res.json({ status: 'ok', kanal: viaWa ? 'WA' : 'EMAIL', sent, target: targets.length, tanpaKontak: list.length - targets.length, checked: hazard.length + inspection.length, ts: new Date().toISOString() });
};

// Self-check (node api/cron-deadline.js)
if (require.main === module) {
  const assert = require('assert');
  const now = Date.UTC(2026, 9, 6, 1); // 6 Okt 2026 08:00 WIB
  assert.strictEqual(daysUntil('2026-10-06', now), 0);
  assert.strictEqual(daysUntil('2026-10-09', now), 3);
  assert.strictEqual(daysUntil('2026-10-05', now), -1);
  const kar = [{ data: { NIK: '7', NAMA: 'BUDI', 'NO WHATSAPP': '0812', EMAIL: 'budi@x.id' } }];
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
  assert.deepStrictEqual(out.map(r => r.email), ['', 'budi@x.id', 'budi@x.id']); // email via nama / NIK
  const onlyEmail = buildReminders([{ id: 'H7', status_perbaikan: 'OPEN', data: { batas_waktu: '2026-10-07', nama_pic: 'BUDI X' } }],
    [], [{ data: { NAMA: 'BUDI X', EMAIL: 'bx@x.id' } }], now);
  assert.strictEqual(onlyEmail[0]?.email, 'bx@x.id'); // tanpa WA tapi punya email → tetap diingatkan
  console.log('cron-deadline self-check OK');
}
