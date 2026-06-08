const SPREADSHEET_ID = '16vecOjTRvSHLiNFmfWu4kj95Abi02Wnss3bnwE2kmrU';
const FOLDER_HAZARD_ID = '1YacQjwpxwvvetienjMr7G8v9BsSoysKI';
const FOLDER_CLOSING_ID = '17gpMJ5S3r7m3FDwPbBknNJuw3vaBY5YC';
const FOLDER_INSPECTION_ID = FOLDER_HAZARD_ID; // Gunakan folder hazard jika belum ada folder inspeksi khusus
const INSPECTION_SHEETS = [
  'INS_CB',
  'INS_JA',
  'INS_MD',
  'INS_KG',
  'INS_SP',
  'INS_T',
  'INS_TB',
  'INS_WS'
];
const INSPECTION_CLOSING_HEADERS = [
  'NIK PIC',
  'UPLOAD FOTO PERBAIKAN PIC',
  'STATUS PERBAIKAN',
  'PERNYATAAN',
  'TANDA TANGAN',
  'CATATAN CLOSING',
  'TANGGAL CLOSING'
];

function isInspectionSheet(name) {
  return INSPECTION_SHEETS.includes(String(name || '').trim().toUpperCase());
}

/**
 * Upload gambar Base64 ke Google Drive
 *
 * @param {string} base64Data - Data URL (data:image/png;base64,...)
 * @param {string} folderId   - ID folder Google Drive
 * @param {string} fileName   - Nama file yang akan disimpan
 * @return {string} URL file di Google Drive
 */
function saveBase64ImageToDrive(base64Data, folderId, fileName) {
  if (!base64Data) return "";

  const mimeMatch = base64Data.match(/^data:(.+);base64,/);
  if (!mimeMatch) {
    throw new Error("Format gambar tidak valid.");
  }

  const mimeType = mimeMatch[1];
  const base64 = base64Data.split(",")[1];
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ========================================
// FUNGSI GENERIK MEMBACA SHEET
// ========================================
function getSheetData(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" tidak ditemukan.`);
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const headers = values[0];
  const data = values.slice(1);

  return data.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[String(header).trim()] = row[index];
    });
    return obj;
  });
}

function getSheetHeaders(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" tidak ditemukan.`);
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.map(header => String(header).trim());
}

function getSheetChecklist(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const records = values.slice(1);
  return records.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[String(header).trim()] = row[index];
    });
    return obj;
  });
}

function buildInspectionRow(sheet, data) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.map(header => mapInspectionValue(String(header).trim(), data));
}

function ensureInspectionClosingHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  const headers = lastColumn
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    : [];
  const normalized = headers.map(normalizeHeader);
  const missing = INSPECTION_CLOSING_HEADERS.filter(header =>
    !normalized.includes(normalizeHeader(header))
  );

  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
}

function mapInspectionValue(header, data) {
  const key = header.trim().toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  switch (key) {
    case 'ID':
      return data.id || '';
    case 'TIMESTAMP':
      return data.timestamp || '';
    case 'JENIS_INSPEKSI':
      return data.jenis_inspeksi || '';
    case 'PERUSAHAAN':
      return data.perusahaan || '';
    case 'PERUSAHAAN SUBCONT(1)':
    case 'SUBCONT1':
      return data.subcont1 || '';
    case 'NAMA':
      return data.nama || '';
    case 'NIK':
      return data.nik || '';
    case 'JABATAN':
      return data.jabatan || '';
    case 'DEPARTEMEN':
      return data.departemen || '';
    case 'NO WHATSAPP':
      return data.no_whatsapp || '';
    case 'TANGGAL KEJADIAN':
    case 'TANGGAL INSPEKSI':
      return data.tanggal_inspeksi || '';
    case 'SHIFT KEJADIAN':
    case 'SHIFT INSPEKSI':
      return data.shift_inspeksi || '';
    case 'LOKASI':
    case 'LOKASI INSPEKSI':
      return data.lokasi_inspeksi || '';
    case 'DETAIL_LOKASI_INSPEKSI':
      return data.detail_lokasi_inspeksi || '';
    case 'TEMUAN INSPEKSI':
      return data.temuan_inspeksi || '';
    case 'UPLOAD FOTO INSPEKSI':
      return data.upload_foto_inspeksi || '';
    case 'TINDAKAN PERBAIKAN YANG DIUSULKAN KEPADA PENANGGUNGJAWAB (PIC)':
    case 'TINDAKAN USULAN PIC':
      return data.tindakan_usulan_pic || '';
    case 'PERUSAHAAN PIC':
      return data.perusahaan_pic || '';
    case 'PERUSAHAAN SUBCONT(2)':
    case 'SUBCONT2':
      return data.subcont2 || '';
    case 'DEPARTEMEN PIC':
      return data.departemen_pic || '';
    case 'JABATAN PIC':
      return data.jabatan_pic || '';
    case 'NAMA PIC':
      return data.nama_pic || '';
    case 'NO WHATTSAPP PIC':
    case 'NO WHATSAPP PIC':
      return data.no_whatsapp_pic || '';
    case 'NIK PIC':
      return data.nik_pic || '';
    case 'BATAS WAKTU':
      return data.batas_waktu || '';
  case 'UPLOAD FOTO PERBAIKAN PIC':
      return data.upload_foto_perbaikan_pic || '';
    case 'INSPECTION_CHECKLIST':
      return data.inspection_checklist || '';
    default:
      if (header.startsWith('CHECKLIST_')) {
        return data.temuan_fields && data.temuan_fields[header] !== undefined
          ? data.temuan_fields[header]
          : '';
      }
      return data.temuan_fields && data.temuan_fields[header] !== undefined
        ? data.temuan_fields[header]
        : '';
  }
}

