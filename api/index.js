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

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '12h';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ===== RATE LIMITING =====
// In-memory per instance — efektif untuk throttle brute-force pada satu instance
const _loginAttempts = new Map(); // nik → { count, firstAt, lockedUntil }
const RATE_WINDOW_MS  = 15 * 60 * 1000; // 15 menit
const MAX_ATTEMPTS    = 5;
const LOCKOUT_MS      = 15 * 60 * 1000;

function checkLoginRateLimit(nik) {
  const key = String(nik || '').trim().toLowerCase();
  const now = Date.now();
  const e = _loginAttempts.get(key);
  if (!e) return { ok: true };
  if (e.lockedUntil && now < e.lockedUntil) {
    const mnt = Math.ceil((e.lockedUntil - now) / 60000);
    return { ok: false, message: `Terlalu banyak percobaan. Coba lagi dalam ${mnt} menit.` };
  }
  if (now - e.firstAt > RATE_WINDOW_MS) { _loginAttempts.delete(key); return { ok: true }; }
  return { ok: true };
}

function recordFailedLogin(nik) {
  const key = String(nik || '').trim().toLowerCase();
  const now = Date.now();
  const e = _loginAttempts.get(key) || { count: 0, firstAt: now };
  if (now - e.firstAt > RATE_WINDOW_MS) { _loginAttempts.set(key, { count: 1, firstAt: now }); return; }
  e.count++;
  if (e.count >= MAX_ATTEMPTS) e.lockedUntil = now + LOCKOUT_MS;
  _loginAttempts.set(key, e);
}

function clearFailedLogins(nik) {
  _loginAttempts.delete(String(nik || '').trim().toLowerCase());
}

// Password lemah yang wajib diganti
const WEAK_PASSWORDS = new Set(['12345','123456','1234567','12345678','123456789','1234567890',
  'password','password1','qwerty','qwerty123','abc123','111111','000000','admin','admin123']);

function isWeakPassword(pw) {
  return WEAK_PASSWORDS.has(String(pw || '').trim().toLowerCase());
}
const INSPECTION_SHEETS = ['INS_CB', 'INS_JA', 'INS_MD', 'INS_KG', 'INS_SP', 'INS_T', 'INS_TB', 'INS_WS'];

function getClients() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return { sheets: google.sheets({ version: 'v4', auth }) };
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

async function saveMultipleImagesToDrive(base64DataField, folderId, idPrefix) {
  if (!base64DataField) return '';
  let list;
  try {
    const trimmed = String(base64DataField).trim();
    list = trimmed.startsWith('[') ? JSON.parse(trimmed) : [base64DataField];
  } catch { list = [base64DataField]; }
  const urls = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i]) {
      const url = await saveBase64ImageToDrive(list[i], folderId, `${idPrefix}-${i + 1}.jpg`);
      if (url) urls.push(url);
    }
  }
  return urls.join(', ');
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
    return jwt.verify(token, JWT_SECRET); // { nik, nama, role, ... }
  } catch {
    throw Object.assign(new Error('Sesi berakhir. Silakan login ulang.'), { httpStatus: 401 });
  }
}

async function login(sheets, nik, password) {
  const rateCheck = checkLoginRateLimit(nik);
  if (!rateCheck.ok) return { status: 'error', message: rateCheck.message };

  const data = await getSheetData(sheets, 'Master_Karyawan');
  const user = data.find(row => String(row['NIK'] || '').trim() === String(nik || '').trim());
  if (!user || normalizeRole(user['ROLE']) === 'DELETED' || !verifyPassword(password, user['PASSWORD'])) {
    recordFailedLogin(nik);
    return { status: 'error', message: 'NIK atau password salah.' };
  }
  clearFailedLogins(nik);

  const storedPw = String(user['PASSWORD'] || '');
  // Password dianggap lemah jika masih plaintext (belum di-hash) ATAU termasuk daftar password umum
  const isPlaintext = !/^\$2[aby]\$/.test(storedPw);
  const forceChange = isPlaintext || isWeakPassword(password);

  return {
    status: 'success',
    ...(forceChange ? { force_change_password: true } : {}),
    user: {
      nik: String(user['NIK'] || '').trim(),
      nama: String(user['NAMA'] || '').trim(),
      jabatan: String(user['JABATAN'] || '').trim(),
      departemen: String(user['DEPARTEMEN'] || '').trim(),
      perusahaan: String(user['PERUSAHAAN'] || '').trim(),
      subcont: String(user['SUBCONT'] || user['PERUSAHAAN SUBCONT(1)'] || '').trim(),
      no_whatsapp: String(user['NO WHATSAPP'] || '').trim(),
      role: String(user['ROLE'] || 'USER').trim().toUpperCase().replace(/\s+/g, '_')
    }
  };
}

