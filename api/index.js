const { google } = require('googleapis');
const https = require('https');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const webPush = require('web-push');

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
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  _cachedClient = { sheets: google.sheets({ version: 'v4', auth }) };
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
  // migrasi). Cache 30s (dipanggil tiap request via assertNotCuti). Fallback ke
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

/** Lempar 401 kalau NIK ini sedang cuti — dipanggil di kedua choke point auth
 * (GET & POST) biar akses ke-cut total, bukan cuma di action tertentu. */
async function assertNotCuti(sheets, auth) {
  const status = await getStatusKerjaByNik(sheets, auth.nik, auth.nama);
  if (status === 'cuti')
    throw Object.assign(new Error('Sedang cuti — akses ONE-SAP ditangguhkan sampai tanggal masuk kembali.'), { httpStatus: 401 });
}

/** PIC yang dipilih tidak boleh sedang cuti/wajib_reinduksi. ponytail: kalau
 * nik_pic tidak terkirim dari form, skip (tidak cukup data buat verifikasi
 * aman) — celah ini sudah ada sebelumnya untuk field lain juga. */
async function assertPicEligible(sheets, nikPic, namaPic) {
  if (!nikPic) return;
  const status = await getStatusKerjaByNik(sheets, nikPic, namaPic);
  if (status === 'aktif') return;
  const reason = status === 'cuti' ? 'sedang cuti' : 'wajib menyelesaikan Reinduksi Pasca Cuti dulu';
  throw Object.assign(new Error(`PIC yang dipilih (${namaPic || nikPic}) ${reason}, tidak bisa ditunjuk sebagai PIC.`), { httpStatus: 400 });
}

function getDriveClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
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

  // Cuti (2026-08-20) — kalau status berubah jadi cuti SETELAH login (token
  // masih hidup 12 jam), tendang di request berikutnya, jangan tunggu expiry.
  await assertNotCuti(sheets, auth);
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

  // Cuti (2026-08-20) — kredensial benar, tapi sedang cuti = akses ditutup total.
  const statusKerjaLogin = await getStatusKerjaByNik(sheets, nik, String(user['NAMA'] || '').trim());
  if (statusKerjaLogin === 'cuti')
    return { status: 'error', code: 'CUTI_BLOCKED', message: 'Sedang cuti — akses ONE-SAP ditangguhkan sampai tanggal masuk kembali. Kelola cuti kamu lewat SIKAP.' };

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

async function sendWaNotification(target, message, _attempt = 0) {
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
    req.write(payload);
    req.end();
  });
  // #3 — 1x retry setelah 5 detik jika gagal
  if (!ok && _attempt === 0) {
    await new Promise(r => setTimeout(r, 5000));
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

  // Tanda tangan disimpan sebagai URL Drive (bukan base64) agar DB & daftar ramping.
  if (data.tanda_tangan && String(data.tanda_tangan).startsWith('data:'))
    data.tanda_tangan = await saveBase64ImageToDrive(data.tanda_tangan, process.env.FOLDER_HAZARD_ID, id + '-TTD.png').catch(() => data.tanda_tangan);

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
  await getSql()`
    INSERT INTO hazard_report (id, nik, perusahaan, status_perbaikan, data)
    VALUES (${id}, ${_hzData.nik || ''}, ${_hzData.perusahaan || ''}, ${_hzData.status_perbaikan || 'OPEN'}, ${JSON.stringify(_hzData)}::jsonb)`;

  let waStatus = 'TIDAK ADA WA';
  if (data.no_whatsapp_pic && data.nama_pic) {
    const msg = `Halo ${data.nama_pic}, kamu ditunjuk sebagai PIC untuk laporan hazard baru.\n\n` +
      `📋 *${id}*\n` +
      `📍 Lokasi: ${data.lokasi_bahaya}${data.detail_lokasi_bahaya ? ' - ' + data.detail_lokasi_bahaya : ''}\n` +
      `⚠️ Temuan: ${data.jenis_bahaya}\n` +
      `⏰ Batas waktu: ${data.batas_waktu || '-'}\n\n` +
      `🔗 Detail laporan: https://sap-ebl.vercel.app/laporan-detail.html?id=${id}`;
    const sent = await sendWaNotification(data.no_whatsapp_pic, msg).catch(() => false);
    waStatus = sent ? 'TERKIRIM' : 'GAGAL';
  }
  await writeWaStatusToSheet(sheets, 'Hazard_Report', id, waStatus);
  // [PUSH-START] — nik_pic tidak ada di form hazard, resolve via WA
  const picNikHazard = data.nik_pic || await resolveNikFromWa(sheets, data.no_whatsapp_pic).catch(() => '');
  if (picNikHazard) await sendPushToNik(sheets, picNikHazard, {
    title: 'Kamu Ditunjuk sebagai PIC 📋',
    body: `Laporan baru ${id} membutuhkan tindakan kamu. Batas: ${data.batas_waktu || '-'}`,
    url: `https://sap-ebl.vercel.app/laporan-detail.html?id=${id}`
  }).catch(() => {});
  // [PUSH-END]
  return { status: 'success', message: 'Hazard Report berhasil disimpan.', id, wa_pic_status: waStatus };
}

