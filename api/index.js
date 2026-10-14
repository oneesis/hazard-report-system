// googleapis dimuat MALAS (2026-10-08): memuat paket ini makan ±1,2 dtk CPU tiap cold
// start, padahal kebanyakan request hanya baca/tulis Neon. Sekarang hanya dimuat saat
// Drive (upload foto) / Sheets (jalur lama) benar-benar dipakai — hemat Fluid Active CPU.
let _googleLib = null;
const google = () => (_googleLib ||= require('googleapis').google);
const https = require('https');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const webPush = require('web-push');
const { parseRosterCsv } = require('../lib/roster');
const { rencanakanAlur } = require('../lib/alur-laporan');

// [PUSH-START] VAPID setup — lazy init agar tidak crash jika env belum diset
let _vapidSet = false;
function ensureVapid() {
  if (_vapidSet) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webPush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@sap-ebl.vercel.app'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  _vapidSet = true;
  return true;
}
// [PUSH-END]

// ── Email OTP (verifikasi email karyawan) ───────────────────────────────────
// Kirim via Gmail SMTP (nodemailer) dari GMAIL_SENDER pakai App Password.
// nodemailer di-require lazy agar tak crash bila dep/env belum siap.
// OTP kini disimpan di Postgres (tabel email_otp), lihat blok requestEmailOtp/
// verifyEmailOtp. TTL 10 menit, cooldown 60 dtk, maks percobaan diatur di SQL.
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Koneksi Postgres (Neon) — lazy, HTTP driver serverless ──────────────────
// Dipakai bertahap: sementara baru untuk email_otp; sisanya masih Google Sheets.
let _sql = null;
function getSql() {
  if (_sql) return _sql;
  if (!process.env.DATABASE_URL) return null;
  const { neon } = require('@neondatabase/serverless');
  _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

let _mailer = null;
function _getMailer() {
  if (_mailer) return _mailer;
  const user = process.env.GMAIL_SENDER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  const nodemailer = require('nodemailer');
  _mailer = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return _mailer;
}

async function sendEmailOtp(to, code) {
  const t = _getMailer();
  if (!t) throw Object.assign(new Error('Layanan email belum dikonfigurasi.'), { httpStatus: 503 });
  await t.sendMail({
    from: `ONE-SAP <${process.env.GMAIL_SENDER}>`,
    to,
    subject: `Kode Verifikasi Email ONE-SAP: ${code}`,
    text: `Kode verifikasi email kamu: ${code}\n\nBerlaku 10 menit. Jangan bagikan kode ini ke siapa pun.\n\nJika kamu tidak meminta ini, abaikan email ini.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto">
      <h2 style="color:#4f46e5;margin:0 0 8px">ONE-SAP</h2>
      <p>Kode verifikasi email kamu:</p>
      <p style="font-size:30px;font-weight:800;letter-spacing:6px;color:#0f172a;margin:12px 0">${code}</p>
      <p style="color:#64748b;font-size:13px">Berlaku 10 menit. Jangan bagikan kode ini ke siapa pun. Jika kamu tidak meminta ini, abaikan email ini.</p>
    </div>`,
  });
}

// Email berisi tombol "Ganti Password" → laman reset-password.html. Dipakai
// alur Lupa Password (publik). Link berlaku 30 menit & sekali pakai.
async function sendPasswordResetEmail(to, nama, link) {
  const t = _getMailer();
  if (!t) throw Object.assign(new Error('Layanan email belum dikonfigurasi.'), { httpStatus: 503 });
  await t.sendMail({
    from: `ONE-SAP <${process.env.GMAIL_SENDER}>`,
    to,
    subject: 'Ganti Password ONE-SAP',
    text: `Halo ${nama || ''},\n\nKlik tautan berikut untuk mengganti password ONE-SAP kamu:\n${link}\n\nTautan berlaku 30 menit dan hanya bisa dipakai sekali. Jika kamu tidak meminta ini, abaikan email ini.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto">
      <h2 style="color:#1e2a52;margin:0 0 8px">ONE-SAP</h2>
      <p>Halo ${nama || ''},</p>
      <p>Kamu meminta penggantian password. Klik tombol di bawah untuk membuat password baru:</p>
      <p style="margin:20px 0"><a href="${link}" style="background:#f0b429;color:#1e2a52;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block">Ganti Password</a></p>
      <p style="color:#64748b;font-size:13px">Atau salin tautan ini:<br><a href="${link}">${link}</a></p>
      <p style="color:#64748b;font-size:13px">Tautan berlaku 30 menit dan hanya bisa dipakai sekali. Jika kamu tidak meminta ini, abaikan email ini.</p>
    </div>`,
  });
}

// Cari NIK di Master_Karyawan; balikkan { nama, email } atau null.
async function _findKaryawanEmail(sheets, nik) {
  const rows = await _karyawanRows(sheets);
  const target = String(nik || '').trim();
  const r = rows.find(x => String(x['NIK'] || '').trim() === target);
  if (!r) return null;
  return { nama: String(r['NAMA'] || '').trim(), email: String(r['EMAIL'] || '').trim() };
}

// Cek email sudah dipakai NIK lain?
async function _emailTakenByOther(sheets, email, nik) {
  const rows = await _karyawanRows(sheets);
  const e = String(email || '').trim().toLowerCase();
  return rows.some(x => String(x['EMAIL'] || '').trim().toLowerCase() === e && String(x['NIK'] || '').trim() !== String(nik || '').trim());
}

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '30d'; // sesi lama untuk PWA/mobile — tak sering logout otomatis (tetap bisa logout manual + lockout)

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ===== RATE LIMITING =====
// In-memory per instance — efektif untuk throttle brute-force pada satu instance
const _loginAttempts = new Map(); // nik → { count, firstAt, lockedUntil }
const _ipAttempts    = new Map(); // ip  → { count, firstAt, lockedUntil }
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 menit
const MAX_ATTEMPTS   = 5;
const LOCKOUT_MS     = 15 * 60 * 1000;
const IP_MAX         = 20; // maks percobaan login dari 1 IP per window

function _checkLimit(map, key, max) {
  const now = Date.now();
  const e = map.get(key);
  if (!e) return { ok: true };
  if (e.lockedUntil && now < e.lockedUntil) {
    const mnt = Math.ceil((e.lockedUntil - now) / 60000);
    return { ok: false, mnt };
  }
  if (now - e.firstAt > RATE_WINDOW_MS) { map.delete(key); return { ok: true }; }
  return { ok: true };
}

function _recordFail(map, key, max) {
  const now = Date.now();
  const e = map.get(key) || { count: 0, firstAt: now };
  if (now - e.firstAt > RATE_WINDOW_MS) { map.set(key, { count: 1, firstAt: now }); return; }
  e.count++;
  if (e.count >= max) e.lockedUntil = now + LOCKOUT_MS;
  map.set(key, e);
}

function checkLoginRateLimit(nik) {
  const r = _checkLimit(_loginAttempts, String(nik || '').trim().toLowerCase(), MAX_ATTEMPTS);
  if (!r.ok) return { ok: false, message: `Terlalu banyak percobaan. Coba lagi dalam ${r.mnt} menit.` };
  return { ok: true };
}

function checkIpRateLimit(ip) {
  const r = _checkLimit(_ipAttempts, String(ip || 'unknown'), IP_MAX);
  if (!r.ok) return { ok: false, message: `Terlalu banyak percobaan dari perangkat ini. Coba lagi dalam ${r.mnt} menit.` };
  return { ok: true };
}

function recordFailedLogin(nik, ip) {
  _recordFail(_loginAttempts, String(nik || '').trim().toLowerCase(), MAX_ATTEMPTS);
  if (ip) _recordFail(_ipAttempts, String(ip), IP_MAX);
}

function clearFailedLogins(nik) {
  _loginAttempts.delete(String(nik || '').trim().toLowerCase());
  // ponytail: sengaja TIDAK hapus IP entry saat sukses — IP bersih hanya lewat expiry
}

// Password lemah yang wajib diganti
const WEAK_PASSWORDS = new Set(['12345','123456','1234567','12345678','123456789','1234567890',
  'password','password1','qwerty','qwerty123','abc123','111111','000000','admin','admin123']);

function isWeakPassword(pw) {
  return WEAK_PASSWORDS.has(String(pw || '').trim().toLowerCase());
}
const INSPECTION_SHEETS = ['INS_CB', 'INS_JA', 'INS_MD', 'INS_KG', 'INS_SP', 'INS_T', 'INS_TB', 'INS_WS'];

// ===== CLIENT + DATA CACHE =====
// ponytail: in-memory, per-instance — mengurangi auth overhead dan Sheets API calls
let _cachedClient = null;
let _clientExpiry = 0;
const _dataCache  = new Map(); // key → { data, expAt }

function getClients() {
  const now = Date.now();
  if (_cachedClient && now < _clientExpiry) return _cachedClient;
  // Klien Sheets asli baru dibuat saat properti pertama diakses (mis. sheets.spreadsheets).
  let real = null;
  const realSheets = () => {
    if (real) return real;
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new (google().auth.GoogleAuth)({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return (real = google().sheets({ version: 'v4', auth }));
  };
  _cachedClient = { sheets: new Proxy({}, { get: (_, k) => realSheets()[k] }) };
  _clientExpiry = now + 55 * 60 * 1000; // token bertahan 1 jam, refresh 5 menit sebelum expiry
  return _cachedClient;
}

async function getCachedSheet(sheets, sheetName, ttlMs = 60_000) {
  const key = `sheet:${sheetName}`;
  const now = Date.now();
  const hit = _dataCache.get(key);
  if (hit && now < hit.expAt) return hit.data;
  const data = await getSheetData(sheets, sheetName);
  _dataCache.set(key, { data, expAt: now + ttlMs });
  return data;
}

function invalidateCache(sheetName) {
  _dataCache.delete(`sheet:${sheetName}`);
}

// Roster (Master_Karyawan) — sumber utama kini Postgres (tabel karyawan, kolom
// data JSONB berisi baris lengkap dengan key HEADER ASLI, mis. r['NIK'],
// r['PERUSAHAAN'], r['PASSWORD']). Fallback ke Sheets bila Postgres kosong/gagal
// supaya login TIDAK PERNAH putus (pra-migrasi / DB down). Cache dipakai bareng
// key 'sheet:Master_Karyawan' agar invalidateCache('Master_Karyawan') tetap jalan.
async function _karyawanRows(sheets) {
  const key = 'sheet:Master_Karyawan';
  const now = Date.now();
  const hit = _dataCache.get(key);
  if (hit && now < hit.expAt) return hit.data;
  let data = [];
  const sql = getSql();
  if (sql) {
    try { data = (await sql`SELECT data FROM karyawan`).map(x => x.data || {}); } catch { data = []; }
  }
  if (!data.length) { try { data = await getSheetData(sheets, 'Master_Karyawan'); } catch { data = []; } }
  _dataCache.set(key, { data, expAt: now + 30_000 });
  return data;
}

function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '');
}

function colIndexToLetter(index) {
  let col = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

async function getSheetData(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[String(h).trim()] = row[i] ?? ''; });
    return obj;
  });
}

async function getSheetHeaders(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!1:1` });
  return (res.data.values?.[0] || []).map(h => String(h).trim());
}

// ===== CUTI (2026-08-20) =====
// Master_Karyawan di app ini tidak punya konsep cuti/leave sama sekali —
// SISTER MINER (repo terpisah) adalah source of truth data karyawan & status
// cuti. Cross-read langsung ke spreadsheet SISTER MINER (+ SIMANTRA K3 untuk
// training TR_REINDUKSI), sama pola integrasi Sheets-as-API yang sudah dipakai
// di seluruh sistem ini (lihat SISTER MINER/src/lib/simantra.ts). Bridge
// identitas NIK↔karyawan_id di-port read-only dari SIKAP/src/lib/bridge.ts.
function namaCocok(a, b) {
  const na = String(a || '').trim().toUpperCase();
  const nb = String(b || '').trim().toUpperCase();
  return Boolean(na && nb) && (na.includes(nb) || nb.includes(na));
}

async function getSheetDataFrom(sheets, spreadsheetId, sheetName) {
  if (!spreadsheetId) return [];
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[String(h).trim()] = row[i] ?? ''; });
    return obj;
  });
}

async function getCachedSheetFrom(sheets, spreadsheetId, sheetName, ttlMs = 30_000) {
  const key = `xsheet:${spreadsheetId}:${sheetName}`;
  const now = Date.now();
  const hit = _dataCache.get(key);
  if (hit && now < hit.expAt) return hit.data;
  const data = await getSheetDataFrom(sheets, spreadsheetId, sheetName);
  _dataCache.set(key, { data, expAt: now + ttlMs });
  return data;
}

// Sekali fetch (Karyawan + akun_karyawan + training_records, masing2 sudah
// di-cache 30s oleh getCachedSheetFrom) dipakai ulang buat resolve 1 NIK atau
// seluruh roster sekaligus — hindari N request paralel ke Sheets API kalau
// dipanggil dalam loop (mis. anotasi dropdown PIC untuk semua karyawan).
async function loadCutiSources(sheets) {
  // Sumber cuti kini di Neon: SISTER MINER sm."Karyawan" + SIMANTRA
  // simantra."akun_karyawan"/"training_records" (sheet-nya sudah beku setelah
  // migrasi). Cache 30s (dipakai cek PIC & dropdown). Fallback ke
  // Sheets bila DATABASE_URL belum ada. Fail-open: error → null (cuti nonaktif,
  // TIDAK mematahkan login/request).
  const CK = 'cuti:sources';
  const hit = _dataCache.get(CK);
  if (hit && Date.now() < hit.expAt) return hit.data;

  const sql = getSql();
  if (sql) {
    try {
      const [karyawan, bridgeRows, records] = await Promise.all([
        sql`SELECT data FROM sm."Karyawan"`,
        sql`SELECT data FROM simantra."akun_karyawan"`,
        sql`SELECT data FROM simantra."training_records"`,
      ]);
      const data = {
        karyawan: karyawan.map(r => r.data || {}),
        bridgeRows: bridgeRows.map(r => r.data || {}),
        records: records.map(r => r.data || {}),
      };
      _dataCache.set(CK, { data, expAt: Date.now() + 30_000 });
      return data;
    } catch (err) {
      console.error('[cuti] gagal baca Neon (sm/simantra), fitur cuti nonaktif sementara:', err.message);
      return null;
    }
  }

  // Fallback lama: baca Sheets langsung (pra-migrasi / tanpa DATABASE_URL)
  const sisterId = process.env.SISTER_MINER_SPREADSHEET_ID;
  if (!sisterId) return null;
  const simantraId = process.env.SIMANTRA_SPREADSHEET_ID;
  try {
    const [karyawan, bridgeRows, records] = await Promise.all([
      getCachedSheetFrom(sheets, sisterId, 'Karyawan'),
      simantraId ? getCachedSheetFrom(sheets, simantraId, 'akun_karyawan') : [],
      simantraId ? getCachedSheetFrom(sheets, simantraId, 'training_records') : [],
    ]);
    return { karyawan, bridgeRows, records };
  } catch (err) {
    console.error('[cuti] gagal baca SISTER MINER/SIMANTRA, fitur cuti nonaktif sementara:', err.message);
    return null;
  }
}

// Bug (2026-08-21): bandingin Date lengkap (dgn jam) ke new Date(tanggal)
// (selalu jam 00:00 UTC) bikin cutiSelesai cuma "cuti" di milidetik pertama
// harinya. Fix: banding string tanggal kalender (YYYY-MM-DD) di zona WIB.
// Tabel roster harian (lib/roster.js) — dibuat otomatis saat import pertama.
let _rosterTableOk = false;
async function ensureRosterTable(sql) {
  if (_rosterTableOk) return;
  await sql`CREATE TABLE IF NOT EXISTS roster_harian (
    nik TEXT NOT NULL, tanggal DATE NOT NULL, kode TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (nik, tanggal))`;
  _rosterTableOk = true;
}

// ── Deteksi dini: master temuan & lokasi di Neon (2026-10-14) ───────────────
// Seed dari lib/master-*.json saat tabel masih kosong; setelah itu dikelola Super Admin.
const Taksonomi = require('../lib/taksonomi');
const PETA_CHECKLIST = require('../lib/peta-checklist.json');
const LibInsiden = require('../lib/insiden');
let _insidenOk = false;
async function ensureInsidenTable(sql) {
  if (_insidenOk) return;
  await sql`CREATE TABLE IF NOT EXISTS insiden (
    id TEXT PRIMARY KEY, tanggal DATE NOT NULL, jam TEXT, shift TEXT, perusahaan TEXT, departemen TEXT,
    lokasi TEXT, sub_lokasi TEXT, klasifikasi TEXT NOT NULL, kode_penyebab TEXT, keparahan_aktual INT, potensi_keparahan INT,
    data JSONB NOT NULL DEFAULT '{}', sumber TEXT, updated_at TIMESTAMPTZ DEFAULT now())`;
  _insidenOk = true;
}
let _sboKodeOk = false;
async function ensureSboKodeKolom(sql) {
  if (_sboKodeOk) return;
  await sql`ALTER TABLE sbo_report ADD COLUMN IF NOT EXISTS kode_temuan TEXT NOT NULL DEFAULT ''`;
  _sboKodeOk = true;
}
let _masterDD = null, _masterDDAt = 0;
const MASTER_DD_TTL = 5 * 60e3;
async function ensureMasterDeteksiDini(sql) {
  await sql`CREATE TABLE IF NOT EXISTS master_kategori (
    kode TEXT PRIMARY KEY, nama TEXT NOT NULL, lokasi_prioritas JSONB NOT NULL DEFAULT '[]', urutan INT NOT NULL DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS master_temuan (
    kode TEXT PRIMARY KEY, kategori_kode TEXT NOT NULL, sub TEXT NOT NULL, tipe TEXT NOT NULL,
    keparahan INT NOT NULL, kemungkinan INT NOT NULL, kritis BOOLEAN NOT NULL DEFAULT false,
    aktif BOOLEAN NOT NULL DEFAULT true, nama_lama JSONB NOT NULL DEFAULT '[]', urutan INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS master_lokasi (
    lokasi TEXT NOT NULL, sub TEXT NOT NULL, jenis_area TEXT NOT NULL DEFAULT '', aktif BOOLEAN NOT NULL DEFAULT true,
    urutan INT NOT NULL DEFAULT 0, PRIMARY KEY (lokasi, sub))`;
  if (!(await sql`SELECT 1 FROM master_temuan LIMIT 1`).length) {
    const m = require('../lib/master-temuan.json');
    await sql`INSERT INTO master_kategori (kode, nama, lokasi_prioritas, urutan)
      SELECT x.kode, x.nama, x.lokasi_prioritas, x.urutan FROM jsonb_to_recordset(${JSON.stringify(m.kategori)}::jsonb)
      AS x(kode text, nama text, lokasi_prioritas jsonb, urutan int) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO master_temuan (kode, kategori_kode, sub, tipe, keparahan, kemungkinan, kritis, nama_lama, urutan)
      SELECT x.kode, x.kategori_kode, x.sub, x.tipe, x.keparahan, x.kemungkinan, x.kritis, x.nama_lama, x.urutan
      FROM jsonb_to_recordset(${JSON.stringify(m.temuan)}::jsonb)
      AS x(kode text, kategori_kode text, sub text, tipe text, keparahan int, kemungkinan int, kritis boolean, nama_lama jsonb, urutan int)
      ON CONFLICT DO NOTHING`;
  }
  if (!(await sql`SELECT 1 FROM master_lokasi LIMIT 1`).length) {
    await sql`INSERT INTO master_lokasi (lokasi, sub, jenis_area, urutan)
      SELECT x.lokasi, x.sub, x.jenis_area, x.urutan FROM jsonb_to_recordset(${JSON.stringify(require('../lib/master-lokasi.json'))}::jsonb)
      AS x(lokasi text, sub text, jenis_area text, urutan int) ON CONFLICT DO NOTHING`;
  }
}
/** { kategori, temuan (+nama kategori), lokasi } aktif — cache 5 menit per instance. */
let _masterDDSiap = null; // satu kali per instance: request paralel pertama tidak berebut CREATE TABLE
async function masterDeteksiDini({ segar = false } = {}) {
  if (!segar && _masterDD && Date.now() - _masterDDAt < MASTER_DD_TTL) return _masterDD;
  const sql = getSql();
  if (!_masterDDSiap) _masterDDSiap = ensureMasterDeteksiDini(sql).catch((e) => { _masterDDSiap = null; throw e; });
  await _masterDDSiap;
  const [kategori, temuan, lokasi] = await Promise.all([
    sql`SELECT * FROM master_kategori ORDER BY urutan`,
    sql`SELECT t.*, k.nama AS kategori FROM master_temuan t JOIN master_kategori k ON k.kode = t.kategori_kode ORDER BY t.urutan`,
    sql`SELECT * FROM master_lokasi ORDER BY urutan`,
  ]);
  _masterDD = { kategori, temuan, lokasi };
  _masterDDAt = Date.now();
  return _masterDD;
}

/** Hitung risiko Hazard di server (5×5) & lengkapi data laporan. Laporan dengan
 * kategori/sub di luar master (mis. draft lama) dibiarkan apa adanya. */
async function _risikoHazard(data) {
  const m = await masterDeteksiDini();
  const t = m.temuan.find((x) => x.aktif && x.kode === data.kode_temuan)
    || m.temuan.find((x) => x.aktif && x.kategori === data.ketidaksesuaian_bahaya && x.sub === data.sub_ketidaksesuaian);
  if (!t) return null;
  const lok = String(data.lokasi_bahaya || ''), sub = String(data.sub_lokasi_bahaya || '');
  const area = (m.lokasi.find((l) => l.lokasi === lok && l.sub === sub) || m.lokasi.find((l) => l.lokasi === lok))?.jenis_area || '';
  const tgl = String(data.tanggal_kejadian || todayJakarta()).slice(0, 10);
  const lain = sub ? await getSql()`SELECT data->>'tanggal_kejadian' AS tanggal FROM hazard_report
    WHERE data->>'kode_temuan' = ${t.kode} AND data->>'lokasi_bahaya' = ${lok} AND data->>'sub_lokasi_bahaya' = ${sub}
      AND left(data->>'tanggal_kejadian', 10) BETWEEN to_char(${tgl}::date - 30, 'YYYY-MM-DD') AND ${tgl}` : [];
  const r = Taksonomi.hitung({
    keparahan: t.keparahan, // otomatis dari master (2026-10-15); koreksi hanya oleh SHE (koreksiRisiko)
    kemungkinan: t.kemungkinan, jenisArea: area, berulang: lain.length > 0,
  });
  Object.assign(data, {
    kode_temuan: t.kode, ketidaksesuaian_bahaya: t.kategori, sub_ketidaksesuaian: t.sub,
    jenis_bahaya: t.tipe === 'Tindakan' ? 'Tindakan Tidak Aman' : 'Kondisi Tidak Aman',
    keparahan: r.keparahan, kemungkinan: r.kemungkinan, skor_risiko: r.skor, tingkat_risiko: r.tingkat,
    kelas_temuan: r.kelas, risiko_kritis: t.kritis ? 'Ya' : '', jenis_area: area, temuan_berulang: lain.length ? 'Ya' : '',
  });
  // Batas waktu otomatis mengikuti tingkat final server (bisa lebih ketat dari pratinjau form,
  // mis. karena berulang). Isian manual pelapor tidak disentuh.
  if (data.batas_auto === '1') {
    const d = new Date(`${todayJakarta()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + r.batasHari);
    data.batas_waktu = d.toISOString().slice(0, 10);
  }
  return r;
}

// ── Deteksi dini tahap 4: indeks risiko & dasbor (2026-10-14) ──────────────
const Indeks = require('../lib/indeks-risiko');
const LaporanBulanan = require('../lib/laporan-bulanan');
const Evaluasi = require('../lib/evaluasi-dd');
// Inspeksi & SBO belum memakai master lokasi (lokasi teks bebas) → perkiraan lokasi.
// ponytail: tebakan kata kunci; ganti dengan pilihan lokasi di form Inspeksi/SBO bila perlu presisi.
const LOKASI_INSPEKSI = { INS_CB: 'CCP', INS_JA: 'Mine Road', INS_KG: 'Office', INS_MD: 'Mess/ Camp', INS_SP: 'Settling Pond', INS_T: 'Front Loading', INS_TB: 'Maintank', INS_WS: 'Workshop' };
const LOKASI_KATA = [[/handak/, 'Gudang Handak'], [/disposal/, 'Disposal'], [/khdtk|hutan/, 'KHDTK / Kawasan Hutan'], [/sp\b|sparing|settling|setpond|pintu air/, 'Settling Pond'],
  [/nursery/, 'Nursery'], [/fasum/, 'Fasum Project'], [/jalan kab|jln kab/, 'Jalan Kabupaten'], [/hauling/, 'Hauling Road'], [/mess|mes\b/, 'Mess/ Camp'],
  [/kantor|office/, 'Office'], [/workshop|ws\b|iglo/, 'Workshop'], [/sump/, 'Sump'], [/rehab|das\b/, 'Area Rehab DAS'], [/tambang|pit|blok|front/, 'Front Loading']];
const tebakLokasi = (s) => (LOKASI_KATA.find(([re]) => re.test(String(s || '').toLowerCase())) || [, 'Lain-lain'])[1];
const BOBOT_AREA = { Operasional: 2, Kritis: 2, Lingkungan: 1.5, Kendaraan: 1.5 };
let _ddCache = new Map();

async function dataDeteksiDini(auth) {
  const superAdmin = isSuperAdmin(auth.role);
  const co = String(auth.perusahaan || '').trim().toUpperCase();
  const kunciCache = superAdmin ? '*' : co;
  const c = _ddCache.get(kunciCache);
  if (c && Date.now() - c.at < 10 * 60e3) return c.data;

  const sql = getSql();
  const m = await masterDeteksiDini();
  await ensureInsidenTable(sql);
  const M = new Map(m.temuan.map((t) => [t.kode, t]));
  const area = new Map(m.lokasi.map((l) => [l.lokasi, l.jenis_area]));
  const [hz, ins, sbo, insiden] = await Promise.all([
    sql`SELECT id, status_perbaikan, data FROM hazard_report WHERE coalesce(data->>'kode_temuan', '') <> ''`,
    sql`SELECT id, jenis, status_perbaikan, data FROM inspection_report WHERE coalesce(data->>'kode_temuan', '') <> ''`,
    sql`SELECT id, tgl_observasi, lokasi, perusahaan_pic, departemen_pic, perusahaan_observer, departemen_observer, nik_observer,
        status_perbaikan, batas_waktu, tanggal_closing, kode_temuan FROM sbo_report WHERE coalesce(kode_temuan, '') <> ''`.catch(() => []),
    sql`SELECT id, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, perusahaan, lokasi, klasifikasi, kode_penyebab, data->>'kode_tambahan' AS kode2 FROM insiden`,
  ]);
  const up = (s) => String(s || '').trim().toUpperCase();
  const dept = (p, d) => `${String(p || '').trim() || '-'} — ${String(d || '').trim().toUpperCase() || '-'}`;
  const item = (o, kode) => {
    const t = M.get(kode);
    return t ? { ...o, kode, keparahan: Number(o.keparahan) || t.keparahan, tipe: t.tipe, kritis: t.kritis } : null;
  };
  let temuan = [];
  for (const r of hz) {
    const d = r.data;
    temuan.push(item({ sumber: 'Hazard', id: r.id, tanggal: d.tanggal_kejadian, perusahaan: d.perusahaan_pic || d.perusahaan,
      departemen: dept(d.perusahaan_pic || d.perusahaan, d.departemen_pic || d.departemen), lokasi: d.lokasi_bahaya, sub: d.sub_lokasi_bahaya || '',
      pelapor: d.nik, status: r.status_perbaikan, batasWaktu: d.batas_waktu, tanggalClosing: d.tanggal_closing, keparahan: d.keparahan,
      pelaporDept: dept(d.perusahaan, d.departemen) }, d.kode_temuan));
  }
  for (const r of ins) {
    const d = r.data;
    for (const k of String(d.kode_temuan).split(',').filter(Boolean)) temuan.push(item({ sumber: 'Inspeksi', id: r.id, tanggal: d.tanggal_kejadian,
      perusahaan: d.perusahaan_pic || d.perusahaan, departemen: dept(d.perusahaan_pic || d.perusahaan, d.departemen_pic || d.departemen),
      lokasi: LOKASI_INSPEKSI[r.jenis] || 'Lain-lain', sub: '', pelapor: d.nik, status: r.status_perbaikan, batasWaktu: d.batas_waktu,
      tanggalClosing: d.tanggal_closing, pelaporDept: dept(d.perusahaan, d.departemen) }, k));
  }
  for (const r of sbo) {
    for (const k of String(r.kode_temuan).split(',').filter(Boolean)) temuan.push(item({ sumber: 'SBO', id: r.id, tanggal: r.tgl_observasi,
      perusahaan: r.perusahaan_pic || r.perusahaan_observer, departemen: dept(r.perusahaan_pic || r.perusahaan_observer, r.departemen_pic),
      lokasi: tebakLokasi(r.lokasi), sub: '', pelapor: r.nik_observer, status: r.status_perbaikan, batasWaktu: r.batas_waktu,
      tanggalClosing: r.tanggal_closing, pelaporDept: dept(r.perusahaan_observer, r.departemen_observer) }, k));
  }
  temuan = temuan.filter(Boolean);
  let ins2 = insiden;
  if (!superAdmin) { temuan = temuan.filter((t) => up(t.perusahaan) === co); ins2 = insiden.filter((i) => up(i.perusahaan) === co); }

  const now = Date.now();
  const siap = Indeks.siapkan(temuan);
  const penyebabInsiden = new Set(insiden.flatMap((i) => [i.kode_penyebab, i.kode2]).filter(Boolean));
  const mulai = siap.length ? Date.parse(String(siap[0].tanggal).slice(0, 10) + 'T00:00:00Z') : null; // siap terurut tanggal
  const opsi = (kunci) => ({ now, kunci, penyebabInsiden, mulai });
  const nama = (k) => M.get(k)?.sub || k;
  const umur = (s) => Math.floor((now - Date.parse(String(s).slice(0, 10) + 'T00:00:00Z')) / 864e5);
  const minggu = Array.from({ length: Indeks.MINGGU }, (_, i) => new Date(now - (Indeks.MINGGU - 1 - i) * 7 * 864e5).toISOString().slice(0, 10));

  const lokasi = Indeks.hitungIndeks(siap, opsi((t) => t.lokasi));
  const hitung = (arr, f) => arr.reduce((a, x) => { const k = f(x); if (k) a[k] = (a[k] || 0) + 1; return a; }, {});
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const t30 = siap.filter((t) => umur(t.tanggal) <= 30);
  const t365 = siap.filter((t) => umur(t.tanggal) <= 365);
  const i365 = ins2.filter((i) => umur(i.tanggal) <= 365);

  const hasil = {
    status: 'success', dihitung: new Date(now).toISOString(), lingkup: superAdmin ? 'Semua perusahaan' : auth.perusahaan, minggu,
    jumlah: { temuan: siap.length, hazard: siap.filter((t) => t.sumber === 'Hazard').length, inspeksi: siap.filter((t) => t.sumber === 'Inspeksi').length,
      sbo: siap.filter((t) => t.sumber === 'SBO').length, insiden: ins2.length },
    lokasi,
    departemen: Indeks.hitungIndeks(siap, opsi((t) => t.departemen)),
    perusahaan: superAdmin ? Indeks.hitungIndeks(siap, opsi((t) => t.perusahaan && up(t.perusahaan))) : [],
    seriTotal: minggu.map((_, i) => lokasi.reduce((a, l) => a + l.seri[i], 0)),
    mayorTerbuka: siap.filter((t) => t.keparahan >= 4 && String(t.status).toUpperCase() !== 'CLOSED')
      .map((t) => ({ id: t.id, sumber: t.sumber, tanggal: String(t.tanggal).slice(0, 10), lokasi: t.lokasi, sub: t.sub, kode: t.kode, nama: nama(t.kode),
        keparahan: t.keparahan, kritis: t.kritis, batas: t.batasWaktu || '', lewatHari: t.batasWaktu ? umur(t.batasWaktu) : null }))
      .sort((a, b) => (b.lewatHari ?? -999) - (a.lewatHari ?? -999)).slice(0, 60),
    berulang: Indeks.berulangAktif(siap, now).slice(0, 20).map((x) => ({ ...x, nama: nama(x.kode) })),
    penyebab30: top(hitung(t30, (t) => t.kode), 10).map(([k, n]) => ({ kode: k, nama: nama(k), jumlah: n, pernahInsiden: penyebabInsiden.has(k) })),
    penyebabInsiden: top(hitung(ins2, (i) => i.kode_penyebab), 10).map(([k, n]) => ({ kode: k, nama: nama(k), jumlah: n })),
    piramida: {
      berat: i365.filter((i) => ['FAT', 'LTI'].includes(i.klasifikasi)).length,
      ringan: i365.filter((i) => ['MTI', 'FAI'].includes(i.klasifikasi)).length,
      kerugian: i365.filter((i) => ['PD', 'FC', 'EC'].includes(i.klasifikasi)).length,
      nearMiss: i365.filter((i) => i.klasifikasi === 'NM').length,
      temuanMayor: t365.filter((t) => t.keparahan >= 4).length,
      temuan: t365.length,
    },
  };

  if (superAdmin) {
    // KPI program (hanya Super Admin) — 30 hari terakhir & seluruh data.
    const kpi = (arr) => {
      const hz2 = arr.filter((t) => t.sumber === 'Hazard');
      const mayorJatuhTempo = arr.filter((t) => t.keparahan >= 4 && t.batasWaktu && umur(t.batasWaktu) > 0);
      const tepat = mayorJatuhTempo.filter((t) => String(t.status).toUpperCase() === 'CLOSED' && t.tanggalClosing
        && String(t.tanggalClosing).slice(0, 10) <= String(t.batasWaktu).slice(0, 10)).length;
      const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
      return {
        areaOperasional: pct(hz2.filter((t) => ['Operasional', 'Kritis'].includes(area.get(t.lokasi))).length, hz2.length),
        tindakan: pct(arr.filter((t) => t.tipe === 'Tindakan').length, arr.length),
        mayorTepatWaktu: pct(tepat, mayorJatuhTempo.length), mayorJatuhTempo: mayorJatuhTempo.length,
      };
    };
    const tPer = hitung(siap, (t) => t.lokasi), iPer = hitung(insiden, (i) => i.lokasi);
    hasil.kpi = { hari30: kpi(t30), semua: kpi(siap),
      rasio: [...new Set([...Object.keys(tPer), ...Object.keys(iPer)])].map((l) => ({ lokasi: l, temuan: tPer[l] || 0, insiden: iPer[l] || 0 }))
        .filter((x) => x.insiden).sort((a, b) => b.insiden - a.insiden) };
    // Capaian berbobot area (terpisah dari capaian SAP resmi): laporan 30 hari per departemen pelapor.
    const cap = new Map();
    for (const t of t30) {
      const k = t.pelaporDept || '-';
      if (!cap.has(k)) cap.set(k, { departemen: k, laporan: new Set(), skor: 0, operasional: 0 });
      const x = cap.get(k);
      const kunci = `${t.sumber}|${t.id}`;
      if (x.laporan.has(kunci)) continue;
      x.laporan.add(kunci);
      const b = BOBOT_AREA[area.get(t.lokasi)] || 1;
      x.skor += b; if (b >= 2) x.operasional++;
    }
    hasil.capaianBobot = [...cap.values()].map((x) => ({ departemen: x.departemen, laporan: x.laporan.size, skor: x.skor,
      pctOperasional: Math.round((x.operasional / x.laporan.size) * 100) })).sort((a, b) => b.skor - a.skor);
  }
  // Penyebab insiden per lokasi (untuk "Fokus minggu ini") & peringatan aktif 14 hari (umpan balik SHE).
  hasil.insidenPerLokasi = {};
  for (const i of ins2) if (i.lokasi && i.kode_penyebab) {
    const x = (hasil.insidenPerLokasi[i.lokasi] ||= {}); x[i.kode_penyebab] = (x[i.kode_penyebab] || 0) + 1;
  }
  for (const [l, x] of Object.entries(hasil.insidenPerLokasi)) hasil.insidenPerLokasi[l] = top(x, 3).map(([k, n]) => ({ kode: k, nama: nama(k), jumlah: n }));
  await ensureDeteksiDiniTables(sql);
  const pp = await sql`SELECT id, to_char(dibuat AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD HH24:MI') AS dibuat, jenis, dimensi, nama, status, alasan,
      tanggapan, ditanggapi_oleh FROM peringatan_dd WHERE dibuat > now() - interval '14 days' ORDER BY dibuat DESC LIMIT 60`;
  hasil.peringatan = superAdmin ? pp : pp.filter((p) => p.dimensi !== 'departemen' || up(p.nama).startsWith(co + ' '));
  if (superAdmin) { // tahap 7: apakah peringatan dini mendahului insiden nyata (bahan kalibrasi)
    const semuaP = await sql`SELECT to_char(dibuat AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS tanggal, jenis, dimensi, nama, tanggapan FROM peringatan_dd`;
    hasil.evaluasi = Evaluasi.evaluasiInsiden({ siap, insiden, peringatan: semuaP, penyebabInsiden });
    hasil.evaluasi.daftar = hasil.evaluasi.daftar.map((x) => ({ ...x, nama: nama(x.kode) }));
  }
  // Bahan laporan bulanan (tahap 6) — tidak ikut JSON respons (non-enumerable).
  if (superAdmin) Object.defineProperty(hasil, '_bahan', { value: { siap, insiden, penyebabInsiden, area, nama } });
  _ddCache.set(kunciCache, { at: Date.now(), data: hasil });
  return hasil;
}

// ── Tahap 5: peringatan dini otomatis, cuaca harian, fokus Beranda (2026-10-15) ──
// ponytail: koordinat acuan curah hujan (user 14 Okt) tetap di kode; IUP ±94% di 1 sel grid
// Open-Meteo (±7 km) → hujan areal ≈ titik ini. Pindah ke pengaturan Super Admin bila sering berubah.
const KOORDINAT_HUJAN = { lat: -2.9778554, lon: 115.2017546 };
const AMBANG_HUJAN_MM = 20;
let _ddTabelOk = false;
async function ensureDeteksiDiniTables(sql) {
  if (_ddTabelOk) return;
  await sql`CREATE TABLE IF NOT EXISTS cuaca_harian (
    tanggal DATE PRIMARY KEY, hujan_mm NUMERIC, jam_hujan NUMERIC, angin_maks NUMERIC, suhu_maks NUMERIC, kode_cuaca INT,
    updated_at TIMESTAMPTZ DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS peringatan_dd (
    id SERIAL PRIMARY KEY, dibuat TIMESTAMPTZ DEFAULT now(), jenis TEXT NOT NULL, dimensi TEXT, nama TEXT, status TEXT,
    alasan JSONB NOT NULL DEFAULT '[]', penerima JSONB NOT NULL DEFAULT '[]', tanggapan TEXT, ditanggapi_oleh TEXT, ditanggapi_at TIMESTAMPTZ)`;
  _ddTabelOk = true;
}

/** Ambil cuaca harian Open-Meteo (gratis, tanpa kunci) & simpan. Pertama kali mundur 92 hari. */
async function perbaruiCuaca(sql) {
  await ensureDeteksiDiniTables(sql);
  const kosong = !(await sql`SELECT 1 FROM cuaca_harian LIMIT 1`).length;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${KOORDINAT_HUJAN.lat}&longitude=${KOORDINAT_HUJAN.lon}`
    + `&daily=precipitation_sum,precipitation_hours,wind_gusts_10m_max,temperature_2m_max,weather_code&timezone=Asia%2FMakassar`
    + `&past_days=${kosong ? 92 : 3}&forecast_days=2`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
  const d = (await res.json()).daily;
  const rows = d.time.map((t, i) => ({ tanggal: t, hujan_mm: d.precipitation_sum[i], jam_hujan: d.precipitation_hours[i],
    angin_maks: d.wind_gusts_10m_max[i], suhu_maks: d.temperature_2m_max[i], kode_cuaca: d.weather_code[i] }));
  await sql`INSERT INTO cuaca_harian (tanggal, hujan_mm, jam_hujan, angin_maks, suhu_maks, kode_cuaca, updated_at)
    SELECT x.tanggal::date, x.hujan_mm, x.jam_hujan, x.angin_maks, x.suhu_maks, x.kode_cuaca, now()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(tanggal text, hujan_mm numeric, jam_hujan numeric, angin_maks numeric, suhu_maks numeric, kode_cuaca int)
    ON CONFLICT (tanggal) DO UPDATE SET hujan_mm = EXCLUDED.hujan_mm, jam_hujan = EXCLUDED.jam_hujan, angin_maks = EXCLUDED.angin_maks,
      suhu_maks = EXCLUDED.suhu_maks, kode_cuaca = EXCLUDED.kode_cuaca, updated_at = now()`;
  return rows.length;
}

/** Cron harian: perbarui cuaca, kirim peringatan saat area/departemen BERUBAH jadi merah (sekali per 7 hari)
 *  & pengingat inspeksi jalan bila hujan kemarin ≥ ambang. dry = hitung tanpa kirim/simpan peringatan. */
async function cronDeteksiDini({ dry = false } = {}) {
  const sql = getSql();
  const { sheets } = getClients();
  const hasil = { cuaca: 0, peringatan: [], hujan: null };
  try { hasil.cuaca = await perbaruiCuaca(sql); } catch (e) { hasil.cuacaGalat = e.message; }
  _ddCache.clear();
  const d = await dataDeteksiDini({ role: 'SUPER_ADMIN', perusahaan: '' });
  const roster = await _karyawanRows(sheets);
  const norm = (s) => String(s || '').trim().toUpperCase();
  const sheHead = roster.filter((r) => /^(SHE|OSHE)$/.test(norm(r.DEPARTEMEN)) && /SECTION HEAD|SECT\.? HEAD|DEPT\.? HEAD/.test(norm(r.JABATAN)));
  const sectHead = (pt, dept) => roster.filter((r) => norm(r.PERUSAHAAN) === norm(pt) && norm(r.DEPARTEMEN) === norm(dept) && /SECTION HEAD|SECT\.? HEAD/.test(norm(r.JABATAN)));
  const URL_DD = 'https://sap-ebl.vercel.app/deteksi-dini.html';
  const unikNik = (arr) => [...new Map(arr.filter((p) => p && p.NIK).map((p) => [String(p.NIK), p])).values()];
  const kirim = async (penerima, subjek, teks, url) => {
    if (dry) return;
    await _sendMail(PIC_DISPUTE_EMAIL, subjek, teks, url).catch(() => {});
    for (const p of unikNik(penerima)) await _notifyPerson(sheets, { nik: String(p.NIK), nama: p.NAMA }, subjek, teks, url).catch(() => {});
  };
  const terakhir = new Map((await sql`SELECT DISTINCT ON (dimensi, nama) dimensi, nama, status FROM peringatan_dd
    WHERE jenis = 'indeks' AND dibuat > now() - interval '7 days' ORDER BY dimensi, nama, dibuat DESC`).map((r) => [`${r.dimensi}|${r.nama}`, r.status]));

  // Satu email ringkasan per orang per hari (bukan satu email per area).
  const perOrang = new Map(); // nik → { p, baris[] }
  const semua = [];
  for (const [dimensi, daftar] of [['lokasi', d.lokasi], ['departemen', d.departemen]]) {
    for (const x of daftar.filter((v) => v.status === 'merah')) {
      if (terakhir.get(`${dimensi}|${x.nama}`) === 'merah') continue; // sudah diperingatkan ≤ 7 hari
      const [pt, dept] = dimensi === 'departemen' ? x.nama.split(' — ') : [];
      const penerima = unikNik([...sheHead, ...(dimensi === 'departemen' ? sectHead(pt, dept) : [])]);
      const baris = `${dimensi === 'lokasi' ? 'Area' : 'Departemen'} ${x.nama}: ${x.alasan.join('; ')} (skor ${x.skor}, ${x.mayorTerbuka} Mayor terbuka)`;
      semua.push(baris);
      for (const p of penerima) { const k = String(p.NIK); if (!perOrang.has(k)) perOrang.set(k, { p, baris: [] }); perOrang.get(k).baris.push(baris); }
      hasil.peringatan.push({ dimensi, nama: x.nama, penerima: penerima.map((p) => p.NAMA) });
      if (!dry) await sql`INSERT INTO peringatan_dd (jenis, dimensi, nama, status, alasan, penerima)
        VALUES ('indeks', ${dimensi}, ${x.nama}, 'merah', ${JSON.stringify(x.alasan)}::jsonb, ${JSON.stringify(penerima.map((p) => p.NAMA))}::jsonb)`;
    }
  }
  const penutup = '\n\nIni indikator dini, bukan ramalan pasti. Mohon cek lapangan & tindak lanjuti, lalu tandai "Ditindaklanjuti" / "Tidak relevan" di menu Deteksi Dini.';
  const daftarBaris = (arr) => arr.map((b) => '- ' + b).join('\n');
  if (semua.length && !dry) {
    const subjek = `[ONE-SAP] Peringatan dini: ${semua.length} area/departemen MERAH`;
    await _sendMail(PIC_DISPUTE_EMAIL, subjek, `Status MERAH baru:\n\n${daftarBaris(semua)}${penutup}`, URL_DD).catch(() => {});
    for (const { p, baris } of perOrang.values())
      await _notifyPerson(sheets, { nik: String(p.NIK), nama: p.NAMA }, `[ONE-SAP] Peringatan dini: ${baris.length} area/departemen MERAH`,
        `Halo ${p.NAMA || ''}, status MERAH baru yang terkait denganmu:\n\n${daftarBaris(baris)}${penutup}`, URL_DD).catch(() => {});
  }
  hasil.email = dry ? 0 : (semua.length ? perOrang.size + 1 : 0);

  // Hujan kemarin ≥ ambang → ingatkan inspeksi jalan angkut & cek lereng (sekali per hari).
  const [cu] = await sql`SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal, hujan_mm FROM cuaca_harian WHERE tanggal = (now() AT TIME ZONE 'Asia/Makassar')::date - 1`;
  if (cu && Number(cu.hujan_mm) >= AMBANG_HUJAN_MM) {
    const sudah = (await sql`SELECT 1 FROM peringatan_dd WHERE jenis = 'hujan' AND nama = ${cu.tanggal}`).length;
    hasil.hujan = { tanggal: cu.tanggal, mm: Number(cu.hujan_mm), sudah: !!sudah };
    if (!sudah) {
      const ops = roster.filter((r) => /OPERATION|PRODUCTION|PRODUKSI/.test(norm(r.DEPARTEMEN)) && /SECTION HEAD|SECT\.? HEAD/.test(norm(r.JABATAN)));
      const penerima = [...sheHead, ...ops];
      const subjek = `[ONE-SAP] Hujan ${Number(cu.hujan_mm).toFixed(0)} mm kemarin — lakukan Inspeksi Jalan Angkut`;
      const teks = `Curah hujan ${cu.tanggal} sekitar ${Number(cu.hujan_mm).toFixed(1)} mm (≥ ${AMBANG_HUJAN_MM} mm). Riwayat insiden menunjukkan jalan licin `
        + `& longsor sering terjadi setelah hujan.\n\nMohon lakukan Inspeksi Jalan Angkut (INS_JA), cek tanggul jalan, drainase, dan lereng sebelum operasi penuh.`;
      if (!dry) await sql`INSERT INTO peringatan_dd (jenis, dimensi, nama, status, alasan, penerima)
        VALUES ('hujan', 'cuaca', ${cu.tanggal}, 'kuning', ${JSON.stringify([`hujan ${Number(cu.hujan_mm).toFixed(1)} mm`])}::jsonb, ${JSON.stringify(penerima.map((p) => p.NAMA))}::jsonb)`;
      await kirim(penerima, subjek, teks, 'https://sap-ebl.vercel.app/inspection-form.html?type=INS_JA');
    }
  }
  if (!dry) try { hasil.laporanBulanan = await simpanLaporanBulanan(sql, d); } catch (e) { hasil.laporanBulananGalat = e.message; }
  console.log('[deteksi-dini]', JSON.stringify({ ...hasil, peringatan: hasil.peringatan.length }));
  return hasil;
}

// ── Tahap 6: laporan bulanan → Laporan Eksekutif SIKAP (tanpa email manajemen, keputusan user 14 Okt) ──
// Disimpan per bulan; SIKAP hanya membaca tabel ini. Bulan berjalan diperbarui tiap hari, bulan lalu
// difinalkan s/d tanggal 3; tabel kosong / semua=true → isi semua bulan sejak data pertama.
async function simpanLaporanBulanan(sql, d, { semua = false } = {}) {
  const b = d._bahan;
  if (!b) throw new Error('bahan laporan bulanan tidak ada (bukan lingkup Super Admin)');
  await sql`CREATE TABLE IF NOT EXISTS laporan_dd_bulanan (bulan TEXT PRIMARY KEY, data JSONB NOT NULL, diperbarui TIMESTAMPTZ DEFAULT now())`;
  const hariIni = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
  const geser = (bln, n) => { const [y, m] = bln.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
  const ini = hariIni.slice(0, 7);
  let bulan = [ini];
  if (Number(hariIni.slice(8)) <= 3) bulan.unshift(geser(ini, -1));
  if (semua || !(await sql`SELECT 1 FROM laporan_dd_bulanan LIMIT 1`).length) {
    bulan = [];
    for (let x = String(b.siap[0]?.tanggal || hariIni).slice(0, 7); x <= ini; x = geser(x, 1)) bulan.push(x);
  }
  const [peringatan, cuaca] = await Promise.all([
    sql`SELECT to_char(dibuat AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS tanggal, jenis, tanggapan FROM peringatan_dd`,
    sql`SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal, hujan_mm::float AS hujan_mm FROM cuaca_harian`,
  ]);
  for (const bln of bulan) {
    const h = LaporanBulanan.ringkasanBulan({ bulan: bln, hariIni, siap: b.siap, insiden: b.insiden, peringatan, cuaca,
      nama: b.nama, jenisArea: (l) => b.area.get(l), penyebabInsiden: b.penyebabInsiden });
    await sql`INSERT INTO laporan_dd_bulanan (bulan, data, diperbarui) VALUES (${bln}, ${JSON.stringify(h)}::jsonb, now())
      ON CONFLICT (bulan) DO UPDATE SET data = EXCLUDED.data, diperbarui = now()`;
  }
  return bulan;
}

// Kategori hujan harian standar BMKG (mm/hari): ringan 0,5–20, sedang 20–50, lebat 50–100,
// sangat lebat 100–150, ekstrem > 150; < 0,5 = gerimis. Tanpa hujan → kode cuaca WMO Open-Meteo.
function kategoriCuaca(k, mm) {
  const h = Number(mm) || 0;
  if (k >= 95) return ['Badai petir', 'fa-cloud-bolt'];
  if (h > 150) return ['Hujan ekstrem', 'fa-cloud-showers-water'];
  if (h >= 100) return ['Hujan sangat lebat', 'fa-cloud-showers-water'];
  if (h >= 50) return ['Hujan lebat', 'fa-cloud-showers-heavy'];
  if (h >= 20) return ['Hujan sedang', 'fa-cloud-showers-heavy'];
  if (h >= 0.5) return ['Hujan ringan', 'fa-cloud-rain'];
  if (h > 0 || (k >= 51 && k <= 57)) return ['Gerimis', 'fa-cloud-rain'];
  if (k === 45 || k === 48) return ['Berkabut', 'fa-smog'];
  if (k >= 3) return ['Berawan', 'fa-cloud'];
  if (k >= 1) return ['Cerah berawan', 'fa-cloud-sun'];
  return ['Cerah', 'fa-sun'];
}
const IKON_CUACA = (k, mm) => kategoriCuaca(k, mm)[1];
/** Ringkasan untuk semua pengguna: fokus minggu ini (area paling berisiko + penyebab insidennya) & cuaca. */
async function dataBeranda() {
  const sql = getSql();
  const d = await dataDeteksiDini({ role: 'SUPER_ADMIN', perusahaan: '' });
  const area = d.lokasi.find((l) => l.status !== 'hijau') || d.lokasi[0];
  const penyebab = (area && d.insidenPerLokasi[area.nama]) || d.penyebabInsiden.slice(0, 3);
  await ensureDeteksiDiniTables(sql);
  const cuaca = await sql`SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal, hujan_mm::float AS hujan_mm, jam_hujan::float AS jam_hujan,
      angin_maks::float AS angin_maks, suhu_maks::float AS suhu_maks, kode_cuaca FROM cuaca_harian
    WHERE tanggal BETWEEN (now() AT TIME ZONE 'Asia/Makassar')::date - 1 AND (now() AT TIME ZONE 'Asia/Makassar')::date + 1 ORDER BY tanggal`;
  return {
    status: 'success',
    fokus: area ? { lokasi: area.nama, status: area.status, alasan: area.alasan, penyebab: penyebab.slice(0, 3) } : null,
    cuaca: cuaca.map((c) => ({ ...c, ikon: IKON_CUACA(c.kode_cuaca, c.hujan_mm), kategori: kategoriCuaca(c.kode_cuaca, c.hujan_mm)[0] })),
  };
}

function todayJakarta() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function resolveStatusKerja(src, nik, nama) {
  if (!src) return 'aktif';
  const key = String(nik || '').trim();
  if (!key) return 'aktif';

  const bridged = src.bridgeRows.find(r => String(r.nik || '').trim() === key);
  let match = bridged && bridged.karyawan_id ? src.karyawan.find(r => r.id === bridged.karyawan_id.trim()) : undefined;
  if (!match) {
    match = src.karyawan.find(r => r.status === 'approved' && String(r.nrp || '').trim() === key && namaCocok(r.nama || '', nama));
  }
  if (!match) return 'aktif';
  if (!match.cutiMulai || !match.cutiSelesai) return 'aktif';

  const today = todayJakarta();
  if (today < match.cutiMulai) return 'aktif';
  if (today <= match.cutiSelesai) return 'cuti';

  // Lewat cutiSelesai — sudah reinduksi pasca cuti (TR_REINDUKSI, SIMANTRA K3)?
  const done = src.records.some(r => r.karyawan_id === match.id && r.training_id === 'TR_REINDUKSI'
    && r.status === 'Hadir' && (r.tanggal_selesai || '') >= match.cutiSelesai);
  return done ? 'aktif' : 'wajib_reinduksi';
}

/** Status kerja real-time ("aktif" | "cuti" | "wajib_reinduksi") dari data
 * SISTER MINER, dicocokkan by NIK (fallback nrp+nama, sama seperti bridge.ts).
 * SISTER_MINER_SPREADSHEET_ID belum diset, atau karyawan gak ketemu di sana →
 * "aktif" (jangan blokir siapa pun gara-gara data tidak lengkap/mismatch). */
async function getStatusKerjaByNik(sheets, nik, nama) {
  const src = await loadCutiSources(sheets);
  return resolveStatusKerja(src, nik, nama);
}

/** Anotasi STATUS_KERJA ke tiap baris Master_Karyawan sekaligus (1 fetch, bukan
 * N) — dipakai buat menandai dropdown PIC di frontend. */
async function annotateStatusKerja(sheets, rows) {
  const src = await loadCutiSources(sheets);
  if (!src) return rows; // fitur cuti belum dikonfigurasi — jangan tempel field kosong
  return rows.map(r => ({ ...r, STATUS_KERJA: resolveStatusKerja(src, r['NIK'], r['NAMA']) }));
}

// Cuti TIDAK lagi menutup akses ONE-SAP (keputusan user 2026-10-08): karyawan
// yang cuti tetap bisa login & melihat/membuat laporan, hanya tidak bisa jadi PIC.

/** PIC yang dipilih tidak boleh sedang cuti (2026-10-08: hanya cuti; dulu juga
 * wajib_reinduksi). ponytail: kalau nik_pic tidak terkirim dari form, skip (tidak
 * cukup data buat verifikasi aman) — celah ini sudah ada sebelumnya. */
const isMagang = (k) => /MAGANG/i.test(String((k && k.JABATAN) || '')); // 2026-10-15: magang tidak bisa jadi PIC
async function assertPicEligible(sheets, nikPic, namaPic) {
  if (!nikPic && !namaPic) return;
  const rows = await _karyawanRows(sheets);
  const nik = String(nikPic || '').trim(), nama = String(namaPic || '').trim().toUpperCase();
  const k = rows.find((r) => nik && String(r.NIK || '').trim() === nik) || (!nik && rows.find((r) => String(r.NAMA || '').trim().toUpperCase() === nama));
  if (isMagang(k)) throw Object.assign(new Error(`PIC yang dipilih (${namaPic || nikPic}) berstatus magang, tidak bisa ditunjuk sebagai PIC.`), { httpStatus: 400 });
  if (!nikPic) return;
  const status = await getStatusKerjaByNik(sheets, nikPic, namaPic);
  if (status !== 'cuti') return;
  throw Object.assign(new Error(`PIC yang dipilih (${namaPic || nikPic}) sedang cuti, tidak bisa ditunjuk sebagai PIC.`), { httpStatus: 400 });
}

function getDriveClient() {
  const oauth2 = new (google().auth.OAuth2)(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google().drive({ version: 'v3', auth: oauth2 });
}

async function saveBase64ImageToDrive(base64Data, folderId, fileName) {
  if (!base64Data) return '';
  if (!folderId) throw new Error('Folder ID Google Drive belum dikonfigurasi. Hubungi administrator.');
  if (!process.env.GOOGLE_OAUTH_REFRESH_TOKEN) throw new Error('GOOGLE_OAUTH_REFRESH_TOKEN belum dikonfigurasi.');
  const { Readable } = require('stream');
  const drive = getDriveClient();
  const mimeMatch = base64Data.match(/^data:(.+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const buffer = Buffer.from(base64Data.replace(/^data:.+;base64,/, ''), 'base64');
  const file = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  });
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  return `https://drive.google.com/file/d/${file.data.id}/view`;
}

// Upload teks (mis. JSON backup) ke Drive. TIDAK dibuat publik — isinya sensitif.
async function saveTextToDrive(text, folderId, fileName, mimeType = 'application/json') {
  if (!folderId) throw new Error('Folder ID Google Drive belum dikonfigurasi.');
  if (!process.env.GOOGLE_OAUTH_REFRESH_TOKEN) throw new Error('GOOGLE_OAUTH_REFRESH_TOKEN belum dikonfigurasi.');
  const { Readable } = require('stream');
  const drive = getDriveClient();
  const buffer = Buffer.from(String(text), 'utf8');
  const file = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  });
  return `https://drive.google.com/file/d/${file.data.id}/view`;
}

