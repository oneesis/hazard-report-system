// Cron harian 08:00 WIB: reminder EMAIL H-3 sebelum akhir bulan ke karyawan
// PT EBL yang capaian SAP-nya belum 100%.
// - Modul: HR (pelapor), INS (pelapor), SBO (observer), PC (coach) — ST tidak.
//   Definisi sama dgn capaian-sap.js & SISTER MINER lib/sap-capaian.ts.
// - Kriteria PER MODUL: dikirim bila ada modul < target; email hanya berisi
//   modul yang belum tercapai (bukan gabungan — HR berlebih tak menutupi SBO 0).
// - Dilewati: bukan EBL, target 0 (magang), ROLE DELETED, tanpa email.
// Query (manual/uji): ?dry=1 (tak kirim, balas daftar) ?force=1 (abaikan H-3)
//                     ?bulan=YYYY-MM ?only=<NIK> (kirim ke 1 orang saja)
const { neon } = require('@neondatabase/serverless');

const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL     = 'https://sap-ebl.vercel.app/index-home.html';
const REMIND_DAYS = 3;
const MONTHS_ID   = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const MODULES     = [
  { key: 'HR',  label: 'Hazard Report',              obj: 'OBJ HR'  },
  { key: 'INS', label: 'Inspeksi',                   obj: 'OBJ INS' },
  { key: 'SBO', label: 'Safe Behavior Observation',  obj: 'OBJ SBO' },
  { key: 'PC',  label: 'Personal Contact',           obj: 'OBJ PC'  },
];