function normalizeHeader(header) {
  return String(header || '').trim().toUpperCase();
}

}

// ========================================
// API ENDPOINT
// ========================================
function doGet(e) {
  const action = e.parameter.action;
  let result = [];

  switch (action) {
    case 'masterKaryawan':
      result = getSheetData('Master_Karyawan');
      break;

    case 'masterLokasi':
      result = getSheetData('Master_Lokasi');
      break;

    case 'inspectionChecklist':
      if (!e.parameter.type) {
        throw new Error('Parameter type wajib diisi untuk inspectionChecklist.');
      }
      const checklistSheet = String(e.parameter.type).trim().toUpperCase();
      if (!isInspectionSheet(checklistSheet)) {
        throw new Error('Jenis inspeksi tidak valid: ' + checklistSheet);
      }
      result = getSheetChecklist(checklistSheet);
      break;

    case 'masterTemuan':
      if (e.parameter.type) {
        const sheetName = String(e.parameter.type).trim().toUpperCase();
        if (!isInspectionSheet(sheetName)) {
          throw new Error('Jenis inspeksi tidak valid: ' + sheetName);
        }
        result = getSheetHeaders(sheetName);
      } else {
        result = getSheetData('Master_Temuan');
      }
      break;

    case 'masterJenisInspeksi':
      result = getSheetData('Jenis_Inspeksi');
      break;

    case 'login':
      result = login(e.parameter.nik, e.parameter.password);
      break;

    case 'getHazardReports':
      result = getHazardReports();
      break;

    case 'getInspectionReports':
      result = getInspectionReports();
      break;

    case 'getAllReports':
      result = getAllReports();
      break;

    default:
      result = {
        status: 'success',
        message: 'HAZARD REPORT ONE-SAP API is running'
      };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const data = payload.data || {};
    let result;

    switch (action) {
      case 'submitHazardReport':
        result = submitHazardReport(data);
        break;

      case 'submitInspectionReport':
        result = submitInspectionReport(data);
        break;

      case 'updateHazardReport':
        result = updateHazardReport(data);
        break;

      case 'updateInspectionReport':
        result = updateInspectionReport(data);
        break;

      default:
        throw new Error('Action tidak dikenali: ' + action);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function submitInspectionReport(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = String(data.inspection_code || data.jenis_inspeksi || '').trim().toUpperCase();

  if (!isInspectionSheet(sheetName)) {
    throw new Error('Jenis inspeksi tidak valid: ' + sheetName);
  }

  let sheet = ss.getSheetByName(sheetName);

  const headers = [
    'ID',
    'TIMESTAMP',
    'JENIS_INSPEKSI',
    'PERUSAHAAN',
    'SUBCONT1',
    'NAMA',
    'NIK',
    'JABATAN',
    'DEPARTEMEN',
    'NO_WHATSAPP',
    'TANGGAL_INSPEKSI',
    'SHIFT_INSPEKSI',
    'LOKASI_INSPEKSI',
    'DETAIL_LOKASI_INSPEKSI',
    'TEMUAN_INSPEKSI',
    'UPLOAD_FOTO_INSPEKSI',
    'TINDAKAN_USULAN_PIC',
    'PERUSAHAAN_PIC',
    'SUBCONT2',
    'NAMA_PIC',
    'JABATAN_PIC',
    'DEPARTEMEN_PIC',
    'NO_WHATSAPP_PIC',
    'BATAS_WAKTU',
    'NIK_PIC',
    'UPLOAD_FOTO_PERBAIKAN_PIC',
    'STATUS_PERBAIKAN',
    'PERNYATAAN',
    'TANDA_TANGAN',
    'CATATAN_CLOSING',
    'TANGGAL_CLOSING'
  ];

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
  }
  ensureInspectionClosingHeaders(sheet);

  const id = 'INSP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const timestamp = new Date();
  let fotoInspeksiUrl = '';

  if (data.upload_foto_inspeksi) {
    fotoInspeksiUrl = saveBase64ImageToDrive(data.upload_foto_inspeksi, FOLDER_INSPECTION_ID, id + '-Inspection.jpg');
  }

  const rowData = Object.assign({}, data, {
    id: id,
    timestamp: timestamp,
    upload_foto_inspeksi: fotoInspeksiUrl,
    status_perbaikan: 'OPEN'
  });

  const row = buildInspectionRow(sheet, rowData);
  sheet.appendRow(row);

  return {
    status: 'success',
    message: 'Inspeksi berhasil disimpan.',
    id: id
  };
}

function submitHazardReport(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Hazard_Report');

  if (!sheet) {
    throw new Error('Sheet "Hazard_Report" tidak ditemukan.');
  }

  const id = 'HR-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const timestamp = new Date();
  let fotoBahayaUrl = '';

  if (data.upload_foto_bahaya) {
    fotoBahayaUrl = saveBase64ImageToDrive(data.upload_foto_bahaya, FOLDER_HAZARD_ID, id + '-Hazard.jpg');
  }

  const row = [
    id,
    timestamp,
    data.perusahaan,
    data.subcont1,
    data.nama,
    data.nik,
    data.jabatan,
    data.departemen,
    data.no_whatsapp,
    data.tanggal_kejadian,
    data.shift_kejadian,
    data.lokasi_bahaya,
    data.detail_lokasi_bahaya || '',
    data.jenis_bahaya,
    data.ketidaksesuaian_bahaya,
    data.sub_ketidaksesuaian,
    data.deskripsi_bahaya,
    data.tingkat_risiko,
    fotoBahayaUrl,
    data.tindakan_langsung,
    data.tindakan_usulan_pic,
    data.perusahaan_pic,
    data.subcont2,
    data.departemen_pic,
    data.jabatan_pic,
    data.nama_pic,
    data.no_whatsapp_pic,
    data.batas_waktu,
    '',
    'OPEN',
    data.pernyataan,
    data.tanda_tangan
  ];

  sheet.appendRow(row);

  return {
    status: 'success',
    message: 'Hazard Report berhasil disimpan.',
    id: id
  };
}

function forceDriveAuthorization() {
  const folder = DriveApp.getFolderById(FOLDER_HAZARD_ID);
  const file = folder.createFile('test.txt', 'Authorization Test');
  Logger.log(file.getUrl());
}

function getHazardReports() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Hazard_Report');

  if (!sheet) {
    throw new Error('Sheet "Hazard_Report" tidak ditemukan.');
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { status: 'success', data: [] };
  }

  const headers = values[0];
  const rows = values.slice(1);
  const data = rows.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      const key = normalizeHeader(header);
      if (key) obj[key] = row[index];
    });
    obj.report_type = 'HAZARD';
    // Hanya push baris yang punya ID
    const id = String(obj.id || '').trim();
    if (!id) return null;
    return obj;
  }).filter(Boolean);

  return { status: 'success', data: data };
}