async function saveMultipleImagesToDrive(base64DataField, folderId, idPrefix) {
  if (!base64DataField) return '';
  let list;
  if (Array.isArray(base64DataField)) {
    list = base64DataField;
  } else {
    try {
      const trimmed = String(base64DataField).trim();
      list = trimmed.startsWith('[') ? JSON.parse(trimmed) : [base64DataField];
    } catch { list = [base64DataField]; }
  }
  const urls = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i]) {
      const url = await saveBase64ImageToDrive(list[i], folderId, `${idPrefix}-${i + 1}.jpg`);
      if (url) urls.push(url);
    }
  }
  return urls.join(', ');
}

// Subfolder jenis (HR/INS/SBO/PC) di dalam folder DOKUMENTASI LAPORAN/CLOSING SAP
// (2026-09-22). find-or-create, di-cache per instance function. Fail-open: kalau
// gagal, pakai folder induk supaya upload tetap jalan.
const _subfolderCache = new Map();
async function driveSubfolderId(parentId, name) {
  if (!parentId || !name) return parentId;
  const key = parentId + '/' + name;
  if (_subfolderCache.has(key)) return _subfolderCache.get(key);
  try {
    const drive = getDriveClient();
    const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const list = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
    let id = list.data.files?.[0]?.id;
    if (!id) {
      const created = await drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
        fields: 'id',
      });
      id = created.data.id;
    }
    _subfolderCache.set(key, id);
    return id;
  } catch (e) {
    console.error('[drive] subfolder gagal, pakai folder induk:', e.message);
    return parentId;
  }
}

// report_type / konteks -> nama subfolder jenis (null = tidak dikelompokkan)
function _docTypeFolder(t) {
  const u = String(t || '').toUpperCase();
  if (u === 'HAZARD' || u === 'HR') return 'HR';
  if (u === 'INSPECTION' || u === 'INS') return 'INS';
  if (u === 'SBO') return 'SBO';
  if (u === 'PC') return 'PC';
  return null;
}

// ===== ACTIONS =====

function verifyPassword(input, stored) {
  const s = String(stored || '').trim();
  const i = String(input || '').trim();
  if (!s || !i) return false;
  // Hash bcrypt diawali $2a$/$2b$/$2y$ — fallback plaintext hanya untuk masa transisi
  // sebelum script migrasi hash-passwords.js dijalankan.
  if (/^\$2[aby]\$/.test(s)) return bcrypt.compareSync(i, s);
  return s === i;
}

function requireAuth(req) {
  if (!JWT_SECRET) throw Object.assign(new Error('JWT_SECRET belum diset di environment.'), { httpStatus: 500 });
  const header = String(req.headers['authorization'] || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw Object.assign(new Error('Tidak terautentikasi. Silakan login.'), { httpStatus: 401 });
  try {
    return jwt.verify(token, JWT_SECRET); // { nik, nama, role, iat, ... }
  } catch {
    throw Object.assign(new Error('Sesi berakhir. Silakan login ulang.'), { httpStatus: 401 });
  }
}

// #2 — Cek apakah token sudah di-invalidasi via logout (LAST_LOGOUT_AT di sheet)
async function checkTokenValid(sheets, auth) {
  const data = await _karyawanRows(sheets);
  const user = data.find(r => String(r['NIK'] || '').trim() === String(auth.nik || '').trim());
  if (!user) return;
  const lastLogout = Number(user['LAST_LOGOUT_AT'] || 0);
  if (lastLogout && (auth.iat || 0) * 1000 < lastLogout)
    throw Object.assign(new Error('Sesi tidak valid. Silakan login ulang.'), { httpStatus: 401 });

}

// Helper: set satu field di baris karyawan (Postgres JSONB). colName = key
// HEADER ASLI persis seperti dibaca client (mis. 'EMAIL', 'LOGIN_LOCKED_UNTIL',
// 'LAST_LOGOUT_AT'). Sinkron kolom top-level role/email untuk quiz-she & index.
async function _updateKaryawanCol(sheets, nik, colName, value) {
  try {
    const sql = getSql(); if (!sql) return;
    const nikStr = String(nik || '').trim(); if (!nikStr) return;
    const val = value === undefined || value === null ? '' : String(value);
    const patch = JSON.stringify({ [colName]: val });
    const up = colName.toUpperCase();
    if (up === 'ROLE')
      await sql`UPDATE karyawan SET data = data || ${patch}::jsonb, role = ${val} WHERE nik = ${nikStr}`;
    else if (up === 'EMAIL')
      await sql`UPDATE karyawan SET data = data || ${patch}::jsonb, email = ${val} WHERE nik = ${nikStr}`;
    else
      await sql`UPDATE karyawan SET data = data || ${patch}::jsonb WHERE nik = ${nikStr}`;
    invalidateCache('Master_Karyawan');
  } catch { /* fail silently — jangan break alur utama */ }
}

async function login(sheets, nik, password, ip) {
  const ipCheck = checkIpRateLimit(ip);
  if (!ipCheck.ok) return { status: 'error', message: ipCheck.message };

  const rateCheck = checkLoginRateLimit(nik);
  if (!rateCheck.ok) return { status: 'error', message: rateCheck.message };

  const data = await _karyawanRows(sheets);
  const user = data.find(row => String(row['NIK'] || '').trim() === String(nik || '').trim());

  // #1 — Persistent lockout check (survives cold start / multi-instance)
  if (user) {
    const lockedMs = Number(user['LOGIN_LOCKED_UNTIL'] || 0);
    if (lockedMs && Date.now() < lockedMs) {
      const mnt = Math.ceil((lockedMs - Date.now()) / 60000);
      recordFailedLogin(nik, ip);
      return { status: 'error', message: `Terlalu banyak percobaan. Coba lagi dalam ${mnt} menit.` };
    }
  }

  if (!user || normalizeRole(user['ROLE']) === 'DELETED' || !verifyPassword(password, user['PASSWORD'])) {
    recordFailedLogin(nik, ip);
    // Persist lockout ke sheet jika baru saja mencapai threshold
    const attempt = _loginAttempts.get(String(nik || '').trim().toLowerCase());
    if (attempt?.lockedUntil)
      _updateKaryawanCol(sheets, nik, 'LOGIN_LOCKED_UNTIL', attempt.lockedUntil).catch(() => {});
    return { status: 'error', message: 'NIK atau password salah.' };
  }
  clearFailedLogins(nik);
  _updateKaryawanCol(sheets, nik, 'LOGIN_LOCKED_UNTIL', '').catch(() => {}); // clear persistent lock

  const storedPw = String(user['PASSWORD'] || '');
  // Password dianggap lemah jika masih plaintext (belum di-hash) ATAU termasuk daftar password umum
  const isPlaintext = !/^\$2[aby]\$/.test(storedPw);
  const forceChange = isPlaintext || isWeakPassword(password);

  const email = String(user['EMAIL'] || '').trim();
  const emailVerified = !!String(user['EMAIL_VERIFIED_AT'] || '').trim();
  // Gate email HANYA aktif bila layanan email sudah dikonfigurasi (GMAIL_* env),
  // supaya rollout tidak mengunci siapa pun sebelum admin menyiapkan pengirim.
  const emailServiceOn = !!(process.env.GMAIL_SENDER && process.env.GMAIL_APP_PASSWORD);
  const emailRequired = emailServiceOn && (!email || !emailVerified);
  return {
    status: 'success',
    ...(forceChange ? { force_change_password: true } : {}),
    ...(emailRequired ? { need_email: true } : {}),
    user: {
      nik: String(user['NIK'] || '').trim(),
      nama: String(user['NAMA'] || '').trim(),
      jabatan: String(user['JABATAN'] || '').trim(),
      departemen: String(user['DEPARTEMEN'] || '').trim(),
      perusahaan: String(user['PERUSAHAAN'] || '').trim(),
      subcont: String(user['SUBCONT'] || user['PERUSAHAAN SUBCONT(1)'] || '').trim(),
      no_whatsapp: String(user['NO WHATSAPP'] || '').trim(),
      email,
      email_verified: emailVerified,
      email_required: emailRequired,
      role: String(user['ROLE'] || 'USER').trim().toUpperCase().replace(/\s+/g, '_')
    }
  };
}

async function changePassword(sheets, nik, oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 8)
    throw Object.assign(new Error('Password baru minimal 8 karakter.'), { httpStatus: 400 });
  if (isWeakPassword(newPassword))
    throw Object.assign(new Error('Password terlalu umum. Gunakan kombinasi huruf, angka, atau simbol.'), { httpStatus: 400 });

  const sql = getSql(); if (!sql) throw new Error('Database tidak tersedia.');
  const nikStr = String(nik || '').trim();
  const row = (await sql`SELECT data FROM karyawan WHERE nik = ${nikStr}`)[0];
  if (!row) throw new Error('User tidak ditemukan.');

  if (!verifyPassword(oldPassword, row.data['PASSWORD']))
    throw Object.assign(new Error('Password lama salah.'), { httpStatus: 400 });

  const hash = bcrypt.hashSync(newPassword, 10);
  await sql`UPDATE karyawan SET data = data || ${JSON.stringify({ PASSWORD: hash })}::jsonb WHERE nik = ${nikStr}`;
  invalidateCache('Master_Karyawan');
  return { status: 'success', message: 'Password berhasil diubah.' };
}

async function adminResetPassword(sheets, auth, targetNik, newPassword) {
  if (!isSuperAdmin(auth.role)) throw Object.assign(new Error('Hanya SUPER_ADMIN yang bisa reset password.'), { httpStatus: 403 });
  if (!newPassword || newPassword.length < 8)
    throw Object.assign(new Error('Password baru minimal 8 karakter.'), { httpStatus: 400 });
  if (isWeakPassword(newPassword))
    throw Object.assign(new Error('Password terlalu umum. Gunakan kombinasi huruf, angka, atau simbol.'), { httpStatus: 400 });

  const sql = getSql(); if (!sql) throw new Error('Database tidak tersedia.');
  const nikStr = String(targetNik || '').trim();
  const row = (await sql`SELECT nik FROM karyawan WHERE nik = ${nikStr}`)[0];
  if (!row) throw new Error('Karyawan tidak ditemukan.');

  const hash = bcrypt.hashSync(newPassword, 10);
  await sql`UPDATE karyawan SET data = data || ${JSON.stringify({ PASSWORD: hash })}::jsonb WHERE nik = ${nikStr}`;
  invalidateCache('Master_Karyawan');
  return { status: 'success', message: 'Password berhasil direset.' };
}

function issueToken(user) {
  return jwt.sign(
    { nik: user.nik, nama: user.nama, role: user.role, perusahaan: user.perusahaan, departemen: user.departemen },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function normalizeRole(role) { return String(role || '').trim().toUpperCase().replace(/\s+/g, '_'); }
function isSuperAdmin(role) { return normalizeRole(role) === 'SUPER_ADMIN'; }
function isAdminOrAbove(role) { const r = normalizeRole(role); return r === 'ADMIN' || r === 'SUPER_ADMIN'; }

const KARYAWAN_HEADERS = ['PERUSAHAAN','SUBCONT','NAMA','NIK','JABATAN','DEPARTEMEN','NO WHATSAPP','PASSWORD','ROLE','OBJ HR','OBJ INS','OBJ SBO','OBJ PC','EMAIL','EMAIL_VERIFIED_AT'];
const PENDING_HEADERS  = ['ID','TIMESTAMP','ACTION','PROPOSED_BY_NIK','PROPOSED_BY_NAMA','PERUSAHAAN','TARGET_NIK','DATA','STATUS','REVIEWED_BY','REVIEWED_AT','REJECTION_REASON'];

async function ensurePendingHeaders(sheets) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Pending_Changes!1:1' });
  if (!(res.data.values?.[0]?.length)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: 'Pending_Changes!A1',
      valueInputOption: 'RAW', requestBody: { values: [PENDING_HEADERS] }
    });
  }
}