const num = v => parseInt(String(v ?? '0'), 10) || 0;
const low = v => String(v ?? '').trim().toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Tanggal "hari ini" versi WIB (UTC+7) → {y, m(0-11), d}
function todayWIB(now = Date.now()) {
  const t = new Date(now + 7 * 3600_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}
// Sisa hari ke akhir bulan (hari terakhir = 0).
function daysToMonthEnd({ y, m, d }) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate() - d;
}
function inMonth(val, bulan) {
  const dt = new Date(String(val || ''));
  if (isNaN(dt)) return false;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` === bulan;
}

// Inti (murni, mudah diuji): daftar karyawan EBL dgn modul yang belum tercapai.
function computeUnmet(kar, hz, ins, sbo, pc, bulan) {
  const people = new Map();      // nik → { nama, email, target:{}, got:{} }
  const nameToNik = new Map();
  for (const row of kar) {
    const d = row.data || {};
    const nik = String(d.NIK ?? '').trim();
    if (!nik || !/EBL/i.test(String(d.PERUSAHAAN ?? ''))) continue;
    if (String(d.ROLE ?? '').toUpperCase() === 'DELETED') continue;
    const target = {}; let total = 0;
    for (const m of MODULES) { target[m.key] = num(d[m.obj]); total += target[m.key]; }
    if (total <= 0) continue; // magang / tanpa kewajiban SAP
    people.set(nik, { nik, nama: String(d.NAMA ?? '').trim(), email: String(row.email || d.EMAIL || '').trim(),
      target, got: { HR: 0, INS: 0, SBO: 0, PC: 0 } });
    if (low(d.NAMA)) nameToNik.set(low(d.NAMA), nik);
  }
  const resolve = (nik, nama) => String(nik ?? '').trim() || nameToNik.get(low(nama)) || '';
  const bump = (nik, key) => { const p = people.get(nik); if (p) p.got[key]++; };

  for (const r of hz) { const d = r.data || {};
    if (inMonth(d.timestamp || d.tanggal_laporan || d.tgl_laporan, bulan)) bump(resolve(d.nik || d.nik_pelapor, d.nama || d.pelapor), 'HR'); }
  for (const r of ins) { const d = r.data || {};
    if (inMonth(d.timestamp || d.tanggal_inspeksi || d.tanggal_laporan, bulan)) bump(resolve(d.nik || d.nik_pelapor, d.nama || d.pelapor), 'INS'); }
  for (const r of sbo) if (inMonth(r.timestamp, bulan)) bump(resolve(r.nik_observer, r.nama_observer), 'SBO');
  for (const r of pc)  if (inMonth(r.timestamp || r.tgl_pc, bulan)) bump(resolve(r.nik_coach, r.nama_coach), 'PC');

  const out = [];
  for (const p of people.values()) {
    const unmet = MODULES.filter(m => p.target[m.key] > 0 && p.got[m.key] < p.target[m.key])
      .map(m => ({ label: m.label, got: p.got[m.key], target: p.target[m.key] }));
    if (unmet.length) out.push({ ...p, unmet });
  }
  return out;
}

function buildEmail(p, bulanNama, deadlineStr) {
  const first = (p.nama.split(/\s+/)[0] || '').toLowerCase().replace(/^./, c => c.toUpperCase());
  const rows = p.unmet.map(u => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7">${esc(u.label)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center">${u.got} / ${u.target}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center;color:#b91c1c;font-weight:700">kurang ${u.target - u.got}</td>
    </tr>`).join('');
  const text = `Halo ${first},\n\nCapaian SAP kamu bulan ${bulanNama} belum 100% dan tersisa ${REMIND_DAYS} hari (s/d ${deadlineStr}).\n\n`
    + p.unmet.map(u => `- ${u.label}: ${u.got}/${u.target} (kurang ${u.target - u.got})`).join('\n')
    + `\n\nYuk lengkapi sebelum akhir bulan: ${APP_URL}\n\nEmail otomatis ONE-SAP — tidak perlu dibalas.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1e293b">
    <h2 style="color:#00205B;margin:0 0 4px">ONE-SAP</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:13px">Pengingat Capaian SAP</p>
    <p>Halo ${esc(first)},</p>
    <p>Capaian SAP kamu bulan <b>${esc(bulanNama)}</b> belum 100%. Tersisa <b>${REMIND_DAYS} hari</b> (s/d ${esc(deadlineStr)}).</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
      <tr style="background:#f8fafc;color:#64748b;font-size:12px">
        <th style="padding:8px 10px;text-align:left">Modul</th><th style="padding:8px 10px">Capaian</th><th style="padding:8px 10px">Sisa</th>
      </tr>${rows}
    </table>
    <p style="margin:20px 0"><a href="${APP_URL}" style="background:#00205B;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;display:inline-block">Lengkapi di ONE-SAP</a></p>
    <p style="color:#94a3b8;font-size:12px">Email otomatis ONE-SAP — tidak perlu dibalas.</p>
  </div>`;
  return { subject: `Capaian SAP ${bulanNama} kamu belum 100% — sisa ${REMIND_DAYS} hari`, text, html };
}

