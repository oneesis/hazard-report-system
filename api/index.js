const { google } = require('googleapis');
const https = require('https');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '12h'; // sesi berlaku 12 jam

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
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
  const data = await getSheetData(sheets, 'Master_Karyawan');
  const user = data.find(row => String(row['NIK'] || '').trim() === String(nik || '').trim());
  // Pesan error disamakan agar tidak membocorkan NIK mana yang terdaftar
  if (!user || normalizeRole(user['ROLE']) === 'DELETED' || !verifyPassword(password, user['PASSWORD']))
    return { status: 'error', message: 'NIK atau password salah.' };
  return {
    status: 'success',
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
  if (!newPassword || newPassword.length < 6)
    throw Object.assign(new Error('Password baru minimal 6 karakter.'), { httpStatus: 400 });

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
  karyawan.filter(r => isSuperAdmin(r['ROLE'])).forEach(sa => {
    if (sa['NO WHATSAPP']) {
      const msg = `Halo ${sa['NAMA']}, ada permohonan *${action.toUpperCase()}* data karyawan dari *${auth.nama}* (${auth.perusahaan}).\n\n👤 User: ${data.NAMA || data.NIK || '-'}\n\nSilakan buka dashboard untuk review dan approval.`;
      await sendWaNotification(sa['NO WHATSAPP'], msg).catch(() => {});
    }
  });
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

async function sendWaNotification(target, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token || !target) return;
  const phone = String(target).replace(/\D/g, '').replace(/^0/, '62');
  const payload = new URLSearchParams({ target: phone, message }).toString();
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.fonnte.com', path: '/send', method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) }
    }, res => { res.resume(); resolve(); });
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

async function submitHazardReport(sheets, data) {
  const id = 'HR-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);
  let fotoBahayaUrl = '';
  if (data.upload_foto_bahaya)
    fotoBahayaUrl = await saveMultipleImagesToDrive(data.upload_foto_bahaya, process.env.FOLDER_HAZARD_ID, id + '-Hazard');

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

  if (data.no_whatsapp_pic && data.nama_pic) {
    const msg = `Halo ${data.nama_pic}, kamu ditunjuk sebagai PIC untuk laporan hazard baru.\n\n` +
      `📋 *${id}*\n` +
      `📍 Lokasi: ${data.lokasi_bahaya}${data.detail_lokasi_bahaya ? ' - ' + data.detail_lokasi_bahaya : ''}\n` +
      `⚠️ Temuan: ${data.jenis_bahaya}\n` +
      `⏰ Batas waktu: ${data.batas_waktu || '-'}\n\n` +
      `Silakan buka aplikasi untuk melihat detail laporan.`;
    await sendWaNotification(data.no_whatsapp_pic, msg).catch(() => {});
  }

  return { status: 'success', message: 'Hazard Report berhasil disimpan.', id };
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

  const headers = await getSheetHeaders(sheets, sheetName);
  const rowData = { ...data, id, timestamp: new Date().toISOString(), upload_foto_inspeksi: fotoInspeksiUrl, status_perbaikan: 'OPEN' };
  const row = headers.map(h => mapInspectionValue(h, rowData));

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });

  if (data.no_whatsapp_pic && data.nama_pic) {
    const namaInspeksi = INSPECTION_NAMES[sheetName] || sheetName;
    const msg = `Halo ${data.nama_pic}, kamu ditunjuk sebagai PIC untuk laporan inspeksi baru.\n\n` +
      `📋 *${id}*\n` +
      `🔍 Jenis: ${namaInspeksi}\n` +
      `📍 Lokasi: ${data.lokasi_inspeksi}${data.detail_lokasi_inspeksi ? ' - ' + data.detail_lokasi_inspeksi : ''}\n` +
      `⏰ Batas waktu: ${data.batas_waktu || '-'}\n\n` +
      `Silakan buka aplikasi untuk melihat detail laporan.`;
    await sendWaNotification(data.no_whatsapp_pic, msg).catch(() => {});
  }

  return { status: 'success', message: 'Inspeksi berhasil disimpan.', id };
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
        case 'masterKaryawan':       result = stripSensitiveKaryawan(await getSheetData(sheets, 'Master_Karyawan')); break;
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
        case 'submitHazardReport':     result = await submitHazardReport(sheets, data); break;
        case 'submitInspectionReport': result = await submitInspectionReport(sheets, data); break;
        case 'updateHazardReport':     result = await updateReport(sheets, data, 'Hazard_Report', '-Closing'); break;
        case 'updateInspectionReport': {
          const sheetName = String(data.inspection_sheet || '').trim().toUpperCase();
          if (!INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          result = await updateReport(sheets, data, sheetName, '-Inspection-Closing');
          break;
        }
        default: throw new Error('Action tidak dikenali: ' + action);
      }
      return res.status(200).json(result);
    }

    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  } catch (error) {
    return res.status(error.httpStatus || 500).json({ status: 'error', message: error.message });
  }
};