async function changePassword(sheets, nik, oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 8)
    throw Object.assign(new Error('Password baru minimal 8 karakter.'), { httpStatus: 400 });
  if (isWeakPassword(newPassword))
    throw Object.assign(new Error('Password terlalu umum. Gunakan kombinasi huruf, angka, atau simbol.'), { httpStatus: 400 });

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Master_Karyawan' });
  const rows = res.data.values || [];
  if (rows.length < 2) throw new Error('Data karyawan tidak ditemukan.');

  const headers = rows[0].map(h => String(h).trim().toUpperCase());
  const nikCol = headers.indexOf('NIK');
  const pwCol  = headers.indexOf('PASSWORD');
  if (nikCol === -1 || pwCol === -1) throw new Error('Kolom NIK/PASSWORD tidak ditemukan.');

  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[nikCol] || '').trim() === String(nik || '').trim());
  if (rowIdx === -1) throw new Error('User tidak ditemukan.');

  if (!verifyPassword(oldPassword, rows[rowIdx][pwCol]))
    throw Object.assign(new Error('Password lama salah.'), { httpStatus: 400 });

  const hash = bcrypt.hashSync(newPassword, 10);
  const colLetter = colIndexToLetter(pwCol);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Master_Karyawan!${colLetter}${rowIdx + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[hash]] }
  });
  return { status: 'success', message: 'Password berhasil diubah.' };
}

function issueToken(user) {
  return jwt.sign(
    { nik: user.nik, nama: user.nama, role: user.role, perusahaan: user.perusahaan },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function normalizeRole(role) { return String(role || '').trim().toUpperCase().replace(/\s+/g, '_'); }
function isSuperAdmin(role) { return normalizeRole(role) === 'SUPER_ADMIN'; }
function isAdminOrAbove(role) { const r = normalizeRole(role); return r === 'ADMIN' || r === 'SUPER_ADMIN'; }

const KARYAWAN_HEADERS = ['PERUSAHAAN','SUBCONT','NAMA','NIK','JABATAN','DEPARTEMEN','NO WHATSAPP','PASSWORD','ROLE','OBJ HR','OBJ INS','OBJ SBO','OBJ PC'];
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
  const karyawan = await getSheetData(sheets, 'Master_Karyawan');
  const match = karyawan.find(r => norm(String(r['no_whatsapp'] || '').replace(/\D/g, '')) === target);
  const nik = String(match?.['nik'] || '').trim();
  console.log(`[push] resolveNikFromWa wa="${wa}" target="${target}" found=${!!match} nik="${nik}"`);
  return nik;
}
// [PUSH-END]

async function getKaryawan(sheets, auth) {
  if (!isAdminOrAbove(auth.role)) throw Object.assign(new Error('Akses ditolak.'), { httpStatus: 403 });
  const rows = await getSheetData(sheets, 'Master_Karyawan');
  const visible = isSuperAdmin(auth.role) ? rows
    : rows.filter(r => String(r['PERUSAHAAN'] || '').trim().toUpperCase() === String(auth.perusahaan || '').trim().toUpperCase());
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
  const karyawan = await getSheetData(sheets, 'Master_Karyawan');
  for (const sa of karyawan.filter(r => isSuperAdmin(r['ROLE']))) {
    if (sa['NO WHATSAPP']) {
      const msg = `Halo ${sa['NAMA']}, ada permohonan *${action.toUpperCase()}* data karyawan dari *${auth.nama}* (${auth.perusahaan}).\n\n👤 User: ${data.NAMA || data.NIK || '-'}\n\nSilakan buka dashboard untuk review dan approval.`;
      await sendWaNotification(sa['NO WHATSAPP'], msg).catch(() => {});
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
  if (action === 'ADD') {
    if (data.PASSWORD && !/^\$2[aby]\$/.test(data.PASSWORD))
      data.PASSWORD = bcrypt.hashSync(data.PASSWORD, 10);
    const row = KARYAWAN_HEADERS.map(h => data[h] ?? '');
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'Master_Karyawan',
      valueInputOption: 'USER_ENTERED', requestBody: { values: [row] }
    });
  } else if (action === 'EDIT' || action === 'DELETE') {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Master_Karyawan' });
    const rows = res.data.values || [];
    const headers = rows[0].map(h => String(h).trim().toUpperCase());
    const nikCol = headers.indexOf('NIK');
    const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[nikCol] || '').trim() === String(data.NIK || '').trim());
    if (rowIdx === -1) throw new Error('User tidak ditemukan.');
    if (action === 'DELETE') {
      // Tandai ROLE=DELETED, login akan otomatis gagal
      const roleCol = headers.indexOf('ROLE');
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: `Master_Karyawan!${colIndexToLetter(roleCol)}${rowIdx + 1}`,
        valueInputOption: 'RAW', requestBody: { values: [['DELETED']] }
      });
    } else {
      const updates = Object.entries(data)
        .filter(([k]) => k.toUpperCase() !== 'PASSWORD')
        .map(([k, v]) => ({ col: headers.indexOf(k.toUpperCase()), val: v }))
        .filter(({ col }) => col !== -1)
        .map(({ col, val }) => ({ range: `Master_Karyawan!${colIndexToLetter(col)}${rowIdx + 1}`, values: [[val]] }));
      if (updates.length)
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: { valueInputOption: 'USER_ENTERED', data: updates }
        });
    }
  }
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
  if (decision === 'APPROVE') await applyUserChange(sheets, action, data);

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
  const karyawan = await getSheetData(sheets, 'Master_Karyawan');
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