// [PUSH-START] Push Notification helpers
const PUSH_SUB_HEADERS = ['NIK', 'ENDPOINT', 'P256DH', 'AUTH', 'CREATED_AT'];

async function ensurePushSubsSheet(sheets) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Push_Subscriptions!1:1' });
    if (!(res.data.values?.[0]?.length)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: 'Push_Subscriptions!A1',
        valueInputOption: 'RAW', requestBody: { values: [PUSH_SUB_HEADERS] }
      });
    }
  } catch {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: 'Push_Subscriptions' } } }] }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: 'Push_Subscriptions!A1',
        valueInputOption: 'RAW', requestBody: { values: [PUSH_SUB_HEADERS] }
      });
    } catch { /* sheet creation failed */ }
  }
}

async function savePushSubscription(sheets, nik, endpoint, p256dh, auth) {
  await ensurePushSubsSheet(sheets);
  await removePushSubscriptionByEndpoint(sheets, endpoint).catch(() => {});
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: 'Push_Subscriptions',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[nik, endpoint, p256dh, auth, new Date().toISOString()]] }
  });
}

async function removePushSubscriptionByEndpoint(sheets, endpoint) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Push_Subscriptions' });
  const rows = res.data.values || [];
  if (rows.length < 2) return;
  const headers = rows[0].map(h => String(h).trim().toUpperCase());
  const endpointCol = headers.indexOf('ENDPOINT');
  if (endpointCol === -1) return;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][endpointCol] || '').trim() === endpoint) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: `Push_Subscriptions!A${i + 1}:E${i + 1}`,
        valueInputOption: 'RAW', requestBody: { values: [['', '', '', '', '']] }
      });
    }
  }
}

async function sendPushToNik(sheets, nik, payload) {
  if (!nik || !ensureVapid()) return;
  try {
    const allSubs = await getSheetData(sheets, 'Push_Subscriptions');
    const nikStr = String(nik).trim();
    const userSubs = allSubs.filter(r => String(r['NIK'] || '').trim() === nikStr && r['ENDPOINT']);
    console.log(`[push] sendPushToNik nik="${nikStr}" subs=${userSubs.length}`);
    for (const sub of userSubs) {
      try {
        await webPush.sendNotification(
          { endpoint: sub['ENDPOINT'], keys: { p256dh: sub['P256DH'], auth: sub['AUTH'] } },
          JSON.stringify(payload)
        );
        console.log(`[push] sent ok to nik="${nikStr}"`);
      } catch (err) {
        console.error(`[push] send error nik="${nikStr}" status=${err.statusCode} msg=${err.message}`);
        if (err.statusCode === 410) await removePushSubscriptionByEndpoint(sheets, sub['ENDPOINT']).catch(() => {});
      }
    }
  } catch (err) { console.error('[push] sendPushToNik error:', err.message); }
}

// ── Notifikasi PWA kuis pengganti Safety Talk (2026-10-11) ─────────────────
// Untuk peserta berstatus wajib-kuis (Cuti/Dinas Luar/Shift Malam/Libur/Security
// Jaga) yang belum lulus kuis, bulan berjalan. Syarat kirim: kuis sesi itu SUDAH
// terbit di quiz-she, dan orangnya TIDAK sedang cuti (dikirim saat kembali onsite).
// Sekali per orang per sesi (kolom notif_kuis_at). Dipanggil saat absensi disimpan
// + cron harian (api/cron-kuis-st.js) untuk kuis yang terbit belakangan / pulang cuti.
const ST_WAJIB_KUIS = ['CUTI', 'DINAS_LUAR', 'SHIFT_MALAM', 'LIBUR', 'SECURITY_JAGA'];
const ST_LABEL = { CUTI: 'cuti', DINAS_LUAR: 'dinas luar', SHIFT_MALAM: 'shift malam', LIBUR: 'libur', SECURITY_JAGA: 'jaga' };

async function _kuisStTerbit() {
  const j = await (await fetch('https://quiz-she.vercel.app/api/data?action=sessions')).json();
  const list = Array.isArray(j) ? j : (j.value || j.sessions || []);
  return new Set(list.filter((s) => s.status === 'published').map((s) => String(s.topicCode || '').trim()).filter(Boolean));
}

async function kirimNotifKuisST(sheets, scheduleId = '') {
  if (!ensureVapid()) return { status: 'skip', reason: 'VAPID belum diset' };
  const sql = getSql();
  const bulan = todayJakarta().slice(0, 7);
  const sid = String(scheduleId || '').trim();
  const rows = await sql`
    SELECT a.schedule_id, a.nik, a.nama, a.status_kehadiran, s.judul_materi, s.tanggal
    FROM safety_talk_absensi a JOIN safety_talk_schedule s ON s.id = a.schedule_id
    WHERE a.status_kehadiran = ANY(${ST_WAJIB_KUIS}) AND coalesce(upper(a.quiz_done), '') <> 'YA'
      AND a.notif_kuis_at IS NULL AND a.bulan = ${bulan}
      AND (${sid} = '' OR a.schedule_id = ${sid})`;
  if (!rows.length) return { status: 'ok', terkirim: 0 };
  const terbit = await _kuisStTerbit();
  const siap = rows.filter((r) => terbit.has(String(r.schedule_id).trim()));
  if (!siap.length) return { status: 'ok', terkirim: 0, menungguKuis: rows.length };

  const src = await loadCutiSources(sheets);
  const subs = await getSheetData(sheets, 'Push_Subscriptions').catch(() => []);
  const now = new Date().toISOString();
  let terkirim = 0, cuti = 0;
  for (const r of siap) {
    if (resolveStatusKerja(src, r.nik, r.nama) === 'cuti') { cuti++; continue; } // tunggu kembali onsite
    const tgl = r.tanggal ? new Date(r.tanggal + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '';
    const payload = JSON.stringify({
      title: 'Kuis pengganti Safety Talk',
      body: `Kamu ${ST_LABEL[r.status_kehadiran] || 'tidak hadir'} saat Safety Talk "${r.judul_materi || ''}"${tgl ? ' (' + tgl + ')' : ''}. Kerjakan kuis penggantinya sebelum akhir bulan.`,
      url: 'https://sap-ebl.vercel.app/index-home.html?kuis=1',
    });
    for (const sub of subs.filter((x) => String(x['NIK'] || '').trim() === String(r.nik).trim() && x['ENDPOINT'])) {
      try {
        await webPush.sendNotification({ endpoint: sub['ENDPOINT'], keys: { p256dh: sub['P256DH'], auth: sub['AUTH'] } }, payload);
        terkirim++;
      } catch (err) {
        if (err.statusCode === 410) await removePushSubscriptionByEndpoint(sheets, sub['ENDPOINT']).catch(() => {});
      }
    }
    // Ditandai walau tak punya langganan push — popup beranda tetap mengarahkan.
    await sql`UPDATE safety_talk_absensi SET notif_kuis_at = ${now} WHERE schedule_id = ${r.schedule_id} AND nik = ${r.nik}`;
  }
  return { status: 'ok', diproses: siap.length - cuti, pushTerkirim: terkirim, tundaCuti: cuti, menungguKuis: rows.length - siap.length };
}

// Resolve NIK dari nomor WA — untuk hazard report yang tidak menyimpan nik_pic
async function resolveNikFromWa(sheets, wa) {
  if (!wa) return '';
  const phone = String(wa).replace(/\D/g, '');
  if (!phone) return '';
  // Normalise ke 62-prefix agar "081x" == "6281x" == "81x"
  const norm = p => p.replace(/^0/, '62').replace(/^(?!62)/, '62');
  const target = norm(phone);
  const karyawan = await _karyawanRows(sheets);
  // Header sheet adalah 'NO WHATSAPP' dan 'NIK' (uppercase sesuai KARYAWAN_HEADERS)
  const match = karyawan.find(r => norm(String(r['NO WHATSAPP'] || '').replace(/\D/g, '')) === target);
  const nik = String(match?.['NIK'] || '').trim();
  console.log(`[push] resolveNikFromWa wa="${wa}" target="${target}" found=${!!match} nik="${nik}"`);
  return nik;
}
// [PUSH-END]

async function getKaryawan(sheets, auth) {
  const rows = await _karyawanRows(sheets);
  const roleKey = rows.length ? (Object.keys(rows[0]).find(k => k.trim().toUpperCase() === 'ROLE') || 'ROLE') : 'ROLE';
  const active = rows.filter(r => normalizeRole(r[roleKey]) !== 'DELETED');
  let visible;
  if (isSuperAdmin(auth.role)) {
    visible = active;
  } else if (isAdminOrAbove(auth.role)) {
    // ADMIN: semua karyawan di perusahaan mereka
    const co = String(auth.perusahaan || '').trim().toUpperCase();
    if (!co) throw Object.assign(new Error('Perusahaan tidak ditemukan untuk akun ini.'), { httpStatus: 403 });
    visible = active.filter(r => String(r['PERUSAHAAN'] || '').trim().toUpperCase() === co);
  } else {
    // USER: hanya karyawan di departemen mereka (lebih ringan)
    const co   = String(auth.perusahaan  || '').trim().toUpperCase();
    const dept = String(auth.departemen  || '').trim().toUpperCase();
    if (!co) throw Object.assign(new Error('Perusahaan tidak ditemukan untuk akun ini.'), { httpStatus: 403 });
    visible = active.filter(r =>
      String(r['PERUSAHAAN'] || '').trim().toUpperCase() === co &&
      String(r['DEPARTEMEN'] || '').trim().toUpperCase() === dept
    );
  }
  return { status: 'success', data: stripSensitiveKaryawan(visible) };
}

async function proposeChange(sheets, auth, action, data) {
  if (!isAdminOrAbove(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
  await ensurePendingHeaders(sheets);
  const id = 'PC-' + Date.now();
  const row = [
    id, new Date().toISOString(), action.toUpperCase(),
    auth.nik, auth.nama, auth.perusahaan || '',
    data.NIK || '', JSON.stringify(data), 'PENDING', '', '', ''
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: 'Pending_Changes',
    valueInputOption: 'USER_ENTERED', requestBody: { values: [row] }
  });
  // WA ke semua SUPER_ADMIN
  const karyawan = await _karyawanRows(sheets);
  for (const sa of karyawan.filter(r => isSuperAdmin(r['ROLE']))) {
    if (sa['NO WHATSAPP']) {
      const msg = `Halo ${sa['NAMA']}, ada permohonan *${action.toUpperCase()}* data karyawan dari *${auth.nama}* (${auth.perusahaan}).\n\n👤 User: ${data.NAMA || data.NIK || '-'}\n\nSilakan buka dashboard untuk review dan approval.`;
      await sendWaNotification(sa['NO WHATSAPP'], msg).catch(() => {});
      await new Promise(r => setTimeout(r, 2500)); // jeda antar SUPER_ADMIN — hindari spam detection
    }
  }
  return { status: 'success', message: 'Permohonan dikirim, menunggu persetujuan SUPER ADMIN.', id };
}

async function getPendingChanges(sheets, auth) {
  if (!isAdminOrAbove(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
  await ensurePendingHeaders(sheets);
  const data = await getSheetData(sheets, 'Pending_Changes');
  const result = isSuperAdmin(auth.role) ? data
    : data.filter(r => String(r['PROPOSED_BY_NIK'] || '') === String(auth.nik || ''));
  return { status: 'success', data: result };
}

async function applyUserChange(sheets, action, data) {
  const sql = getSql(); if (!sql) throw new Error('Database tidak tersedia.');
  if (action === 'ADD') {
    if (data.PASSWORD && !/^\$2[aby]\$/.test(data.PASSWORD))
      data.PASSWORD = bcrypt.hashSync(data.PASSWORD, 10);
    // Baris disimpan dengan key HEADER ASLI (sama seperti getSheetData) agar
    // read via _karyawanRows tetap kompatibel dengan client.
    const obj = {}; KARYAWAN_HEADERS.forEach(h => { obj[h] = data[h] ?? ''; });
    const nik = String(obj.NIK || '').trim();
    if (!nik) throw new Error('NIK wajib diisi.');
    await sql`
      INSERT INTO karyawan (nik, role, email, data)
      VALUES (${nik}, ${String(obj.ROLE || '')}, ${String(obj.EMAIL || '')}, ${JSON.stringify(obj)}::jsonb)
      ON CONFLICT (nik) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email, data = EXCLUDED.data`;
  } else if (action === 'EDIT' || action === 'DELETE') {
    const dataNik  = String(data.NIK  || '').trim();
    const dataNama = String(data.NAMA || '').trim().toLowerCase();
    const row = (await sql`SELECT data FROM karyawan WHERE nik = ${dataNik}`)[0];
    // Cocokkan NIK + NAMA sekaligus — cegah ubah/hapus orang yang salah
    const namaMatch = row && String(row.data['NAMA'] || '').trim().toLowerCase() === dataNama;
    if (!row || !namaMatch) throw new Error(`User ${data.NAMA || data.NIK || '?'} tidak ditemukan.`);
    if (action === 'DELETE') {
      await sql`DELETE FROM karyawan WHERE nik = ${dataNik}`;
    } else {
      // Email yang diisi admin dianggap tervalidasi (tanpa OTP) — set timestamp.
      if (typeof data.EMAIL === 'string' && data.EMAIL.trim() && data.EMAIL_VERIFIED_AT === undefined)
        data.EMAIL_VERIFIED_AT = new Date().toISOString();
      const patch = {};
      for (const [k, v] of Object.entries(data)) { if (k.toUpperCase() !== 'PASSWORD') patch[k] = v; }
      const merged = { ...row.data, ...patch };
      await sql`UPDATE karyawan SET data = ${JSON.stringify(merged)}::jsonb,
                  role = ${String(merged.ROLE || '')}, email = ${String(merged.EMAIL || '')}
                WHERE nik = ${dataNik}`;
      // Ikut perbarui SISTER MINER (sm."Karyawan", juga dibaca SIMANTRA K3) supaya
      // roster tak menyimpang -- dulu edit di ONE-SAP berhenti di sini (2026-10-06).
      const SM_FIELDS = { NAMA: 'nama', JABATAN: 'jabatan', DEPARTEMEN: 'departemen', PERUSAHAAN: 'perusahaan', EMAIL: 'email' };
      const smPatch = {};
      for (const [k, f] of Object.entries(SM_FIELDS)) if (typeof patch[k] === 'string') smPatch[f] = patch[k].trim();
      if (Object.keys(smPatch).length) {
        smPatch.updatedAt = new Date().toISOString();
        await sql`UPDATE sm."Karyawan" SET data = data || ${JSON.stringify(smPatch)}::jsonb
                  WHERE data->>'nrp' = ${dataNik}`
          .catch(e => console.error('[applyUserChange] sync SISTER MINER gagal:', e.message));
      }
    }
  }
  invalidateCache('Master_Karyawan');
}

async function reviewChange(sheets, auth, changeId, decision, reason) {
  if (!isSuperAdmin(auth.role)) throw Object.assign(new Error('Hanya SUPER ADMIN yang bisa menyetujui.'), { httpStatus: 403 });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Pending_Changes' });
  const rows = res.data.values || [];
  if (rows.length < 2) throw new Error('Tidak ada data pending.');
  const headers = rows[0].map(h => String(h).trim().toUpperCase());
  const col = k => headers.indexOf(k.toUpperCase());
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[col('ID')] || '').trim() === String(changeId).trim());
  if (rowIdx === -1) throw new Error('Permohonan tidak ditemukan.');
  if (String(rows[rowIdx][col('STATUS')] || '').toUpperCase() !== 'PENDING')
    throw new Error('Permohonan sudah diproses sebelumnya.');

  const action = String(rows[rowIdx][col('ACTION')] || '');
  const data   = JSON.parse(rows[rowIdx][col('DATA')] || '{}');
  if (decision === 'APPROVE') { await applyUserChange(sheets, action, data); invalidateCache('Master_Karyawan'); }

  const newStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data: [
      { range: `Pending_Changes!${colIndexToLetter(col('STATUS'))}${rowIdx + 1}`,         values: [[newStatus]] },
      { range: `Pending_Changes!${colIndexToLetter(col('REVIEWED_BY'))}${rowIdx + 1}`,    values: [[auth.nik]] },
      { range: `Pending_Changes!${colIndexToLetter(col('REVIEWED_AT'))}${rowIdx + 1}`,    values: [[new Date().toISOString()]] },
      { range: `Pending_Changes!${colIndexToLetter(col('REJECTION_REASON'))}${rowIdx + 1}`, values: [[reason || '']] },
    ]}
  });

  // WA ke proposer
  const proposerNik = String(rows[rowIdx][col('PROPOSED_BY_NIK')] || '');
  const karyawan = await _karyawanRows(sheets);
  const proposer = karyawan.find(r => String(r['NIK'] || '').trim() === proposerNik);
  if (proposer?.['NO WHATSAPP']) {
    const icon = decision === 'APPROVE' ? '✅' : '❌';
    let msg = `Halo ${proposer['NAMA']}, permohonan perubahan data karyawan kamu *${icon} ${newStatus}*`;
    if (decision === 'REJECT' && reason) msg += `\n\nAlasan: ${reason}`;
    await sendWaNotification(proposer['NO WHATSAPP'], msg).catch(() => {});
  }
  return { status: 'success', message: `Permohonan berhasil ${decision === 'APPROVE' ? 'disetujui' : 'ditolak'}.` };
}

function stripSensitiveKaryawan(rows) {
  // Jangan pernah kirim kolom PASSWORD ke client
  return rows.map(r => {
    const clean = { ...r };
    Object.keys(clean).forEach(k => {
      if (normalizeHeader(k) === 'password') delete clean[k];
    });
    return clean;
  });
}

// Field berat (tanda tangan base64 ~40KB/baris) dibuang dari DAFTAR — hanya
// dibutuhkan di halaman/ modal detail, yang mengambilnya lewat action getReport.
function _stripHeavy(o) { delete o.tanda_tangan; delete o.signature; return o; }

async function getHazardReports(sheets, auth) {
  let result = (await getSql()`SELECT data FROM hazard_report`)
    .map(r => _stripHeavy({ ...r.data, report_type: 'HAZARD' }))
    .filter(obj => String(obj.id || '').trim());
  // Scope by company — hanya SUPER_ADMIN yang bisa lihat semua perusahaan
  if (!isSuperAdmin(auth?.role)) {
    const co = String(auth?.perusahaan || '').trim().toUpperCase();
    if (co) result = result.filter(r => String(r.perusahaan || '').trim().toUpperCase() === co);
  }
  return { status: 'success', data: result };
}

async function getInspectionReports(sheets, auth) {
  let data = (await getSql()`SELECT jenis, data FROM inspection_report`)
    .map(r => _stripHeavy({ ...r.data, report_type: 'INSPECTION', inspection_sheet: r.jenis }))
    .filter(obj => String(obj.id || '').trim());
  // Scope by company — hanya SUPER_ADMIN yang bisa lihat semua perusahaan
  if (!isSuperAdmin(auth?.role)) {
    const co = String(auth?.perusahaan || '').trim().toUpperCase();
    if (co) data = data.filter(r => String(r.perusahaan || '').trim().toUpperCase() === co);
  }
  return { status: 'success', data };
}

function isReportVisibleForUser(report, userNik, userName) {
  const getVal = (...keys) => {
    for (const k of keys) {
      const v = report[k];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim().toLowerCase();
    }
    return '';
  };
  const reporterNik = getVal('nik', 'reporter_nik');
  const reporterName = getVal('nama', 'pelapor', 'reporter', 'nama_pelapor');
  const picNik = getVal('nik_pic', 'nip_pic');
  const picName = getVal('nama_pic', 'pic', 'penanggung_jawab');
  return (userNik && reporterNik === userNik) || (userName && reporterName === userName) ||
         (userNik && picNik === userNik) || (userName && picName === userName);
}

async function getAllReports(sheets, nik, nama, role, perusahaan) {
  const auth = { role, perusahaan };
  const [h, i] = await Promise.all([getHazardReports(sheets, auth), getInspectionReports(sheets, auth)]);
  let combined = [...(h.data || []), ...(i.data || [])];
  const userNik = String(nik || '').trim().toLowerCase();
  const userName = String(nama || '').trim().toLowerCase();
  const userRole = String(role || '').trim().toUpperCase();
  // USER hanya lihat laporannya sendiri; ADMIN & SUPER_ADMIN sudah di-scope by company oleh getHazardReports/getInspectionReports
  if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN' && (userNik || userName)) {
    combined = combined.filter(r => isReportVisibleForUser(r, userNik, userName));
  }
  return { status: 'success', data: combined };
}

// Absensi Safety Talk milik user sbg "laporan" ringkas untuk feed beranda —
// join ke schedule buat tanggal + judul materi. Scope perusahaan spt getter lain.
async function getSafetyTalkFeed(auth) {
  const sql = getSql();
  let rows;
  try {
    rows = await sql`
      SELECT a.schedule_id, a.nik, a.nama, a.perusahaan, a.status_kehadiran, a.checked_at,
             s.tanggal AS s_tanggal, s.bulan AS s_bulan, s.judul_materi
      FROM safety_talk_absensi a
      LEFT JOIN safety_talk_schedule s ON s.id = a.schedule_id`;
  } catch { return { status: 'success', data: [] }; }
  let data = rows.map(r => ({
    id: `ST-${r.schedule_id}-${r.nik}`,
    report_type: 'ST',
    nik: r.nik || '',
    nama: r.nama || '',
    perusahaan: r.perusahaan || '',
    status_kehadiran: r.status_kehadiran || '',
    timestamp: r.checked_at || r.s_tanggal || '',
    tanggal_laporan: r.s_tanggal || '',
    deskripsi: r.judul_materi ? `Safety Talk: ${r.judul_materi}` : `Safety Talk ${r.s_bulan || ''}`.trim(),
  }));
  if (!isSuperAdmin(auth?.role)) {
    const co = String(auth?.perusahaan || '').trim().toUpperCase();
    if (co) data = data.filter(r => String(r.perusahaan || '').trim().toUpperCase() === co);
  }
  return { status: 'success', data };
}

// Aktivitas SBO/PC/ST MILIK user (feed "Laporan Terakhir" di beranda) — dinormalisasi
// ke bentuk seragam (nik/nama pelapor, timestamp, deskripsi, status_perbaikan) supaya
// bisa digabung dgn HR/INS di sisi klien. Selalu difilter ke kepemilikan user (nik/nama);
// endpoint TERPISAH dari getAllReports agar halaman Export (HR/INS) tak terpengaruh.
async function getMyActivityExtras(sheets, auth) {
  const [sbo, pc, st] = await Promise.all([
    getSBOReports(sheets, auth).catch(() => ({ data: [] })),
    getPCReports(sheets, auth).catch(() => ({ data: [] })),
    getSafetyTalkFeed(auth).catch(() => ({ data: [] })),
  ]);
  const sboN = (sbo.data || []).map(r => ({
    ...r,
    report_type: 'SBO',
    nik: r.nik_observer || '',
    nama: r.nama_observer || '',
    timestamp: r.timestamp || r.tgl_observasi || '',
    deskripsi: r.deskripsi_temuan || r.nama_pekerjaan || 'Observasi SBO',
  }));
  const pcN = (pc.data || []).map(r => ({
    ...r,
    report_type: 'PC',
    nik: r.nik_coach || '',
    nama: r.nama_coach || '',
    status_perbaikan: r.status || 'OPEN',
    timestamp: r.timestamp || r.tgl_pc || '',
    deskripsi: r.judul_coaching || r.topik_coaching || r.deskripsi_coaching || 'Personal Contact',
  }));
  let all = [...sboN, ...pcN, ...(st.data || [])];

  const nik  = String(auth?.nik  || '').trim().toLowerCase();
  const nama = String(auth?.nama || '').trim().toLowerCase();
  all = all.filter(r =>
    (nik && String(r.nik || '').trim().toLowerCase() === nik) ||
    (nama && String(r.nama || '').trim().toLowerCase() === nama));
  return { status: 'success', data: all };
}

// Satu laporan PENUH (termasuk tanda_tangan) by id — dipakai halaman/modal detail
// supaya daftar bisa ramping tanpa tanda tangan. Cek visibilitas seperti getAllReports.
// TTD PIC untuk lembar print (2026-10-07): roster tak menyimpan berkas tanda tangan,
// jadi pakai tanda tangan TERBARU yang pernah ia bubuhkan sebagai pelapor (Hazard/Inspeksi).
async function _latestSignature(nik, nama) {
  const n = String(nik || '').trim(), nm = String(nama || '').trim();
  if (!n && !nm) return '';
  // Tanda tangan tersimpan (profil, fitur 2.1) diutamakan.
  const prof = (await getSql()`
    SELECT s.data FROM user_signature s LEFT JOIN karyawan k ON k.nik = s.nik
    WHERE (${n} <> '' AND s.nik = ${n}) OR (${nm} <> '' AND upper(k.data->>'NAMA') = upper(${nm}))
    LIMIT 1`.catch(() => []))[0];
  if (prof) return prof.data;
  const rows = await getSql()`
    SELECT ttd, ts FROM (
      SELECT data->>'tanda_tangan' ttd, data->>'timestamp' ts, data->>'nik' nik, data->>'nama' nama FROM hazard_report
      UNION ALL
      SELECT data->>'tanda_tangan', data->>'timestamp', data->>'nik', data->>'nama' FROM inspection_report
    ) x
    WHERE coalesce(ttd, '') <> ''
      AND ((${n} <> '' AND nik = ${n}) OR (${nm} <> '' AND upper(nama) = upper(${nm})))
    ORDER BY (ts ~ '^\d{4}-') DESC, ts DESC
    LIMIT 1`;
  return rows[0]?.ttd || '';
}

// ── Tanda tangan tersimpan per orang (fitur 2.1, 2026-10-07) ─────────────────
// Disimpan sebagai data URL PNG di tabel user_signature (bukan di roster: ±20 KB/orang
// akan memberatkan setiap baca roster). Data URL — bukan link Drive — karena gambar
// Drive di <canvas> membuat kanvas "tainted" dan toDataURL() gagal saat kirim laporan.
async function _driveImageAsDataUrl(url) {
  const m = String(url).match(/\/d\/([\w-]+)/) || String(url).match(/[?&]id=([\w-]+)/);
  if (!m) return '';
  const r = await getDriveClient().files.get({ fileId: m[1], alt: 'media' }, { responseType: 'arraybuffer' });
  return 'data:image/png;base64,' + Buffer.from(r.data).toString('base64');
}

async function getMySignature(auth) {
  const sql = getSql();
  const nik = String(auth.nik || '').trim();
  if (!nik) return { status: 'success', data: '' };
  const row = (await sql`SELECT data FROM user_signature WHERE nik = ${nik}`)[0];
  if (row) return { status: 'success', data: row.data };
  // Belum punya: ambil sekali dari laporan terakhir yang ia buat sebagai pelapor.
  const me = await _rosterByNik(nik);
  const last = await _seedSignatureDariLaporan(nik, me?.NAMA || auth.nama);
  return { status: 'success', data: last, from_report: !!last };
}

/** TTD terakhir dari laporan yang ia buat → disimpan sebagai TTD tersimpan (sekali).
 * Dipanggil hanya untuk NIK yang BELUM punya baris user_signature (baris kosong =
 * sengaja dihapus lewat "Tanda Tangan Saya" → tidak diisi ulang). */
async function _seedSignatureDariLaporan(nik, nama) {
  let last = await _latestSignature(nik, nama).catch(() => '');
  if (last && !last.startsWith('data:')) last = await _driveImageAsDataUrl(last).catch(() => '');
  if (!last) return '';
  await getSql()`INSERT INTO user_signature (nik, data) VALUES (${nik}, ${last}) ON CONFLICT (nik) DO NOTHING`;
  return last;
}

async function saveMySignature(auth, data) {
  const nik = String(auth.nik || '').trim();
  const img = String(data?.tanda_tangan || '');
  if (!nik) throw new Error('Akun tanpa NIK.');
  if (!/^data:image\/(png|jpeg);base64,/.test(img)) throw new Error('Format tanda tangan tidak valid.');
  if (img.length > 400_000) throw new Error('Gambar tanda tangan terlalu besar.');
  await getSql()`INSERT INTO user_signature (nik, data, updated_at) VALUES (${nik}, ${img}, now())
    ON CONFLICT (nik) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  return { status: 'success' };
}

// TTD PIC dibekukan saat closing dikirim (2026-10-08): cetakan laporan itu tidak
// berubah walau PIC mengganti tanda tangannya nanti. Tabel terpisah (bukan di data
// laporan) supaya daftar laporan tetap ringan — gambar ±20 KB per laporan.
let _closingSigTable = false;
async function _bekukanTtdPic(id, nikPic, namaPic) {
  const ttd = await _latestSignature(nikPic, namaPic);
  if (!ttd) return;
  const sql = getSql();
  if (!_closingSigTable) {
    await sql`CREATE TABLE IF NOT EXISTS closing_signature (id text PRIMARY KEY, data text NOT NULL, created_at timestamptz DEFAULT now())`;
    _closingSigTable = true;
  }
  await sql`INSERT INTO closing_signature (id, data) VALUES (${String(id).trim()}, ${ttd})
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, created_at = now()`;
}

async function hapusMySignature(auth) {
  const nik = String(auth.nik || '').trim();
  if (!nik) throw new Error('Akun tanpa NIK.');
  await getSql()`INSERT INTO user_signature (nik, data, updated_at) VALUES (${nik}, '', now())
    ON CONFLICT (nik) DO UPDATE SET data = '', updated_at = now()`;
  return { status: 'success' };
}

async function getReportById(id, auth) {
  const sql = getSql();
  const idT = String(id || '').trim();
  if (!idT) return { status: 'error', message: 'ID kosong.' };
  let row = (await sql`SELECT data FROM hazard_report WHERE id = ${idT}`)[0];
  let report = row ? { ...row.data, report_type: 'HAZARD' } : null;
  if (!report) {
    row = (await sql`SELECT jenis, data FROM inspection_report WHERE id = ${idT}`)[0];
    report = row ? { ...row.data, report_type: 'INSPECTION', inspection_sheet: row.jenis } : null;
  }
  if (!report) return { status: 'error', message: 'Laporan tidak ditemukan.' };
  // Scope perusahaan (non-super-admin) + kepemilikan (user biasa)
  const roleU = normalizeRole(auth?.role);
  if (roleU !== 'SUPER_ADMIN') {
    const co = String(auth?.perusahaan || '').trim().toUpperCase();
    if (roleU === 'ADMIN') {
      if (co && String(report.perusahaan || '').trim().toUpperCase() !== co)
        return { status: 'error', message: 'Akses ditolak.' };
    } else {
      const un = String(auth?.nik || '').trim().toLowerCase();
      const nm = String(auth?.nama || '').trim().toLowerCase();
      if ((un || nm) && !isReportVisibleForUser(report, un, nm))
        return { status: 'error', message: 'Akses ditolak.' };
    }
  }
  // TTD saat closing (dibekukan); laporan lama tanpa itu → TTD tersimpan terbaru PIC.
  const beku = (await getSql()`SELECT data FROM closing_signature WHERE id = ${idT}`.catch(() => []))[0];
  report.pic_signature = beku?.data || await _latestSignature(report.nik_pic, report.nama_pic).catch(() => '');
  return { status: 'success', data: report };
}

function mapInspectionValue(header, data) {
  // key: underscore-to-space so "JENIS_INSPEKSI" → "JENIS INSPEKSI"
  const key = header.trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  const map = {
    'ID': data.id, 'TIMESTAMP': data.timestamp,
    'JENIS INSPEKSI': data.jenis_inspeksi,   // was 'JENIS_INSPEKSI' — never matched after transform
    'PERUSAHAAN': data.perusahaan, 'PERUSAHAAN SUBCONT(1)': data.subcont1, 'SUBCONT1': data.subcont1,
    'NAMA': data.nama, 'NIK': data.nik, 'JABATAN': data.jabatan, 'DEPARTEMEN': data.departemen,
    'NO WHATSAPP': data.no_whatsapp,
    'TANGGAL KEJADIAN': data.tanggal_inspeksi, 'TANGGAL INSPEKSI': data.tanggal_inspeksi,
    'SHIFT KEJADIAN': data.shift_inspeksi, 'SHIFT INSPEKSI': data.shift_inspeksi,
    'LOKASI': data.lokasi_inspeksi, 'LOKASI INSPEKSI': data.lokasi_inspeksi,
    'DETAIL LOKASI INSPEKSI': data.detail_lokasi_inspeksi,  // was 'DETAIL_LOKASI_INSPEKSI' — never matched
    'TEMUAN INSPEKSI': data.temuan_inspeksi,
    'UPLOAD FOTO INSPEKSI': data.upload_foto_inspeksi,
    'TINDAKAN PERBAIKAN YANG DIUSULKAN KEPADA PENANGGUNGJAWAB (PIC)': data.tindakan_usulan_pic,
    'TINDAKAN USULAN PIC': data.tindakan_usulan_pic,
    'PERUSAHAAN PIC': data.perusahaan_pic, 'PERUSAHAAN SUBCONT(2)': data.subcont2, 'SUBCONT2': data.subcont2,
    'DEPARTEMEN PIC': data.departemen_pic, 'JABATAN PIC': data.jabatan_pic, 'NAMA PIC': data.nama_pic,
    'NO WHATTSAPP PIC': data.no_whatsapp_pic, 'NO WHATSAPP PIC': data.no_whatsapp_pic,
    'NIK PIC': data.nik_pic, 'BATAS WAKTU': data.batas_waktu,
    'UPLOAD FOTO PERBAIKAN PIC': data.upload_foto_perbaikan_pic,
    'STATUS PERBAIKAN': data.status_perbaikan,
    'PERNYATAAN': data.pernyataan, 'TANDA TANGAN': data.tanda_tangan,
    'CATATAN CLOSING': data.catatan_closing, 'TANGGAL CLOSING': data.tanggal_closing
  };
  if (key in map) return map[key] ?? '';
  if (data.temuan_fields) return data.temuan_fields[header] ?? '';
  return '';
}

async function resolveWaFromNik(sheets, nik) {
  if (!nik) return '';
  const rows = await _karyawanRows(sheets);
  const match = rows.find(r => String(r['NIK'] || '').trim() === String(nik).trim());
  return String(match?.['NO WHATSAPP'] || '').replace(/\D/g, '');
}

async function resolveWaByIdentity(sheets, perusahaan, subcont, nama) {
  if (!nama) return '';
  const rows = await _karyawanRows(sheets);
  const norm = s => String(s || '').trim().toUpperCase();
  const match = rows.find(r =>
    norm(r['NAMA']) === norm(nama) &&
    norm(r['PERUSAHAAN']) === norm(perusahaan) &&
    norm(r['SUBCONT'] || r['PERUSAHAAN']) === norm(subcont || perusahaan)
  );
  return String(match?.['NO WHATSAPP'] || '').replace(/\D/g, '');
}

// WA dinonaktifkan → notifikasi dialihkan ke EMAIL pemilik nomor tsb (2026-10-06).
// Peta nomor WA → email karyawan, cache 5 menit.
let _waEmailMap = null, _waEmailExp = 0;
const _normWa = (v) => String(v ?? '').replace(/\D/g, '').replace(/^62/, '0');
async function _emailForWa(target) {
  if (!_waEmailMap || Date.now() > _waEmailExp) {
    const rows = await getSql()`SELECT data FROM karyawan WHERE coalesce(data->>'EMAIL', '') <> ''`;
    _waEmailMap = new Map();
    for (const { data: d } of rows) { const w = _normWa(d['NO WHATSAPP']); if (w) _waEmailMap.set(w, String(d.EMAIL).trim()); }
    _waEmailExp = Date.now() + 300e3;
  }
  return _waEmailMap.get(_normWa(target)) || '';
}
async function _waAsEmail(target, message) {
  try {
    const to = await _emailForWa(target);
    if (!to) return false;
    const msg = String(message || '');
    const url = (msg.match(/https?:\/\/\S+/) || [])[0] || '';
    const text = msg.replace(/\*/g, '').replace(/\n?🔗[^\n]*https?:\/\/\S+/g, '').trim();
    const id = (text.match(/\b(?:HR|INSP|SBO|PC)-[\w-]+/) || [])[0];
    const first = (text.split('\n').find((l) => l.trim()) || 'Notifikasi').replace(/^Halo [^,]+,\s*/i, '');
    const subject = `[ONE-SAP] ${id ? id + ' — ' : ''}${first.charAt(0).toUpperCase()}${first.slice(1, 90)}`;
    return await _sendMail(to, subject, text, url);
  } catch (e) { console.error('[wa→email]', e.message); return false; }
}

async function sendWaNotification(target, message, _attempt = 0) {
  if (process.env.WA_ENABLED !== '1') return _waAsEmail(target, message); // WA Fonnte DINONAKTIFKAN (2026-10-06, akun sering kena banned). Nyalakan lagi: env WA_ENABLED=1 lalu redeploy.
  const token = process.env.FONNTE_TOKEN;
  if (!token || !target) return false;
  const phone = String(target).replace(/\D/g, '').replace(/^0/, '62');
  const payload = new URLSearchParams({ target: phone, message, delay: '3', countryCode: '62' }).toString();
  const ok = await new Promise(resolve => {
    const req = https.request({
      hostname: 'api.fonnte.com', path: '/send', method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).status === true); }
        catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    // Batas 8 dtk (2026-10-06): Fonnte macet dulu menahan fungsi sampai timeout
    // 30 dtk → klien lihat error padahal laporan SUDAH tersimpan → kirim ulang → dobel.
    req.setTimeout(8000, () => { req.destroy(); resolve('timeout'); });
    req.write(payload);
    req.end();
  });
  if (ok === 'timeout') return false; // tak diulang — waktu fungsi terbatas
  // #3 — 1x retry setelah 2 detik jika gagal
  if (!ok && _attempt === 0) {
    await new Promise(r => setTimeout(r, 2000));
    return sendWaNotification(target, message, 1);
  }
  return ok;
}

async function ensureWaStatusColumn(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!1:1` });
  const headers = (res.data.values?.[0] || []).map(h => String(h).trim());
  let col = headers.indexOf('WA_PIC_STATUS');
  if (col !== -1) return col;

  col = headers.length;

  // Expand grid if needed — values.update fails if col >= sheet column count
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' });
  const sheetProps = meta.data.sheets?.find(s => s.properties.title === sheetName)?.properties;
  if (sheetProps && col >= sheetProps.gridProperties.columnCount) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ appendDimension: { sheetId: sheetProps.sheetId, dimension: 'COLUMNS', length: 1 } }]
      }
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${colIndexToLetter(col)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['WA_PIC_STATUS']] }
  });
  return col;
}