module.exports = async (req, res) => {
  // Vercel memanggil cron dengan header Authorization: Bearer <CRON_SECRET>
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query || {};
  const dry = q.dry === '1', force = q.force === '1', only = String(q.only || '').trim();
  const today = todayWIB();
  const left = daysToMonthEnd(today);
  if (!force && left !== REMIND_DAYS)
    return res.json({ status: 'skip', reason: `bukan H-${REMIND_DAYS} (sisa ${left} hari)` });

  const bulan = /^\d{4}-\d{2}$/.test(q.bulan || '') ? q.bulan
    : `${today.y}-${String(today.m + 1).padStart(2, '0')}`;
  const [by, bm] = bulan.split('-').map(Number);
  const bulanNama = `${MONTHS_ID[bm - 1]} ${by}`;
  const deadlineStr = `${new Date(Date.UTC(by, bm, 0)).getUTCDate()} ${bulanNama}`;

  const sql = neon(process.env.DATABASE_URL);
  const [kar, hz, ins, sbo, pc] = await Promise.all([
    sql`SELECT email, data FROM karyawan`,
    sql`SELECT data FROM hazard_report`,
    sql`SELECT data FROM inspection_report`,
    sql`SELECT nik_observer, nama_observer, timestamp FROM sbo_report`,
    sql`SELECT nik_coach, nama_coach, timestamp, tgl_pc FROM pc_report`,
  ]);

  let list = computeUnmet(kar, hz, ins, sbo, pc, bulan);
  if (only) list = list.filter(p => p.nik === only);
  const withEmail = list.filter(p => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email));
  const noEmail = list.length - withEmail.length;

  if (dry) return res.json({ status: 'dry', bulan, belum100: list.length, akanDikirim: withEmail.length, tanpaEmail: noEmail,
    daftar: withEmail.map(p => ({ nik: p.nik, nama: p.nama, unmet: p.unmet.map(u => `${u.label} ${u.got}/${u.target}`).join(', ') })) });

  const user = process.env.GMAIL_SENDER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return res.status(503).json({ error: 'GMAIL_SENDER/GMAIL_APP_PASSWORD belum diset' });
  const t = require('nodemailer').createTransport({ service: 'gmail', pool: true, auth: { user, pass } });

  let sent = 0; const failed = [];
  for (const p of withEmail) {
    const m = buildEmail(p, bulanNama, deadlineStr);
    try { await t.sendMail({ from: `ONE-SAP <${user}>`, to: p.email, ...m }); sent++; }
    catch (e) { failed.push({ nik: p.nik, error: e.message }); }
  }
  t.close();
  console.log(`[cron-sap-reminder] ${bulan}: belum100=${list.length} terkirim=${sent} gagal=${failed.length} tanpaEmail=${noEmail}`);
  res.json({ status: 'ok', bulan, belum100: list.length, terkirim: sent, gagal: failed, tanpaEmail: noEmail });
};

// Self-check logika (jalankan: node api/cron-sap-reminder.js)
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(daysToMonthEnd({ y: 2026, m: 9, d: 28 }), 3);  // 28 Okt → H-3
  assert.strictEqual(daysToMonthEnd({ y: 2026, m: 1, d: 25 }), 3);  // 25 Feb 2026 (28 hr) → H-3
  const kar = [
    { email: 'a@x.com', data: { NIK: '1', NAMA: 'ANDI', PERUSAHAAN: 'PT EBL', 'OBJ HR': 2, 'OBJ INS': 0, 'OBJ SBO': 1, 'OBJ PC': 0 } },
    { email: 'b@x.com', data: { NIK: '2', NAMA: 'BUDI', PERUSAHAAN: 'PT EBL', 'OBJ HR': 1 } },
    { email: 'c@x.com', data: { NIK: '3', NAMA: 'CICI', PERUSAHAAN: 'PT LAIN', 'OBJ HR': 4 } },   // bukan EBL
    { email: 'd@x.com', data: { NIK: '4', NAMA: 'DODI', PERUSAHAAN: 'PT EBL' } },               // magang (target 0)
  ];
  const hz = [{ data: { nik: '1', timestamp: '2026-10-05' } }, { data: { nik: '1', timestamp: '2026-10-06' } },
              { data: { nik: '1', timestamp: '2026-10-07' } },                                  // HR berlebih 3/2
              { data: { nama: 'BUDI', timestamp: '2026-10-02' } },                               // via nama
              { data: { nik: '2', timestamp: '2026-09-30' } }];                                  // bulan lain
  const out = computeUnmet(kar, hz, [], [], [], '2026-10');
  assert.deepStrictEqual(out.map(p => p.nik), ['1']);                       // BUDI 1/1 tercapai; CICI & DODI dilewati
  assert.deepStrictEqual(out[0].unmet, [{ label: 'Safe Behavior Observation', got: 0, target: 1 }]); // HR berlebih tak menutupi SBO
  console.log('cron-sap-reminder self-check OK');
}