async function getHazardReports(sheets) {
  const data = await getSheetData(sheets, 'Hazard_Report');
  const result = data
    .map(obj => {
      const normalized = {};
      Object.keys(obj).forEach(k => { normalized[normalizeHeader(k)] = obj[k]; });
      normalized.report_type = 'HAZARD';
      return normalized;
    })
    .filter(obj => String(obj.id || '').trim());
  return { status: 'success', data: result };
}

async function getInspectionReports(sheets) {
  // ponytail: parallel fetches — 8 sheets sequential was ~8x slower
  const results = await Promise.allSettled(
    INSPECTION_SHEETS.map(sheetName => getSheetData(sheets, sheetName).then(rows => ({ sheetName, rows })))
  );
  const data = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { sheetName, rows } = result.value;
    rows.forEach(row => {
      const normalized = {};
      Object.keys(row).forEach(k => { normalized[normalizeHeader(k)] = row[k]; });
      if (!String(normalized.id || '').trim()) return;
      normalized.report_type = 'INSPECTION';
      normalized.inspection_sheet = sheetName;
      data.push(normalized);
    });
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

async function getAllReports(sheets, nik, nama, role) {
  const [h, i] = await Promise.all([getHazardReports(sheets), getInspectionReports(sheets)]);
  let combined = [...(h.data || []), ...(i.data || [])];
  const userNik = String(nik || '').trim().toLowerCase();
  const userName = String(nama || '').trim().toLowerCase();
  const userRole = String(role || '').trim().toUpperCase();
  if (userRole !== 'ADMIN' && (userNik || userName)) {
    combined = combined.filter(r => isReportVisibleForUser(r, userNik, userName));
  }
  return { status: 'success', data: combined };
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
  const rows = await getSheetData(sheets, 'Master_Karyawan');
  const match = rows.find(r => String(r['NIK'] || '').trim() === String(nik).trim());
  return String(match?.['NO WHATSAPP'] || '').replace(/\D/g, '');
}

async function resolveWaByIdentity(sheets, perusahaan, subcont, nama) {
  if (!nama) return '';
  const rows = await getSheetData(sheets, 'Master_Karyawan');
  const norm = s => String(s || '').trim().toUpperCase();
  const match = rows.find(r =>
    norm(r['NAMA']) === norm(nama) &&
    norm(r['PERUSAHAAN']) === norm(perusahaan) &&
    norm(r['SUBCONT'] || r['PERUSAHAAN']) === norm(subcont || perusahaan)
  );
  return String(match?.['NO WHATSAPP'] || '').replace(/\D/g, '');
}

async function sendWaNotification(target, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token || !target) return false;
  const phone = String(target).replace(/\D/g, '').replace(/^0/, '62');
  const payload = new URLSearchParams({ target: phone, message }).toString();
  return new Promise(resolve => {
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

async function writeWaStatusToSheet(sheets, sheetName, reportId, waStatus) {
  try {
    const waCol = await ensureWaStatusColumn(sheets, sheetName);
    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
    const rows = dataRes.data.values || [];
    // Search all columns — ID might not always be in col A
    const rowIdx = rows.findIndex((row, i) => i > 0 && row.some(cell => String(cell || '').trim() === reportId));
    if (rowIdx === -1) { console.error('writeWaStatus: row not found for', reportId, 'in', sheetName); return; }
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${colIndexToLetter(waCol)}${rowIdx + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[waStatus]] }
    });
  } catch (err) { console.error('writeWaStatus error:', err?.message || err); }
}

