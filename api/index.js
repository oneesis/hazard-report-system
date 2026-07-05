const { google } = require('googleapis');
const { Readable } = require('stream');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const FOLDER_HAZARD_ID = process.env.FOLDER_HAZARD_ID;
const FOLDER_CLOSING_ID = process.env.FOLDER_CLOSING_ID;
const INSPECTION_SHEETS = ['INS_CB', 'INS_JA', 'INS_MD', 'INS_KG', 'INS_SP', 'INS_T', 'INS_TB', 'INS_WS'];

function getClients() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  return {
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth })
  };
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

async function saveBase64ImageToDrive(drive, base64Data, folderId, fileName) {
  if (!base64Data) return '';
  const mimeMatch = base64Data.match(/^data:(.+);base64,/);
  if (!mimeMatch) throw new Error('Format gambar tidak valid.');
  const mimeType = mimeMatch[1];
  const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
  const file = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id'
  });
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: { role: 'reader', type: 'anyone' }
  });
  return `https://drive.google.com/file/d/${file.data.id}/view`;
}

async function saveMultipleImagesToDrive(drive, base64DataField, folderId, idPrefix) {
  if (!base64DataField) return '';
  let list;
  try {
    const trimmed = String(base64DataField).trim();
    list = trimmed.startsWith('[') ? JSON.parse(trimmed) : [base64DataField];
  } catch { list = [base64DataField]; }
  const urls = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i]) {
      const url = await saveBase64ImageToDrive(drive, list[i], folderId, `${idPrefix}-${i + 1}-${Date.now()}.jpg`);
      if (url) urls.push(url);
    }
  }
  return urls.join(', ');
}

// ===== ACTIONS =====

async function login(sheets, nik, password) {
  const data = await getSheetData(sheets, 'Master_Karyawan');
  const user = data.find(row => String(row['NIK'] || '').trim() === String(nik || '').trim());
  if (!user) return { status: 'error', message: 'NIK tidak ditemukan.' };
  if (String(user['PASSWORD'] || '').trim() !== String(password || '').trim())
    return { status: 'error', message: 'Password salah.' };
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
      role: String(user['ROLE'] || 'USER').trim().toUpperCase()
    }
  };
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

async function submitHazardReport(sheets, drive, data) {
  const id = 'HR-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);
  let fotoBahayaUrl = '';
  if (data.upload_foto_bahaya)
    fotoBahayaUrl = await saveMultipleImagesToDrive(drive, data.upload_foto_bahaya, FOLDER_HAZARD_ID, id + '-Hazard');

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
  return { status: 'success', message: 'Hazard Report berhasil disimpan.', id };
}

async function submitInspectionReport(sheets, drive, data) {
  const sheetName = String(data.inspection_code || data.jenis_inspeksi || '').trim().toUpperCase();
  if (!INSPECTION_SHEETS.includes(sheetName)) throw new Error('Jenis inspeksi tidak valid: ' + sheetName);

  const id = 'INSP-' + new Date().toISOString().replace(/\D/g, '').slice(0, 15);
  let fotoInspeksiUrl = '';
  if (data.upload_foto_inspeksi)
    fotoInspeksiUrl = await saveMultipleImagesToDrive(drive, data.upload_foto_inspeksi, FOLDER_HAZARD_ID, id + '-Inspection');

  const headers = await getSheetHeaders(sheets, sheetName);
  const rowData = { ...data, id, timestamp: new Date().toISOString(), upload_foto_inspeksi: fotoInspeksiUrl, status_perbaikan: 'OPEN' };
  const row = headers.map(h => mapInspectionValue(h, rowData));

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
  return { status: 'success', message: 'Inspeksi berhasil disimpan.', id };
}

async function updateReport(sheets, drive, data, sheetName, folderSuffix) {
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
    fotoPerbaikanUrl = await saveMultipleImagesToDrive(drive, data.upload_foto_perbaikan_pic, FOLDER_CLOSING_ID, data.id + folderSuffix);

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
    const { sheets, drive } = getClients();

    if (req.method === 'GET') {
      const { action, type, nik, password, nama, role } = req.query;
      let result;
      switch (action) {
        case 'masterKaryawan':       result = await getSheetData(sheets, 'Master_Karyawan'); break;
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
        case 'login':               result = await login(sheets, nik, password); break;
        case 'getHazardReports':    result = await getHazardReports(sheets); break;
        case 'getInspectionReports':result = await getInspectionReports(sheets); break;
        case 'getAllReports':        result = await getAllReports(sheets, nik, nama, role); break;
        default: result = { status: 'success', message: 'HAZARD REPORT ONE-SAP API is running' };
      }
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      // GAS-style clients send text/plain — parse body regardless of Content-Type
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const { action, data } = body || {};
      let result;
      switch (action) {
        case 'submitHazardReport':     result = await submitHazardReport(sheets, drive, data); break;
        case 'submitInspectionReport': result = await submitInspectionReport(sheets, drive, data); break;
        case 'updateHazardReport':     result = await updateReport(sheets, drive, data, 'Hazard_Report', '-Closing'); break;
        case 'updateInspectionReport': {
          const sheetName = String(data.inspection_sheet || '').trim().toUpperCase();
          if (!INSPECTION_SHEETS.includes(sheetName)) throw new Error('Sheet inspeksi tidak valid.');
          result = await updateReport(sheets, drive, data, sheetName, '-Inspection-Closing');
          break;
        }
        default: throw new Error('Action tidak dikenali: ' + action);
      }
      return res.status(200).json(result);
    }

    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