// Tulis status WA PIC. Hazard/Inspeksi kini di Postgres (JSONB) — set field.
async function writeWaStatusToSheet(sheets, sheetName, reportId, waStatus) {
  try { await _reportSet(sheetName, reportId, { 'WA_PIC_STATUS': waStatus }); }
  catch (err) { console.error('writeWaStatus error:', err?.message || err); }
}

async function submitHazardReport(sheets, data) {
  await assertPicEligible(sheets, data.nik_pic, data.nama_pic); // Cuti (2026-08-20)
  const dupId = await _findByClientRef('hazard_report', data.client_ref);
  if (dupId) return { status: 'success', message: 'Hazard Report sudah tersimpan sebelumnya.', id: dupId, duplicate: true };
  const id = 'HR-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);
  let fotoBahayaUrl = '';
  if (data.upload_foto_bahaya)
    fotoBahayaUrl = await saveMultipleImagesToDrive(data.upload_foto_bahaya, await driveSubfolderId(process.env.FOLDER_HAZARD_ID, 'HR'), id + '-Hazard');

  // Resolve WA dari master data jika tidak dikirim dari form
  if (!data.no_whatsapp && data.nik)
    data.no_whatsapp = await resolveWaFromNik(sheets, data.nik).catch(() => '');
  if (!data.no_whatsapp_pic) {
    if (data.nik_pic)
      data.no_whatsapp_pic = await resolveWaFromNik(sheets, data.nik_pic).catch(() => '');
    else if (data.nama_pic)
      data.no_whatsapp_pic = await resolveWaByIdentity(sheets, data.perusahaan_pic, data.subcont2, data.nama_pic).catch(() => '');
  }

  // NIK PIC wajib tersimpan (dulu hilang: kolom sheet lama tak punya NIK PIC) — dipakai
  // notifikasi & cek hak PIC (assertReportRole).
  data.nik_pic = await _resolveNikPic(sheets, { nik: data.nik_pic, nama: data.nama_pic, perusahaan: data.perusahaan_pic, wa: data.no_whatsapp_pic });

  // Tanda tangan disimpan sebagai URL Drive (bukan base64) agar DB & daftar ramping.
  if (data.tanda_tangan && String(data.tanda_tangan).startsWith('data:'))
    data.tanda_tangan = await saveBase64ImageToDrive(data.tanda_tangan, process.env.FOLDER_HAZARD_ID, id + '-TTD.png').catch(() => data.tanda_tangan);

  // Matriks 5×5 dihitung ulang di server (pratinjau form tidak dipercaya). Gagal → tetap simpan.
  try { await _risikoHazard(data); } catch (e) { console.error('[risikoHazard]', e.message); }

  const row = [
    id, new Date().toISOString(), data.perusahaan, data.subcont1, data.nama, data.nik,
    data.jabatan, data.departemen, data.no_whatsapp, data.tanggal_kejadian, data.shift_kejadian,
    data.lokasi_bahaya, data.detail_lokasi_bahaya || '', data.jenis_bahaya, data.ketidaksesuaian_bahaya,
    data.sub_ketidaksesuaian, data.deskripsi_bahaya, data.tingkat_risiko, fotoBahayaUrl,
    data.tindakan_langsung, data.tindakan_usulan_pic, data.perusahaan_pic, data.subcont2,
    data.departemen_pic, data.jabatan_pic, data.nama_pic, data.no_whatsapp_pic, data.batas_waktu,
    '', 'OPEN', data.pernyataan, data.tanda_tangan
  ];
  // Bangun objek ter-normalisasi (key = header sheet ter-normalisasi) agar konsisten
  // dengan getHazardReports & migrasi, lalu simpan sebagai data JSONB di Postgres.
  const _hzHeaders = await getSheetHeaders(sheets, 'Hazard_Report');
  const _hzData = {};
  _hzHeaders.forEach((h, i) => { _hzData[normalizeHeader(h)] = row[i] ?? ''; });
  if (data.client_ref) _hzData.client_ref = String(data.client_ref);
  _hzData.nik_pic = data.nik_pic || '';
  for (const k of ['sub_lokasi_bahaya', 'sub_lokasi_lainnya', 'kode_temuan', 'keparahan', 'kemungkinan',
    'skor_risiko', 'kelas_temuan', 'risiko_kritis', 'jenis_area', 'temuan_berulang']) {
    if (data[k] !== undefined && data[k] !== '') _hzData[k] = data[k];
  }
  const _hzDup = await _insertOnce('hazard_report', data.client_ref, () => getSql()`
    INSERT INTO hazard_report (id, nik, perusahaan, status_perbaikan, data)
    VALUES (${id}, ${_hzData.nik || ''}, ${_hzData.perusahaan || ''}, ${_hzData.status_perbaikan || 'OPEN'}, ${JSON.stringify(_hzData)}::jsonb)`, 'Hazard Report');
  if (_hzDup) return _hzDup;

  const waStatus = await _notifPicBaru(sheets, {
    nik: data.nik_pic, nama: data.nama_pic, wa: data.no_whatsapp_pic, label: 'laporan hazard', id, batas: data.batas_waktu,
    baris: [`Lokasi: ${data.lokasi_bahaya}${data.detail_lokasi_bahaya ? ' - ' + data.detail_lokasi_bahaya : ''}`, `Temuan: ${data.jenis_bahaya}`],
  });
  await writeWaStatusToSheet(sheets, 'Hazard_Report', id, waStatus);
  return { status: 'success', message: 'Hazard Report berhasil disimpan.', id, wa_pic_status: waStatus };
}

const INSPECTION_NAMES = {
  INS_CB: 'Inspeksi Conveyor Belt', INS_JA: 'Inspeksi Jalan Angkut',
  INS_MD: 'Inspeksi Mess dan Dapur', INS_KG: 'Inspeksi Kantor dan Gudang',
  INS_SP: 'Inspeksi Settling Pond', INS_T: 'Inspeksi Tambang',
  INS_TB: 'Inspeksi Tangki BBM', INS_WS: 'Inspeksi Workshop'
};

// Anti-dobel (2026-10-06): form mengirim client_ref unik per laporan. Bila respons
// sebelumnya hilang (timeout/jaringan) dan form mengirim ulang, kembalikan laporan
// yang sudah tersimpan alih-alih membuat baru.
async function _findByClientRef(table, ref) {
  const r = String(ref || '').trim();
  if (!r) return null;
  const sql = getSql();
  const rows = table === 'inspection_report' ? await sql`SELECT id FROM inspection_report WHERE data->>'client_ref' = ${r} LIMIT 1`
    : table === 'hazard_report' ? await sql`SELECT id FROM hazard_report WHERE data->>'client_ref' = ${r} LIMIT 1`
    : table === 'sbo_report' ? await sql`SELECT id FROM sbo_report WHERE client_ref = ${r} LIMIT 1`
    : await sql`SELECT id FROM pc_report WHERE client_ref = ${r} LIMIT 1`;
  return rows[0]?.id || null;
}
// Dua kiriman identik yang tiba BERSAMAAN lolos cek di atas → indeks unik
// client_ref di DB menolak yang kedua (23505); kembalikan laporan yang pertama.
async function _insertOnce(table, ref, insertFn, label) {
  try { await insertFn(); return null; }
  catch (e) {
    if (e.code === '23505' && ref) {
      const id = await _findByClientRef(table, ref);
      if (id) return { status: 'success', message: `${label} sudah tersimpan sebelumnya.`, id, duplicate: true };
    }
    throw e;
  }
}

async function submitInspectionReport(sheets, data) {
  const sheetName = String(data.inspection_code || data.jenis_inspeksi || '').trim().toUpperCase();
  if (!INSPECTION_SHEETS.includes(sheetName)) throw new Error('Jenis inspeksi tidak valid: ' + sheetName);
  const dupId = await _findByClientRef('inspection_report', data.client_ref);
  if (dupId) return { status: 'success', message: 'Inspeksi sudah tersimpan sebelumnya.', id: dupId, duplicate: true };
  await assertPicEligible(sheets, data.nik_pic, data.nama_pic); // Cuti (2026-08-20)

  const id = 'INSP-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);
  let fotoInspeksiUrl = '';
  if (data.upload_foto_inspeksi)
    fotoInspeksiUrl = await saveMultipleImagesToDrive(data.upload_foto_inspeksi, await driveSubfolderId(process.env.FOLDER_HAZARD_ID, 'INS'), id + '-Inspection');

  // Resolve WA dari master data jika tidak dikirim dari form
  if (!data.no_whatsapp && data.nik)
    data.no_whatsapp = await resolveWaFromNik(sheets, data.nik).catch(() => '');
  if (!data.no_whatsapp_pic) {
    if (data.nik_pic)
      data.no_whatsapp_pic = await resolveWaFromNik(sheets, data.nik_pic).catch(() => '');
    else if (data.nama_pic)
      data.no_whatsapp_pic = await resolveWaByIdentity(sheets, data.perusahaan_pic, data.subcont2, data.nama_pic).catch(() => '');
  }

  // Tanda tangan disimpan sebagai URL Drive (bukan base64) agar DB & daftar ramping.
  if (data.tanda_tangan && String(data.tanda_tangan).startsWith('data:'))
    data.tanda_tangan = await saveBase64ImageToDrive(data.tanda_tangan, process.env.FOLDER_HAZARD_ID, id + '-TTD.png').catch(() => data.tanda_tangan);

  const headers = await getSheetHeaders(sheets, sheetName);
  data.nik_pic = await _resolveNikPic(sheets, { nik: data.nik_pic, nama: data.nama_pic, perusahaan: data.perusahaan_pic, wa: data.no_whatsapp_pic });
  const rowData = { ...data, id, timestamp: new Date().toISOString(), upload_foto_inspeksi: fotoInspeksiUrl, status_perbaikan: 'OPEN' };
  const row = headers.map(h => mapInspectionValue(h, rowData));

  // Simpan sebagai data JSONB (key = header ter-normalisasi) di inspection_report.
  const _insData = {};
  headers.forEach((h, i) => { _insData[normalizeHeader(h)] = row[i] ?? ''; });
  if (data.client_ref) _insData.client_ref = String(data.client_ref);
  _insData.nik_pic = data.nik_pic || '';
  _insData.kode_temuan = Taksonomi.kodeInspeksi(sheetName, _insData, PETA_CHECKLIST).join(','); // deteksi dini tahap 2
  const _insDup = await _insertOnce('inspection_report', data.client_ref, () => getSql()`
    INSERT INTO inspection_report (id, jenis, nik, perusahaan, status_perbaikan, data)
    VALUES (${id}, ${sheetName}, ${_insData.nik || ''}, ${_insData.perusahaan || ''}, ${_insData.status_perbaikan || 'OPEN'}, ${JSON.stringify(_insData)}::jsonb)`, 'Inspeksi');
  if (_insDup) return _insDup;

  const waStatus = await _notifPicBaru(sheets, {
    nik: data.nik_pic, nama: data.nama_pic, wa: data.no_whatsapp_pic, label: 'laporan inspeksi', id, batas: data.batas_waktu,
    baris: [`Jenis: ${INSPECTION_NAMES[sheetName] || sheetName}`, `Lokasi: ${data.lokasi_inspeksi}${data.detail_lokasi_inspeksi ? ' - ' + data.detail_lokasi_inspeksi : ''}`],
  });
  await writeWaStatusToSheet(sheets, sheetName, id, waStatus);
  return { status: 'success', message: 'Inspeksi berhasil disimpan.', id, wa_pic_status: waStatus };
}

// ══════════════════════════════════════════════════════
// PERSONAL CONTACT (PC)
// ══════════════════════════════════════════════════════
const PC_HEADERS = [
  'ID','TIMESTAMP','TGL_PC','LOKASI_PC',
  'NAMA_COACH','NIK_COACH','JABATAN_COACH','DEPARTEMEN_COACH','PERUSAHAAN_COACH',
  'NAMA_COACHEE','NIK_COACHEE','JABATAN_COACHEE','DEPARTEMEN_COACHEE','PERUSAHAAN_COACHEE','SUBCONT_COACHEE','NO_WA_COACHEE',
  'TOPIK_COACHING','JUDUL_COACHING','DESKRIPSI_COACHING','KOMITMEN_PERBAIKAN','BATAS_WAKTU_PC',
  'FOTO_PC','STATUS','FOTO_KOMITMEN','PESAN_KOMITMEN','TIMESTAMP_CLOSE','WA_PIC_STATUS',
];

async function ensurePCSheet(sheets) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
    const exists = meta.data.sheets.some(s => s.properties.title === 'PC_Report');
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: 'PC_Report' } } }] }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'PC_Report!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [PC_HEADERS] }
      });
    }
  } catch (err) { console.error('ensurePCSheet error:', err?.message || err); }
}

async function submitPCReport(sheets, data) {
  const sql = getSql();
  const ref = String(data.client_ref || '').trim() || null;
  const pcDupId = await _findByClientRef('pc_report', ref);
  if (pcDupId) return { status: 'success', message: 'Personal Contact sudah tersimpan sebelumnya.', id: pcDupId, duplicate: true };
  const id = 'PC-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);

  let fotoUrl = '';
  if (data.foto_pc)
    fotoUrl = await saveMultipleImagesToDrive(data.foto_pc, await driveSubfolderId(process.env.FOLDER_HAZARD_ID, 'PC'), id + '-PC');

  const pcDup = await _insertOnce('pc_report', ref, () => sql`
    INSERT INTO pc_report
      ("timestamp", id, tgl_pc, lokasi_pc, nama_coach, nik_coach, jabatan_coach, departemen_coach, perusahaan_coach,
       nama_coachee, nik_coachee, jabatan_coachee, departemen_coachee, perusahaan_coachee, subcont_coachee, no_wa_coachee,
       topik_coaching, judul_coaching, deskripsi_coaching, komitmen_perbaikan, batas_waktu_pc, foto_pc, status, client_ref)
    VALUES
      (${new Date().toISOString()}, ${id}, ${data.tgl_pc || ''}, ${data.lokasi_pc || ''}, ${data.nama_coach || ''},
       ${data.nik_coach || ''}, ${data.jabatan_coach || ''}, ${data.departemen_coach || ''}, ${data.perusahaan_coach || ''},
       ${data.nama_coachee || ''}, ${data.nik_coachee || ''}, ${data.jabatan_coachee || ''}, ${data.departemen_coachee || ''},
       ${data.perusahaan_coachee || ''}, ${data.subcont_coachee || ''}, ${data.no_wa_coachee || ''},
       ${data.topik_coaching || ''}, ${data.judul_coaching || ''}, ${data.deskripsi_coaching || ''},
       ${data.komitmen_perbaikan || ''}, ${data.batas_waktu_pc || ''}, ${fotoUrl}, 'OPEN', ${ref})`, 'Personal Contact');
  if (pcDup) return pcDup;

  // Kirim WA ke coachee
  let waStatus = 'TIDAK ADA WA';
  if (data.no_wa_coachee && data.nama_coachee) {
    const msg = `Halo ${data.nama_coachee}, kamu mendapat Personal Contact dari ${data.nama_coach || 'Coach'}.\n\n` +
      `📋 *${id}*\n` +
      `🏷️ Topik: ${data.topik_coaching || '-'}\n` +
      `📌 Judul: ${data.judul_coaching || '-'}\n` +
      `🤝 Komitmen: ${data.komitmen_perbaikan || '-'}\n` +
      `⏰ Batas waktu: ${data.batas_waktu_pc || '-'}\n\n` +
      `🔗 Lihat & konfirmasi: https://sap-ebl.vercel.app/pc.html`;
    const sent = await sendWaNotification(data.no_wa_coachee, msg).catch(() => false);
    waStatus = sent ? 'TERKIRIM' : 'GAGAL';
  }
  await sql`UPDATE pc_report SET wa_pic_status = ${waStatus} WHERE id = ${id}`;

  // Push notif ke coachee
  if (data.nik_coachee) await sendPushToNik(sheets, data.nik_coachee, {
    title: 'Kamu Mendapat Personal Contact 💬',
    body: `${data.nama_coach || 'Coach'} membuat PC untuk kamu: ${data.judul_coaching || '-'}`,
    url: `https://sap-ebl.vercel.app/pc.html`
  }).catch(() => {});

  return { status: 'success', message: `PC ${id} berhasil disimpan. Notifikasi dikirim ke coachee.`, id, wa_coachee_status: waStatus };
}

async function getPCReports(sheets, auth, mineOnly) {
  const sql = getSql();
  let rows;
  try { rows = await sql`SELECT * FROM pc_report`; } catch { return { status: 'success', data: [] }; }
  let data = rows.map(r => ({ ...r, report_type: 'PC' })).filter(r => String(r.id || '').trim());
  if (!isSuperAdmin(auth?.role)) {
    const co = String(auth?.perusahaan || '').trim().toUpperCase();
    if (co) data = data.filter(r =>
      String(r.perusahaan_coach || '').trim().toUpperCase() === co ||
      String(r.perusahaan_coachee || '').trim().toUpperCase() === co
    );
  }
  // mineOnly (halaman daftar): USER hanya lihat PC yang dia terlibat (coach/coachee).
  if (mineOnly && !isAdminOrAbove(auth?.role)) {
    const un = String(auth?.nik || '').trim().toLowerCase();
    const nm = String(auth?.nama || '').trim().toLowerCase();
    data = data.filter(r => ['nik_coach', 'nama_coach', 'nik_coachee', 'nama_coachee']
      .some(k => { const v = String(r[k] || '').trim().toLowerCase(); return v && (v === un || v === nm); }));
  }
  return { status: 'success', data };
}

async function updatePCReport(sheets, data, auth) {
  const sql = getSql();
  let fotoUrl = '';
  if (data.foto_komitmen)
    fotoUrl = await saveMultipleImagesToDrive(data.foto_komitmen, await driveSubfolderId(process.env.FOLDER_CLOSING_ID || process.env.FOLDER_HAZARD_ID, 'PC'), data.id + '-Komitmen');

  const upd = await sql`
    UPDATE pc_report SET status = 'CLOSED', foto_komitmen = ${fotoUrl},
      pesan_komitmen = ${data.pesan_komitmen || ''}, timestamp_close = ${new Date().toISOString()}
    WHERE id = ${data.id} RETURNING nik_coach`;

  // Push notif ke coach
  const nikCoach = String(upd[0]?.nik_coach || '').trim();
  if (nikCoach) await sendPushToNik(sheets, nikCoach, {
    title: 'Coachee Telah Konfirmasi Komitmen ✅',
    body:  `Coachee untuk PC ${data.id} telah mengkonfirmasi komitmennya.`,
    url:   `https://sap-ebl.vercel.app/pc.html`
  }).catch(() => {});

  return { status: 'success', message: 'Komitmen berhasil dikonfirmasi.' };
}

const SBO_HEADERS = [
  'ID','TIMESTAMP','TGL_OBSERVASI','NAMA_PEKERJAAN','LOKASI',
  'NAMA_OBSERVER','NIK_OBSERVER','JABATAN_OBSERVER','DEPARTEMEN_OBSERVER','PERUSAHAAN_OBSERVER',
  'NAMA_OBSERVEE','PERUSAHAAN_OBSERVEE','SUBCONT_OBSERVEE','JABATAN_OBSERVEE','DEPARTEMEN_OBSERVEE',
  'TINDAKAN_SEGERA','POTENSI_BAHAYA','APD','ALAT_PERALATAN','PROSEDUR','KEBERSIHAN',
  'STATUS_OBSERVASI','JENIS_TEMUAN','KATEGORI_TEMUAN','DESKRIPSI_TEMUAN','FOTO_TEMUAN',
  'RENCANA_TINDAKAN','REFERENSI_SOP',
  'NAMA_PIC','NIK_PIC','PERUSAHAAN_PIC','SUBCONT_PIC','DEPARTEMEN_PIC','JABATAN_PIC','NO_WA_PIC',
  'BATAS_WAKTU','UPLOAD_FOTO_PERBAIKAN_PIC','STATUS_PERBAIKAN','PERNYATAAN','WA_PIC_STATUS',
];

async function ensureSBOSheet(sheets) {
  // Cek apakah sheet SBO_Report sudah ada
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
    const exists = meta.data.sheets.some(s => s.properties.title === 'SBO_Report');
    if (!exists) {
      // Buat sheet baru
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: 'SBO_Report' } } }] }
      });
      // Tulis header
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'SBO_Report!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [SBO_HEADERS] }
      });
    }
  } catch (err) { console.error('ensureSBOSheet error:', err?.message || err); }
}

// ── Safety Talk sheet bootstrap ───────────────────────────────────
const ST_SCHED_HDR = ['ID','TIMESTAMP','TANGGAL','BULAN','JUDUL_MATERI','DESKRIPSI_MATERI','NAMA_PEMATERI','NIK_PEMATERI','JABATAN_PEMATERI','PERUSAHAAN_TARGET','STATUS','CREATED_BY'];
const ST_AB_HDR    = ['SCHEDULE_ID','BULAN','NIK','NAMA','PERUSAHAAN','DEPARTEMEN','JABATAN','CHECKED_BY','CHECKED_AT'];

async function _ensureSafetyTalkSheets(sheets) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
    const titles = new Set(meta.data.sheets.map(s => s.properties.title));
    const reqs = [];
    if (!titles.has('SafetyTalk_Schedule')) reqs.push({ addSheet: { properties: { title: 'SafetyTalk_Schedule' } } });
    if (!titles.has('SafetyTalk_Absensi'))  reqs.push({ addSheet: { properties: { title: 'SafetyTalk_Absensi' } } });
    if (reqs.length) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: reqs } });
      const updates = [];
      if (!titles.has('SafetyTalk_Schedule')) updates.push({ range: 'SafetyTalk_Schedule!A1', values: [ST_SCHED_HDR] });
      if (!titles.has('SafetyTalk_Absensi'))  updates.push({ range: 'SafetyTalk_Absensi!A1',  values: [ST_AB_HDR] });
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data: updates } });
    }
  } catch (err) { console.error('_ensureSafetyTalkSheets error:', err?.message); }
}

// Baris Postgres → bentuk UPPERCASE yang dibaca client (safety-talk*.js, capaian).
const _stSchedOut = r => ({
  ID: r.id, TIMESTAMP: r.timestamp, TANGGAL: r.tanggal, BULAN: r.bulan,
  JUDUL_MATERI: r.judul_materi, DESKRIPSI_MATERI: r.deskripsi_materi,
  NAMA_PEMATERI: r.nama_pemateri, NIK_PEMATERI: r.nik_pemateri, JABATAN_PEMATERI: r.jabatan_pemateri,
  PERUSAHAAN_TARGET: r.perusahaan_target, STATUS: r.status, CREATED_BY: r.created_by,
  SITE: r.site || '', TEMPAT: r.tempat || '', WAKTU: r.waktu || '', // untuk cetak absensi (2026-10-08)
  MATERI_TAMBAHAN: r.materi_tambahan || '', // satu materi per baris
});
const _stAbsOut = r => ({
  SCHEDULE_ID: r.schedule_id, BULAN: r.bulan, NIK: r.nik, NAMA: r.nama, PERUSAHAAN: r.perusahaan,
  DEPARTEMEN: r.departemen, JABATAN: r.jabatan, STATUS_KEHADIRAN: r.status_kehadiran,
  QUIZ_DONE: r.quiz_done, CHECKED_BY: r.checked_by, CHECKED_AT: r.checked_at,
});

// ── Generic draft helpers (per-NIK, sheet: {FormType}_Drafts) ────
async function _upsertDraftRow(sheets, sheetName, nik, draftJson) {
  let rows = [];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
    rows = res.data.values || [];
  } catch {}
  const now = new Date().toISOString();
  if (!rows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: sheetName, valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['NIK','DRAFT','UPDATED_AT'], [nik, draftJson, now]] },
    }).catch(() => {});
    return;
  }
  const nikCol = rows[0].indexOf('NIK');
  const rowIdx = rows.findIndex((r, i) => i > 0 && (r[nikCol] || '') === nik);
  if (rowIdx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: sheetName, valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[nik, draftJson, now]] },
    }).catch(() => {});
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A${rowIdx + 1}:C${rowIdx + 1}`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: [[nik, draftJson, now]] },
    }).catch(() => {});
  }
}

async function _fetchDraftRow(sheets, sheetName, nik) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
    const rows = res.data.values || [];
    if (rows.length < 2) return null;
    const nikCol   = rows[0].indexOf('NIK');
    const draftCol = rows[0].indexOf('DRAFT');
    const row = rows.find((r, i) => i > 0 && (r[nikCol] || '') === nik);
    if (!row || !row[draftCol]) return null;
    return { draft: JSON.parse(row[draftCol]) };
  } catch { return null; }
}

async function _deleteDraftRow(sheets, sheetName, nik) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
    const rows = res.data.values || [];
    if (rows.length < 2) return;
    const nikCol = rows[0].indexOf('NIK');
    const rowIdx = rows.findIndex((r, i) => i > 0 && (r[nikCol] || '') === nik);
    if (rowIdx !== -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A${rowIdx + 1}:C${rowIdx + 1}`,
        valueInputOption: 'USER_ENTERED', requestBody: { values: [['','','']] },
      }).catch(() => {});
    }
  } catch {}
}

// Shorthand untuk SBO (tetap kompatibel)
const saveSBODraftForUser   = (s, n, d) => _upsertDraftRow(s, 'SBO_Drafts', n, d);
const getSBODraftForUser    = (s, n)    => _fetchDraftRow(s, 'SBO_Drafts', n);
const clearSBODraftForUser  = (s, n)    => _deleteDraftRow(s, 'SBO_Drafts', n);

async function submitSBOReport(sheets, data) {
  const sql = getSql();
  const ref = String(data.client_ref || '').trim() || null;
  const sboDupId = await _findByClientRef('sbo_report', ref);
  if (sboDupId) return { status: 'success', message: 'Laporan SBO sudah tersimpan sebelumnya.', id: sboDupId, duplicate: true };
  const id = 'SBO-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);
  const hasFinding = data.status_observasi === 'ADA_TEMUAN';

  if (hasFinding) await assertPicEligible(sheets, data.nik_pic, data.nama_pic);

  let fotoUrl = '';
  if (hasFinding && data.foto_temuan)
    fotoUrl = await saveMultipleImagesToDrive(data.foto_temuan, await driveSubfolderId(process.env.FOLDER_HAZARD_ID, 'SBO'), id + '-SBO');

  if (hasFinding && !data.no_wa_pic && data.nik_pic)
    data.no_wa_pic = await resolveWaFromNik(sheets, data.nik_pic).catch(() => '');
  if (hasFinding && !data.no_wa_pic && data.nama_pic)
    data.no_wa_pic = await resolveWaByIdentity(sheets, data.perusahaan_pic, data.subcont_pic, data.nama_pic).catch(() => '');

  const F = v => hasFinding ? (v || '') : ''; // field hanya diisi bila ada temuan
  const sboDup = await _insertOnce('sbo_report', ref, () => sql`
    INSERT INTO sbo_report
      ("timestamp", id, tgl_observasi, nama_pekerjaan, lokasi, nama_observer, nik_observer, jabatan_observer,
       departemen_observer, perusahaan_observer, nama_observee, perusahaan_observee, subcont_observee, jabatan_observee,
       departemen_observee, tindakan_segera, potensi_bahaya, apd, alat_peralatan, prosedur, kebersihan, status_observasi,
       jenis_temuan, kategori_temuan, deskripsi_temuan, foto_temuan, rencana_tindakan, referensi_sop,
       nama_pic, nik_pic, perusahaan_pic, subcont_pic, departemen_pic, jabatan_pic, no_wa_pic, batas_waktu,
       upload_foto_perbaikan_pic, status_perbaikan, pernyataan, wa_pic_status, client_ref)
    VALUES
      (${new Date().toISOString()}, ${id}, ${data.tgl_observasi || ''}, ${data.nama_pekerjaan || ''}, ${data.lokasi || ''},
       ${data.nama_observer || ''}, ${data.nik_observer || ''}, ${data.jabatan_observer || ''}, ${data.departemen_observer || ''},
       ${data.perusahaan_observer || ''}, ${data.nama_observee || ''}, ${data.perusahaan_observee || ''}, ${data.subcont_observee || ''},
       ${data.jabatan_observee || ''}, ${data.departemen_observee || ''}, ${data.tindakan_segera || ''}, ${data.potensi_bahaya || ''},
       ${data.apd || ''}, ${data.alat_peralatan || ''}, ${data.prosedur || ''}, ${data.kebersihan || ''}, ${data.status_observasi || 'AMAN'},
       ${F(data.jenis_temuan)}, ${F(data.kategori_temuan)}, ${F(data.deskripsi_temuan)}, ${fotoUrl}, ${F(data.rencana_tindakan)},
       ${F(data.referensi_sop)}, ${F(data.nama_pic)}, ${F(data.nik_pic)}, ${F(data.perusahaan_pic)}, ${F(data.subcont_pic)},
       ${F(data.departemen_pic)}, ${F(data.jabatan_pic)}, ${F(data.no_wa_pic)}, ${F(data.batas_waktu)},
       ${''}, ${hasFinding ? 'OPEN' : 'AMAN'}, ${data.pernyataan || ''}, ${''}, ${ref})`, 'Laporan SBO');
  if (sboDup) return sboDup;
  // Deteksi dini tahap 2: item Tidak Aman → kode taksonomi. Gagal tidak membatalkan laporan.
  if (hasFinding) {
    try { await ensureSboKodeKolom(sql); await sql`UPDATE sbo_report SET kode_temuan = ${Taksonomi.kodeSbo(data, PETA_CHECKLIST).join(',')} WHERE id = ${id}`; }
    catch (e) { console.error('[kodeSbo]', e.message); }
  }

  let waStatus = 'TIDAK ADA WA';
  if (hasFinding && data.no_wa_pic && data.nama_pic) {
    const msg = `Halo ${data.nama_pic}, kamu ditunjuk sebagai PIC untuk laporan SBO baru.\n\n` +
      `📋 *${id}*\n` +
      `👷 Observer: ${data.nama_observer}\n` +
      `👤 Observee: ${data.nama_observee || '-'}\n` +
      `📍 Lokasi: ${data.lokasi || '-'}\n` +
      `🔍 Temuan: ${data.jenis_temuan || '-'}\n` +
      `⏰ Batas waktu: ${data.batas_waktu || '-'}\n\n` +
      `🔗 Detail: https://sap-ebl.vercel.app/sbo.html`;
    const sent = await sendWaNotification(data.no_wa_pic, msg).catch(() => false);
    waStatus = sent ? 'TERKIRIM' : 'GAGAL';
  }
  await sql`UPDATE sbo_report SET wa_pic_status = ${waStatus} WHERE id = ${id}`;

  if (hasFinding && data.nik_pic) await sendPushToNik(sheets, data.nik_pic, {
    title: 'Kamu Ditunjuk sebagai PIC SBO 📋',
    body: `Laporan SBO baru ${id} membutuhkan tindakan kamu. Batas: ${data.batas_waktu || '-'}`,
    url: `https://sap-ebl.vercel.app/sbo.html`
  }).catch(() => {});

  return { status: 'success', message: 'Laporan SBO berhasil disimpan.', id, wa_pic_status: waStatus };
}