async function submitHazardReport(sheets, data) {
  const id = 'HR-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);
  let fotoBahayaUrl = '';
  if (data.upload_foto_bahaya)
    fotoBahayaUrl = await saveMultipleImagesToDrive(data.upload_foto_bahaya, process.env.FOLDER_HAZARD_ID, id + '-Hazard');

  // Resolve WA dari master data jika tidak dikirim dari form
  if (!data.no_whatsapp && data.nik)
    data.no_whatsapp = await resolveWaFromNik(sheets, data.nik).catch(() => '');
  if (!data.no_whatsapp_pic) {
    if (data.nik_pic)
      data.no_whatsapp_pic = await resolveWaFromNik(sheets, data.nik_pic).catch(() => '');
    else if (data.nama_pic)
      data.no_whatsapp_pic = await resolveWaByIdentity(sheets, data.perusahaan_pic, data.subcont2, data.nama_pic).catch(() => '');
  }

  const row = [
    id, new Date().toISOString(), data.perusahaan, data.subcont1, data.nama, data.nik,
    data.jabatan, data.departemen, data.no_whatsapp, data.tanggal_kejadian, data.shift_kejadian,
    data.lokasi_bahaya, data.detail_lokasi_bahaya || '', data.jenis_bahaya, data.ketidaksesuaian_bahaya,
    data.sub_ketidaksesuaian, data.deskripsi_bahaya, data.tingkat_risiko, fotoBahayaUrl,
    data.tindakan_langsung, data.tindakan_usulan_pic, data.perusahaan_pic, data.subcont2,
    data.departemen_pic, data.jabatan_pic, data.nama_pic, data.no_whatsapp_pic, data.batas_waktu,
    '', 'OPEN', data.pernyataan, data.tanda_tangan
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Hazard_Report',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });

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

  const id = 'INSP-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);
  let fotoInspeksiUrl = '';
  if (data.upload_foto_inspeksi)
    fotoInspeksiUrl = await saveMultipleImagesToDrive(data.upload_foto_inspeksi, process.env.FOLDER_HAZARD_ID, id + '-Inspection');

  // Resolve WA dari master data jika tidak dikirim dari form
  if (!data.no_whatsapp && data.nik)
    data.no_whatsapp = await resolveWaFromNik(sheets, data.nik).catch(() => '');
  if (!data.no_whatsapp_pic) {
    if (data.nik_pic)
      data.no_whatsapp_pic = await resolveWaFromNik(sheets, data.nik_pic).catch(() => '');
    else if (data.nama_pic)
      data.no_whatsapp_pic = await resolveWaByIdentity(sheets, data.perusahaan_pic, data.subcont2, data.nama_pic).catch(() => '');
  }

  const headers = await getSheetHeaders(sheets, sheetName);
  const rowData = { ...data, id, timestamp: new Date().toISOString(), upload_foto_inspeksi: fotoInspeksiUrl, status_perbaikan: 'OPEN' };
  const row = headers.map(h => mapInspectionValue(h, rowData));

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });

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

