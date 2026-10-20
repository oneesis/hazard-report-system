// Cron harian 08:00 WIB: reminder EMAIL H-3 sebelum akhir bulan ke karyawan
// PT EBL yang capaian SAP-nya belum 100%.
// - Modul: HR (pelapor), INS (pelapor), SBO (observer), PC (coach).
// - Kuis pengganti Safety Talk (2026-10-11): peserta wajib-kuis (Cuti/Dinas/
//   Shift Malam/Libur/Jaga) yang belum lulus kuis bulan ini, kuisnya sudah terbit
//   di quiz-she, dan tidak sedang cuti → ikut di email yang sama (semua perusahaan).
//   Definisi sama dgn capaian-sap.js & SISTER MINER lib/sap-capaian.ts.
// - Kriteria PER MODUL: dikirim bila ada modul < target; email hanya berisi
//   modul yang belum tercapai (bukan gabungan — HR berlebih tak menutupi SBO 0).
// - Dilewati: bukan EBL, target 0 (magang), ROLE DELETED, tanpa email.
// Query (manual/uji): ?dry=1 (tak kirim, balas daftar) ?force=1 (abaikan H-3)
//                     ?bulan=YYYY-MM ?only=<NIK> (kirim ke 1 orang saja)
const { neon } = require('@neondatabase/serverless');
const { targetBulan } = require('../lib/target-mulai');

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
    for (const m of MODULES) { target[m.key] = targetBulan(num(d[m.obj]), d['TGL MULAI KERJA'], bulan); total += target[m.key]; }
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

const ST_WAJIB_KUIS = ['CUTI', 'DINAS_LUAR', 'SHIFT_MALAM', 'LIBUR', 'SECURITY_JAGA'];
const ST_LABEL = { CUTI: 'Cuti', DINAS_LUAR: 'Dinas luar', SHIFT_MALAM: 'Shift malam', LIBUR: 'Libur', SECURITY_JAGA: 'Jaga' };
const QUIZ_URL = 'https://quiz-she.vercel.app';