function getInspectionReports() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data = [];

  INSPECTION_SHEETS.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;

    ensureInspectionClosingHeaders(sheet);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(normalizeHeader);

    values.slice(1).forEach(row => {
      const report = {};
      headers.forEach((header, index) => {
        report[header] = row[index];
      });
      if (!String(report.id || '').trim()) return;
      report.report_type = 'INSPECTION';
      report.inspection_sheet = sheetName;
      data.push(report);
    });
  });

  return { status: 'success', data: data };
}

function getAllReports() {
  const hazard = getHazardReports().data || [];
  const inspection = getInspectionReports().data || [];
  return { status: 'success', data: hazard.concat(inspection) };
}

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '');
}

function updateHazardReport(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Hazard_Report');

  if (!sheet) {
    throw new Error('Sheet "Hazard_Report" tidak ditemukan.');
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(h => normalizeHeader(h));

  const idCol = headers.indexOf('id');
  if (idCol === -1) {
    throw new Error('Kolom ID tidak ditemukan.');
  }

  if (!data.id) {
    throw new Error('ID Hazard Report tidak ditemukan.');
  }

  const rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues();

  const rowIndex = rows.findIndex(row => String(row[idCol]).trim() === String(data.id).trim());
  if (rowIndex === -1) {
    throw new Error('Data dengan ID tersebut tidak ditemukan.');
  }

  const actualRow = rowIndex + 2;
  const setCell = (headerName, value) => {
    const colIndex = headers.indexOf(normalizeHeader(headerName));
    if (colIndex !== -1 && value !== undefined && value !== null) {
      sheet.getRange(actualRow, colIndex + 1).setValue(value);
    }
  };

  let fotoPerbaikanUrl = '';
  if (data.upload_foto_perbaikan_pic) {
    fotoPerbaikanUrl = saveBase64ImageToDrive(data.upload_foto_perbaikan_pic, FOLDER_CLOSING_ID, data.id + '-Closing-' + new Date().getTime() + '.jpg');
  }

  setCell('STATUS PERBAIKAN', data.status_perbaikan || 'OPEN');
  if (fotoPerbaikanUrl) {
    setCell('UPLOAD FOTO PERBAIKAN PIC', fotoPerbaikanUrl);
  }
  setCell('CATATAN CLOSING', data.catatan_closing || '');

  if (data.status_perbaikan === 'CLOSED') {
    setCell('TANGGAL CLOSING', new Date());
  }

  return {
    status: 'success',
    message: 'Hazard Report berhasil diperbarui.',
    id: data.id,
    foto_perbaikan_url: fotoPerbaikanUrl
  };
}

function updateInspectionReport(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = String(data.inspection_sheet || '').trim().toUpperCase();

  if (!isInspectionSheet(sheetName)) {
    throw new Error('Sheet inspeksi tidak valid.');
  }

  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet inspeksi tidak ditemukan.');
  }
  if (!data.id) {
    throw new Error('ID inspeksi tidak ditemukan.');
  }

  ensureInspectionClosingHeaders(sheet);
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(normalizeHeader);
  const idCol = headers.indexOf('id');
  if (idCol === -1 || sheet.getLastRow() < 2) {
    throw new Error('Data inspeksi tidak ditemukan.');
  }

  const rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues();
  const rowIndex = rows.findIndex(row =>
    String(row[idCol]).trim() === String(data.id).trim()
  );
  if (rowIndex === -1) {
    throw new Error('Data inspeksi dengan ID tersebut tidak ditemukan.');
  }

  const actualRow = rowIndex + 2;
  const setCell = (headerName, value) => {
    const colIndex = headers.indexOf(normalizeHeader(headerName));
    if (colIndex !== -1 && value !== undefined && value !== null) {
      sheet.getRange(actualRow, colIndex + 1).setValue(value);
    }
  };

  let fotoPerbaikanUrl = '';
  if (data.upload_foto_perbaikan_pic) {
    fotoPerbaikanUrl = saveBase64ImageToDrive(
      data.upload_foto_perbaikan_pic,
      FOLDER_CLOSING_ID,
      data.id + '-Inspection-Closing-' + new Date().getTime() + '.jpg'
    );
  }

  setCell('STATUS PERBAIKAN', data.status_perbaikan || 'OPEN');
  if (fotoPerbaikanUrl) {
    setCell('UPLOAD FOTO PERBAIKAN PIC', fotoPerbaikanUrl);
  }
  setCell('CATATAN CLOSING', data.catatan_closing || '');
  if (data.status_perbaikan === 'CLOSED') {
    setCell('TANGGAL CLOSING', new Date());
  }

  return {
    status: 'success',
    message: 'Laporan inspeksi berhasil diperbarui.',
    id: data.id,
    foto_perbaikan_url: fotoPerbaikanUrl
  };
}

function login(nik, password) {
  const data = getSheetData('Master_Karyawan');
  const user = data.find(row => String(row['NIK'] || '').trim() === String(nik || '').trim());

  if (!user) {
    return { status: 'error', message: 'NIK tidak ditemukan.' };
  }

  const storedPassword = String(user['PASSWORD'] || '').trim();
  if (storedPassword !== String(password || '').trim()) {
    return { status: 'error', message: 'Password salah.' };
  }

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