// ── "PIC yang dicantumkan salah" (2026-10-06) ───────────────────────────────
// PIC menandai laporan (Hazard/Inspeksi/SBO) → email admin. Super Admin atau
// Admin perusahaan pelapor menetapkan PIC baru (deadline dihitung ulang dari
// tanggal penggantian, durasi = deadline awal − tanggal laporan) atau menolak.
// Disimpan di pic_dispute: field JSONB di data (hazard/inspeksi), kolom jsonb (SBO).
// Selama PENDING: reminder WA deadline dijeda & tak dihitung ke PIC Open capaian.
const PIC_DISPUTE_EMAIL = process.env.PIC_DISPUTE_EMAIL || 'esmsrantau@gmail.com';
const APP_URL = 'https://sap-ebl.vercel.app';
const _todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const _ymd = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };

function _disputeModul(modul, id) {
  const m = String(modul || '').toUpperCase();
  if (['HAZARD', 'INSPECTION', 'SBO'].includes(m)) return m;
  const s = String(id || '').toUpperCase();
  return s.startsWith('SBO') ? 'SBO' : s.startsWith('INSP') ? 'INSPECTION' : 'HAZARD';
}

async function _rosterByNik(nik) {
  const n = String(nik || '').trim();
  return n ? (await getSql()`SELECT data FROM karyawan WHERE nik = ${n}`)[0]?.data || null : null;
}

async function _disputeLoad(modul, id) {
  const sql = getSql();
  const idT = String(id || '').trim();
  if (modul === 'SBO') {
    const r = (await sql`SELECT * FROM sbo_report WHERE id = ${idT}`)[0];
    if (!r) return null;
    return {
      modul, id: idT, label: 'SBO', lokasi: r.lokasi, perusahaan: r.perusahaan_observer,
      status: String(r.status_perbaikan || '').toUpperCase(), batas: r.batas_waktu, tanggal: r.timestamp || r.tgl_observasi,
      pic: { nik: r.nik_pic, nama: r.nama_pic, wa: r.no_wa_pic },
      pelapor: { nik: r.nik_observer, nama: r.nama_observer },
      dispute: r.pic_dispute || null,
      url: `${APP_URL}/sbo.html?id=${encodeURIComponent(idT)}`,
    };
  }
  const row = modul === 'INSPECTION'
    ? (await sql`SELECT data FROM inspection_report WHERE id = ${idT}`)[0]
    : (await sql`SELECT data FROM hazard_report WHERE id = ${idT}`)[0];
  if (!row) return null;
  const d = row.data || {};
  return {
    modul, id: idT, label: modul === 'INSPECTION' ? 'Inspeksi' : 'Hazard',
    lokasi: d.lokasi_bahaya || d.lokasi || d.lokasi_inspeksi || '', perusahaan: d.perusahaan,
    status: String(d.status_perbaikan || 'OPEN').toUpperCase(), batas: d.batas_waktu, tanggal: d.timestamp,
    pic: { nik: d.nik_pic, nama: d.nama_pic, wa: d.no_whattsapp_pic || d.no_whatsapp_pic },
    pelapor: { nik: d.nik, nama: d.nama, wa: d.no_whatsapp },
    dispute: d.pic_dispute || null,
    url: `${APP_URL}/laporan-detail.html?id=${encodeURIComponent(idT)}`,
  };
}

// patch: field PIC baru (opsional) — nama key disesuaikan per tabel.
async function _disputeSave(d, dispute, patch) {
  const sql = getSql();
  if (d.modul === 'SBO') {
    if (patch) {
      await sql`UPDATE sbo_report SET pic_dispute = ${JSON.stringify(dispute)}::jsonb,
        nama_pic = ${patch.nama}, nik_pic = ${patch.nik}, perusahaan_pic = ${patch.perusahaan},
        departemen_pic = ${patch.departemen}, jabatan_pic = ${patch.jabatan}, no_wa_pic = ${patch.wa},
        batas_waktu = ${patch.batas}, wa_pic_status = ''
        WHERE id = ${d.id}`;
    } else {
      await sql`UPDATE sbo_report SET pic_dispute = ${JSON.stringify(dispute)}::jsonb WHERE id = ${d.id}`;
    }
    return;
  }
  const obj = { pic_dispute: dispute };
  if (patch) Object.assign(obj, {
    nama_pic: patch.nama, nik_pic: patch.nik, perusahaan_pic: patch.perusahaan, departemen_pic: patch.departemen,
    jabatan_pic: patch.jabatan, no_whattsapp_pic: patch.wa, no_whatsapp_pic: patch.wa, batas_waktu: patch.batas,
    wa_pic_status: '',
    // PIC baru mulai dari awal: rencana/closing PIC lama dibatalkan.
    status_perbaikan: 'OPEN', plan_status: '', rencana_tindakan: '', tanggal_rencana: '',
    plan_review_comment: '', closing_status: '',
  });
  const json = JSON.stringify(obj);
  if (d.modul === 'INSPECTION') {
    await sql`UPDATE inspection_report SET data = data || ${json}::jsonb,
      status_perbaikan = COALESCE(${patch ? 'OPEN' : null}, status_perbaikan) WHERE id = ${d.id}`;
  } else {
    await sql`UPDATE hazard_report SET data = data || ${json}::jsonb,
      status_perbaikan = COALESCE(${patch ? 'OPEN' : null}, status_perbaikan) WHERE id = ${d.id}`;
  }
}

function _isDisputePic(d, auth, me) {
  const nik = String(auth.nik || '').trim();
  if (d.pic.nik && String(d.pic.nik).trim() === nik) return true;
  const wa = (s) => String(s || '').replace(/\D/g, '').replace(/^62/, '0');
  if (d.pic.wa && me && wa(me['NO WHATSAPP']) && wa(d.pic.wa) === wa(me['NO WHATSAPP'])) return true;
  const nm = String(me?.NAMA || auth.nama || '').trim().toLowerCase();
  return !!(d.pic.nama && nm && String(d.pic.nama).trim().toLowerCase() === nm);
}

async function _sendMail(to, subject, text, url) {
  const t = _getMailer();
  if (!t || !to) return false;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  await t.sendMail({
    from: `ONE-SAP <${process.env.GMAIL_SENDER}>`, to, subject,
    text: url ? `${text}\n\n${url}` : text,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#00205B;margin:0 0 12px">ONE-SAP</h2>
      <div style="white-space:pre-line;color:#0f172a;font-size:14px;line-height:1.55">${esc(text)}</div>
      ${url ? `<p style="margin:20px 0"><a href="${url}" style="background:#00205B;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Buka Laporan</a></p>` : ''}
    </div>`,
  });
  return true;
}

// Kirim ke satu orang lewat semua kanal yang tersedia (email, WA, push) — best-effort.
async function _notifyPerson(sheets, person, subject, text, url, { push = true } = {}) {
  let k = person.nik ? await _rosterByNik(person.nik) : null;
  if (!k && person.nama) {
    k = (await getSql()`SELECT data FROM karyawan WHERE upper(data->>'NAMA') = upper(${String(person.nama).trim()}) LIMIT 1`)[0]?.data || null;
  }
  const email = String(k?.EMAIL || '').trim();
  const wa = String(person.wa || k?.['NO WHATSAPP'] || '').replace(/\D/g, '');
  const nik = person.nik || k?.NIK;
  // Teks pesan lama berformat WA (*tebal*, baris 🔗 link) → dibersihkan untuk email.
  const teksEmail = String(text).replace(/\*/g, '').replace(/\n?🔗[^\n]*/g, '').trim();
  const [rEmail] = await Promise.allSettled([
    email && _sendMail(email, subject, teksEmail, url),
    wa && process.env.WA_ENABLED === '1' && sendWaNotification(wa, `${text}\n\n🔗 ${url}`),
    push && nik && sendPushToNik(sheets, String(nik), { title: subject, body: teksEmail.slice(0, 140), url }),
  ]);
  return { email: rEmail.status === 'fulfilled' && rEmail.value === true };
}

// NIK PIC dari roster bila form tidak mengirimnya (laporan lama / form versi lama):
// cocokkan nama + perusahaan, lalu nomor WA (2026-10-12, alur pelaporan A1).
async function _resolveNikPic(sheets, { nik, nama, perusahaan, wa }) {
  if (String(nik || '').trim()) return String(nik).trim();
  const rows = await _karyawanRows(sheets).catch(() => []);
  const norm = (v) => String(v || '').trim().toUpperCase();
  const samaNama = nama ? rows.filter((r) => norm(r['NAMA']) === norm(nama)) : [];
  const pas = samaNama.find((r) => norm(r['PERUSAHAAN']) === norm(perusahaan)) || (samaNama.length === 1 ? samaNama[0] : null);
  if (pas?.NIK) return String(pas.NIK).trim();
  const w = _normWa(wa);
  const lewatWa = w ? rows.find((r) => _normWa(r['NO WHATSAPP']) === w) : null;
  return String(lewatWa?.NIK || '').trim();
}

// Notifikasi "kamu ditunjuk sebagai PIC" lewat NIK (email + push). Status = TERKIRIM bila email
// benar-benar terkirim; GAGAL bila PIC tak punya email (perlu dilengkapi / diingatkan manual).
async function _notifPicBaru(sheets, { nik, nama, wa, label, id, batas, baris }) {
  if (!nik && !nama) return 'TIDAK ADA PIC';
  const url = `https://sap-ebl.vercel.app/laporan-detail.html?id=${id}`;
  const text = `Halo ${nama || ''}, kamu ditunjuk sebagai PIC untuk ${label} baru ${id}.\n\n` +
    `${baris.filter(Boolean).join('\n')}\nBatas waktu: ${batas || '-'}\n\nSilakan kirim rencana tindakan di ONE-SAP.`;
  const r = await _notifyPerson(sheets, { nik, nama, wa }, `[ONE-SAP] ${id} — Kamu ditunjuk sebagai PIC`, text, url).catch(() => ({ email: false }));
  return r.email ? 'TERKIRIM' : 'GAGAL';
}

async function disputePic(sheets, auth, data) {
  const d = await _disputeLoad(_disputeModul(data.modul, data.id), data.id);
  if (!d) throw new Error('Laporan tidak ditemukan.');
  const alasan = String(data.alasan || '').trim();
  if (alasan.length < 5) throw new Error('Alasan wajib diisi (minimal 5 karakter).');
  if (['CLOSED', 'FOLLOWUP'].includes(d.status)) throw new Error('Laporan sudah tahap closing — tidak bisa mengajukan PIC salah.');
  const me = await _rosterByNik(auth.nik);
  if (!_isDisputePic(d, auth, me)) throw Object.assign(new Error('Hanya PIC laporan ini yang bisa mengajukan.'), { httpStatus: 403 });
  const cur = d.dispute || {};
  if (cur.status === 'PENDING') throw new Error('Pengajuan sudah dikirim, menunggu keputusan admin.');
  const log = Array.isArray(cur.log) ? cur.log : [];
  const byNik = String(auth.nik || '').trim();
  if (log.some((x) => x.type === 'AJUAN' && x.by_nik === byNik)) throw new Error('Kamu sudah pernah mengajukan untuk laporan ini.');

  let usulan = null;
  const u = data.usulan_nik ? await _rosterByNik(data.usulan_nik) : null;
  if (u) usulan = { nik: String(u.NIK || data.usulan_nik), nama: u.NAMA || '', jabatan: u.JABATAN || '', perusahaan: u.PERUSAHAAN || '' };
  const byNama = me?.NAMA || auth.nama || d.pic.nama || '';
  const now = new Date().toISOString();
  await _disputeSave(d, {
    status: 'PENDING', by_nik: byNik, by_nama: byNama, alasan, usulan, at: now,
    log: [...log, { type: 'AJUAN', at: now, by_nik: byNik, by_nama: byNama, alasan, usulan_nama: usulan?.nama || '' }],
  });

  const text = `PIC laporan ${d.label} ${d.id} menyatakan dirinya BUKAN PIC yang tepat.\n\n` +
    `Lokasi: ${d.lokasi || '-'}\nPerusahaan pelapor: ${d.perusahaan || '-'}\nPelapor: ${d.pelapor.nama || '-'}\n` +
    `PIC tercantum: ${d.pic.nama || '-'}\nAlasan: ${alasan}\n` +
    `Usulan PIC: ${usulan ? `${usulan.nama} (${usulan.nik}) — ${usulan.jabatan}, ${usulan.perusahaan}` : '-'}\n\n` +
    `Tentukan PIC yang benar lewat tombol di bawah (Super Admin / Admin perusahaan pelapor).`;
  await _sendMail(PIC_DISPUTE_EMAIL, `[ONE-SAP] PIC salah — ${d.id}`, text, d.url)
    .catch((e) => console.error('[disputePic] email admin gagal:', e.message));
  return { status: 'success', message: 'Pengajuan terkirim. Admin akan menentukan PIC yang benar.' };
}

async function resolvePicDispute(sheets, auth, data) {
  const role = normalizeRole(auth.role);
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') throw Object.assign(new Error('Hanya admin yang bisa memutuskan.'), { httpStatus: 403 });
  const d = await _disputeLoad(_disputeModul(data.modul, data.id), data.id);
  if (!d) throw new Error('Laporan tidak ditemukan.');
  if (role === 'ADMIN' && String(d.perusahaan || '').trim().toUpperCase() !== String(auth.perusahaan || '').trim().toUpperCase())
    throw Object.assign(new Error('Hanya admin perusahaan pelapor yang bisa memutuskan.'), { httpStatus: 403 });
  const cur = d.dispute || {};
  if (cur.status !== 'PENDING') throw new Error('Tidak ada pengajuan PIC salah yang menunggu.');
  const catatan = String(data.catatan || '').trim();
  const admin = (await _rosterByNik(auth.nik))?.NAMA || auth.nama || 'Admin';
  const now = new Date().toISOString();
  const log = Array.isArray(cur.log) ? cur.log : [];
  const oldPic = { nik: d.pic.nik, nama: d.pic.nama, wa: d.pic.wa };

  if (data.keputusan === 'TOLAK') {
    if (!catatan) throw new Error('Isi alasan penolakan.');
    await _disputeSave(d, { ...cur, status: 'DITOLAK', resolved_by: admin, resolved_at: now, catatan,
      log: [...log, { type: 'DITOLAK', at: now, by_nama: admin, catatan }] });
    await _notifyPerson(sheets, { ...oldPic, nik: cur.by_nik || oldPic.nik },
      `Pengajuan PIC salah ditolak — ${d.id}`,
      `Halo ${oldPic.nama || ''}, pengajuan bahwa kamu bukan PIC laporan ${d.label} ${d.id} DITOLAK oleh ${admin}.\n\nAlasan: ${catatan}\n\nKamu tetap PIC laporan ini. Batas waktu: ${d.batas || '-'}.`, d.url);
    return { status: 'success', message: 'Pengajuan ditolak. PIC tetap.' };
  }

  if (data.keputusan !== 'GANTI') throw new Error('Keputusan tidak dikenali.');
  const baru = await _rosterByNik(data.nik_pic_baru);
  if (!baru) throw new Error('PIC baru tidak ditemukan di data karyawan.');
  const baruNik = String(baru.NIK || data.nik_pic_baru).trim();
  await assertPicEligible(sheets, baruNik, baru.NAMA);
  if ((oldPic.nik && String(oldPic.nik).trim() === baruNik) ||
      String(oldPic.nama || '').trim().toLowerCase() === String(baru.NAMA || '').trim().toLowerCase())
    throw new Error('PIC baru sama dengan PIC sekarang.');

  // Deadline baru = hari ini (WIB) + durasi awal (deadline lama − tanggal laporan), min 1 hari.
  let batas = /^\d{4}-\d{2}-\d{2}$/.test(String(data.batas_waktu || '')) ? data.batas_waktu : '';
  if (!batas) {
    const a = _ymd(d.tanggal), b = _ymd(d.batas);
    const dur = a && b ? Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5)) : 7;
    batas = new Date(new Date(_todayWib()).getTime() + dur * 864e5).toISOString().slice(0, 10);
  }
  const patch = {
    nik: baruNik, nama: baru.NAMA || '', jabatan: baru.JABATAN || '', departemen: baru.DEPARTEMEN || '',
    perusahaan: baru.PERUSAHAAN || '', wa: String(baru['NO WHATSAPP'] || '').replace(/\D/g, ''), batas,
  };
  await _disputeSave(d, { ...cur, status: 'DIGANTI', resolved_by: admin, resolved_at: now, catatan, pic_baru: patch.nama,
    log: [...log, { type: 'DIGANTI', at: now, by_nama: admin, dari: oldPic.nama || '', ke: patch.nama, batas, catatan }] }, patch);

  const info = `Laporan ${d.label} ${d.id}${d.lokasi ? ` (${d.lokasi})` : ''}`;
  await Promise.allSettled([
    _notifyPerson(sheets, { nik: patch.nik, nama: patch.nama, wa: patch.wa }, `Kamu ditunjuk sebagai PIC — ${d.id}`,
      `Halo ${patch.nama}, kamu ditetapkan sebagai PIC ${info} menggantikan ${oldPic.nama || 'PIC sebelumnya'}.\n\nBatas waktu: ${batas}${catatan ? `\nCatatan admin: ${catatan}` : ''}`, d.url),
    _notifyPerson(sheets, { ...oldPic, nik: cur.by_nik || oldPic.nik }, `Kamu tidak lagi PIC — ${d.id}`,
      `Halo ${oldPic.nama || ''}, pengajuan kamu disetujui. PIC ${info} kini ${patch.nama}. Kamu tidak perlu menindaklanjuti laporan ini lagi.`, d.url),
    _notifyPerson(sheets, d.pelapor, `PIC laporan kamu diganti — ${d.id}`,
      `Halo ${d.pelapor.nama || ''}, PIC ${info} diganti dari ${oldPic.nama || '-'} menjadi ${patch.nama} oleh ${admin}.\nBatas waktu baru: ${batas}.`, d.url),
  ]);
  return { status: 'success', message: `PIC diganti menjadi ${patch.nama}. Batas waktu baru ${batas}.` };
}

// Antrean admin: pengajuan yang menunggu (Super Admin semua; Admin perusahaannya).
async function getPicDisputes(auth) {
  const role = normalizeRole(auth.role);
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return { status: 'success', data: [] };
  const sql = getSql();
  const [h, i, s] = await Promise.all([
    sql`SELECT id, data FROM hazard_report WHERE data->'pic_dispute'->>'status' = 'PENDING'`,
    sql`SELECT id, data FROM inspection_report WHERE data->'pic_dispute'->>'status' = 'PENDING'`,
    sql`SELECT id, lokasi, perusahaan_observer, nama_pic, pic_dispute FROM sbo_report WHERE pic_dispute->>'status' = 'PENDING'`.catch(() => []),
  ]);
  const co = String(auth.perusahaan || '').trim().toUpperCase();
  const rows = [
    ...h.map((r) => ({ id: r.id, modul: 'HAZARD', lokasi: r.data.lokasi_bahaya || '', perusahaan: r.data.perusahaan, nama_pic: r.data.nama_pic, dispute: r.data.pic_dispute, url: `laporan-detail.html?id=${encodeURIComponent(r.id)}` })),
    ...i.map((r) => ({ id: r.id, modul: 'INSPECTION', lokasi: r.data.lokasi || '', perusahaan: r.data.perusahaan, nama_pic: r.data.nama_pic, dispute: r.data.pic_dispute, url: `laporan-detail.html?id=${encodeURIComponent(r.id)}` })),
    ...s.map((r) => ({ id: r.id, modul: 'SBO', lokasi: r.lokasi || '', perusahaan: r.perusahaan_observer, nama_pic: r.nama_pic, dispute: r.pic_dispute, url: `sbo.html?id=${encodeURIComponent(r.id)}` })),
  ].filter((r) => role === 'SUPER_ADMIN' || String(r.perusahaan || '').trim().toUpperCase() === co);
  return { status: 'success', data: rows };
}

async function getSBOReports(sheets, auth, mineOnly) {
  const sql = getSql();
  let rows;
  try { rows = await sql`SELECT * FROM sbo_report`; } catch { return { status: 'success', data: [] }; }
  let data = rows.map(r => ({ ...r, report_type: 'SBO' })).filter(r => String(r.id || '').trim());
  if (!isSuperAdmin(auth?.role)) {
    const co = String(auth?.perusahaan || '').trim().toUpperCase();
    if (co) data = data.filter(r => String(r.perusahaan_observer || '').trim().toUpperCase() === co);
  }
  // mineOnly (halaman daftar): USER hanya lihat SBO yang dia terlibat (observer/PIC/observee).
  if (mineOnly && !isAdminOrAbove(auth?.role)) {
    const un = String(auth?.nik || '').trim().toLowerCase();
    const nm = String(auth?.nama || '').trim().toLowerCase();
    data = data.filter(r => ['nik_observer', 'nama_observer', 'nik_pic', 'nama_pic', 'nama_observee']
      .some(k => { const v = String(r[k] || '').trim().toLowerCase(); return v && (v === un || v === nm); }));
  }
  return { status: 'success', data };
}

// ── Report store (Postgres, JSONB) — hazard + inspeksi ──────────────────────
// Hazard_Report → tabel hazard_report; INS_* → inspection_report (kolom jenis).
// Baris disimpan sebagai `data` JSONB (objek ter-normalisasi, sama seperti yang
// dulu dihasilkan getHazardReports/getInspectionReports dari sheet).
async function _reportFind(sheetName, id) {
  const sql = getSql();
  const idT = String(id || '').trim();
  if (sheetName === 'Hazard_Report') {
    const r = (await sql`SELECT data FROM hazard_report WHERE id = ${idT}`)[0];
    return r ? { ...r.data, report_type: 'HAZARD' } : null;
  }
  const r = (await sql`SELECT jenis, data FROM inspection_report WHERE id = ${idT}`)[0];
  return r ? { ...r.data, report_type: 'INSPECTION', inspection_sheet: r.jenis } : null;
}
async function _reportSet(sheetName, id, fields) {
  const sql = getSql();
  const idT = String(id || '').trim();
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[normalizeHeader(k)] = v;
  const patch = JSON.stringify(obj);
  const newStatus = obj.status_perbaikan ?? null; // COALESCE menjaga nilai lama bila tak diubah
  if (sheetName === 'Hazard_Report')
    await sql`UPDATE hazard_report SET data = data || ${patch}::jsonb, status_perbaikan = COALESCE(${newStatus}, status_perbaikan) WHERE id = ${idT}`;
  else
    await sql`UPDATE inspection_report SET data = data || ${patch}::jsonb, status_perbaikan = COALESCE(${newStatus}, status_perbaikan) WHERE id = ${idT}`;
}

async function updateWorkflowFields(sheets, sheetName, reportId, fields) {
  const pre = await _reportFind(sheetName, reportId); // baris SEBELUM update (untuk kontak WA/push)
  if (!pre) throw new Error('Laporan tidak ditemukan.');
  await _reportSet(sheetName, reportId, fields);
  return pre;
}

// Cek bahwa caller adalah PIC atau pelapor laporan (skip jika NIK tidak tersedia di report lama)
function assertReportRole(reportRow, auth, requiredRole) {
  if (isAdminOrAbove(auth.role)) return;
  const authNik = String(auth.nik || '').trim();
  if (!authNik) return; // token tanpa NIK = tidak bisa verifikasi
  if (requiredRole === 'pic') {
    const picNik = String(reportRow['nik_pic'] || reportRow['nip_pic'] || '').trim();
    // NIK PIC kosong (laporan lama): cocokkan nama PIC dengan nama akun (2026-10-12; dulu dilewati
    // sehingga siapa pun bisa kirim rencana/closing).
    const sama = picNik
      ? picNik === authNik
      : String(reportRow['nama_pic'] || '').trim().toUpperCase() === String(auth.nama || '').trim().toUpperCase();
    if (!sama)
      throw Object.assign(new Error('Akses ditolak: kamu bukan PIC laporan ini.'), { httpStatus: 403 });
  } else {
    const repNik = String(reportRow['nik'] || reportRow['nik_pelapor'] || '').trim();
    if (repNik && repNik !== authNik)
      throw Object.assign(new Error('Akses ditolak: kamu bukan pelapor laporan ini.'), { httpStatus: 403 });
  }
}

async function submitActionPlan(sheets, data, sheetName, auth) {
  if (!data.rencana_tindakan?.trim()) throw new Error('Rencana tindakan wajib diisi.');
  // Baca dulu untuk cek ownership sebelum update
  const checkNorm = await _reportFind(sheetName, data.id);
  if (!checkNorm) throw new Error('Laporan tidak ditemukan.');
  assertReportRole(checkNorm, auth, 'pic');
  const reportRow = await updateWorkflowFields(sheets, sheetName, data.id, {
    'RENCANA_TINDAKAN':  data.rencana_tindakan.trim(),
    'TANGGAL_RENCANA':   data.tanggal_rencana || '',
    'PLAN_STATUS':       'pending_review',
    'PLAN_SUBMITTED_AT': new Date().toISOString(),
  });
  const noWa = reportRow['no_whatsapp'] || '';
  const nama  = reportRow['nama'] || '';
  {
    const msg = `Halo ${nama}, PIC telah menyampaikan rencana tindakan untuk laporan *${data.id}*.\n\n` +
      `📋 Rencana: ${data.rencana_tindakan.trim()}\n📅 Tanggal rencana: ${data.tanggal_rencana || '-'}\n\n` +
      `Silakan berikan persetujuan:\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`;
    await _notifyPerson(sheets, { nik: reportRow['nik'] || reportRow['nik_pelapor'], nama, wa: noWa }, `[ONE-SAP] ${data.id} — Rencana tindakan menunggu persetujuanmu`, msg, `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`, { push: false }).catch(() => {});
  }
  // [PUSH-START]
  const reporterNik = reportRow['nik'] || reportRow['nik_pelapor'] ||
    await resolveNikFromWa(sheets, reportRow['no_whatsapp']).catch(() => '');
  console.log(`[push] submitActionPlan reporterNik="${reporterNik}" id=${data.id}`);
  if (reporterNik) await sendPushToNik(sheets, reporterNik, {
    title: 'Rencana Tindakan Masuk 📋',
    body: `PIC telah submit rencana untuk laporan ${data.id}. Silakan review.`,
    url: `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`
  }).catch(() => {});
  // [PUSH-END]
  return { status: 'success', message: 'Rencana tindakan berhasil dikirim ke pelapor.' };
}

async function reviewActionPlan(sheets, data, sheetName, auth) {
  const decision = data.decision;
  if (decision !== 'approved' && decision !== 'rejected') throw new Error('Decision harus approved atau rejected.');
  if (decision === 'rejected' && !data.comment?.trim()) throw new Error('Komentar wajib diisi jika menolak.');
  // Cek ownership: harus pelapor atau admin
  const checkNorm = await _reportFind(sheetName, data.id);
  if (!checkNorm) throw new Error('Laporan tidak ditemukan.');
  assertReportRole(checkNorm, auth, 'reporter');
  const fields = {
    'PLAN_STATUS':          decision,
    'PLAN_REVIEW_COMMENT':  data.comment || '',
    'PLAN_REVIEWED_AT':     new Date().toISOString(),
  };
  if (decision === 'approved') fields['STATUS PERBAIKAN'] = 'PROGRESS';
  const reportRow = await updateWorkflowFields(sheets, sheetName, data.id, fields);
  const noWaPic = reportRow['no_whatsapp_pic'] || '';
  const namaPic = reportRow['nama_pic'] || '';
  {
    const msg = decision === 'approved'
      ? `Halo ${namaPic}, rencana tindakan untuk laporan *${data.id}* telah ✅ *DISETUJUI* ${data.otomatis ? 'otomatis (pelapor tidak merespons 2 hari)' : 'oleh pelapor'}.\n\nSilakan lanjutkan perbaikan:\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`
      : `Halo ${namaPic}, rencana tindakan untuk laporan *${data.id}* ❌ *DITOLAK* oleh pelapor.\n\n💬 Komentar: ${data.comment}\n\nSilakan revisi rencana:\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`;
    await _notifyPerson(sheets, { nik: reportRow['nik_pic'], nama: namaPic, wa: noWaPic }, `[ONE-SAP] ${data.id} — Rencana tindakan ${decision === 'approved' ? 'disetujui' : 'ditolak'}`, msg, `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`, { push: false }).catch(() => {});
  }
  // [PUSH-START]
  const picWaReview = reportRow['no_whatsapp_pic'] || reportRow['no_whattsapp_pic'] || '';
  const picNikReview = reportRow['nik_pic'] ||
    await resolveNikFromWa(sheets, picWaReview).catch(() => '');
  console.log(`[push] reviewActionPlan decision=${decision} picWa="${picWaReview}" picNik="${picNikReview}" id=${data.id}`);
  if (picNikReview) await sendPushToNik(sheets, picNikReview, decision === 'approved'
    ? { title: 'Rencana Disetujui ✅', body: `Laporan ${data.id}: rencana kamu disetujui. Mulai perbaikan!`, url: `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}` }
    : { title: 'Rencana Ditolak ❌', body: `Laporan ${data.id}: rencana kamu ditolak. Silakan revisi.`, url: `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}` }
  ).catch(() => {});
  // [PUSH-END]
  return { status: 'success', message: decision === 'approved' ? 'Rencana disetujui.' : 'Rencana ditolak, PIC akan merevisi.' };
}

async function updateReport(sheets, data, sheetName, folderSuffix, auth) {
  const rowObj = await _reportFind(sheetName, data.id);
  if (!rowObj) throw new Error('Data tidak ditemukan.');
  if (auth) assertReportRole(rowObj, auth, 'pic');

  let fotoPerbaikanUrl = '';
  if (data.upload_foto_perbaikan_pic) {
    const closingParent = process.env.FOLDER_CLOSING_ID || process.env.FOLDER_HAZARD_ID;
    const closingFolder = await driveSubfolderId(closingParent, sheetName === 'Hazard_Report' ? 'HR' : 'INS');
    fotoPerbaikanUrl = await saveMultipleImagesToDrive(data.upload_foto_perbaikan_pic, closingFolder, data.id + folderSuffix);
  }

  const fields = {
    'STATUS PERBAIKAN': data.status_perbaikan || 'OPEN',
    'CATATAN CLOSING':  data.catatan_closing || '',
  };
  if (fotoPerbaikanUrl) fields['UPLOAD FOTO PERBAIKAN PIC'] = fotoPerbaikanUrl;
  if (data.status_perbaikan === 'CLOSED') fields['TANGGAL CLOSING'] = new Date().toISOString();
  if (data.closing_status) fields['CLOSING_STATUS'] = data.closing_status;
  if (data.closing_status === 'pending_review') fields['CLOSING_SUBMITTED_AT'] = new Date().toISOString();
  await _reportSet(sheetName, data.id, fields);
  if (data.status_perbaikan === 'FOLLOWUP' && sheetName !== 'SBO_Report') {
    await _bekukanTtdPic(data.id, rowObj['nik_pic'], rowObj['nama_pic']).catch((e) => console.error('[ttd closing]', e.message));
  }

  // [PUSH-START] — push/WA ke pelapor saat laporan FOLLOWUP atau CLOSED
  if (data.status_perbaikan === 'CLOSED' || data.status_perbaikan === 'FOLLOWUP') {
    const reporterNik = rowObj['nik_observer'] || rowObj['nik'] || rowObj['nik_pelapor'] || '';
    const isSBO = sheetName === 'SBO_Report';
    const detailUrl = isSBO ? `https://sap-ebl.vercel.app/sbo.html` : `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`;
    if (data.status_perbaikan === 'CLOSED') {
      if (reporterNik) await sendPushToNik(sheets, reporterNik, {
        title: 'Laporan Selesai ✅', body: `Laporan ${data.id} telah berhasil ditutup.`, url: detailUrl
      }).catch(() => {});
    } else {
      const noWa = rowObj['no_whatsapp'] || '';
      const nama = rowObj['nama'] || rowObj['nama_observer'] || '';
      if (!isSBO) {
        const msg = `Halo ${nama}, PIC laporan *${data.id}* telah menyelesaikan perbaikan dan meminta konfirmasimu.\n\nSilakan konfirmasi apakah perbaikan sudah sesuai:\n🔗 ${detailUrl}`;
        await _notifyPerson(sheets, { nik: reporterNik, nama, wa: noWa }, `[ONE-SAP] ${data.id} — Closing menunggu konfirmasimu`, msg, detailUrl, { push: false }).catch(() => {});
      }
      if (reporterNik) await sendPushToNik(sheets, reporterNik, {
        title: isSBO ? 'PIC SBO Telah Submit Perbaikan 📸' : 'Perlu Konfirmasi Closing 🔔',
        body: isSBO ? `PIC laporan SBO ${data.id} telah upload foto perbaikan.` : `PIC laporan ${data.id} telah submit closing. Silakan konfirmasi.`,
        url: detailUrl
      }).catch(() => {});
    }
  }
  // [PUSH-END]
  return { status: 'success', message: 'Laporan berhasil diperbarui.', id: data.id, foto_perbaikan_url: fotoPerbaikanUrl };
}