async function updateWorkflowFields(sheets, sheetName, reportId, fields) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
  const rows = res.data.values || [];
  if (rows.length < 2) throw new Error('Data tidak ditemukan.');
  const headers = rows[0].map(normalizeHeader);
  const idCol = headers.indexOf('id');
  if (idCol === -1) throw new Error('Kolom ID tidak ditemukan.');
  const rowIndex = rows.findIndex((row, i) => i > 0 && String(row[idCol] || '').trim() === String(reportId).trim());
  if (rowIndex === -1) throw new Error('Laporan tidak ditemukan.');
  const actualRow = rowIndex + 1;
  const reportRow = {};
  headers.forEach((h, i) => { reportRow[h] = rows[rowIndex][i] ?? ''; });
  const updates = Object.entries(fields).map(([key, value]) => {
    const colIdx = headers.indexOf(normalizeHeader(key));
    return colIdx !== -1 ? { range: `${sheetName}!${colIndexToLetter(colIdx)}${actualRow}`, values: [[value]] } : null;
  }).filter(Boolean);
  if (updates.length)
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
  return reportRow;
}

async function submitActionPlan(sheets, data, sheetName) {
  if (!data.rencana_tindakan?.trim()) throw new Error('Rencana tindakan wajib diisi.');
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

async function reviewActionPlan(sheets, data, sheetName) {
  const decision = data.decision;
  if (decision !== 'approved' && decision !== 'rejected') throw new Error('Decision harus approved atau rejected.');
  if (decision === 'rejected' && !data.comment?.trim()) throw new Error('Komentar wajib diisi jika menolak.');
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

async function updateReport(sheets, data, sheetName, folderSuffix) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
  const rows = res.data.values || [];
  if (rows.length < 2) throw new Error('Data tidak ditemukan.');

  const headers = rows[0].map(normalizeHeader);
  const idCol = headers.indexOf('id');
  if (idCol === -1) throw new Error('Kolom ID tidak ditemukan.');

  const rowIndex = rows.findIndex((row, i) => i > 0 && String(row[idCol] || '').trim() === String(data.id || '').trim());
  if (rowIndex === -1) throw new Error('Data tidak ditemukan.');
  const actualRow = rowIndex + 1; // 1-indexed, rows[0]=header=row1, rows[1]=data=row2

  let fotoPerbaikanUrl = '';
  if (data.upload_foto_perbaikan_pic)
    fotoPerbaikanUrl = await saveMultipleImagesToDrive(data.upload_foto_perbaikan_pic, process.env.FOLDER_CLOSING_ID, data.id + folderSuffix);

  const updates = [];
  const setCell = (headerName, value) => {
    const colIdx = headers.indexOf(normalizeHeader(headerName));
    if (colIdx !== -1 && value != null)
      updates.push({ range: `${sheetName}!${colIndexToLetter(colIdx)}${actualRow}`, values: [[value]] });
  };

  setCell('STATUS PERBAIKAN', data.status_perbaikan || 'OPEN');
  if (fotoPerbaikanUrl) setCell('UPLOAD FOTO PERBAIKAN PIC', fotoPerbaikanUrl);
  setCell('CATATAN CLOSING', data.catatan_closing || '');
  if (data.status_perbaikan === 'CLOSED') setCell('TANGGAL CLOSING', new Date().toISOString());

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates }
    });
  }
  // [PUSH-START] — push ke pelapor saat laporan CLOSED
  if (data.status_perbaikan === 'CLOSED') {
    const rowData = {};
    headers.forEach((h, i) => { rowData[h] = rows[rowIndex][i] ?? ''; });
    const reporterNik = rowData['nik'] || rowData['nik_pelapor'] || '';
    if (reporterNik) await sendPushToNik(sheets, reporterNik, {
      title: 'Laporan Selesai ✅',
      body: `Laporan ${data.id} telah berhasil ditutup.`,
      url: `https://sap-ebl.vercel.app/laporan-detail.html?id=${data.id}`
    }).catch(() => {});
  }
  // [PUSH-END]
  return { status: 'success', message: 'Laporan berhasil diperbarui.', id: data.id, foto_perbaikan_url: fotoPerbaikanUrl };
}