// Murni: kuis pengganti ST yang belum dikerjakan per NIK (kuis sudah terbit, tidak sedang cuti).
function computeKuis(absRows, terbit, sedangCuti) {
  const out = new Map();
  for (const r of absRows) {
    const nik = String(r.nik ?? '').trim();
    if (!nik || sedangCuti.has(nik) || !terbit.has(String(r.schedule_id).trim())) continue;
    if (!ST_WAJIB_KUIS.includes(String(r.status_kehadiran).toUpperCase())) continue;
    if (String(r.quiz_done ?? '').toUpperCase() === 'YA') continue;
    if (!out.has(nik)) out.set(nik, []);
    out.get(nik).push({ judul: r.judul_materi || 'Safety Talk', tanggal: r.tanggal || '', status: ST_LABEL[String(r.status_kehadiran).toUpperCase()] || '' });
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
  const kuis = p.kuis || [];
  const quizLink = `${QUIZ_URL}/?nik=${encodeURIComponent(p.nik)}`;
  const tglPendek = t => { const d = new Date(String(t) + 'T00:00:00'); return isNaN(d) ? String(t || '') : `${d.getDate()} ${MONTHS_ID[d.getMonth()].slice(0, 3)}`; };
  const text = `Halo ${first},\n\n`
    + (p.unmet.length ? `Capaian SAP kamu bulan ${bulanNama} belum 100% dan tersisa ${REMIND_DAYS} hari (s/d ${deadlineStr}).\n\n`
      + p.unmet.map(u => `- ${u.label}: ${u.got}/${u.target} (kurang ${u.target - u.got})`).join('\n') + '\n\n' : '')
    + (kuis.length ? `Kuis pengganti Safety Talk yang belum kamu kerjakan (batas ${deadlineStr}):\n`
      + kuis.map(k => `- ${k.judul} (${tglPendek(k.tanggal)}, ${k.status})`).join('\n') + `\nKerjakan: ${quizLink}\n\n` : '')
    + `Lengkapi sebelum akhir bulan: ${APP_URL}\n\nEmail otomatis ONE-SAP — tidak perlu dibalas.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1e293b">
    <h2 style="color:#00205B;margin:0 0 4px">ONE-SAP</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:13px">Pengingat Capaian SAP</p>
    <p>Halo ${esc(first)},</p>
    ${p.unmet.length ? `<p>Capaian SAP kamu bulan <b>${esc(bulanNama)}</b> belum 100%. Tersisa <b>${REMIND_DAYS} hari</b> (s/d ${esc(deadlineStr)}).</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
      <tr style="background:#f8fafc;color:#64748b;font-size:12px">
        <th style="padding:8px 10px;text-align:left">Modul</th><th style="padding:8px 10px">Capaian</th><th style="padding:8px 10px">Sisa</th>
      </tr>${rows}
    </table>
    <p style="margin:20px 0"><a href="${APP_URL}" style="background:#00205B;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;display:inline-block">Lengkapi di ONE-SAP</a></p>` : ''}
    ${kuis.length ? `<p style="margin-top:${p.unmet.length ? 24 : 0}px">Kuis pengganti <b>Safety Talk</b> yang belum kamu kerjakan — batas <b>${esc(deadlineStr)}</b>:</p>
    <ul style="padding-left:20px;margin:8px 0 16px;font-size:14px">${kuis.map(k => `<li style="margin:4px 0">${esc(k.judul)} <span style="color:#64748b">(${esc(tglPendek(k.tanggal))}, ${esc(k.status)})</span></li>`).join('')}</ul>
    <p style="margin:16px 0 20px"><a href="${quizLink}" style="background:#6366f1;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;display:inline-block">Kerjakan Kuis Sekarang</a></p>` : ''}
    <p style="color:#94a3b8;font-size:12px">Email otomatis ONE-SAP — tidak perlu dibalas.</p>
  </div>`;
  const subject = p.unmet.length
    ? `Capaian SAP ${bulanNama} kamu belum 100% — sisa ${REMIND_DAYS} hari`
    : `Kuis pengganti Safety Talk belum dikerjakan — sisa ${REMIND_DAYS} hari`;
  return { subject, text, html };
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

  const sql = neon(process.env.DATABASE_URL_INTI || process.env.DATABASE_URL);
  const [kar, hz, ins, sbo, pc] = await Promise.all([
    sql`SELECT email, data FROM karyawan`,
    sql`SELECT data FROM hazard_report`,
    sql`SELECT data FROM inspection_report`,
    sql`SELECT nik_observer, nama_observer, timestamp FROM sbo_report`,
    sql`SELECT nik_coach, nama_coach, timestamp, tgl_pc FROM pc_report`,
  ]);

  let list = computeUnmet(kar, hz, ins, sbo, pc, bulan);

  // Kuis pengganti Safety Talk (best-effort: quiz-she/SISTER MINER tak terjangkau → bagian kuis dilewati)
  try {
    const todayStr = `${today.y}-${String(today.m + 1).padStart(2, '0')}-${String(today.d).padStart(2, '0')}`;
    const [absRows, cutiRows, sesJ] = await Promise.all([
      sql`SELECT a.schedule_id, a.nik, a.status_kehadiran, a.quiz_done, s.judul_materi, s.tanggal
           FROM safety_talk_absensi a JOIN safety_talk_schedule s ON s.id = a.schedule_id
           WHERE a.bulan = ${bulan} AND a.status_kehadiran = ANY(${ST_WAJIB_KUIS})`,
      sql`SELECT data->>'nrp' AS nrp FROM sm."Karyawan"
           WHERE coalesce(data->>'cutiMulai', '') <> '' AND data->>'cutiMulai' <= ${todayStr} AND data->>'cutiSelesai' >= ${todayStr}`.catch(() => []),
      fetch(`${QUIZ_URL}/api/data?action=sessions`).then(r => r.json()),
    ]);
    const sesi = Array.isArray(sesJ) ? sesJ : (sesJ.value || sesJ.sessions || []);
    const terbit = new Set(sesi.filter(x => x.status === 'published').map(x => String(x.topicCode || '').trim()).filter(Boolean));
    const kuisMap = computeKuis(absRows, terbit, new Set(cutiRows.map(r => String(r.nrp || '').trim())));
    const byNik = new Map(list.map(p => [p.nik, p]));
    for (const [nik, kuis] of kuisMap) {
      if (byNik.has(nik)) { byNik.get(nik).kuis = kuis; continue; }
      const k = kar.find(r => String(r.data?.NIK ?? '').trim() === nik);
      if (!k || String(k.data?.ROLE ?? '').toUpperCase() === 'DELETED') continue;
      list.push({ nik, nama: String(k.data?.NAMA ?? '').trim(), email: String(k.email || k.data?.EMAIL || '').trim(), unmet: [], kuis });
    }
  } catch (e) { console.error('[cron-sap-reminder] kuis ST dilewati:', e.message); }
  if (only) list = list.filter(p => p.nik === only);
  const withEmail = list.filter(p => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email));
  const noEmail = list.length - withEmail.length;

  if (dry) return res.json({ status: 'dry', bulan, belum100: list.length, akanDikirim: withEmail.length, tanpaEmail: noEmail,
    daftar: withEmail.map(p => ({ nik: p.nik, nama: p.nama, unmet: p.unmet.map(u => `${u.label} ${u.got}/${u.target}`).join(', '),
      kuis: (p.kuis || []).map(k => k.judul).join(', ') })) });

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
  const abs = [
    { schedule_id: 'ST-1', nik: '1', status_kehadiran: 'CUTI', quiz_done: '', judul_materi: 'APD', tanggal: '2026-10-07' },
    { schedule_id: 'ST-1', nik: '2', status_kehadiran: 'LIBUR', quiz_done: 'YA', judul_materi: 'APD' },     // sudah lulus
    { schedule_id: 'ST-2', nik: '3', status_kehadiran: 'DINAS_LUAR', quiz_done: '', judul_materi: 'LOTO' },  // kuis belum terbit
    { schedule_id: 'ST-1', nik: '4', status_kehadiran: 'SHIFT_MALAM', quiz_done: '', judul_materi: 'APD' },  // sedang cuti
    { schedule_id: 'ST-1', nik: '5', status_kehadiran: 'MANGKIR', quiz_done: '', judul_materi: 'APD' },      // mangkir: tak bisa kuis
  ];
  const km = computeKuis(abs, new Set(['ST-1']), new Set(['4']));
  assert.deepStrictEqual([...km.keys()], ['1']);
  assert.strictEqual(km.get('1')[0].status, 'Cuti');
  const em = buildEmail({ nik: '9', nama: 'EKA PUTRA', unmet: [], kuis: km.get('1') }, 'Oktober 2026', '31 Oktober 2026');
  assert.ok(em.subject.startsWith('Kuis pengganti') && em.html.includes('quiz-she.vercel.app/?nik=9') && !em.html.includes('<th'));
  console.log('cron-sap-reminder self-check OK');
}