async function ensureClosingColumns(sheets, sheetName) {
  return; // Hazard/Inspeksi kini Postgres JSONB — tak perlu kolom sheet.
  // eslint-disable-next-line no-unreachable
  const needed = ['CLOSING_STATUS', 'CLOSING_REVIEW_COMMENT', 'CLOSING_REVIEWED_AT'];
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!1:1` });
  const existing = (res.data.values?.[0] || []).map(h => normalizeHeader(h));
  const toAdd = needed.filter(c => !existing.includes(normalizeHeader(c)));
  if (!toAdd.length) return;

  // Expand grid columns jika sheet belum punya cukup kolom
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title,gridProperties))'
  });
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === sheetName);
  const currentCols = sheetMeta?.properties?.gridProperties?.columnCount || 0;
  const neededCols = existing.length + toAdd.length;
  if (neededCols > currentCols) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ appendDimension: {
        sheetId: sheetMeta.properties.sheetId,
        dimension: 'COLUMNS',
        length: neededCols - currentCols
      }}]}
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${colIndexToLetter(existing.length)}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [toAdd] }
  });
}

async function reviewClosing(sheets, data, sheetName, auth) {
  const { decision } = data;
  if (decision !== 'confirmed' && decision !== 'rejected') throw new Error('Decision harus confirmed atau rejected.');
  if (decision === 'rejected' && !data.comment?.trim()) throw new Error('Catatan wajib diisi jika menolak closing.');
  // Cek ownership: harus pelapor atau admin
  const checkNorm = await _reportFind(sheetName, data.id);
  if (!checkNorm) throw new Error('Laporan tidak ditemukan.');
  assertReportRole(checkNorm, auth, 'reporter');

  await ensureClosingColumns(sheets, sheetName);

  const fields = {
    'CLOSING_STATUS':         decision,
    'CLOSING_REVIEW_COMMENT': data.comment || '',
    'CLOSING_REVIEWED_AT':    new Date().toISOString(),
    'STATUS PERBAIKAN':       decision === 'confirmed' ? 'CLOSED' : 'PROGRESS',
  };
  if (decision === 'confirmed') fields['TANGGAL CLOSING'] = new Date().toISOString();

  const reportRow = await updateWorkflowFields(sheets, sheetName, data.id, fields);

  const noWaPic = reportRow['no_whatsapp_pic'] || '';
  const namaPic = reportRow['nama_pic'] || '';
  {
    const msg = decision === 'confirmed'
      ? `Halo ${namaPic}, closing laporan *${data.id}* telah ✅ *DIKONFIRMASI* ${data.otomatis ? 'otomatis (pelapor tidak merespons 3 hari)' : 'oleh pelapor'}. Laporan dinyatakan selesai.\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`
      : `Halo ${namaPic}, closing laporan *${data.id}* ❌ *DITOLAK* oleh pelapor.\n\n💬 Catatan: ${data.comment}\n\nSilakan revisi dan submit ulang:\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`;
    await _notifyPerson(sheets, { nik: reportRow['nik_pic'], nama: namaPic, wa: noWaPic }, `[ONE-SAP] ${data.id} — Closing ${decision === 'confirmed' ? 'dikonfirmasi' : 'ditolak'}`, msg, `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`, { push: false }).catch(() => {});
  }
  const picWa  = reportRow['no_whatsapp_pic'] || reportRow['no_whattsapp_pic'] || '';
  const picNik = reportRow['nik_pic'] || await resolveNikFromWa(sheets, picWa).catch(() => '');
  if (picNik) await sendPushToNik(sheets, picNik, decision === 'confirmed'
    ? { title: 'Closing Dikonfirmasi ✅', body: `Laporan ${data.id} dinyatakan selesai oleh pelapor.`, url: `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}` }
    : { title: 'Closing Ditolak ❌', body: `Laporan ${data.id}: closing ditolak. Silakan revisi dan submit ulang.`, url: `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}` }
  ).catch(() => {});

  return { status: 'success', message: decision === 'confirmed' ? 'Closing dikonfirmasi. Laporan selesai.' : 'Closing ditolak. PIC akan diminta submit ulang.' };
}

// ===== HANDLER =====

// ── Perpanjangan batas waktu (A6, 2026-10-12) ─────────────────────────────────
// PIC mengajukan tanggal batas waktu baru + alasan; pelapor (atau admin/SHE) menyetujui/menolak.
// Disimpan di data.perpanjangan; disetujui → batas_waktu diganti & eskalasi SHE di-reset.
async function _perpanjanganMuat(id) {
  const idT = String(id || '').trim();
  const tabel = /^INSP/i.test(idT) ? 'inspection_report' : 'hazard_report';
  const d = await _disputeLoad(tabel === 'inspection_report' ? 'INSPECTION' : 'HAZARD', idT);
  return d ? { ...d, tabel } : null;
}
async function _perpanjanganSimpan(tabel, id, patch) {
  await getSql()(`UPDATE ${tabel} SET data = (data - 'eskalasi_she_at') || $1::jsonb WHERE id = $2`, [JSON.stringify(patch), id]);
}
async function ajukanPerpanjangan(sheets, auth, data) {
  const d = await _perpanjanganMuat(data.id);
  if (!d) throw new Error('Laporan tidak ditemukan.');
  const row = (await getSql()(`SELECT data FROM ${d.tabel} WHERE id = $1`, [d.id]))[0]?.data || {};
  assertReportRole(row, auth, 'pic');
  if (['CLOSED', 'FOLLOWUP'].includes(d.status)) throw new Error('Laporan sudah tahap closing — perpanjangan tidak diperlukan.');
  if (row.perpanjangan?.status === 'PENDING') throw new Error('Masih ada pengajuan perpanjangan yang menunggu keputusan.');
  const tgl = String(data.tanggal_baru || '').slice(0, 10);
  const alasan = String(data.alasan || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) throw new Error('Tanggal batas waktu baru wajib diisi.');
  if (tgl <= todayJakarta()) throw new Error('Tanggal baru harus setelah hari ini.');
  if (alasan.length < 5) throw new Error('Alasan wajib diisi (minimal 5 karakter).');
  const me = (await _rosterByNik(auth.nik)) || {};
  const now = new Date().toISOString();
  const log = Array.isArray(row.perpanjangan?.log) ? row.perpanjangan.log : [];
  await getSql()(`UPDATE ${d.tabel} SET data = data || $1::jsonb WHERE id = $2`, [JSON.stringify({ perpanjangan: {
    status: 'PENDING', tanggal_baru: tgl, alasan, batas_lama: String(d.batas || '').slice(0, 10),
    by_nik: auth.nik || '', by_nama: me.NAMA || auth.nama || '', at: now,
    log: [...log, { type: 'AJUAN', at: now, by_nama: me.NAMA || auth.nama || '', tanggal_baru: tgl, alasan }],
  } }), d.id]);
  await _notifyPerson(sheets, d.pelapor, `[ONE-SAP] ${d.id} — PIC mengajukan perpanjangan batas waktu`,
    `PIC ${d.pic.nama || ''} mengajukan perpanjangan batas waktu laporan ${d.id}.\n\nBatas waktu sekarang: ${String(d.batas || '-').slice(0, 10)}\nUsulan baru: ${tgl}\nAlasan: ${alasan}\n\nSilakan setujui atau tolak di ONE-SAP.`,
    d.url).catch(() => {});
  return { status: 'success', message: 'Pengajuan perpanjangan terkirim ke pelapor.' };
}
async function putuskanPerpanjangan(sheets, auth, data) {
  const d = await _perpanjanganMuat(data.id);
  if (!d) throw new Error('Laporan tidak ditemukan.');
  const row = (await getSql()(`SELECT data FROM ${d.tabel} WHERE id = $1`, [d.id]))[0]?.data || {};
  assertReportRole(row, auth, 'reporter');
  const p0 = row.perpanjangan;
  if (p0?.status !== 'PENDING') throw new Error('Tidak ada pengajuan perpanjangan yang menunggu.');
  const setuju = data.keputusan === 'setuju';
  const catatan = String(data.catatan || '').trim();
  if (!setuju && catatan.length < 3) throw new Error('Catatan wajib diisi bila menolak.');
  const me = (await _rosterByNik(auth.nik)) || {};
  const now = new Date().toISOString();
  const pp = { ...p0, status: setuju ? 'DISETUJUI' : 'DITOLAK', keputusan_by: me.NAMA || auth.nama || '', keputusan_at: now, catatan,
    log: [...(p0.log || []), { type: setuju ? 'SETUJU' : 'TOLAK', at: now, by_nama: me.NAMA || auth.nama || '', catatan }] };
  if (setuju) await _perpanjanganSimpan(d.tabel, d.id, { perpanjangan: pp, batas_waktu: p0.tanggal_baru });
  else await getSql()(`UPDATE ${d.tabel} SET data = data || $1::jsonb WHERE id = $2`, [JSON.stringify({ perpanjangan: pp }), d.id]);
  await _notifyPerson(sheets, d.pic, `[ONE-SAP] ${d.id} — Perpanjangan ${setuju ? 'disetujui' : 'ditolak'}`,
    setuju ? `Perpanjangan batas waktu laporan ${d.id} DISETUJUI. Batas waktu baru: ${p0.tanggal_baru}.`
           : `Perpanjangan batas waktu laporan ${d.id} DITOLAK.\nCatatan: ${catatan}\n\nBatas waktu tetap ${String(d.batas || '-').slice(0, 10)}.`,
    d.url).catch(() => {});
  return { status: 'success', message: setuju ? `Disetujui. Batas waktu baru ${p0.tanggal_baru}.` : 'Perpanjangan ditolak.' };
}

// ── Alur pelaporan otomatis (A3–A5, keputusan user 2026-10-12) ──────────────────
// Harian (dipanggil api/cron-deadline.js): setujui rencana > 2 hari, konfirmasi closing > 3 hari
// (memakai reviewActionPlan/reviewClosing yang sama → efek & notifikasi identik), lalu eskalasi
// bertingkat PIC → Section Head departemen PIC → SHE. Eskalasi dikirim 1 email ringkas per
// penerima; tiap tingkat ditandai di data (eskalasi_*_at) supaya tidak berulang.
const SISTEM = { role: 'SUPER_ADMIN', nik: '', nama: 'Sistem ONE-SAP' };
async function cronAlurLaporan({ dry = false, batasMs = 45000 } = {}) {
  const sql = getSql();
  const { sheets } = getClients();
  const mulai = Date.now();
  const [hz, ins, roster] = await Promise.all([
    sql`SELECT id, status_perbaikan, data FROM hazard_report WHERE upper(coalesce(status_perbaikan,'')) <> 'CLOSED'`,
    sql`SELECT id, jenis, status_perbaikan, data FROM inspection_report WHERE upper(coalesce(status_perbaikan,'')) <> 'CLOSED'`,
    _karyawanRows(sheets),
  ]);
  const laporan = [
    ...hz.map((r) => ({ tabel: 'hazard_report', sheet: 'Hazard_Report', id: r.id, status: r.status_perbaikan, data: r.data || {} })),
    ...ins.map((r) => ({ tabel: 'inspection_report', sheet: r.jenis, id: r.id, status: r.status_perbaikan, data: r.data || {} })),
  ];
  const sheetOf = new Map(laporan.map((l) => [l.id, l.sheet]));
  const aksi = rencanakanAlur(laporan, Date.now(), todayJakarta()); // tanggal lokal: cron kini 06:00 WITA (= kemarin dalam UTC)
  const hitung = aksi.reduce((a, x) => ((a[x.aksi] = (a[x.aksi] || 0) + 1), a), {});
  if (dry) return { dry: true, ...hitung };

  const hasil = { setujuiRencana: 0, konfirmasiClosing: 0, ingatkanPic: 0, eskalasiSect: 0, eskalasiShe: 0, gagal: 0, terpotong: false };
  const waktuHabis = () => Date.now() - mulai > batasMs;

  // A3 & A5 — lewat fungsi review yang sama dengan tombol pelapor
  for (const a of aksi.filter((x) => x.aksi === 'setujuiRencana' || x.aksi === 'konfirmasiClosing')) {
    if (waktuHabis()) { hasil.terpotong = true; break; }
    const sheet = sheetOf.get(a.id);
    const payload = { id: a.id, otomatis: true, ...(sheet !== 'Hazard_Report' ? { inspection_sheet: sheet } : {}) };
    try {
      if (a.aksi === 'setujuiRencana') await reviewActionPlan(sheets, { ...payload, decision: 'approved', comment: 'Disetujui otomatis: pelapor tidak merespons 2 hari.' }, sheet, SISTEM);
      else await reviewClosing(sheets, { ...payload, decision: 'confirmed', comment: 'Dikonfirmasi otomatis: pelapor tidak merespons 3 hari.' }, sheet, SISTEM);
      hasil[a.aksi]++;
    } catch (e) { hasil.gagal++; console.error('[alur]', a.aksi, a.id, e.message); }
  }

  // A4 — eskalasi, dikelompokkan per penerima
  const norm = (v) => String(v || '').trim().toUpperCase();
  const byNik = new Map(roster.map((r) => [String(r.NIK || '').trim(), r]));
  const baris = (a) => `- ${a.id} · ${a.data.lokasi_bahaya || a.data.lokasi_inspeksi || a.data.lokasi || '-'} · PIC ${a.data.nama_pic || '-'} · batas ${String(a.data.batas_waktu || '-').slice(0, 10)}`;
  const daftar = (arr, maks = 40) => arr.slice(0, maks).map(baris).join('\n') + (arr.length > maks ? `\n... dan ${arr.length - maks} laporan lainnya` : '');
  const kelompok = (nama, kunci) => {
    const m = new Map();
    for (const a of aksi.filter((x) => x.aksi === nama)) { const k = kunci(a); if (!m.has(k)) m.set(k, []); m.get(k).push(a); }
    return m;
  };
  const tandai = async (arr, kolom) => {
    for (const tabel of ['hazard_report', 'inspection_report']) {
      const ids = arr.filter((a) => a.tabel === tabel).map((a) => a.id);
      if (ids.length) await sql(`UPDATE ${tabel} SET data = data || jsonb_build_object($1::text, $2::text) WHERE id = ANY($3::text[])`, [kolom, new Date().toISOString(), ids]);
    }
  };
  const URL_ESK = 'https://sap-ebl.vercel.app/eskalasi.html';

  for (const [nik, arr] of kelompok('ingatkanPic', (a) => String(a.data.nik_pic || a.data.nama_pic || ''))) {
    if (waktuHabis()) { hasil.terpotong = true; break; }
    const k = byNik.get(nik);
    await _notifyPerson(sheets, { nik: k ? nik : '', nama: k?.NAMA || arr[0].data.nama_pic }, `[ONE-SAP] ${arr.length} laporan menunggu rencana tindakanmu`,
      `Halo ${k?.NAMA || arr[0].data.nama_pic || ''}, laporan berikut sudah lebih dari 3 hari tanpa rencana tindakan darimu sebagai PIC:\n\n${daftar(arr)}\n\nSilakan buka ONE-SAP dan kirim rencana tindakan. Bila kamu bukan PIC yang tepat, gunakan tombol "Bukan PIC saya" di laporan.`,
      'https://sap-ebl.vercel.app/index-home.html').catch(() => {});
    await tandai(arr, 'eskalasi_pic_at');
    hasil.ingatkanPic += arr.length;
  }

  // Section Head = karyawan roster ber-jabatan "SECTION HEAD" di departemen & perusahaan PIC
  const sectHeadOf = (a) => {
    const pic = byNik.get(String(a.data.nik_pic || '').trim());
    const dept = norm(pic?.DEPARTEMEN || a.data.departemen_pic), pt = norm(pic?.PERUSAHAAN || a.data.perusahaan_pic);
    const sh = roster.find((r) => norm(r.DEPARTEMEN) === dept && norm(r.PERUSAHAAN) === pt && /SECTION HEAD|SECT\.? HEAD/.test(norm(r.JABATAN)));
    return sh && String(sh.NIK) !== String(a.data.nik_pic) ? String(sh.NIK) : '';
  };
  for (const [shNik, arr] of kelompok('eskalasiSect', sectHeadOf)) {
    if (waktuHabis()) { hasil.terpotong = true; break; }
    if (shNik) {
      const sh = byNik.get(shNik);
      await _notifyPerson(sheets, { nik: shNik, nama: sh?.NAMA }, `[ONE-SAP] ${arr.length} laporan di departemenmu belum ditindaklanjuti`,
        `Halo ${sh?.NAMA || ''}, laporan berikut sudah lebih dari 7 hari tanpa rencana tindakan dari PIC di departemenmu:\n\n${daftar(arr)}\n\nMohon bantu tindak lanjuti bersama PIC terkait.`, URL_ESK).catch(() => {});
      hasil.eskalasiSect += arr.length;
    }
    await tandai(arr, 'eskalasi_sect_at'); // tanpa Section Head → tetap ditandai; SHE menerima saat lewat batas waktu
  }

  const she = aksi.filter((x) => x.aksi === 'eskalasiShe');
  if (she.length && !waktuHabis()) {
    const sheHead = roster.find((r) => norm(r.DEPARTEMEN) === 'SHE' && /SECTION HEAD/.test(norm(r.JABATAN)));
    const teks = `Laporan berikut sudah lewat batas waktu dan belum selesai (${she.length} laporan):\n\n${daftar(she, 60)}\n\nDaftar lengkap & tombol ingatkan PIC ada di menu Eskalasi.`;
    const subjek = `[ONE-SAP] ${she.length} laporan lewat batas waktu`;
    await _sendMail(PIC_DISPUTE_EMAIL, subjek, teks, URL_ESK).catch(() => {});
    if (sheHead?.NIK) await _notifyPerson(sheets, { nik: String(sheHead.NIK), nama: sheHead.NAMA }, subjek, teks, URL_ESK).catch(() => {});
    await tandai(she, 'eskalasi_she_at');
    hasil.eskalasiShe = she.length;
  } else if (she.length) hasil.terpotong = true;

  console.log('[alur]', JSON.stringify(hasil));
  return hasil;
}

// Dipakai api/cron-kuis-st.js (cron harian).
const cronKuisST = () => kirimNotifKuisST(getClients().sheets);

module.exports = async (req, res) => {
  try {
    // CORS preflight — kiosk quiz-she (origin lain) memanggil endpoint email OTP
    // via POST+JSON, yang memicu OPTIONS lebih dulu. Jawab di sini sebelum apa pun.
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      return res.status(204).end();
    }

    const { sheets } = getClients();

    if (req.method === 'GET') {
      const { action, type } = req.query;

      // Health check — satu-satunya GET tanpa auth
      if (!action) return res.status(200).json({ status: 'success', message: 'HAZARD REPORT ONE-SAP API is running' });

      // getSafetyTalkPublic — tidak butuh auth (data non-sensitif untuk integrasi quiz-she)
      if (action === 'getSafetyTalkPublic') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        let rows = [];
        try { rows = await getSql()`SELECT * FROM safety_talk_schedule WHERE status = 'AKTIF'`; } catch {}
        return res.status(200).json({
          status: 'success',
          data: rows.map(r => ({
            id: r.id, tanggal: r.tanggal, bulan: r.bulan,
            judul: r.judul_materi, deskripsi: r.deskripsi_materi,
            pemateri: r.nama_pemateri, perusahaan_target: r.perusahaan_target || '',
          })),
        });
      }

      // syncSafetyTalkQuiz (2026-09-16) — dipanggil quiz-she begitu seseorang LULUS
      // kuis Safety Talk, supaya QUIZ_DONE terisi saat itu juga (capaian langsung
      // +1) tanpa menunggu admin menyimpan ulang absensi.
      // Tanpa auth, tapi AMAN: pemanggil hanya bisa "minta dicek" — server ini
      // memverifikasi sendiri ke quiz-she sebelum menulis apa pun, jadi request
      // palsu tidak bisa memalsukan kelulusan.
      if (action === 'syncSafetyTalkQuiz') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        const schedId = String(req.query.schedule_id || '').trim();
        const nik     = String(req.query.nik || '').trim();
        if (!schedId || !nik) return res.status(400).json({ status: 'error', message: 'schedule_id & nik wajib.' });

        const sql = getSql();
        const row = (await sql`SELECT status_kehadiran, quiz_done FROM safety_talk_absensi WHERE schedule_id = ${schedId} AND nik = ${nik}`)[0];
        if (!row) return res.status(200).json({ status: 'success', updated: false, reason: 'no_row' });
        const status = String(row.status_kehadiran || 'HADIR').toUpperCase();
        if (status === 'HADIR' || status === 'MANGKIR')
          return res.status(200).json({ status: 'success', updated: false, reason: 'not_quiz_required', status_kehadiran: status });
        if (String(row.quiz_done || '').toUpperCase() === 'YA')
          return res.status(200).json({ status: 'success', updated: false, reason: 'already' });

        // Verifikasi ke quiz-she: sesi dengan topicCode === ID jadwal, lulus di salah satu
        const QUIZ_URL = 'https://quiz-she.vercel.app/api/data';
        let passed = null;
        try {
          const sesJ = await (await fetch(QUIZ_URL + '?action=sessions')).json();
          const sesIds = (Array.isArray(sesJ) ? sesJ : (sesJ.value || []))
            .filter(s => String(s.topicCode || '').trim() === schedId).map(s => s.id);
          for (const sid of sesIds) {
            const ex = await (await fetch(QUIZ_URL + '?action=existing&nik=' + encodeURIComponent(nik) + '&sessionId=' + encodeURIComponent(sid))).json();
            if (ex && ex.certificateNo) { passed = ex; break; }
          }
        } catch (e) {
          return res.status(502).json({ status: 'error', message: 'Tidak bisa verifikasi ke quiz-she: ' + e.message });
        }
        if (!passed) return res.status(200).json({ status: 'success', updated: false, reason: 'not_passed' });

        await sql`UPDATE safety_talk_absensi SET quiz_done = 'YA' WHERE schedule_id = ${schedId} AND nik = ${nik}`;
        return res.status(200).json({ status: 'success', updated: true, score: passed.score, certificateNo: passed.certificateNo });
      }

      // syncAllSafetyTalkQuiz (2026-09-16) — rekonsiliasi massal. Dipanggil saat
      // halaman Capaian SAP dibuka, untuk menutup kelulusan kuis yang terjadi
      // SEBELUM fitur auto-sync ada (atau bila notifikasi per-submit gagal).
      // Memindai baris yang statusnya wajib-kuis & QUIZ_DONE belum YA, cek ke
      // quiz-she, lalu tulis YA untuk yang sudah lulus. Idempoten & aman:
      // tidak butuh auth khusus karena hanya menandai kelulusan yang benar.
      if (action === 'syncAllSafetyTalkQuiz') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        const QUIZ_URL = 'https://quiz-she.vercel.app/api/data';
        const sql = getSql();
        const WAJIB = ['CUTI', 'DINAS_LUAR', 'SHIFT_MALAM', 'LIBUR', 'SECURITY_JAGA'];
        // Kandidat: wajib kuis & QUIZ_DONE belum YA
        const cand = await sql`
          SELECT schedule_id, nik FROM safety_talk_absensi
          WHERE status_kehadiran = ANY(${WAJIB}) AND COALESCE(upper(quiz_done), '') <> 'YA'`;
        if (!cand.length) return res.status(200).json({ status: 'success', updated: 0 });

        let sessBySched = {};
        try {
          const sesJ = await (await fetch(QUIZ_URL + '?action=sessions')).json();
          for (const s of (Array.isArray(sesJ) ? sesJ : (sesJ.value || []))) {
            const tc = String(s.topicCode || '').trim();
            if (!tc) continue;
            (sessBySched[tc] = sessBySched[tc] || []).push(s.id);
          }
        } catch (e) {
          return res.status(502).json({ status: 'error', message: 'quiz-she tak terjangkau: ' + e.message });
        }
        const toMark = [];
        const BATCH = 8;
        for (let i = 0; i < cand.length; i += BATCH) {
          await Promise.all(cand.slice(i, i + BATCH).map(async c => {
            const sids = sessBySched[String(c.schedule_id).trim()];
            if (!sids || !sids.length) return;
            for (const sid of sids) {
              try {
                const ex = await (await fetch(QUIZ_URL + '?action=existing&nik=' + encodeURIComponent(c.nik) + '&sessionId=' + encodeURIComponent(sid))).json();
                if (ex && ex.certificateNo) { toMark.push(c); break; }
              } catch { /* satu sesi gagal, lanjut */ }
            }
          }));
        }
        for (const c of toMark)
          await sql`UPDATE safety_talk_absensi SET quiz_done = 'YA' WHERE schedule_id = ${c.schedule_id} AND nik = ${c.nik}`;
        return res.status(200).json({ status: 'success', updated: toMark.length, checked: cand.length });
      }

      // Semua endpoint migrasi (sekali-pakai, sudah selesai) kini DIKUNCI token —
      // dulu publik untuk kebutuhan migrasi. Pakai BACKUP_TOKEN (header/query).
      if (typeof action === 'string' && action.startsWith('migrate_')) {
        const token = process.env.BACKUP_TOKEN;
        const provided = req.headers['x-backup-token'] || req.query.token;
        if (!token || provided !== token) return res.status(403).json({ status: 'error', message: 'Forbidden' });
      }

      // Migrasi sekali-pakai PC_Report (Sheets → Neon). Empty-guard: hanya jalan
      // bila tabel pc_report kosong. Baca sheet via service account runtime.
      if (action === 'migrate_pc') {
        const sql = getSql();
        const cur = await sql`SELECT count(*)::int AS n FROM pc_report`;
        if (cur[0].n > 0) return res.status(200).json({ status: 'success', already: true, count: cur[0].n });
        let rows = []; try { rows = await getSheetData(sheets, 'PC_Report'); } catch {}
        const g = (r, k) => { const v = r[k]; return (v === undefined || v === null) ? '' : String(v); };
        let ok = 0;
        for (const r of rows) {
          const id = g(r, 'ID').trim(); if (!id) continue;
          await sql`
            INSERT INTO pc_report
              ("timestamp", id, tgl_pc, lokasi_pc, nama_coach, nik_coach, jabatan_coach, departemen_coach, perusahaan_coach,
               nama_coachee, nik_coachee, jabatan_coachee, departemen_coachee, perusahaan_coachee, subcont_coachee, no_wa_coachee,
               topik_coaching, judul_coaching, deskripsi_coaching, komitmen_perbaikan, batas_waktu_pc, foto_pc, status,
               foto_komitmen, pesan_komitmen, timestamp_close, wa_pic_status)
            VALUES
              (${g(r,'TIMESTAMP')}, ${id}, ${g(r,'TGL_PC')}, ${g(r,'LOKASI_PC')}, ${g(r,'NAMA_COACH')}, ${g(r,'NIK_COACH')},
               ${g(r,'JABATAN_COACH')}, ${g(r,'DEPARTEMEN_COACH')}, ${g(r,'PERUSAHAAN_COACH')}, ${g(r,'NAMA_COACHEE')},
               ${g(r,'NIK_COACHEE')}, ${g(r,'JABATAN_COACHEE')}, ${g(r,'DEPARTEMEN_COACHEE')}, ${g(r,'PERUSAHAAN_COACHEE')},
               ${g(r,'SUBCONT_COACHEE')}, ${g(r,'NO_WA_COACHEE')}, ${g(r,'TOPIK_COACHING')}, ${g(r,'JUDUL_COACHING')},
               ${g(r,'DESKRIPSI_COACHING')}, ${g(r,'KOMITMEN_PERBAIKAN')}, ${g(r,'BATAS_WAKTU_PC')}, ${g(r,'FOTO_PC')},
               ${g(r,'STATUS') || 'OPEN'}, ${g(r,'FOTO_KOMITMEN')}, ${g(r,'PESAN_KOMITMEN')}, ${g(r,'TIMESTAMP_CLOSE')}, ${g(r,'WA_PIC_STATUS')})
            ON CONFLICT (id) DO NOTHING`;
          ok++;
        }
        const after = await sql`SELECT count(*)::int AS n FROM pc_report`;
        return res.status(200).json({ status: 'success', migrated: ok, total: after[0].n });
      }

      // Migrasi sekali-pakai SBO_Report (Sheets → Neon). Empty-guard.
      if (action === 'migrate_sbo') {
        const sql = getSql();
        const cur = await sql`SELECT count(*)::int AS n FROM sbo_report`;
        if (cur[0].n > 0) return res.status(200).json({ status: 'success', already: true, count: cur[0].n });
        let rows = []; try { rows = await getSheetData(sheets, 'SBO_Report'); } catch {}
        const g = (r, k) => { const v = r[k]; return (v === undefined || v === null) ? '' : String(v); };
        let ok = 0;
        for (const r of rows) {
          const id = g(r, 'ID').trim(); if (!id) continue;
          await sql`
            INSERT INTO sbo_report
              ("timestamp", id, tgl_observasi, nama_pekerjaan, lokasi, nama_observer, nik_observer, jabatan_observer,
               departemen_observer, perusahaan_observer, nama_observee, perusahaan_observee, subcont_observee, jabatan_observee,
               departemen_observee, tindakan_segera, potensi_bahaya, apd, alat_peralatan, prosedur, kebersihan, status_observasi,
               jenis_temuan, kategori_temuan, deskripsi_temuan, foto_temuan, rencana_tindakan, referensi_sop,
               nama_pic, nik_pic, perusahaan_pic, subcont_pic, departemen_pic, jabatan_pic, no_wa_pic, batas_waktu,
               upload_foto_perbaikan_pic, status_perbaikan, pernyataan, wa_pic_status, catatan_closing, tanggal_closing)
            VALUES
              (${g(r,'TIMESTAMP')}, ${id}, ${g(r,'TGL_OBSERVASI')}, ${g(r,'NAMA_PEKERJAAN')}, ${g(r,'LOKASI')},
               ${g(r,'NAMA_OBSERVER')}, ${g(r,'NIK_OBSERVER')}, ${g(r,'JABATAN_OBSERVER')}, ${g(r,'DEPARTEMEN_OBSERVER')},
               ${g(r,'PERUSAHAAN_OBSERVER')}, ${g(r,'NAMA_OBSERVEE')}, ${g(r,'PERUSAHAAN_OBSERVEE')}, ${g(r,'SUBCONT_OBSERVEE')},
               ${g(r,'JABATAN_OBSERVEE')}, ${g(r,'DEPARTEMEN_OBSERVEE')}, ${g(r,'TINDAKAN_SEGERA')}, ${g(r,'POTENSI_BAHAYA')},
               ${g(r,'APD')}, ${g(r,'ALAT_PERALATAN')}, ${g(r,'PROSEDUR')}, ${g(r,'KEBERSIHAN')}, ${g(r,'STATUS_OBSERVASI')},
               ${g(r,'JENIS_TEMUAN')}, ${g(r,'KATEGORI_TEMUAN')}, ${g(r,'DESKRIPSI_TEMUAN')}, ${g(r,'FOTO_TEMUAN')},
               ${g(r,'RENCANA_TINDAKAN')}, ${g(r,'REFERENSI_SOP')}, ${g(r,'NAMA_PIC')}, ${g(r,'NIK_PIC')}, ${g(r,'PERUSAHAAN_PIC')},
               ${g(r,'SUBCONT_PIC')}, ${g(r,'DEPARTEMEN_PIC')}, ${g(r,'JABATAN_PIC')}, ${g(r,'NO_WA_PIC')}, ${g(r,'BATAS_WAKTU')},
               ${g(r,'UPLOAD_FOTO_PERBAIKAN_PIC')}, ${g(r,'STATUS_PERBAIKAN')}, ${g(r,'PERNYATAAN')}, ${g(r,'WA_PIC_STATUS')},
               ${g(r,'CATATAN_CLOSING')}, ${g(r,'TANGGAL_CLOSING')})
            ON CONFLICT (id) DO NOTHING`;
          ok++;
        }
        const after = await sql`SELECT count(*)::int AS n FROM sbo_report`;
        return res.status(200).json({ status: 'success', migrated: ok, total: after[0].n });
      }

      // Migrasi sekali-pakai Safety Talk (schedule + absensi). Empty-guard per tabel.
      if (action === 'migrate_safety_talk') {
        const sql = getSql();
        const g = (r, k) => { const v = r[k]; return (v === undefined || v === null) ? '' : String(v); };
        let sMig = 0, aMig = 0;
        if ((await sql`SELECT count(*)::int n FROM safety_talk_schedule`)[0].n === 0) {
          let rows = []; try { rows = await getSheetData(sheets, 'SafetyTalk_Schedule'); } catch {}
          for (const r of rows) {
            const id = g(r, 'ID').trim(); if (!id) continue;
            await sql`
              INSERT INTO safety_talk_schedule
                (id, "timestamp", tanggal, bulan, judul_materi, deskripsi_materi, nama_pemateri, nik_pemateri,
                 jabatan_pemateri, perusahaan_target, status, created_by)
              VALUES (${id}, ${g(r,'TIMESTAMP')}, ${g(r,'TANGGAL')}, ${g(r,'BULAN')}, ${g(r,'JUDUL_MATERI')},
                      ${g(r,'DESKRIPSI_MATERI')}, ${g(r,'NAMA_PEMATERI')}, ${g(r,'NIK_PEMATERI')}, ${g(r,'JABATAN_PEMATERI')},
                      ${g(r,'PERUSAHAAN_TARGET')}, ${g(r,'STATUS') || 'AKTIF'}, ${g(r,'CREATED_BY')})
              ON CONFLICT (id) DO NOTHING`;
            sMig++;
          }
        }
        if ((await sql`SELECT count(*)::int n FROM safety_talk_absensi`)[0].n === 0) {
          let rows = []; try { rows = await getSheetData(sheets, 'SafetyTalk_Absensi'); } catch {}
          for (const r of rows) {
            const sid = g(r, 'SCHEDULE_ID').trim(), nik = g(r, 'NIK').trim();
            if (!sid || !nik) continue;
            await sql`
              INSERT INTO safety_talk_absensi
                (schedule_id, nik, bulan, nama, perusahaan, departemen, jabatan, status_kehadiran, quiz_done, checked_by, checked_at)
              VALUES (${sid}, ${nik}, ${g(r,'BULAN')}, ${g(r,'NAMA')}, ${g(r,'PERUSAHAAN')}, ${g(r,'DEPARTEMEN')},
                      ${g(r,'JABATAN')}, ${g(r,'STATUS_KEHADIRAN') || 'HADIR'}, ${g(r,'QUIZ_DONE')}, ${g(r,'CHECKED_BY')}, ${g(r,'CHECKED_AT')})
              ON CONFLICT (schedule_id, nik) DO NOTHING`;
            aMig++;
          }
        }
        const cnt = await sql`SELECT (SELECT count(*)::int FROM safety_talk_schedule) AS sched, (SELECT count(*)::int FROM safety_talk_absensi) AS abs`;
        return res.status(200).json({ status: 'success', schedule_migrated: sMig, absensi_migrated: aMig, schedule_total: cnt[0].sched, absensi_total: cnt[0].abs });
      }

      // Migrasi sekali-pakai Hazard_Report → hazard_report (JSONB). Empty-guard.
      if (action === 'migrate_hazard') {
        const sql = getSql();
        // Bulk insert satu round-trip (jsonb_to_recordset) — hindari timeout.
        let rows = []; try { rows = await getSheetData(sheets, 'Hazard_Report'); } catch {}
        const recs = [];
        for (const r of rows) {
          const d = {}; Object.keys(r).forEach(k => { d[normalizeHeader(k)] = r[k]; });
          const id = String(d.id || '').trim(); if (!id) continue;
          recs.push({ id, nik: d.nik || '', perusahaan: d.perusahaan || '', status_perbaikan: d.status_perbaikan || '', data: d });
        }
        if (recs.length) await sql`
          INSERT INTO hazard_report (id, nik, perusahaan, status_perbaikan, data)
          SELECT id, nik, perusahaan, status_perbaikan, data
          FROM jsonb_to_recordset(${JSON.stringify(recs)}::jsonb)
               AS t(id text, nik text, perusahaan text, status_perbaikan text, data jsonb)
          ON CONFLICT (id) DO NOTHING`;
        const n = (await sql`SELECT count(*)::int n FROM hazard_report`)[0].n;
        return res.status(200).json({ status: 'success', migrated: recs.length, total: n });
      }

      // Migrasi sekali-pakai 8 sheet INS_* → inspection_report (JSONB). Empty-guard.
      if (action === 'migrate_inspection') {
        const sql = getSql();
        let ok = 0, perSheet = {};
        for (const sheetName of INSPECTION_SHEETS) {
          let rows = []; try { rows = await getSheetData(sheets, sheetName); } catch {}
          let c = 0;
          for (const r of rows) {
            const d = {}; Object.keys(r).forEach(k => { d[normalizeHeader(k)] = r[k]; });
            const id = String(d.id || '').trim(); if (!id) continue;
            await sql`INSERT INTO inspection_report (id, jenis, nik, perusahaan, status_perbaikan, data)
              VALUES (${id}, ${sheetName}, ${d.nik || ''}, ${d.perusahaan || ''}, ${d.status_perbaikan || ''}, ${JSON.stringify(d)}::jsonb)
              ON CONFLICT (id) DO NOTHING`;
            ok++; c++;
          }
          perSheet[sheetName] = c;
        }
        const n = (await sql`SELECT count(*)::int n FROM inspection_report`)[0].n;
        return res.status(200).json({ status: 'success', migrated: ok, total: n, per_sheet: perSheet });
      }

      // Migrasi sekali-pakai Master_Karyawan → karyawan (JSONB). Empty-guard.
      // Publik (tanpa token) KARENA login bergantung roster: harus bisa mengisi
      // Postgres sebelum ada yang login. Hanya balikkan hitungan — tak bocorkan data.
      // Ping ringan untuk "menghangatkan" Neon (cegah cold-start). Publik, tanpa
      // token. Jalankan SELECT 1 supaya DB bangun dari scale-to-zero. Dipakai
      // penjadwal eksternal HANYA di jam kerja (jangan 24 jam — hemat compute).
      if (action === 'ping') {
        const t = Date.now();
        let db = 'skip';
        const sql = getSql();
        if (sql) { try { await sql`SELECT 1`; db = 'ok'; } catch { db = 'error'; } }
        return res.status(200).json({ status: 'success', db, ms: Date.now() - t });
      }

      // Backup seluruh DB (kedua app — 13 tabel) → JSON ke Google Drive (privat,
      // TIDAK dipublikkan). Dijaga BACKUP_TOKEN. Dipanggil cron GitHub Actions harian.
      if (action === 'backup') {
        const token = process.env.BACKUP_TOKEN;
        const provided = req.headers['x-backup-token'] || req.query.token;
        if (!token || provided !== token) return res.status(403).json({ status: 'error', message: 'Forbidden' });
        const sql = getSql();
        // Backup DINAMIS seluruh DB bersama: schema public (ONE-SAP + quiz-she),
        // sm (SISTER MINER), simantra (SIMANTRA). Enumerasi dari katalog → tabel
        // baru otomatis ikut. Identifier dari pg_tables (tepercaya) + dikutip.
        const qDyn = (strings, ...vals) =>
          sql(Object.assign([...strings], { raw: [...strings] }), ...vals);
        const tbls = await sql`
          SELECT schemaname, tablename FROM pg_tables
          WHERE schemaname IN ('public','sm','simantra') ORDER BY schemaname, tablename`;
        const schemas = {}; const counts = {};
        for (const { schemaname, tablename } of tbls) {
          const rows = await qDyn([`SELECT * FROM "${schemaname}"."${tablename}"`]);
          (schemas[schemaname] = schemas[schemaname] || {})[tablename] = rows;
          counts[`${schemaname}.${tablename}`] = rows.length;
        }
        const json = JSON.stringify({ generated_at: new Date().toISOString(), schemas });
        const fileName = `sap-backup-${new Date().toISOString().slice(0, 10)}.json`;
        const folder = process.env.FOLDER_BACKUP_ID || process.env.FOLDER_HAZARD_ID;
        const url = await saveTextToDrive(json, folder, fileName, 'application/json');
        return res.status(200).json({ status: 'success', file: fileName, bytes: Buffer.byteLength(json), url, counts });
      }

      if (action === 'migrate_karyawan') {
        const sql = getSql();
        const cur = (await sql`SELECT count(*)::int n FROM karyawan`)[0].n;
        if (cur > 0) return res.status(200).json({ status: 'success', already: true, count: cur });
        let rows = []; try { rows = await getSheetData(sheets, 'Master_Karyawan'); } catch {}
        const recs = [];
        for (const r of rows) {
          const nik = String(r['NIK'] || '').trim(); if (!nik) continue;
          recs.push({ nik, role: String(r['ROLE'] || ''), email: String(r['EMAIL'] || ''), data: r });
        }
        if (recs.length) await sql`
          INSERT INTO karyawan (nik, role, email, data)
          SELECT nik, role, email, data
          FROM jsonb_to_recordset(${JSON.stringify(recs)}::jsonb)
               AS t(nik text, role text, email text, data jsonb)
          ON CONFLICT (nik) DO NOTHING`;
        const n = (await sql`SELECT count(*)::int n FROM karyawan`)[0].n;
        return res.status(200).json({ status: 'success', migrated: recs.length, total: n });
      }

      // Backfill tanda tangan base64 → URL Drive. Bertahap (batch) supaya tak
      // timeout: panggil berulang sampai remaining = 0. Publik (hanya konversi,
      // tak balikkan data). ?limit=N (default 12, maks 30).
      if (action === 'migrate_signatures') {
        const sql = getSql();
        const LIMIT = Math.min(parseInt(req.query.limit || '12', 10) || 12, 30);
        const folder = process.env.FOLDER_HAZARD_ID;
        let migrated = 0;
        for (const tbl of ['hazard_report', 'inspection_report']) {
          if (migrated >= LIMIT) break;
          const rows = tbl === 'hazard_report'
            ? await sql`SELECT id, data FROM hazard_report WHERE data->>'tanda_tangan' LIKE 'data:%' LIMIT ${LIMIT - migrated}`
            : await sql`SELECT id, data FROM inspection_report WHERE data->>'tanda_tangan' LIKE 'data:%' LIMIT ${LIMIT - migrated}`;
          for (const r of rows) {
            try {
              const url = await saveBase64ImageToDrive(r.data.tanda_tangan, folder, r.id + '-TTD.png');
              if (!url) continue;
              const patch = JSON.stringify({ tanda_tangan: url });
              if (tbl === 'hazard_report') await sql`UPDATE hazard_report SET data = data || ${patch}::jsonb WHERE id = ${r.id}`;
              else await sql`UPDATE inspection_report SET data = data || ${patch}::jsonb WHERE id = ${r.id}`;
              migrated++;
            } catch { /* baris gagal dilewati, coba lagi di batch berikutnya */ }
          }
        }
        const remH = (await sql`SELECT count(*)::int n FROM hazard_report WHERE data->>'tanda_tangan' LIKE 'data:%'`)[0].n;
        const remI = (await sql`SELECT count(*)::int n FROM inspection_report WHERE data->>'tanda_tangan' LIKE 'data:%'`)[0].n;
        return res.status(200).json({ status: 'success', migrated, remaining: remH + remI });
      }

      // Semua action GET lainnya wajib token valid
      const auth = requireAuth(req);

      let result;
      switch (action) {
        case 'masterKaryawan': {
          const allRows = await annotateStatusKerja(sheets, await _karyawanRows(sheets));
          if (isSuperAdmin(auth.role)) {
            // SUPER_ADMIN: semua data lengkap
            result = stripSensitiveKaryawan(allRows);
          } else {
            const ownCo = String(auth.perusahaan || '').trim().toUpperCase();
            result = stripSensitiveKaryawan(allRows).map(r => {
              const isOwn = String(r['PERUSAHAAN'] || '').trim().toUpperCase() === ownCo;
              if (isOwn) {
                // Perusahaan sendiri: data lengkap, ROLE disembunyikan untuk non-admin
                if (!isAdminOrAbove(auth.role)) delete r['ROLE'];
                return r;
              }
              // Perusahaan lain: hanya field minimum untuk dropdown PIC (tanpa WA)
              return {
                PERUSAHAAN: r['PERUSAHAAN'] || '',
                SUBCONT:    r['SUBCONT']    || '',
                NAMA:       r['NAMA']       || '',
                NIK:        r['NIK']        || '',
                JABATAN:    r['JABATAN']    || '',
                STATUS_KERJA: r['STATUS_KERJA'] || 'aktif', // Cuti (2026-08-20) — dropdown PIC
              };
            });
          }
          break;
        }
        case 'masterLokasi': {
          // Lokasi + sub-lokasi + jenis area (Neon). Kunci pertama LOKASI — kompatibel form lama.
          const m = await masterDeteksiDini();
          result = m.lokasi.filter((l) => l.aktif).map((l) => ({ LOKASI: l.lokasi, SUB_LOKASI: l.sub, JENIS_AREA: l.jenis_area }));
          break;
        }
        case 'masterJenisInspeksi':  result = await getSheetData(sheets, 'Jenis_Inspeksi'); break;
        case 'inspectionChecklist': {
          const sheet = String(type || '').trim().toUpperCase();
          if (!INSPECTION_SHEETS.includes(sheet)) throw new Error('Jenis inspeksi tidak valid.');
          result = await getSheetData(sheets, sheet);
          break;
        }
        case 'masterTemuan': {
          if (type) {
            const sheet = String(type).trim().toUpperCase();
            if (!INSPECTION_SHEETS.includes(sheet)) throw new Error('Jenis inspeksi tidak valid.');
            result = await getSheetHeaders(sheets, sheet);
          } else {
            // Taksonomi v3 (Neon). Kunci lama (KETIDAKSESUAIAN / SUB KETIDAKSESUAIAN / RESIKO)
            // dipertahankan; RESIKO = tingkat default 5×5 sebelum penyesuaian lokasi.
            const m = await masterDeteksiDini();
            const prio = Object.fromEntries(m.kategori.map((k) => [k.kode, k.lokasi_prioritas]));
            result = m.temuan.filter((t) => t.aktif).map((t) => ({
              KODE: t.kode, KATEGORI_KODE: t.kategori_kode, 'KETIDAKSESUAIAN': t.kategori, 'SUB KETIDAKSESUAIAN': t.sub,
              TIPE: t.tipe, KEPARAHAN: t.keparahan, KEMUNGKINAN: t.kemungkinan, KRITIS: t.kritis,
              RESIKO: Taksonomi.hitung({ keparahan: t.keparahan, kemungkinan: t.kemungkinan }).tingkat,
              LOKASI_PRIORITAS: prio[t.kategori_kode] || [],
            }));
          }
          break;
        }
        case 'getMasterAdmin': {
          // Halaman Kelola Master (Super Admin): semua master (termasuk nonaktif) + antrean
          // laporan Hazard yang belum punya sub-lokasi (Lainnya baru & laporan lama).
          if (!isSuperAdmin(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          const m = await masterDeteksiDini({ segar: true });
          const antrean = await getSql()`SELECT id, data->>'tanggal_kejadian' AS tanggal, data->>'lokasi_bahaya' AS lokasi,
              data->>'sub_lokasi_lainnya' AS lainnya, data->>'detail_lokasi_bahaya' AS detail,
              left(data->>'deskripsi_bahaya', 140) AS deskripsi, data->>'kode_temuan' AS kode
            FROM hazard_report WHERE coalesce(data->>'lokasi_bahaya', '') <> '' AND coalesce(data->>'sub_lokasi_bahaya', '') = ''
            ORDER BY id DESC`;
          result = { status: 'success', ...m, antrean };
          break;
        }
        case 'deteksiDini': {
          // Dasbor Deteksi Dini — Admin: perusahaannya; Super Admin: semua + KPI & capaian berbobot.
          if (!isAdminOrAbove(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          if (req.query.segar === '1') _ddCache.clear();
          result = await dataDeteksiDini(auth);
          break;
        }
        case 'beranda': result = await dataBeranda(); break; // fokus minggu ini & cuaca (semua pengguna)
        case 'cuacaTanggal': {
          // Cuaca hari laporan (detail laporan).
          const sql = getSql(); await ensureDeteksiDiniTables(sql);
          const tgl = String(req.query.tanggal || '').slice(0, 10);
          const [c] = /^\d{4}-\d{2}-\d{2}$/.test(tgl) ? await sql`SELECT hujan_mm::float AS hujan_mm, jam_hujan::float AS jam_hujan,
              angin_maks::float AS angin_maks, suhu_maks::float AS suhu_maks, kode_cuaca FROM cuaca_harian WHERE tanggal = ${tgl}::date` : [];
          result = { status: 'success', data: c ? { ...c, ikon: IKON_CUACA(c.kode_cuaca, c.hujan_mm), kategori: kategoriCuaca(c.kode_cuaca, c.hujan_mm)[0] } : null };
          break;
        }
        case 'getInsiden': {
          // Register insiden SHE (tahap 3) — Super Admin. Kronologi dipotong agar ringan.
          if (!isSuperAdmin(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          const sql = getSql(); await ensureInsidenTable(sql);
          const rows = await sql`SELECT id, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, jam, shift, perusahaan, lokasi, sub_lokasi,
              klasifikasi, kode_penyebab, keparahan_aktual, potensi_keparahan, data->>'jenis' AS jenis,
              left(data->>'kronologi', 160) AS kronologi, sumber FROM insiden ORDER BY tanggal DESC, jam DESC NULLS LAST`;
          result = { status: 'success', data: rows };
          break;
        }
        case 'getHazardReports':    result = await getHazardReports(sheets, auth); break;
        case 'getInspectionReports':result = await getInspectionReports(sheets, auth); break;
        case 'getSBOReports':       result = await getSBOReports(sheets, auth, req.query.mine === '1'); break;
        case 'getSafetyTalkSchedules': {
          if (!isAdminOrAbove(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          let stRows = [];
          try { stRows = (await getSql()`SELECT * FROM safety_talk_schedule`).map(_stSchedOut); } catch {}
          if (!isSuperAdmin(auth.role)) {
            const co = String(auth.perusahaan || '').trim();
            stRows = stRows.filter(r => !r['PERUSAHAAN_TARGET'] || r['PERUSAHAAN_TARGET'] === co);
          }
          result = { status: 'success', data: stRows };
          break;
        }
        case 'getStScheduleCounts': {
          // Jumlah jadwal Safety Talk per bulan × perusahaan target — dasar OBJ ST
          // mulai Okt 2026 (lihat stObjForMonth di reports-utils.js). Agregat saja,
          // aman utk semua user (endpoint jadwal lengkap khusus admin).
          let rows = [];
          try {
            rows = await getSql()`
              SELECT left(coalesce(bulan, ''), 7) AS bulan,
                     coalesce(perusahaan_target, '') AS perusahaan_target,
                     count(*)::int AS n
              FROM safety_talk_schedule
              WHERE upper(coalesce(status, '')) NOT LIKE '%BATAL%'
              GROUP BY 1, 2`;
          } catch {}
          result = { status: 'success', data: rows };
          break;
        }
        case 'getCetakAbsensiSt': {
          // Cetak Daftar Hadir FRM-EBL-S-SHE-06 (2026-10-08): jadwal + peserta HADIR +
          // fasilitator + TTD tersimpan masing-masing (yang belum menyimpan TTD → kosong).
          if (!isAdminOrAbove(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          const sid = String(req.query.id || '').trim();
          const sql = getSql();
          const sch = (await sql`SELECT * FROM safety_talk_schedule WHERE id = ${sid}`)[0];
          if (!sch) throw Object.assign(new Error('Jadwal tidak ditemukan.'), { httpStatus: 404 });
          if (!isSuperAdmin(auth.role) && sch.perusahaan_target && sch.perusahaan_target !== String(auth.perusahaan || '').trim())
            throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          const peserta = await sql`
            SELECT nik, nama, jabatan, perusahaan FROM safety_talk_absensi
            WHERE schedule_id = ${sid} AND upper(status_kehadiran) = 'HADIR'
            ORDER BY perusahaan, nama`;
          const pem = sch.nik_pemateri ? await _rosterByNik(sch.nik_pemateri) : null;
          const niks = [...new Set([...peserta.map((p) => String(p.nik).trim()), String(sch.nik_pemateri || '').trim()].filter(Boolean))];
          const sigRows = niks.length ? await sql`SELECT nik, data FROM user_signature WHERE nik = ANY(${niks})` : [];
          const punyaBaris = new Set(sigRows.map((r) => r.nik));
          const ttdRows = sigRows.filter((r) => r.data);
          // Belum pernah punya TTD tersimpan → pakai TTD terakhir dari laporannya (lalu disimpan).
          const namaByNik = new Map([...peserta.map((p) => [String(p.nik).trim(), p.nama]), [String(sch.nik_pemateri || '').trim(), sch.nama_pemateri]]);
          const belum = niks.filter((n) => !punyaBaris.has(n));
          for (let i = 0; i < belum.length; i += 5) {
            const hasil = await Promise.all(belum.slice(i, i + 5).map(async (n) => ({ nik: n, data: await _seedSignatureDariLaporan(n, namaByNik.get(n)).catch(() => '') })));
            ttdRows.push(...hasil.filter((r) => r.data));
          }
          result = {
            status: 'success',
            data: {
              jadwal: _stSchedOut(sch),
              fasilitator: { nama: sch.nama_pemateri || '', nik: sch.nik_pemateri || '', jabatan: sch.jabatan_pemateri || pem?.JABATAN || '', perusahaan: pem?.PERUSAHAAN || '' },
              peserta,
              ttd: Object.fromEntries(ttdRows.map((r) => [r.nik, r.data])),
            },
          };
          break;
        }
        case 'getMySafetyTalkHistory': {
          // Riwayat ST milik user sendiri + judul/tanggal sesi (untuk beranda).
          const nik = String(auth.nik || '').trim();
          let rows = [];
          try {
            rows = await getSql()`
              SELECT a.schedule_id, a.status_kehadiran, a.quiz_done, a.bulan, s.tanggal, s.judul_materi
              FROM safety_talk_absensi a
              LEFT JOIN safety_talk_schedule s ON s.id = a.schedule_id
              WHERE a.nik = ${nik}
              ORDER BY coalesce(s.tanggal, a.bulan) DESC
              LIMIT 120`; // panel tampil 12; sisanya utk capaian ST per bulan
          } catch {}
          result = { status: 'success', data: rows };
          break;
        }
        case 'getCutiOnsite': {
          // Popup "sudah onsite?" pasca cuti: periode JadwalCuti (SISTER MINER) milik user
          // yang sudah berakhir ≤15 hari lalu & belum dikonfirmasi onsite. Tombol popup
          // membuka `tautan` (halaman konfirmasi bertoken SISTER MINER, sama dgn email).
          const nik = String(auth.nik || '').trim();
          const today = todayJakarta();
          let rows = [];
          try {
            rows = await getSql()`
              SELECT data->>'akhir' AS akhir, data->>'tautan' AS tautan
              FROM sm."JadwalCuti"
              WHERE nik = ${nik} AND coalesce(data->>'onsite', '') <> 'ya' AND coalesce(data->>'tautan', '') <> ''
                AND (data->>'akhir')::date < ${today}::date
                AND (data->>'akhir')::date >= ${today}::date - 15
              ORDER BY data->>'akhir' DESC LIMIT 1`;
          } catch {}
          result = { status: 'success', data: rows[0] || null };
          break;
        }
        case 'getRosterTanggal': {
          // Referensi absensi manual: kode roster + cuti (Jadwal Cuti SISTER MINER) per NIK
          // pada tanggal sesi. Fail-open: tabel/sumber belum ada → objek kosong.
          if (!isAdminOrAbove(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          const tgl = String(req.query.tanggal || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) throw new Error('tanggal wajib (YYYY-MM-DD).');
          const sql = getSql();
          const roster = {}, cuti = {};
          try { for (const r of await sql`SELECT nik, kode FROM roster_harian WHERE tanggal = ${tgl}::date`) roster[r.nik] = r.kode; } catch {}
          try {
            for (const r of await sql`SELECT nik, data->>'awal' AS awal, data->>'akhir' AS akhir FROM sm."JadwalCuti"
              WHERE (data->>'awal')::date <= ${tgl}::date AND (data->>'akhir')::date >= ${tgl}::date`) cuti[r.nik] = { awal: r.awal, akhir: r.akhir };
          } catch {}
          result = { status: 'success', data: { tanggal: tgl, roster, cuti } };
          break;
        }
        case 'getSafetyTalkAbsensi': {
          // Admin/Super Admin: semua (atau per schedule). USER: absensi
          // se-DEPARTEMEN-nya (perusahaan+departemen sama) supaya angka ST
          // departemennya nyata (dulu cuma NIK sendiri → agregat 0, 2026-09-28).
          // Capaian SAP tetap benar (client memfilter ke NIK sendiri). Fallback ke
          // NIK sendiri bila departemen kosong (hindari bocor lintas-departemen).
          const schedId = String(req.query.schedule_id || '').trim();
          const admin = isAdminOrAbove(auth.role);
          let abRows = [];
          try {
            const sql = getSql();
            let rows;
            if (admin) {
              rows = schedId
                ? await sql`SELECT * FROM safety_talk_absensi WHERE schedule_id = ${schedId}`
                : await sql`SELECT * FROM safety_talk_absensi`;
            } else {
              const nik  = String(auth.nik || '').trim();
              const co   = String(auth.perusahaan || '').trim();
              const dept = String(auth.departemen || '').trim();
              if (co && dept) {
                rows = await sql`
                  SELECT * FROM safety_talk_absensi
                  WHERE upper(trim(coalesce(departemen, ''))) = upper(${dept})
                    AND upper(trim(coalesce(perusahaan, ''))) = upper(${co})`;
              } else {
                rows = await sql`SELECT * FROM safety_talk_absensi WHERE nik = ${nik}`;
              }
            }
            abRows = rows.map(_stAbsOut);
          } catch {}
          result = { status: 'success', data: abRows };
          break;
        }
        case 'saveSBODraft': {
          const auth2 = requireAuth(req); await checkTokenValid(sheets, auth2);
          await saveSBODraftForUser(sheets, auth2.nik, JSON.stringify(data.draft || {}));
          result = { status: 'success' }; break;
        }
        case 'getSBODraft': {
          const auth2 = requireAuth(req); await checkTokenValid(sheets, auth2);
          result = await getSBODraftForUser(sheets, auth2.nik) || { draft: null }; break;
        }
        case 'clearSBODraft': {
          const auth2 = requireAuth(req); await checkTokenValid(sheets, auth2);
          await clearSBODraftForUser(sheets, auth2.nik);
          result = { status: 'success' }; break;
        }
        // Generic draft — digunakan oleh Hazard, Inspeksi, PC, SBO
        case 'saveDraft': {
          const auth2 = requireAuth(req); await checkTokenValid(sheets, auth2);
          const ftype = String(data.form_type || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
          if (!ftype) throw new Error('form_type wajib diisi.');
          await _upsertDraftRow(sheets, ftype + '_Drafts', auth2.nik, JSON.stringify(data.draft || {}));
          result = { status: 'success' }; break;
        }
        case 'getDraft': {
          const auth2 = requireAuth(req); await checkTokenValid(sheets, auth2);
          const ftype = String(req.query?.form_type || data.form_type || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
          result = ftype ? (await _fetchDraftRow(sheets, ftype + '_Drafts', auth2.nik) || { draft: null }) : { draft: null };
          break;
        }
        case 'clearDraft': {
          const auth2 = requireAuth(req); await checkTokenValid(sheets, auth2);
          const ftype = String(data.form_type || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
          if (ftype) await _deleteDraftRow(sheets, ftype + '_Drafts', auth2.nik);
          result = { status: 'success' }; break;
        }
        case 'getPCReports':        result = await getPCReports(sheets, auth, req.query.mine === '1'); break;
        // Identitas & role diambil dari token — parameter query diabaikan
        case 'getAllReports':        result = await getAllReports(sheets, auth.nik, auth.nama, auth.role, auth.perusahaan); break;
        case 'getMyActivityExtras':  result = await getMyActivityExtras(sheets, auth); break;
        case 'ensureDocFolders': {
          // Buat (kalau belum ada) subfolder HR/INS/SBO/PC di DOKUMENTASI LAPORAN
          // SAP (FOLDER_HAZARD_ID) & DOKUMENTASI CLOSING SAP (FOLDER_CLOSING_ID).
          // Super admin only. Sekalian balikin nama folder induk utk verifikasi.
          if (normalizeRole(auth.role) !== 'SUPER_ADMIN') { result = { status: 'error', message: 'Hanya super admin.' }; break; }
          const drive = getDriveClient();
          const parents = { LAPORAN: process.env.FOLDER_HAZARD_ID, CLOSING: process.env.FOLDER_CLOSING_ID };
          const out = {};
          for (const [label, pid] of Object.entries(parents)) {
            if (!pid) { out[label] = { error: 'env belum diset' }; continue; }
            let parentName = '(?)';
            try { parentName = (await drive.files.get({ fileId: pid, fields: 'name' })).data.name; } catch {}
            const subs = {};
            for (const t of ['HR', 'INS', 'SBO', 'PC']) subs[t] = await driveSubfolderId(pid, t);
            out[label] = { folder: parentName, sub: subs };
          }
          result = { status: 'success', data: out };
          break;
        }
        case 'getReport':            result = await getReportById(req.query.id, auth); break;
        case 'getKaryawan':         result = await getKaryawan(sheets, auth); break;
        case 'getPendingChanges':   result = await getPendingChanges(sheets, auth); break;
        case 'getPicDisputes':      result = await getPicDisputes(auth); break;
        case 'getMySignature':      result = await getMySignature(auth); break;
        case 'getMyObj': {
          // Query 1 baris langsung (bukan tarik seluruh roster) — beranda ringan.
          const _sqlMy = getSql();
          const _nik = String(auth.nik || '').trim();
          const me = _sqlMy
            ? (await _sqlMy`SELECT data FROM karyawan WHERE nik = ${_nik}`)[0]?.data
            : (await _karyawanRows(sheets)).find(r => String(r['NIK'] || '').trim() === _nik);
          result = {
            status: 'success',
            data: {
              hr:  parseInt(me?.['OBJ HR']  || 0) || 0,
              ins: parseInt(me?.['OBJ INS'] || 0) || 0,
              sbo: parseInt(me?.['OBJ SBO'] || 0) || 0,
              pc:  parseInt(me?.['OBJ PC']  || 0) || 0,
              st:  parseInt(me?.['OBJ_ST']  || me?.['OBJ ST'] || 0) || 0,
            }
          };
          break;
        }
        default: throw new Error('Action tidak dikenali: ' + action);
      }
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      // GAS-style clients send text/plain — parse body regardless of Content-Type
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const { action, data } = body || {};

      // Login: satu-satunya POST tanpa token — kredensial di body, bukan di URL
      if (action === 'login') {
        const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
        const result = await login(sheets, data?.nik, data?.password, ip);
        if (result.status === 'success') result.token = issueToken(result.user);
        return res.status(200).json(result);
      }

      // Email OTP — publik (kiosk quiz-she tidak login) + CORS. Aman: cuma menulis
      // EMAIL setelah kode benar; NIK harus ada di roster; dibatasi cooldown/attempt.
      if (action === 'requestEmailOtp' || action === 'verifyEmailOtp') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        const nik   = String(data?.nik || '').trim();
        const email = String(data?.email || '').trim();
        if (!nik) return res.status(400).json({ status: 'error', message: 'NIK wajib diisi.' });
        const kar = await _findKaryawanEmail(sheets, nik);
        if (!kar) return res.status(404).json({ status: 'error', message: 'NIK tidak terdaftar.' });

        // OTP disimpan di Postgres/Neon (tabel email_otp) — UPSERT atomik,
        // menggantikan pola "clear seluruh sheet lalu tulis ulang" yang rapuh.
        // Roster (tabel karyawan) juga sudah di Postgres.
        const sql = getSql();
        if (!sql) return res.status(503).json({ status: 'error', message: 'Database belum dikonfigurasi.' });

        if (action === 'requestEmailOtp') {
          if (!EMAIL_RE.test(email)) return res.status(400).json({ status: 'error', message: 'Format email tidak valid.' });
          if (await _emailTakenByOther(sheets, email, nik))
            return res.status(409).json({ status: 'error', message: 'Email sudah dipakai karyawan lain.' });
          // Cooldown 60 dtk per NIK
          const cd = await sql`SELECT 1 FROM email_otp WHERE nik = ${nik} AND created_at > now() - interval '60 seconds'`;
          if (cd.length) return res.status(429).json({ status: 'error', message: 'Tunggu sebentar sebelum kirim ulang kode.' });
          const code = String(Math.floor(100000 + Math.random() * 900000));
          await sql`
            INSERT INTO email_otp (nik, email, code_hash, expires_at, attempts, created_at)
            VALUES (${nik}, ${email}, ${bcrypt.hashSync(code, 8)}, now() + interval '10 minutes', 0, now())
            ON CONFLICT (nik) DO UPDATE SET
              email = EXCLUDED.email, code_hash = EXCLUDED.code_hash,
              expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`;
          try { await sendEmailOtp(email, code); }
          catch (e) { return res.status(e.httpStatus || 502).json({ status: 'error', message: e.message || 'Gagal mengirim email.' }); }
          return res.status(200).json({ status: 'success', message: 'Kode dikirim ke email.' });
        }

        // verifyEmailOtp
        const code = String(data?.code || '').trim();
        if (!code) return res.status(400).json({ status: 'error', message: 'Kode wajib diisi.' });
        const rowsOtp = await sql`SELECT email, code_hash, attempts, (expires_at < now()) AS expired FROM email_otp WHERE nik = ${nik}`;
        const row = rowsOtp[0];
        if (!row) return res.status(400).json({ status: 'error', message: 'Belum ada kode. Minta kode dulu.' });
        if (row.expired) return res.status(400).json({ status: 'error', message: 'Kode kedaluwarsa. Minta kode baru.' });
        if (Number(row.attempts || 0) >= EMAIL_OTP_MAX_ATTEMPTS) return res.status(429).json({ status: 'error', message: 'Terlalu banyak percobaan. Minta kode baru.' });
        if (!bcrypt.compareSync(code, String(row.code_hash || ''))) {
          await sql`UPDATE email_otp SET attempts = attempts + 1 WHERE nik = ${nik}`;
          return res.status(400).json({ status: 'error', message: 'Kode salah.' });
        }
        // Sukses → tulis email + timestamp ke roster (Sheets), hapus baris OTP
        const emailStored = String(row.email || '').trim();
        await _updateKaryawanCol(sheets, nik, 'EMAIL', emailStored);
        await _updateKaryawanCol(sheets, nik, 'EMAIL_VERIFIED_AT', new Date().toISOString());
        await sql`DELETE FROM email_otp WHERE nik = ${nik}`;
        return res.status(200).json({ status: 'success', message: 'Email terverifikasi.', email: emailStored });
      }

      // Lupa Password — publik. requestPasswordReset: kirim link "Ganti Password"
      // ke email karyawan bila terdaftar; kalau belum daftar email → arahkan ke
      // SHE PT EBL (jangan kirim). resetPassword: set password baru pakai token
      // (sekali pakai, disimpan sbg hash di roster JSONB, berlaku 30 menit).
      if (action === 'requestPasswordReset' || action === 'resetPassword') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        const sql = getSql();
        if (!sql) return res.status(503).json({ status: 'error', message: 'Database belum dikonfigurasi.' });
        const nik = String(data?.nik || '').trim();
        if (!nik) return res.status(400).json({ status: 'error', message: 'NIK wajib diisi.' });

        if (action === 'requestPasswordReset') {
          const kar = await _findKaryawanEmail(sheets, nik);
          if (!kar) return res.status(404).json({ status: 'error', message: 'NIK tidak terdaftar.' });
          if (!kar.email || !EMAIL_RE.test(kar.email)) {
            return res.status(200).json({ status: 'no_email', message: 'Kamu belum mendaftarkan email. Silakan hubungi SHE PT EBL untuk reset password.' });
          }
          if (!_getMailer()) return res.status(503).json({ status: 'error', message: 'Layanan email belum aktif. Hubungi SHE PT EBL.' });
          // Cooldown 60 dtk per NIK
          const cur = (await sql`SELECT data->>'PWRESET_AT' AS at FROM karyawan WHERE nik = ${nik}`)[0];
          if (cur?.at && Date.now() - Number(cur.at) < 60000)
            return res.status(429).json({ status: 'error', message: 'Tunggu sebentar sebelum minta ulang.' });
          const token = require('crypto').randomBytes(24).toString('hex');
          const patch = { PWRESET: bcrypt.hashSync(token, 8), PWRESET_EXP: String(Date.now() + 30 * 60 * 1000), PWRESET_AT: String(Date.now()) };
          await sql`UPDATE karyawan SET data = data || ${JSON.stringify(patch)}::jsonb WHERE nik = ${nik}`;
          invalidateCache('Master_Karyawan');
          const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'sap-ebl.vercel.app');
          const link = `${base}/reset-password.html?nik=${encodeURIComponent(nik)}&token=${token}`;
          try { await sendPasswordResetEmail(kar.email, kar.nama, link); }
          catch (e) { return res.status(e.httpStatus || 502).json({ status: 'error', message: e.message || 'Gagal mengirim email.' }); }
          const masked = kar.email.replace(/^(.).*(@.*)$/, (m, a, b) => a + '***' + b);
          return res.status(200).json({ status: 'success', message: `Link ganti password sudah dikirim ke ${masked}. Cek email (termasuk folder spam).` });
        }

        // resetPassword
        const token = String(data?.token || '').trim();
        const newPassword = String(data?.new_password || '');
        if (!token) return res.status(400).json({ status: 'error', message: 'Token tidak valid.' });
        if (!newPassword || newPassword.length < 8) return res.status(400).json({ status: 'error', message: 'Password baru minimal 8 karakter.' });
        if (isWeakPassword(newPassword)) return res.status(400).json({ status: 'error', message: 'Password terlalu umum. Gunakan kombinasi huruf, angka, atau simbol.' });
        const row = (await sql`SELECT data FROM karyawan WHERE nik = ${nik}`)[0];
        if (!row) return res.status(404).json({ status: 'error', message: 'NIK tidak terdaftar.' });
        const h = String(row.data['PWRESET'] || '');
        const exp = Number(row.data['PWRESET_EXP'] || 0);
        if (!h || !exp || Date.now() > exp) return res.status(400).json({ status: 'error', message: 'Link kadaluarsa atau tidak valid. Minta ulang.' });
        if (!bcrypt.compareSync(token, h)) return res.status(400).json({ status: 'error', message: 'Token tidak valid.' });
        const hash = bcrypt.hashSync(newPassword, 10);
        const patch = { PASSWORD: hash, PWRESET: null, PWRESET_EXP: null, PWRESET_AT: null };
        await sql`UPDATE karyawan SET data = data || ${JSON.stringify(patch)}::jsonb WHERE nik = ${nik}`;
        invalidateCache('Master_Karyawan');
        return res.status(200).json({ status: 'success', message: 'Password berhasil diubah. Silakan login.' });
      }

      // Semua action POST lainnya wajib token valid
      const authUser = requireAuth(req);
      // #2 — Cek LAST_LOGOUT_AT — token yang sudah di-logout tidak bisa dipakai lagi
      await checkTokenValid(sheets, authUser);

      let result;
      switch (action) {
        case 'logout':
          // Invalidasi token dengan catat waktu logout ke sheet
          await _updateKaryawanCol(sheets, authUser.nik, 'LAST_LOGOUT_AT', Date.now());
          result = { status: 'success', message: 'Logout berhasil.' };
          break;
        case 'changePassword':
          result = await changePassword(sheets, authUser.nik, data?.old_password, data?.new_password);
          break;
        case 'adminResetPassword':
          result = await adminResetPassword(sheets, authUser, data?.nik, data?.new_password);
          break;
        case 'proposeChange':
          result = await proposeChange(sheets, authUser, data?.action, data?.payload);
          break;
        case 'reviewChange':
          result = await reviewChange(sheets, authUser, data?.change_id, data?.decision, data?.reason);
          break;
        // Ingatkan PIC (2026-10-12): email + notifikasi PWA ke PIC (dulu WhatsApp & baca
        // Google Sheets lama). Dipakai tombol di detail laporan & halaman Eskalasi.
        case 'resendWaPic':
        case 'ingatkanPic': {
          if (!isAdminOrAbove(authUser.role)) throw Object.assign(new Error('Hanya admin yang bisa mengingatkan PIC.'), { httpStatus: 403 });
          const rid = String(data?.report_id || '').trim();
          const sheetTarget = rid.startsWith('INSP-') ? 'INSPECTION' : 'Hazard_Report';
          const rep = await _reportFind(sheetTarget, rid);
          if (!rep) throw new Error('Laporan tidak ditemukan.');
          const namaPic = rep.nama_pic || '';
          if (!namaPic && !rep.nik_pic) throw new Error('PIC belum ditentukan di laporan ini.');
          const batas = rep.batas_waktu ? new Date(rep.batas_waktu).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
          const url = `https://sap-ebl.vercel.app/laporan-detail.html?id=${encodeURIComponent(rid)}`;
          await _notifyPerson(sheets, { nik: rep.nik_pic, nama: namaPic, wa: rep.no_whatsapp_pic || rep.no_whattsapp_pic },
            `Pengingat PIC: laporan ${rid}`,
            `Halo ${namaPic}, kamu PIC untuk laporan ${rid}${batas ? ` (batas waktu ${batas})` : ''}. Mohon segera ditindaklanjuti.\n\nDikirim oleh ${authUser.nama || 'Admin ONE-SAP'}.`, url);
          await writeWaStatusToSheet(sheets, rep.report_type === 'INSPECTION' ? rep.inspection_sheet : 'Hazard_Report', rid, 'TERKIRIM');
          result = { status: 'success', wa_pic_status: 'TERKIRIM', message: `Pengingat dikirim ke ${namaPic || 'PIC'} (email & notifikasi).` };
          break;
        }
        case 'deleteSafetyTalkSchedule': {
          if (!isAdminOrAbove(authUser.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          if (!data.id) throw new Error('ID jadwal wajib diisi.');
          const delId = String(data.id).trim();
          const sql = getSql();
          await sql`DELETE FROM safety_talk_absensi WHERE schedule_id = ${delId}`;
          await sql`DELETE FROM safety_talk_schedule WHERE id = ${delId}`;
          result = { status: 'success', message: 'Jadwal berhasil dihapus.' };
          break;
        }
        case 'addObjStColumn': {
          // Roster kini JSONB (Postgres) — tak ada konsep "kolom" tetap; OBJ_ST
          // otomatis tersimpan saat user disimpan lewat Manajemen User. No-op.
          if (!isSuperAdmin(authUser.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          result = { status: 'success', message: 'OBJ_ST tersimpan otomatis (roster berbasis JSONB).' };
          break;
        }
        case 'createSafetyTalkSchedule': {
          if (!isAdminOrAbove(authUser.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          if (!data.tanggal?.trim()) throw new Error('Tanggal wajib diisi.');
          if (!data.judul_materi?.trim()) throw new Error('Judul materi wajib diisi.');
          const stId = 'ST-' + Date.now();
          await getSql()`
            INSERT INTO safety_talk_schedule
              (id, "timestamp", tanggal, bulan, judul_materi, deskripsi_materi, nama_pemateri, nik_pemateri,
               jabatan_pemateri, perusahaan_target, status, created_by, site, tempat, waktu, materi_tambahan)
            VALUES
              (${stId}, ${new Date().toISOString()}, ${data.tanggal}, ${data.tanggal.slice(0, 7)},
               ${data.judul_materi?.trim() || ''}, ${data.deskripsi_materi?.trim() || ''}, ${data.nama_pemateri?.trim() || ''},
               ${data.nik_pemateri?.trim() || ''}, ${data.jabatan_pemateri?.trim() || ''}, ${data.perusahaan_target?.trim() || ''},
               'AKTIF', ${authUser.nik || ''}, ${data.site?.trim() || ''}, ${data.tempat?.trim() || ''}, ${data.waktu?.trim() || ''}, ${data.materi_tambahan?.trim() || ''})`;
          result = { status: 'success', id: stId, message: 'Jadwal Safety Talk berhasil dibuat.' };
          break;
        }
        case 'updateSafetyTalkSchedule': {
          if (!isAdminOrAbove(authUser.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          if (!data.id) throw new Error('ID jadwal wajib diisi.');
          // Update kolom yang dikirim (satu tagged-template per kolom — aman & parameterized)
          const sql = getSql();
          const _id = data.id;
          if (data.status)             await sql`UPDATE safety_talk_schedule SET status = ${data.status} WHERE id = ${_id}`;
          if (data.judul_materi)       await sql`UPDATE safety_talk_schedule SET judul_materi = ${data.judul_materi} WHERE id = ${_id}`;
          if (data.deskripsi_materi !== undefined) await sql`UPDATE safety_talk_schedule SET deskripsi_materi = ${data.deskripsi_materi} WHERE id = ${_id}`;
          if (data.tanggal)            await sql`UPDATE safety_talk_schedule SET tanggal = ${data.tanggal}, bulan = ${data.tanggal.slice(0, 7)} WHERE id = ${_id}`;
          if (data.nama_pemateri    !== undefined) await sql`UPDATE safety_talk_schedule SET nama_pemateri = ${data.nama_pemateri} WHERE id = ${_id}`;
          if (data.nik_pemateri     !== undefined) await sql`UPDATE safety_talk_schedule SET nik_pemateri = ${data.nik_pemateri} WHERE id = ${_id}`;
          if (data.jabatan_pemateri !== undefined) await sql`UPDATE safety_talk_schedule SET jabatan_pemateri = ${data.jabatan_pemateri} WHERE id = ${_id}`;
          if (data.perusahaan_target !== undefined) await sql`UPDATE safety_talk_schedule SET perusahaan_target = ${data.perusahaan_target} WHERE id = ${_id}`;
          if (data.site   !== undefined) await sql`UPDATE safety_talk_schedule SET site = ${data.site} WHERE id = ${_id}`;
          if (data.tempat !== undefined) await sql`UPDATE safety_talk_schedule SET tempat = ${data.tempat} WHERE id = ${_id}`;
          if (data.waktu  !== undefined) await sql`UPDATE safety_talk_schedule SET waktu = ${data.waktu} WHERE id = ${_id}`;
          if (data.materi_tambahan !== undefined) await sql`UPDATE safety_talk_schedule SET materi_tambahan = ${data.materi_tambahan} WHERE id = ${_id}`;
          result = { status: 'success', message: 'Jadwal berhasil diperbarui.' };
          break;
        }
        case 'saveSafetyTalkAbsensi': {
          if (!isAdminOrAbove(authUser.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          // Support both legacy {niks_hadir} and new {absensi} format
          const { schedule_id, niks_hadir, absensi } = data || {};
          if (!schedule_id) throw new Error('schedule_id wajib diisi.');
          const sql = getSql();
          const sched = (await sql`SELECT bulan, tanggal FROM safety_talk_schedule WHERE id = ${schedule_id}`)[0];
          if (!sched) throw new Error('Jadwal tidak ditemukan.');
          const bulan = String(sched.bulan || (sched.tanggal || '').slice(0, 7) || '');
          const now = new Date().toISOString();
          const VALID_STATUS = new Set(['HADIR','CUTI','DINAS_LUAR','SHIFT_MALAM','LIBUR','SECURITY_JAGA','MANGKIR']);
          const inputList = Array.isArray(absensi)
            ? absensi
            : (Array.isArray(niks_hadir) ? niks_hadir.map(k => ({ ...k, status_kehadiran: 'HADIR', quiz_done: '' })) : []);
          const norm = inputList.map(k => {
            const status = VALID_STATUS.has(String(k.status_kehadiran || '').toUpperCase())
              ? String(k.status_kehadiran).toUpperCase() : 'HADIR';
            const quizDone = (status !== 'HADIR' && status !== 'MANGKIR') ? (k.quiz_done ? 'YA' : '') : '';
            return { nik: k.nik || '', nama: k.nama || '', perusahaan: k.perusahaan || '',
              departemen: k.departemen || '', jabatan: k.jabatan || '', status, quizDone };
          });
          // notif_kuis_at dipertahankan saat absensi ditulis ulang (supaya notifikasi tidak terkirim lagi)
          const notifLama = new Map((await sql`SELECT nik, notif_kuis_at FROM safety_talk_absensi WHERE schedule_id = ${schedule_id}`).map((r) => [r.nik, r.notif_kuis_at]));
          // Ganti absensi jadwal ini: hapus lalu insert (transaksi ringan via 2 statement)
          await sql`DELETE FROM safety_talk_absensi WHERE schedule_id = ${schedule_id}`;
          for (const k of norm) {
            await sql`
              INSERT INTO safety_talk_absensi
                (schedule_id, bulan, nik, nama, perusahaan, departemen, jabatan, status_kehadiran, quiz_done, checked_by, checked_at, notif_kuis_at)
              VALUES (${schedule_id}, ${bulan}, ${k.nik}, ${k.nama}, ${k.perusahaan}, ${k.departemen}, ${k.jabatan},
                      ${k.status}, ${k.quizDone}, ${authUser.nik || ''}, ${now}, ${notifLama.get(k.nik) || null})
              ON CONFLICT (schedule_id, nik) DO UPDATE SET
                bulan=EXCLUDED.bulan, nama=EXCLUDED.nama, perusahaan=EXCLUDED.perusahaan, departemen=EXCLUDED.departemen,
                jabatan=EXCLUDED.jabatan, status_kehadiran=EXCLUDED.status_kehadiran, quiz_done=EXCLUDED.quiz_done,
                checked_by=EXCLUDED.checked_by, checked_at=EXCLUDED.checked_at`;
          }
          const hadirCount   = norm.filter(r => r.status === 'HADIR').length;
          const quizCount    = norm.filter(r => r.quizDone === 'YA').length;
          const mangkirCount = norm.filter(r => r.status === 'MANGKIR').length;
          // Notifikasi PWA kuis pengganti (best-effort; yang kuisnya belum terbit/sedang cuti menyusul via cron)
          const notif = await kirimNotifKuisST(sheets, schedule_id).catch((e) => ({ status: 'error', reason: e.message }));
          result = { status: 'success', count: norm.length, notif_kuis: notif,
            message: `Hadir: ${hadirCount}, Quiz: ${quizCount}, Mangkir: ${mangkirCount}.` };
          break;
        }
        // ── Kelola master deteksi dini (Super Admin, 2026-10-14) ──
        case 'simpanMasterTemuan': {
          if (!isSuperAdmin(authUser.role)) throw Object.assign(new Error('Hanya SUPER ADMIN.'), { httpStatus: 403 });
          const d = data || {}, sql = getSql();
          const p = Number(d.keparahan), k = Number(d.kemungkinan);
          if (!String(d.sub || '').trim() || !(p >= 1 && p <= 5) || !(k >= 1 && k <= 5) || !['Kondisi', 'Tindakan'].includes(d.tipe))
            throw new Error('Isian belum lengkap: sub, tipe, keparahan & kemungkinan 1–5.');
          await masterDeteksiDini();
          if (d.kode) {
            await sql`UPDATE master_temuan SET sub = ${d.sub.trim()}, tipe = ${d.tipe}, keparahan = ${p}, kemungkinan = ${k},
              kritis = ${!!d.kritis}, aktif = ${d.aktif !== false}, updated_at = now() WHERE kode = ${d.kode}`;
          } else {
            const kk = String(d.kategori_kode || '');
            if (!(await sql`SELECT 1 FROM master_kategori WHERE kode = ${kk}`).length) throw new Error('Kategori tidak dikenal.');
            const [{ n }] = await sql`SELECT coalesce(max(substring(kode from 4)::int), 0) + 1 AS n FROM master_temuan WHERE kategori_kode = ${kk}`;
            d.kode = `${kk}-${String(n).padStart(2, '0')}`;
            await sql`INSERT INTO master_temuan (kode, kategori_kode, sub, tipe, keparahan, kemungkinan, kritis, urutan)
              VALUES (${d.kode}, ${kk}, ${d.sub.trim()}, ${d.tipe}, ${p}, ${k}, ${!!d.kritis}, (SELECT coalesce(max(urutan), 0) + 1 FROM master_temuan))`;
          }
          _masterDD = null;
          result = { status: 'success', message: `Tersimpan (${d.kode}).`, kode: d.kode };
          break;
        }
        case 'simpanMasterLokasi': {
          // Tambah/ubah sub-lokasi. Ganti nama sub → laporan yang memakai nama lama ikut diganti.
          if (!isSuperAdmin(authUser.role)) throw Object.assign(new Error('Hanya SUPER ADMIN.'), { httpStatus: 403 });
          const d = data || {}, sql = getSql();
          const lok = String(d.lokasi || '').trim(), sub = String(d.sub || '').trim(), lama = String(d.sub_lama || '').trim();
          if (!lok || !sub) throw new Error('Lokasi dan sub-lokasi wajib diisi.');
          await masterDeteksiDini();
          if (lama && lama !== sub) {
            await sql`UPDATE master_lokasi SET sub = ${sub} WHERE lokasi = ${lok} AND sub = ${lama}`;
            await sql`UPDATE hazard_report SET data = data || jsonb_build_object('sub_lokasi_bahaya', ${sub}::text)
              WHERE data->>'lokasi_bahaya' = ${lok} AND data->>'sub_lokasi_bahaya' = ${lama}`;
          }
          await sql`INSERT INTO master_lokasi (lokasi, sub, jenis_area, aktif, urutan)
            VALUES (${lok}, ${sub}, ${String(d.jenis_area || '')}, ${d.aktif !== false}, (SELECT coalesce(max(urutan), 0) + 1 FROM master_lokasi))
            ON CONFLICT (lokasi, sub) DO UPDATE SET jenis_area = EXCLUDED.jenis_area, aktif = EXCLUDED.aktif`;
          _masterDD = null;
          result = { status: 'success', message: `Sub-lokasi "${sub}" tersimpan.` };
          break;
        }
        case 'tetapkanSubLokasi': {
          // Antrean SHE: isi sub-lokasi laporan (gabung ke sub yang ada / jadikan sub baru).
          if (!isSuperAdmin(authUser.role)) throw Object.assign(new Error('Hanya SUPER ADMIN.'), { httpStatus: 403 });
          const d = data || {}, sql = getSql();
          const ids = (Array.isArray(d.ids) ? d.ids : []).map(String).filter(Boolean);
          const lok = String(d.lokasi || '').trim(), sub = String(d.sub || '').trim();
          if (!ids.length || !lok || !sub) throw new Error('Pilih laporan dan sub-lokasinya.');
          const m = await masterDeteksiDini({ segar: true });
          if (!m.lokasi.some((l) => l.lokasi === lok && l.sub === sub)) {
            if (!d.buat_baru) throw new Error('Sub-lokasi belum ada di master.');
            const area = (m.lokasi.find((l) => l.lokasi === lok) || {}).jenis_area || '';
            await sql`INSERT INTO master_lokasi (lokasi, sub, jenis_area, urutan)
              VALUES (${lok}, ${sub}, ${area}, (SELECT coalesce(max(urutan), 0) + 1 FROM master_lokasi)) ON CONFLICT DO NOTHING`;
            _masterDD = null;
          }
          // ponytail: risiko tidak dihitung ulang (jenis area per lokasi sama); hitung ulang bila aturan "berulang" perlu riwayat persis.
          const upd = await sql`UPDATE hazard_report SET data = data || jsonb_build_object('sub_lokasi_bahaya', ${sub}::text,
              'sub_lokasi_ditetapkan', ${`${authUser.nama || authUser.nik} ${new Date().toISOString()}`}::text)
            WHERE id = ANY(${ids}::text[]) AND data->>'lokasi_bahaya' = ${lok} RETURNING id`;
          result = { status: 'success', message: `${upd.length} laporan diberi sub-lokasi "${sub}".`, jumlah: upd.length };
          break;
        }
        case 'koreksiRisiko': {
          // SHE mengoreksi keparahan/kemungkinan hasil otomatis. Batas waktu tidak diubah.
          if (!isSuperAdmin(authUser.role)) throw Object.assign(new Error('Hanya SUPER ADMIN.'), { httpStatus: 403 });
          const d = data || {}, sql = getSql();
          const p = Number(d.keparahan), k = Number(d.kemungkinan);
          if (!(p >= 1 && p <= 5 && k >= 1 && k <= 5)) throw new Error('Keparahan & kemungkinan harus 1–5.');
          const [row] = await sql`SELECT data FROM hazard_report WHERE id = ${String(d.id || '')}`;
          if (!row) throw new Error('Laporan tidak ditemukan.');
          const skor = p * k, t = Taksonomi.tingkat(skor);
          const sebelum = { keparahan: row.data.keparahan, kemungkinan: row.data.kemungkinan, tingkat: row.data.tingkat_resiko };
          await sql`UPDATE hazard_report SET data = data || ${JSON.stringify({
            keparahan: p, kemungkinan: k, skor_risiko: skor, tingkat_resiko: t, kelas_temuan: p >= 4 ? 'Mayor' : 'Minor',
            koreksi_risiko: { oleh: authUser.nama || authUser.nik, at: new Date().toISOString(), sebelum, alasan: String(d.alasan || '').slice(0, 300) },
          })}::jsonb WHERE id = ${String(d.id)}`;
          result = { status: 'success', message: `Risiko dikoreksi: ${t} (${k} × ${p} = ${skor}).`, tingkat: t };
          break;
        }
        case 'tanggapiPeringatan': {
          // Umpan balik peringatan dini (bahan kalibrasi bobot).
          if (!isAdminOrAbove(authUser.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          const d = data || {};
          if (!['Ditindaklanjuti', 'Tidak relevan'].includes(d.tanggapan)) throw new Error('Tanggapan tidak valid.');
          await getSql()`UPDATE peringatan_dd SET tanggapan = ${d.tanggapan}, ditanggapi_oleh = ${authUser.nama || authUser.nik}, ditanggapi_at = now()
            WHERE id = ${Number(d.id) || 0}`;
          _ddCache.clear();
          result = { status: 'success', message: `Ditandai "${d.tanggapan}".` };
          break;
        }
        case 'imporInsiden': {
          // Unggah Excel register insiden (template SHE). Upsert per No. Register; baris bergalat dilewati.
          if (!isSuperAdmin(authUser.role)) throw Object.assign(new Error('Hanya SUPER ADMIN.'), { httpStatus: 403 });
          const d = data || {}, sql = getSql();
          const baris = Array.isArray(d.rows) ? d.rows.slice(0, 5000) : [];
          if (!baris.length) throw new Error('File tidak berisi baris insiden.');
          await ensureInsidenTable(sql);
          const m = await masterDeteksiDini();
          const ctx = { kodeAda: new Set(m.temuan.map((t) => t.kode)), lokasiAda: new Map() };
          for (const l of m.lokasi) ctx.lokasiAda.set(l.lokasi, [...(ctx.lokasiAda.get(l.lokasi) || []), l.sub]);
          const ok = [], gagal = [], peringatan = [], dilihat = new Set();
          baris.forEach((b, i) => {
            const { rec, galat, peringatan: pr } = LibInsiden.normalisasi(b, ctx);
            if (!rec) return;
            const no = i + 2; // baris Excel (judul di baris 1)
            if (rec.id && dilihat.has(rec.id)) galat.push(`No. Register ${rec.id} dipakai lebih dari sekali di file`);
            if (galat.length) return gagal.push({ baris: no, register: rec.id || '', galat });
            dilihat.add(rec.id);
            if (pr.length) peringatan.push({ baris: no, register: rec.id, peringatan: pr });
            ok.push(rec);
          });
          let baru = 0;
          if (ok.length) {
            const ada = new Set((await sql`SELECT id FROM insiden WHERE id = ANY(${ok.map((r) => r.id)}::text[])`).map((r) => r.id));
            baru = ok.filter((r) => !ada.has(r.id)).length;
            const sumber = `${String(d.nama_file || 'Excel').slice(0, 80)} · ${authUser.nama || authUser.nik} · ${new Date().toISOString()}`;
            await sql`INSERT INTO insiden (id, tanggal, jam, shift, perusahaan, departemen, lokasi, sub_lokasi, klasifikasi,
                kode_penyebab, keparahan_aktual, potensi_keparahan, data, sumber, updated_at)
              SELECT x.id, x.tanggal::date, x.jam, x.shift, x.perusahaan, x.departemen, x.lokasi, x.sub_lokasi, x.klasifikasi,
                x.kode_penyebab, x.keparahan_aktual, x.potensi_keparahan, x.r - ARRAY['id','tanggal','jam','shift','perusahaan',
                'departemen','lokasi','sub_lokasi','klasifikasi','kode_penyebab','keparahan_aktual','potensi_keparahan'], ${sumber}, now()
              FROM (SELECT e AS r, e->>'id' AS id, e->>'tanggal' AS tanggal, e->>'jam' AS jam, e->>'shift' AS shift,
                  e->>'perusahaan' AS perusahaan, e->>'departemen' AS departemen, e->>'lokasi' AS lokasi, e->>'sub_lokasi' AS sub_lokasi,
                  e->>'klasifikasi' AS klasifikasi, e->>'kode_penyebab' AS kode_penyebab, (e->>'keparahan_aktual')::int AS keparahan_aktual,
                  (e->>'potensi_keparahan')::int AS potensi_keparahan
                FROM jsonb_array_elements(${JSON.stringify(ok)}::jsonb) e) x
              ON CONFLICT (id) DO UPDATE SET tanggal = EXCLUDED.tanggal, jam = EXCLUDED.jam, shift = EXCLUDED.shift,
                perusahaan = EXCLUDED.perusahaan, departemen = EXCLUDED.departemen, lokasi = EXCLUDED.lokasi, sub_lokasi = EXCLUDED.sub_lokasi,
                klasifikasi = EXCLUDED.klasifikasi, kode_penyebab = EXCLUDED.kode_penyebab, keparahan_aktual = EXCLUDED.keparahan_aktual,
                potensi_keparahan = EXCLUDED.potensi_keparahan, data = EXCLUDED.data, sumber = EXCLUDED.sumber, updated_at = now()`;
          }
          result = { status: 'success', message: `${ok.length} insiden tersimpan (${baru} baru, ${ok.length - baru} diperbarui), ${gagal.length} baris dilewati.`,
            baru, diperbarui: ok.length - baru, gagal, peringatan };
          break;
        }
        case 'importRoster': {
          // Roster harian (CSV per bulan, lib/roster.js) → referensi keterangan kehadiran
          // di absensi manual Safety Talk. Upsert per (NIK, tanggal); sel kosong = hapus.
          if (!isSuperAdmin(authUser.role)) throw Object.assign(new Error('Hanya SUPER ADMIN yang bisa import roster.'), { httpStatus: 403 });
          const { rows, tanggal, errors } = parseRosterCsv((data || {}).csv);
          if (errors.length) { result = { status: 'error', message: 'File roster belum sesuai format.', errors }; break; }
          const sql = getSql();
          await ensureRosterTable(sql);
          const isi = rows.filter((r) => r.kode), kosong = rows.filter((r) => !r.kode);
          if (isi.length) await sql`
            INSERT INTO roster_harian (nik, tanggal, kode, updated_at)
            SELECT n, t::date, k, now() FROM unnest(${isi.map((r) => r.nik)}::text[], ${isi.map((r) => r.tanggal)}::text[], ${isi.map((r) => r.kode)}::text[]) AS x(n, t, k)
            ON CONFLICT (nik, tanggal) DO UPDATE SET kode = EXCLUDED.kode, updated_at = now()`;
          if (kosong.length) await sql`
            DELETE FROM roster_harian r USING unnest(${kosong.map((x) => x.nik)}::text[], ${kosong.map((x) => x.tanggal)}::text[]) AS x(n, t)
            WHERE r.nik = x.n AND r.tanggal = x.t::date`;
          const niks = new Set(rows.map((r) => r.nik)).size;
          const sorted = [...tanggal].sort();
          result = { status: 'success', message: `Roster tersimpan: ${niks} karyawan, ${sorted[0]} s/d ${sorted[sorted.length - 1]} (${isi.length} sel terisi).` };
          break;
        }
        case 'submitHazardReport':
          // Override identitas dari token — cegah spoofing
          data.nik  = authUser.nik;
          data.nama = authUser.nama;
          result = await submitHazardReport(sheets, data);
          break;
        case 'submitInspectionReport':
          data.nik  = authUser.nik;
          data.nama = authUser.nama;
          result = await submitInspectionReport(sheets, data);
          break;
        case 'submitPCReport':
          data.nik_coach        = authUser.nik;
          data.nama_coach       = authUser.nama;
          data.jabatan_coach    = authUser.jabatan;
          data.departemen_coach = authUser.departemen;
          data.perusahaan_coach = authUser.perusahaan;
          result = await submitPCReport(sheets, data);
          break;
        case 'updatePCReport':
          result = await updatePCReport(sheets, data, authUser);
          break;
        case 'submitSBOReport':
          data.nik_observer  = authUser.nik;
          data.nama_observer = authUser.nama;
          data.perusahaan_observer = authUser.perusahaan;
          data.jabatan_observer    = authUser.jabatan;
          data.departemen_observer = authUser.departemen;
          result = await submitSBOReport(sheets, data);
          break;
        case 'updateSBOReport': {
          const _sql = getSql();
          const sboRow = (await _sql`SELECT * FROM sbo_report WHERE id = ${String(data.id || '').trim()}`)[0];
          if (!sboRow) throw new Error('Laporan tidak ditemukan.');
          if (data.action_type === 'komitmen') {
            // Observee menyatakan komitmen → status KOMITMEN, notif WA ke PIC
            if (!data.pernyataan?.trim()) throw new Error('Pernyataan komitmen wajib diisi.');
            if (!isAdminOrAbove(authUser.role)) {
              const obsNik = String(sboRow.nik_observee || '').trim();
              const myNik  = String(authUser.nik || '').trim();
              if (obsNik && myNik && obsNik !== myNik)
                throw Object.assign(new Error('Akses ditolak: kamu bukan observee laporan ini.'), { httpStatus: 403 });
            }
            await _sql`UPDATE sbo_report SET pernyataan = ${data.pernyataan}, status_perbaikan = 'KOMITMEN' WHERE id = ${data.id}`;
            const noWaPic = String(sboRow.no_wa_pic || '').trim();
            const namaPic = String(sboRow.nama_pic || '').trim();
            if (noWaPic) {
              await sendWaNotification(noWaPic,
                `Halo ${namaPic || 'PIC'}, Observee telah menyatakan komitmen untuk laporan SBO *${data.id}*.\n\nSilakan lakukan tindak lanjut perbaikan:\n🔗 https://sap-ebl.vercel.app/sbo.html`
              ).catch(() => {});
            }
            result = { status: 'success', message: 'Komitmen observee berhasil disimpan.' };
          } else {
            // PIC melakukan tindak lanjut → langsung CLOSED
            assertReportRole(sboRow, authUser, 'pic'); // cek kepemilikan PIC
            let fotoUrl = '';
            if (data.upload_foto_perbaikan_pic) {
              const folder = await driveSubfolderId(process.env.FOLDER_CLOSING_ID || process.env.FOLDER_HAZARD_ID, 'SBO');
              fotoUrl = await saveMultipleImagesToDrive(data.upload_foto_perbaikan_pic, folder, data.id + '-SBO-Closing');
            }
            const st = data.status_perbaikan || 'CLOSED';
            await _sql`
              UPDATE sbo_report SET status_perbaikan = ${st},
                upload_foto_perbaikan_pic = COALESCE(NULLIF(${fotoUrl}, ''), upload_foto_perbaikan_pic),
                catatan_closing = ${data.catatan_closing || ''},
                tanggal_closing = ${st === 'CLOSED' ? new Date().toISOString() : (sboRow.tanggal_closing || '')}
              WHERE id = ${data.id}`;
            // Notif ke observer saat selesai
            if (st === 'CLOSED' && sboRow.nik_observer) {
              await sendPushToNik(sheets, String(sboRow.nik_observer).trim(), {
                title: 'Laporan Selesai ✅', body: `Laporan ${data.id} telah berhasil ditutup.`,
                url: 'https://sap-ebl.vercel.app/sbo.html',
              }).catch(() => {});
            } else if (sboRow.nik_observer) {
              await sendPushToNik(sheets, String(sboRow.nik_observer).trim(), {
                title: 'PIC SBO Telah Submit Perbaikan 📸', body: `PIC laporan SBO ${data.id} telah upload foto perbaikan.`,
                url: 'https://sap-ebl.vercel.app/sbo.html',
              }).catch(() => {});
            }
            result = { status: 'success', message: 'Laporan berhasil diperbarui.', id: data.id, foto_perbaikan_url: fotoUrl };
          }
          break;
        }
        case 'disputePic':          result = await disputePic(sheets, authUser, data); break;
        case 'ajukanPerpanjangan':  result = await ajukanPerpanjangan(sheets, authUser, data); break;
        case 'putuskanPerpanjangan': result = await putuskanPerpanjangan(sheets, authUser, data); break;
        case 'saveMySignature':     result = await saveMySignature(authUser, data); break;
        case 'hapusMySignature':    result = await hapusMySignature(authUser); break;
        case 'resolvePicDispute':   result = await resolvePicDispute(sheets, authUser, data); break;
        case 'updateHazardReport': {
          if (data.status_perbaikan === 'CLOSED') {
            await ensureClosingColumns(sheets, 'Hazard_Report');
            data.status_perbaikan = 'FOLLOWUP';
            data.closing_status   = 'pending_review';
          }
          result = await updateReport(sheets, data, 'Hazard_Report', '-Closing', authUser);
          break;
        }
        case 'updateInspectionReport': {
          const sheetName = String(data.inspection_sheet || '').trim().toUpperCase();
          if (!INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          if (data.status_perbaikan === 'CLOSED') {
            await ensureClosingColumns(sheets, sheetName);
            data.status_perbaikan = 'FOLLOWUP';
            data.closing_status   = 'pending_review';
          }
          result = await updateReport(sheets, data, sheetName, '-Inspection-Closing', authUser);
          break;
        }
        case 'submitActionPlan': {
          const sheetName = data.inspection_sheet ? String(data.inspection_sheet).trim().toUpperCase() : 'Hazard_Report';
          if (data.inspection_sheet && !INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          result = await submitActionPlan(sheets, data, sheetName, authUser);
          break;
        }
        case 'reviewActionPlan': {
          const sheetName = data.inspection_sheet ? String(data.inspection_sheet).trim().toUpperCase() : 'Hazard_Report';
          if (data.inspection_sheet && !INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          result = await reviewActionPlan(sheets, data, sheetName, authUser);
          break;
        }
        case 'reviewClosing': {
          const sheetName = data.inspection_sheet ? String(data.inspection_sheet).trim().toUpperCase() : 'Hazard_Report';
          if (data.inspection_sheet && !INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          result = await reviewClosing(sheets, data, sheetName, authUser);
          break;
        }
        // [PUSH-START]
        case 'push_subscribe':
          await savePushSubscription(sheets, authUser.nik, data.endpoint, data.p256dh, data.auth);
          result = { status: 'success', message: 'Push subscription saved.' };
          break;
        case 'push_unsubscribe': {
          // Verifikasi endpoint milik user yang sedang login
          const allSubs2 = await getSheetData(sheets, 'Push_Subscriptions').catch(() => []);
          const sub = allSubs2.find(r => String(r['ENDPOINT'] || '').trim() === String(data.endpoint || '').trim());
          if (sub && String(sub['NIK'] || '').trim() !== String(authUser.nik || '').trim())
            throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
          await removePushSubscriptionByEndpoint(sheets, data.endpoint);
          result = { status: 'success', message: 'Push subscription removed.' };
          break;
        }
        case 'push_test': {
          if (!ensureVapid()) {
            result = { status: 'error', message: 'VAPID keys belum dikonfigurasi di env vars (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_EMAIL).' };
            break;
          }
          let allSubs = [];
          try { allSubs = await getSheetData(sheets, 'Push_Subscriptions'); } catch (e) { result = { status: 'error', message: 'Sheet Push_Subscriptions tidak ditemukan: ' + e.message }; break; }
          const mySubs = allSubs.filter(r => String(r['NIK'] || '').trim() === String(authUser.nik).trim() && r['ENDPOINT']);
          if (!mySubs.length) { result = { status: 'error', message: `Tidak ada subscription tersimpan untuk NIK ${authUser.nik}. Klik tombol bell di sidebar dulu.` }; break; }
          let sent = 0, failed = 0;
          for (const sub of mySubs) {
            try {
              await webPush.sendNotification(
                { endpoint: sub['ENDPOINT'], keys: { p256dh: sub['P256DH'], auth: sub['AUTH'] } },
                JSON.stringify({ title: 'Test ONE-SAP ✅', body: 'Push notification berhasil! Sistem siap digunakan.', url: 'https://sap-ebl.vercel.app/index-home.html' })
              );
              sent++;
            } catch (e) { failed++; console.error('push_test send error:', e.message, e.statusCode); }
          }
          result = { status: sent > 0 ? 'success' : 'error', message: `${sent} push terkirim, ${failed} gagal dari ${mySubs.length} subscription.` };
          break;
        }
        // [PUSH-END]
        default: throw new Error('Action tidak dikenali: ' + action);
      }
      return res.status(200).json(result);
    }

    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  } catch (error) {
    return res.status(error.httpStatus || 500).json({ status: 'error', message: error.message });
  }
};
module.exports.cronKuisST = cronKuisST;
module.exports.cronAlurLaporan = cronAlurLaporan;
module.exports.cronDeteksiDini = cronDeteksiDini; // tahap 5: cuaca + peringatan dini (cron-deadline)
module.exports.simpanLaporanBulanan = simpanLaporanBulanan; // tahap 6 (cron; isi ulang manual)
module.exports._dataDeteksiDini = dataDeteksiDini;
module.exports._risikoHazard = _risikoHazard; // dipakai uji lokal (baca saja)