// ===== HANDLER =====

module.exports = async (req, res) => {
  try {
    const { sheets } = getClients();

    if (req.method === 'GET') {
      const { action, type } = req.query;

      // Health check — satu-satunya GET tanpa auth
      if (!action) return res.status(200).json({ status: 'success', message: 'HAZARD REPORT ONE-SAP API is running' });

      // Semua action GET lainnya wajib token valid
      const auth = requireAuth(req);

      let result;
      switch (action) {
        case 'masterKaryawan': {
          const allRows = await getSheetData(sheets, 'Master_Karyawan');
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
        case 'getHazardReports':    result = await getHazardReports(sheets); break;
        case 'getInspectionReports':result = await getInspectionReports(sheets); break;
        // Identitas & role diambil dari token — parameter query diabaikan
        case 'getAllReports':        result = await getAllReports(sheets, auth.nik, auth.nama, auth.role); break;
        case 'getKaryawan':         result = await getKaryawan(sheets, auth); break;
        case 'getPendingChanges':   result = await getPendingChanges(sheets, auth); break;
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
        const result = await login(sheets, data?.nik, data?.password);
        if (result.status === 'success') result.token = issueToken(result.user);
        return res.status(200).json(result);
      }

      // Semua action POST lainnya wajib token valid
      const authUser = requireAuth(req);

      let result;
      switch (action) {
        case 'changePassword':
          result = await changePassword(sheets, authUser.nik, data?.old_password, data?.new_password);
          break;
        case 'proposeChange':
          result = await proposeChange(sheets, authUser, data?.action, data?.payload);
          break;
        case 'reviewChange':
          result = await reviewChange(sheets, authUser, data?.change_id, data?.decision, data?.reason);
          break;
        case 'resendWaPic': {
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
        case 'submitHazardReport':     result = await submitHazardReport(sheets, data); break;
        case 'submitInspectionReport': result = await submitInspectionReport(sheets, data); break;
        case 'updateHazardReport':     result = await updateReport(sheets, data, 'Hazard_Report', '-Closing'); break;
        case 'updateInspectionReport': {
          const sheetName = String(data.inspection_sheet || '').trim().toUpperCase();
          if (!INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          result = await updateReport(sheets, data, sheetName, '-Inspection-Closing');
          break;
        }
        case 'submitActionPlan': {
          const sheetName = data.inspection_sheet ? String(data.inspection_sheet).trim().toUpperCase() : 'Hazard_Report';
          if (data.inspection_sheet && !INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          result = await submitActionPlan(sheets, data, sheetName);
          break;
        }
        case 'reviewActionPlan': {
          const sheetName = data.inspection_sheet ? String(data.inspection_sheet).trim().toUpperCase() : 'Hazard_Report';
          if (data.inspection_sheet && !INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          result = await reviewActionPlan(sheets, data, sheetName);
          break;
        }
        // [PUSH-START]
        case 'push_subscribe':
          await savePushSubscription(sheets, authUser.nik, data.endpoint, data.p256dh, data.auth);
          result = { status: 'success', message: 'Push subscription saved.' };
          break;
        case 'push_unsubscribe':
          await removePushSubscriptionByEndpoint(sheets, data.endpoint);
          result = { status: 'success', message: 'Push subscription removed.' };
          break;
        case 'push_debug':
          result = {
            status: 'success',
            hasPublicKey:  !!process.env.VAPID_PUBLIC_KEY,
            hasPrivateKey: !!process.env.VAPID_PRIVATE_KEY,
            hasEmail:      !!process.env.VAPID_EMAIL,
            pubKeyLen:     process.env.VAPID_PUBLIC_KEY?.length ?? 0,
            privKeyLen:    process.env.VAPID_PRIVATE_KEY?.length ?? 0,
          };
          break;
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