const INSPECTION_NAMES = {
  INS_CB: 'Inspeksi Conveyor Belt', INS_JA: 'Inspeksi Jalan Angkut',
  INS_MD: 'Inspeksi Mess dan Dapur', INS_KG: 'Inspeksi Kantor dan Gudang',
  INS_SP: 'Inspeksi Settling Pond', INS_T: 'Inspeksi Tambang',
  INS_TB: 'Inspeksi Tangki BBM', INS_WS: 'Inspeksi Workshop'
};

async function submitInspectionReport(sheets, data) {
  const sheetName = String(data.inspection_code || data.jenis_inspeksi || '').trim().toUpperCase();
  if (!INSPECTION_SHEETS.includes(sheetName)) throw new Error('Jenis inspeksi tidak valid: ' + sheetName);
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
  const rowData = { ...data, id, timestamp: new Date().toISOString(), upload_foto_inspeksi: fotoInspeksiUrl, status_perbaikan: 'OPEN' };
  const row = headers.map(h => mapInspectionValue(h, rowData));

  // Simpan sebagai data JSONB (key = header ter-normalisasi) di inspection_report.
  const _insData = {};
  headers.forEach((h, i) => { _insData[normalizeHeader(h)] = row[i] ?? ''; });
  await getSql()`
    INSERT INTO inspection_report (id, jenis, nik, perusahaan, status_perbaikan, data)
    VALUES (${id}, ${sheetName}, ${_insData.nik || ''}, ${_insData.perusahaan || ''}, ${_insData.status_perbaikan || 'OPEN'}, ${JSON.stringify(_insData)}::jsonb)`;

  let waStatus = 'TIDAK ADA WA';
  if (data.no_whatsapp_pic && data.nama_pic) {
    const namaInspeksi = INSPECTION_NAMES[sheetName] || sheetName;
    const msg = `Halo ${data.nama_pic}, kamu ditunjuk sebagai PIC untuk laporan inspeksi baru.\n\n` +
      `📋 *${id}*\n` +
      `🔍 Jenis: ${namaInspeksi}\n` +
      `📍 Lokasi: ${data.lokasi_inspeksi}${data.detail_lokasi_inspeksi ? ' - ' + data.detail_lokasi_inspeksi : ''}\n` +
      `⏰ Batas waktu: ${data.batas_waktu || '-'}\n\n` +
      `🔗 Detail laporan: https://sap-ebl.vercel.app/laporan-detail.html?id=${id}`;
    const sent = await sendWaNotification(data.no_whatsapp_pic, msg).catch(() => false);
    waStatus = sent ? 'TERKIRIM' : 'GAGAL';
  }
  await writeWaStatusToSheet(sheets, sheetName, id, waStatus);
  // [PUSH-START]
  if (data.nik_pic) await sendPushToNik(sheets, data.nik_pic, {
    title: 'Kamu Ditunjuk sebagai PIC 📋',
    body: `Laporan inspeksi baru ${id} membutuhkan tindakan kamu. Batas: ${data.batas_waktu || '-'}`,
    url: `https://sap-ebl.vercel.app/laporan-detail.html?id=${id}`
  }).catch(() => {});
  // [PUSH-END]
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
  const id = 'PC-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);

  let fotoUrl = '';
  if (data.foto_pc)
    fotoUrl = await saveMultipleImagesToDrive(data.foto_pc, await driveSubfolderId(process.env.FOLDER_HAZARD_ID, 'PC'), id + '-PC');

  await sql`
    INSERT INTO pc_report
      ("timestamp", id, tgl_pc, lokasi_pc, nama_coach, nik_coach, jabatan_coach, departemen_coach, perusahaan_coach,
       nama_coachee, nik_coachee, jabatan_coachee, departemen_coachee, perusahaan_coachee, subcont_coachee, no_wa_coachee,
       topik_coaching, judul_coaching, deskripsi_coaching, komitmen_perbaikan, batas_waktu_pc, foto_pc, status)
    VALUES
      (${new Date().toISOString()}, ${id}, ${data.tgl_pc || ''}, ${data.lokasi_pc || ''}, ${data.nama_coach || ''},
       ${data.nik_coach || ''}, ${data.jabatan_coach || ''}, ${data.departemen_coach || ''}, ${data.perusahaan_coach || ''},
       ${data.nama_coachee || ''}, ${data.nik_coachee || ''}, ${data.jabatan_coachee || ''}, ${data.departemen_coachee || ''},
       ${data.perusahaan_coachee || ''}, ${data.subcont_coachee || ''}, ${data.no_wa_coachee || ''},
       ${data.topik_coaching || ''}, ${data.judul_coaching || ''}, ${data.deskripsi_coaching || ''},
       ${data.komitmen_perbaikan || ''}, ${data.batas_waktu_pc || ''}, ${fotoUrl}, 'OPEN')`;

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

async function getPCReports(sheets, auth) {
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
  await sql`
    INSERT INTO sbo_report
      ("timestamp", id, tgl_observasi, nama_pekerjaan, lokasi, nama_observer, nik_observer, jabatan_observer,
       departemen_observer, perusahaan_observer, nama_observee, perusahaan_observee, subcont_observee, jabatan_observee,
       departemen_observee, tindakan_segera, potensi_bahaya, apd, alat_peralatan, prosedur, kebersihan, status_observasi,
       jenis_temuan, kategori_temuan, deskripsi_temuan, foto_temuan, rencana_tindakan, referensi_sop,
       nama_pic, nik_pic, perusahaan_pic, subcont_pic, departemen_pic, jabatan_pic, no_wa_pic, batas_waktu,
       upload_foto_perbaikan_pic, status_perbaikan, pernyataan, wa_pic_status)
    VALUES
      (${new Date().toISOString()}, ${id}, ${data.tgl_observasi || ''}, ${data.nama_pekerjaan || ''}, ${data.lokasi || ''},
       ${data.nama_observer || ''}, ${data.nik_observer || ''}, ${data.jabatan_observer || ''}, ${data.departemen_observer || ''},
       ${data.perusahaan_observer || ''}, ${data.nama_observee || ''}, ${data.perusahaan_observee || ''}, ${data.subcont_observee || ''},
       ${data.jabatan_observee || ''}, ${data.departemen_observee || ''}, ${data.tindakan_segera || ''}, ${data.potensi_bahaya || ''},
       ${data.apd || ''}, ${data.alat_peralatan || ''}, ${data.prosedur || ''}, ${data.kebersihan || ''}, ${data.status_observasi || 'AMAN'},
       ${F(data.jenis_temuan)}, ${F(data.kategori_temuan)}, ${F(data.deskripsi_temuan)}, ${fotoUrl}, ${F(data.rencana_tindakan)},
       ${F(data.referensi_sop)}, ${F(data.nama_pic)}, ${F(data.nik_pic)}, ${F(data.perusahaan_pic)}, ${F(data.subcont_pic)},
       ${F(data.departemen_pic)}, ${F(data.jabatan_pic)}, ${F(data.no_wa_pic)}, ${F(data.batas_waktu)},
       ${''}, ${hasFinding ? 'OPEN' : 'AMAN'}, ${data.pernyataan || ''}, ${''})`;

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

async function getSBOReports(sheets, auth) {
  const sql = getSql();
  let rows;
  try { rows = await sql`SELECT * FROM sbo_report`; } catch { return { status: 'success', data: [] }; }
  let data = rows.map(r => ({ ...r, report_type: 'SBO' })).filter(r => String(r.id || '').trim());
  if (!isSuperAdmin(auth?.role)) {
    const co = String(auth?.perusahaan || '').trim().toUpperCase();
    if (co) data = data.filter(r => String(r.perusahaan_observer || '').trim().toUpperCase() === co);
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
    if (picNik && picNik !== authNik)
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
  if (noWa) {
    const msg = `Halo ${nama}, PIC telah menyampaikan rencana tindakan untuk laporan *${data.id}*.\n\n` +
      `📋 Rencana: ${data.rencana_tindakan.trim()}\n📅 Tanggal rencana: ${data.tanggal_rencana || '-'}\n\n` +
      `Silakan berikan persetujuan:\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`;
    await sendWaNotification(noWa, msg).catch(() => {});
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
  if (noWaPic) {
    const msg = decision === 'approved'
      ? `Halo ${namaPic}, rencana tindakan untuk laporan *${data.id}* telah ✅ *DISETUJUI* oleh pelapor.\n\nSilakan lanjutkan perbaikan:\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`
      : `Halo ${namaPic}, rencana tindakan untuk laporan *${data.id}* ❌ *DITOLAK* oleh pelapor.\n\n💬 Komentar: ${data.comment}\n\nSilakan revisi rencana:\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`;
    await sendWaNotification(noWaPic, msg).catch(() => {});
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
  await _reportSet(sheetName, data.id, fields);

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
      if (noWa && !isSBO) {
        const msg = `Halo ${nama}, PIC laporan *${data.id}* telah menyelesaikan perbaikan dan meminta konfirmasimu.\n\nSilakan konfirmasi apakah perbaikan sudah sesuai:\n🔗 ${detailUrl}`;
        await sendWaNotification(noWa, msg).catch(() => {});
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
  if (noWaPic) {
    const msg = decision === 'confirmed'
      ? `Halo ${namaPic}, closing laporan *${data.id}* telah ✅ *DIKONFIRMASI* oleh pelapor. Laporan dinyatakan selesai.\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`
      : `Halo ${namaPic}, closing laporan *${data.id}* ❌ *DITOLAK* oleh pelapor.\n\n💬 Catatan: ${data.comment}\n\nSilakan revisi dan submit ulang:\n🔗 https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`;
    await sendWaNotification(noWaPic, msg).catch(() => {});
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
      await assertNotCuti(sheets, auth); // Cuti (2026-08-20)

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
        case 'masterLokasi':         result = await getSheetData(sheets, 'Master_Lokasi'); break;
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
            result = await getSheetData(sheets, 'Master_Temuan');
          }
          break;
        }
        case 'getHazardReports':    result = await getHazardReports(sheets, auth); break;
        case 'getInspectionReports':result = await getInspectionReports(sheets, auth); break;
        case 'getSBOReports':       result = await getSBOReports(sheets, auth); break;
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
        case 'getSafetyTalkAbsensi': {
          // Admin/Super Admin: semua (atau per schedule). USER: HANYA absensi
          // miliknya sendiri (dipakai Capaian SAP agar ST-nya terbaca) — tanpa
          // ini USER kena 403 & capaian ST-nya selalu kosong (fix 2026-09-22).
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
              const nik = String(auth.nik || '').trim();
              rows = await sql`SELECT * FROM safety_talk_absensi WHERE nik = ${nik}`;
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
        case 'getPCReports':        result = await getPCReports(sheets, auth); break;
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
        case 'resendWaPic': {
          if (!isAdminOrAbove(authUser.role)) throw Object.assign(new Error('Hanya admin yang bisa kirim ulang WA PIC.'), { httpStatus: 403 });
          const sheetTarget = data?.sheet_name || 'Hazard_Report';
          const reportRow = (await getSheetData(sheets, sheetTarget)).find(r => r['ID'] === data?.report_id || r['id'] === data?.report_id);
          if (!reportRow) throw new Error('Laporan tidak ditemukan.');
          const waTarget = reportRow['NO WHATSAPP PIC'] || reportRow['NO WHATTSAPP PIC'] || reportRow['no_whatsapp_pic'] || '';
          const namaPic  = reportRow['NAMA PIC'] || reportRow['nama_pic'] || '';
          if (!waTarget) throw new Error('Nomor WA PIC tidak ada di laporan ini.');
          const msg = `Halo ${namaPic}, pengingat: kamu adalah PIC untuk laporan *${data.report_id}*.\n\n🔗 Detail laporan: https://sap-ebl.vercel.app/laporan-detail.html?id=${data.report_id}`;
          const sent = await sendWaNotification(waTarget, msg).catch(() => false);
          const newStatus = sent ? 'TERKIRIM' : 'GAGAL';
          await writeWaStatusToSheet(sheets, sheetTarget, data.report_id, newStatus);
          result = { status: 'success', wa_pic_status: newStatus, message: sent ? 'WA berhasil dikirim ulang.' : 'Gagal mengirim WA.' };
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
               jabatan_pemateri, perusahaan_target, status, created_by)
            VALUES
              (${stId}, ${new Date().toISOString()}, ${data.tanggal}, ${data.tanggal.slice(0, 7)},
               ${data.judul_materi?.trim() || ''}, ${data.deskripsi_materi?.trim() || ''}, ${data.nama_pemateri?.trim() || ''},
               ${data.nik_pemateri?.trim() || ''}, ${data.jabatan_pemateri?.trim() || ''}, ${data.perusahaan_target?.trim() || ''},
               'AKTIF', ${authUser.nik || ''})`;
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
          // Ganti absensi jadwal ini: hapus lalu insert (transaksi ringan via 2 statement)
          await sql`DELETE FROM safety_talk_absensi WHERE schedule_id = ${schedule_id}`;
          for (const k of norm) {
            await sql`
              INSERT INTO safety_talk_absensi
                (schedule_id, bulan, nik, nama, perusahaan, departemen, jabatan, status_kehadiran, quiz_done, checked_by, checked_at)
              VALUES (${schedule_id}, ${bulan}, ${k.nik}, ${k.nama}, ${k.perusahaan}, ${k.departemen}, ${k.jabatan},
                      ${k.status}, ${k.quizDone}, ${authUser.nik || ''}, ${now})
              ON CONFLICT (schedule_id, nik) DO UPDATE SET
                bulan=EXCLUDED.bulan, nama=EXCLUDED.nama, perusahaan=EXCLUDED.perusahaan, departemen=EXCLUDED.departemen,
                jabatan=EXCLUDED.jabatan, status_kehadiran=EXCLUDED.status_kehadiran, quiz_done=EXCLUDED.quiz_done,
                checked_by=EXCLUDED.checked_by, checked_at=EXCLUDED.checked_at`;
          }
          const hadirCount   = norm.filter(r => r.status === 'HADIR').length;
          const quizCount    = norm.filter(r => r.quizDone === 'YA').length;
          const mangkirCount = norm.filter(r => r.status === 'MANGKIR').length;
          result = { status: 'success', count: norm.length,
            message: `Hadir: ${hadirCount}, Quiz: ${quizCount}, Mangkir: ${mangkirCount}.` };
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
