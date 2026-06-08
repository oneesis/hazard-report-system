window.__inspectionFormBaseUrl = window.__inspectionFormBaseUrl || "https://script.google.com/macros/s/AKfycbyw_rFrWax6FBdlc0FYeJAvl511YT5MCXToXf-RYsFhds-gapAr0w8vkXNKc2zZ9h5X/exec";
var __INSPECTION_BASE_URL = window.__inspectionFormBaseUrl;

const INSPECTION_TYPE_LABELS = {
  INS_CB: "Inspeksi Conveyor Belt",
  INS_JA: "Inspeksi Jalan Angkut",
  INS_MD: "Inspeksi Mess dan Dapur",
  INS_KG: "Inspeksi Kantor dan Gudang",
  INS_SP: "Inspeksi Settling Pond",
  INS_T: "Inspeksi Tambang",
  INS_TB: "Inspeksi Tangki BBM",
  INS_WS: "Inspeksi Workshop"
};

let masterKaryawan = [];
let masterLokasi = [];
let signaturePad;
let currentStep = 1;
const TOTAL_STEPS = 5;
let inspectionChecklist = [];
let inspectionAutosaveTimer = null;
const INSPECTION_AUTOSAVE_DELAY = 2000;

function getQueryParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return JSON.parse(text);
}

async function loadMasterKaryawan() {
  try {
    const data = await fetchJSON(`${BASE_URL}?action=masterKaryawan`);
    masterKaryawan = Array.isArray(data) ? data : (data.data || []);
    console.log('✓ inspection-form: masterKaryawan loaded, count=', masterKaryawan.length);
    console.log('  First employee:', masterKaryawan[0]);
    window.masterKaryawan = masterKaryawan; // Ensure global access
  } catch (err) {
    console.error('✗ inspection-form: gagal load masterKaryawan', err);
    masterKaryawan = [];
    window.masterKaryawan = masterKaryawan;
    const alertBox = document.getElementById('alertError');
    if (alertBox) alertBox.textContent = 'Gagal memuat daftar karyawan. Cek koneksi/API.';
    // Fallback: jika ada user yang login, buat entry sementara dari profil agar autofill bekerja
    try {
      const user = getCurrentUser();
      if (user && user.nik) {
        masterKaryawan = [{
          'NIK': user.nik,
          'NAMA': user.nama || '',
          'PERUSAHAAN': user.perusahaan || '',
          'SUBCONT': user.subcont || '',
          'JABATAN': user.jabatan || '',
          'DEPARTEMEN': user.departemen || '',
          'NO WHATSAPP': user.no_whatsapp || ''
        }];
        console.log('✓ inspection-form: menggunakan fallback masterKaryawan dari profil user');
        window.masterKaryawan = masterKaryawan;
      }
    } catch (e) {
      console.error('✗ inspection-form: fallback masterKaryawan gagal', e);
    }
  }
}

async function loadMasterLokasi() {
  try {
    const data = await fetchJSON(`${BASE_URL}?action=masterLokasi`);
    masterLokasi = Array.isArray(data) ? data : (data.data || []);
    console.log('✓ inspection-form: masterLokasi loaded, count=', masterLokasi.length);
    window.masterLokasi = masterLokasi; // Ensure global access
  } catch (err) {
    console.error('✗ inspection-form: gagal load masterLokasi', err);
    masterLokasi = [];
    window.masterLokasi = masterLokasi;
    const alertBox = document.getElementById('alertError');
    if (alertBox) alertBox.textContent = 'Gagal memuat daftar lokasi. Cek koneksi/API.';
  }
}

async function loadInspectionChecklist() {
  const params = getQueryParams();
  const type = (params.type || "").toUpperCase();
  if (!type) return;
  try {
    const data = await fetchJSON(`${BASE_URL}?action=masterTemuan&type=${encodeURIComponent(type)}`);
    const headers = Array.isArray(data) ? data : (data.data || []);
    
    // Temukan index LOKASI (case-insensitive)
    const lokasiIndex = headers.findIndex(h => {
      const norm = String(h || "").trim().toUpperCase().replace(/_/g, " ");
      return norm === "LOKASI" || norm === "LOKASI INSPEKSI";
    });
    
    // Temukan index Temuan Inspeksi (case-insensitive)
    const temuanIndex = headers.findIndex(h => {
      const norm = String(h || "").trim().toUpperCase().replace(/_/g, " ");
      return norm === "TEMUAN INSPEKSI" || norm === "TEMUAN_INSPEKSI";
    });
    
    if (lokasiIndex !== -1 && temuanIndex !== -1 && temuanIndex > lokasiIndex + 1) {
      inspectionChecklist = headers.slice(lokasiIndex + 1, temuanIndex).map(h => String(h).trim());
    } else {
      console.warn("✗ inspection-form: Kolom LOKASI atau Temuan Inspeksi tidak ditemukan/tidak berurutan");
      inspectionChecklist = [];
    }
    
    console.log("✓ inspectionChecklist loaded, count=", inspectionChecklist.length);
    renderInspectionChecklist();
  } catch (err) {
    console.error('✗ inspection-form: gagal load inspectionChecklist', err);
    inspectionChecklist = [];
    renderInspectionChecklist();
  }
}

function renderInspectionChecklist() {
  const container = document.getElementById('inspectionChecklistItems');
  if (!container) return;
  
  if (!inspectionChecklist || inspectionChecklist.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: #64748b; padding: 20px;">Tidak ada item checklist untuk jenis inspeksi ini.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  inspectionChecklist.forEach((item, index) => {
    const labelText = String(item).trim();
    
    // Buat card checklist item
    const row = document.createElement('div');
    row.className = 'inspection-checklist-item';
    row.dataset.checklistIndex = String(index);
    row.dataset.status = ''; // Simpan status terpilih disini

    // Header untuk label dan tombol pilihan
    const headerDiv = document.createElement('div');
    headerDiv.className = 'inspection-checklist-item-header';

    const labelEl = document.createElement('label');
    labelEl.textContent = labelText;

    // Container pilihan status (Normal / Abnormal)
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'inspection-checklist-options';

    const btnNormal = document.createElement('button');
    btnNormal.type = 'button';
    btnNormal.className = 'checklist-option-btn option-normal';
    btnNormal.innerHTML = '<i class="fa-solid fa-circle-check"></i> Normal';

    const btnAbnormal = document.createElement('button');
    btnAbnormal.type = 'button';
    btnAbnormal.className = 'checklist-option-btn option-abnormal';
    btnAbnormal.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Abnormal';

    optionsDiv.append(btnNormal, btnAbnormal);
    headerDiv.append(labelEl, optionsDiv);

    // Container catatan untuk status abnormal (tersembunyi secara default)
    const notesContainer = document.createElement('div');
    notesContainer.className = 'inspection-checklist-notes-container';

    const notesLabel = document.createElement('span');
    notesLabel.className = 'inspection-checklist-item-notes-label';
    notesLabel.textContent = 'Catatan Temuan (Wajib diisi jika abnormal):';

    const notes = document.createElement('textarea');
    notes.className = 'inspection-checklist-notes';
    notes.rows = 2;
    notes.dataset.checklistIndex = String(index);
    notes.setAttribute('placeholder', 'Jelaskan kondisi abnormal secara detail...');

    notesContainer.append(notesLabel, notes);
    row.append(headerDiv, notesContainer);

    // Fungsi pembantu untuk set status
    const setStatus = (val) => {
      row.dataset.status = val;
      row.classList.remove('status-normal', 'status-abnormal', 'error');
      row.querySelectorAll('.field-error').forEach(el => el.remove());

      if (val === 'Normal') {
        row.classList.add('status-normal');
      } else if (val === 'Abnormal') {
        row.classList.add('status-abnormal');
        setTimeout(() => notes.focus(), 100);
      }
    };

    // Event listener untuk tombol
    btnNormal.addEventListener('click', () => setStatus('Normal'));
    btnAbnormal.addEventListener('click', () => setStatus('Abnormal'));

    fragment.appendChild(row);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
}

function getValue(obj, possibleKeys) {
  for (const key of possibleKeys) {
    const value = obj[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function setInspectionType(type) {
  const label = INSPECTION_TYPE_LABELS[type] || "Jenis inspeksi tidak valid";
  const title = document.getElementById("inspectionDescription");
  const inputType = document.getElementById("jenis_inspeksi");
  if (title) title.textContent = label;
  if (inputType) inputType.value = label;
}

function loadPerusahaanOptions() {
  const select = document.getElementById("perusahaan");
  if (!select) return;
  select.innerHTML = '<option value="">Pilih Perusahaan</option>';
  const list = [...new Set(masterKaryawan.map(item => item["PERUSAHAAN"]).filter(Boolean))].sort();
  list.forEach(item => select.add(new Option(item, item)));
}

function populatePelaporOptions() {
  loadPerusahaanOptions();

  const { user, employee } = getCurrentEmployeeFromProfile();
  if (!user) return;

  const perusahaan = getEmployeeValue(employee || {}, ["PERUSAHAAN"]) || user.perusahaan || "";
  const subcont = getEmployeeValue(employee || {}, [
    "SUBCONT",
    "PERUSAHAAN SUBCONT(1)",
    "SUBCONT1"
  ]) || user.subcont || "";
  const nama = getEmployeeValue(employee || {}, ["NAMA"]) || user.nama || "";

  setSelectValue("perusahaan", perusahaan);
  loadSubcontOptions(true);
  setSelectValue("subcont1", subcont);
  loadNamaOptions(true);
  setSelectValue("nama", nama);

  document.getElementById("nik").value = getEmployeeValue(employee || {}, ["NIK"]) || user.nik || "";
  document.getElementById("jabatan").value =
    getEmployeeValue(employee || {}, ["JABATAN"]) || user.jabatan || "";
  document.getElementById("departemen").value =
    getEmployeeValue(employee || {}, ["DEPARTEMEN"]) || user.departemen || "";
  document.getElementById("no_whatsapp").value =
    getEmployeeValue(employee || {}, ["NO WHATSAPP", "NO_WHATSAPP"]) || user.no_whatsapp || "";

  ["nik", "jabatan", "departemen", "no_whatsapp"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.readOnly = true;
  });
  ["perusahaan", "subcont1", "nama"].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.disabled = true;
  });
}

function loadSubcontOptions(skipClear = false) {
  const perusahaan = document.getElementById("perusahaan").value;
  const select = document.getElementById("subcont1");
  select.innerHTML = '<option value="">Pilih Subcont</option>';
  if (!skipClear) {
    clearAutoFill();
    resetNamaDropdown();
  }
  if (!perusahaan) return;
  const list = [...new Set(
    masterKaryawan.filter(item => item["PERUSAHAAN"] === perusahaan)
      .map(item => item["SUBCONT"]).filter(Boolean)
  )].sort();
  list.forEach(item => select.add(new Option(item, item)));
}

function loadNamaOptions(skipClear = false) {
  const perusahaan = document.getElementById("perusahaan").value;
  const subcont = document.getElementById("subcont1").value;
  const select = document.getElementById("nama");
  select.innerHTML = '<option value="">Pilih Nama</option>';
  if (!skipClear) {
    clearAutoFill();
  }
  if (!perusahaan || !subcont) return;
  const list = [...new Set(
    masterKaryawan.filter(item => item["PERUSAHAAN"] === perusahaan && item["SUBCONT"] === subcont)
      .map(item => item["NAMA"]).filter(Boolean)
  )].sort();
  list.forEach(item => select.add(new Option(item, item)));
}

function isManualPelaporMode() {
  return false;
}

function normalizeNik(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function getCurrentEmployeeFromProfile() {
  const user = getCurrentUser();
  if (!user) return { user, employee: null };

  const profileNik = normalizeNik(user.nik);
  let employee = masterKaryawan.find(item => normalizeNik(item?.["NIK"]) === profileNik) || null;

  if (!employee) {
    const userNama = String(user.nama ?? "").trim();
    const userPerusahaan = String(user.perusahaan ?? "").trim();
    const userSubcont = String(user.subcont ?? "").trim();

    if (userNama && userPerusahaan && userSubcont) {
      employee = masterKaryawan.find(item => {
        return (
          String(item?.["NAMA"] ?? "").trim() === userNama &&
          String(item?.["PERUSAHAAN"] ?? "").trim() === userPerusahaan &&
          String(item?.["SUBCONT"] ?? "").trim() === userSubcont
        );
      }) || null;
    }
  }

  return { user, employee };
}

function renderAutofillProfileDebug({ user, employee }) {
  const el = document.getElementById("autofillProfileDebug");
  if (!el) return;

  const userNik = user?.nik ?? "";
  const userNama = user?.nama ?? "";
  const userPerusahaan = user?.perusahaan ?? "";
  const userSubcont = user?.subcont ?? "";

  const nik = employee?.["NIK"] ?? userNik ?? "";
  const nama = employee?.["NAMA"] ?? userNama ?? "";
  const perusahaan = employee?.["PERUSAHAAN"] ?? userPerusahaan ?? "";
  const subcont = employee?.["SUBCONT"] ?? userSubcont ?? "";
  const jabatan = employee?.["JABATAN"] ?? user?.jabatan ?? "";
  const departemen = employee?.["DEPARTEMEN"] ?? user?.departemen ?? "";
  const wa = employee?.["NO WHATSAPP"] ?? user?.no_whatsapp ?? "";

  const escape = (value) => {
    return String(value ?? "").replace(/[&<>"']/g, (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[c]
    );
  };

  el.innerHTML = `
    <div class="autofill-profile-debug">
      <div class="autofill-profile-debug-title">Profil yang dipakai untuk autofill</div>
      <div class="autofill-profile-debug-grid">
        <div><strong>NIK (user)</strong><div>${escape(userNik) || "-"}</div></div>
        <div><strong>NIK (master)</strong><div>${escape(employee?.["NIK"] ?? "") || "-"}</div></div>
        <div><strong>Nama</strong><div>${escape(nama) || "-"}</div></div>
        <div><strong>Perusahaan</strong><div>${escape(perusahaan) || "-"}</div></div>
        <div><strong>Subcont</strong><div>${escape(subcont) || "-"}</div></div>
        <div><strong>Jabatan</strong><div>${escape(jabatan) || "-"}</div></div>
        <div><strong>Departemen</strong><div>${escape(departemen) || "-"}</div></div>
        <div><strong>No WA</strong><div>${escape(wa) || "-"}</div></div>
      </div>
      <div class="autofill-profile-debug-status">
        Status masterKaryawan match: <strong>${employee ? "DITEMUKAN" : "TIDAK DITEMUKAN"}</strong>
      </div>
    </div>
  `;
}

function getPelaporValue(selectId, manualId) {
  if (isManualPelaporMode()) {
    return document.getElementById(manualId)?.value || "";
  }
  return document.getElementById(selectId)?.value || "";
}

function getEmployeeValue(employee, keys) {
  return getValue(employee || {}, keys);
}

function setSelectValue(selectId, value) {
  const select = document.getElementById(selectId);
  if (!select || !value) return false;
  const normalizedValue = String(value).trim().toLowerCase();
  const option = [...select.options].find(item =>
    String(item.value).trim().toLowerCase() === normalizedValue
  );
  if (!option) select.add(new Option(value, value));
  select.value = option ? option.value : value;
  return true;
}

function toggleManualPelaporMode() {}

function autoFillData() {
  if (isManualPelaporMode()) return;
  const perusahaan = document.getElementById("perusahaan").value;
  const subcont = document.getElementById("subcont1").value;
  const nama = document.getElementById("nama").value;
  const selected = masterKaryawan.find(item =>
    item["PERUSAHAAN"] === perusahaan && item["SUBCONT"] === subcont && item["NAMA"] === nama
  );
  if (!selected) {
    ["nik", "jabatan", "departemen", "no_whatsapp"].forEach(id => {
      const field = document.getElementById(id);
      if (field) field.value = "";
    });
    return;
  }
  document.getElementById("nik").value = selected["NIK"] || "";
  document.getElementById("jabatan").value = selected["JABATAN"] || "";
  document.getElementById("departemen").value = selected["DEPARTEMEN"] || "";
  document.getElementById("no_whatsapp").value = selected["NO WHATSAPP"] || "";
}

function clearAutoFill() {
  ["nik", "jabatan", "departemen", "no_whatsapp"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function resetNamaDropdown() {
  const select = document.getElementById("nama");
  if (!select) return;
  select.innerHTML = '<option value="">Pilih Nama</option>';
}

function loadLokasiOptions() {
  const select = document.getElementById("lokasi_inspeksi");
  if (!select) return;
  select.innerHTML = '<option value="">Pilih Lokasi</option>';
  const list = [...new Set(masterLokasi.map(item => getValue(item, [Object.keys(item)[0]])).filter(Boolean))].sort();
  list.forEach(item => select.add(new Option(item, item)));
}

function validateRequiredFields(fieldIds) {
  let isValid = true;
  let firstInvalid = null;
  hideAlert();
  clearFieldErrors();
  fieldIds.forEach(id => {
    const field = document.getElementById(id);
    if (!field) return;
    const value = (field.value || "").trim();
    if (!value) {
      isValid = false;
      if (!firstInvalid) firstInvalid = field;
      addFieldError(field);
      const formGroup = field.closest(".form-group");
      if (formGroup) {
        const error = document.createElement("div");
        error.className = "field-error";
        error.textContent = "Field ini wajib diisi.";
        formGroup.appendChild(error);
      }
    }
  });
  if (!isValid && firstInvalid) {
    showAlert();
    firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => firstInvalid.focus?.(), 400);
  }
  return isValid;
}

function addFieldError(field) {
  field.classList.add("error");
}

function clearFieldErrors() {
  document.querySelectorAll(".error").forEach(el => el.classList.remove("error"));
  document.querySelectorAll(".field-error").forEach(el => el.remove());
}

function showAlert() {
  const alertBox = document.getElementById("alertError");
  if (alertBox) alertBox.style.display = "block";
}

function hideAlert() {
  const alertBox = document.getElementById("alertError");
  if (alertBox) alertBox.style.display = "none";
}

function getFormData() {
  const params = getQueryParams();
  const type = (params.type || "").toUpperCase();
  
  const checklistValues = [];
  const temuan_fields = {};
  const temuanLines = [];

  (inspectionChecklist || []).forEach((item, index) => {
    const row = document.querySelector(`.inspection-checklist-item[data-checklist-index="${index}"]`);
    const notes = document.querySelector(`textarea[data-checklist-index="${index}"]`);
    const status = row ? (row.dataset.status || "") : "";
    const noteText = notes ? notes.value.trim() : "";
    
    checklistValues.push({
      index,
      item,
      status,
      notes: noteText
    });

    // Di spreadsheet, kolom checklist cukup "Normal" atau "Abnormal"
    temuan_fields[item] = status;

    // Kumpulkan item abnormal untuk kolom Temuan Inspeksi
    if (status === "Abnormal" && noteText) {
      temuanLines.push(`${item} : ${noteText}`);
    }
  });

  // Auto-generate isi kolom Temuan Inspeksi dari item abnormal
  const temuanInspeksiAuto = temuanLines.join("\n");

  return {
    inspection_code: type,
    jenis_inspeksi: INSPECTION_TYPE_LABELS[type] || type,
    perusahaan: getPelaporValue("perusahaan", "manual_perusahaan"),
    subcont1: getPelaporValue("subcont1", "manual_subcont1"),
    nama: getPelaporValue("nama", "manual_nama"),
    nik: getPelaporValue("nik", "manual_nik"),
    jabatan: getPelaporValue("jabatan", "manual_jabatan"),
    departemen: getPelaporValue("departemen", "manual_departemen"),
    no_whatsapp: getPelaporValue("no_whatsapp", "manual_no_whatsapp"),
    tanggal_inspeksi: document.getElementById("tanggal_inspeksi")?.value || "",
    shift_inspeksi: document.getElementById("shift_inspeksi")?.value || "",
    lokasi_inspeksi: document.getElementById("lokasi_inspeksi")?.value || "",
    detail_lokasi_inspeksi: document.getElementById("detail_lokasi_inspeksi")?.value || "",
    temuan_inspeksi: temuanInspeksiAuto,
    inspection_checklist: JSON.stringify(checklistValues),
    temuan_fields: temuan_fields,
    upload_foto_inspeksi: document.getElementById("upload_foto_inspeksi")?.dataset?.base64 || "",
    tindakan_usulan_pic: document.getElementById("tindakan_usulan_pic")?.value || "",
    perusahaan_pic: document.getElementById("perusahaan_pic")?.value || "",
    subcont2: document.getElementById("subcont2")?.value || "",
    nama_pic: document.getElementById("nama_pic")?.value || "",
    jabatan_pic: document.getElementById("jabatan_pic")?.value || "",
    departemen_pic: document.getElementById("departemen_pic")?.value || "",
    no_whatsapp_pic: document.getElementById("no_whatsapp_pic")?.value || "",
    nik_pic: (function() {
      const perusahaanPic = document.getElementById("perusahaan_pic")?.value || "";
      const subcontPic = document.getElementById("subcont2")?.value || "";
      const namaPic = document.getElementById("nama_pic")?.value || "";
      return masterKaryawan.find(item =>
        item["PERUSAHAAN"] === perusahaanPic &&
        item["SUBCONT"] === subcontPic &&
        item["NAMA"] === namaPic
      )?.["NIK"] || "";
    })(),
    batas_waktu: document.getElementById("batas_waktu")?.value || "",
    pernyataan: document.getElementById("pernyataan")?.checked ? "Ya" : "Tidak",
    tanda_tangan: signaturePad && !signaturePad.isEmpty()
      ? signaturePad.toDataURL("image/png")
      : ""
  };
}

function showStep(step) {
  currentStep = Math.min(Math.max(step, 1), TOTAL_STEPS);
  document.querySelectorAll(".form-step").forEach(stepEl => {
    stepEl.classList.toggle("active", Number(stepEl.id.replace("step", "")) === currentStep);
  });
  updateStepIndicator();
  if (currentStep === 5) {
    requestAnimationFrame(resizeSignaturePad);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateStepIndicator() {
  document.querySelectorAll("#inspectionStepIndicator .step").forEach(stepEl => {
    const step = Number(stepEl.dataset.step);
    stepEl.classList.toggle("active", step === currentStep);
    stepEl.classList.toggle("completed", step < currentStep);
  });
}

function validateStep1() {
  return validateRequiredFields([
    "perusahaan",
    "subcont1",
    "nama",
    "nik",
    "jabatan",
    "departemen",
    "no_whatsapp"
  ]);
}

function validateStep2() {
  return validateRequiredFields(["tanggal_inspeksi", "shift_inspeksi", "lokasi_inspeksi"]);
}

function validateStep3() {
  const photoField = document.getElementById("upload_foto_inspeksi");
  const invalidItems = [];

  // Reset styles
  document.querySelectorAll('.inspection-checklist-item').forEach(row => {
    row.classList.remove('error');
    row.querySelectorAll('.field-error').forEach(el => el.remove());
  });
  clearFieldErrors();

  if (photoField && !photoField.dataset?.base64) {
    invalidItems.push(photoField);
    const group = photoField.closest(".form-group");
    if (group) {
      addFieldError(photoField);
      const error = document.createElement("div");
      error.className = "field-error";
      error.textContent = "Foto inspeksi wajib diupload.";
      group.appendChild(error);
    }
  }

  (inspectionChecklist || []).forEach((item, index) => {
    const row = document.querySelector(`.inspection-checklist-item[data-checklist-index="${index}"]`);
    const notes = document.querySelector(`textarea[data-checklist-index="${index}"]`);
    if (!row) return;
    
    const status = row.dataset.status || "";
    if (!status) {
      invalidItems.push(row);
      row.classList.add('error');
      const error = document.createElement('div');
      error.className = 'field-error';
      error.textContent = 'Pilih Normal atau Abnormal.';
      row.appendChild(error);
    } else if (status === 'Abnormal') {
      if (!notes || !notes.value.trim()) {
        invalidItems.push(notes || row);
        row.classList.add('error');
        const error = document.createElement('div');
        error.className = 'field-error';
        error.textContent = 'Isi catatan temuan untuk item abnormal.';
        row.appendChild(error);
      }
    }
  });

  if (invalidItems.length) {
    const firstInvalid = invalidItems[0];
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try { firstInvalid.focus?.(); } catch (err) {}
    showAlert();
    return false;
  }

  hideAlert();
  return true;
}

function validateStep4() {
  return validateRequiredFields(["perusahaan_pic", "subcont2", "nama_pic", "batas_waktu"]);
}

function validateStep5() {
  hideAlert();
  clearFieldErrors();
  const statement = document.getElementById("pernyataan");
  const canvas = document.getElementById("signaturePad");
  let firstInvalid = null;
  let valid = true;

  if (!statement?.checked) {
    valid = false;
    const group = statement?.closest(".form-group");
    group?.classList.add("error");
    if (group) {
      const error = document.createElement("div");
      error.className = "field-error";
      error.textContent = "Pernyataan wajib disetujui.";
      group.appendChild(error);
    }
    firstInvalid = group || statement;
  }

  if (!signaturePad || signaturePad.isEmpty()) {
    valid = false;
    canvas?.classList.add("error");
    const group = canvas?.closest(".form-group");
    if (group) {
      const error = document.createElement("div");
      error.className = "field-error";
      error.textContent = "Tanda tangan wajib diisi.";
      group.appendChild(error);
    }
    if (!firstInvalid) firstInvalid = canvas;
  }

  if (!valid && firstInvalid) {
    showAlert();
    firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return valid;
}

async function submitForm() {
  hideAlert();
  if (!validateStep1() || !validateStep2() || !validateStep3() || !validateStep4() || !validateStep5()) {
    return;
  }
  const data = getFormData();
  const btn = document.getElementById("btnSubmit");
  if (btn) btn.disabled = true;

  // Intercept explicitly offline state
  if (!navigator.onLine) {
    if (typeof OneSapOfflineSync !== "undefined") {
      try {
        await OneSapOfflineSync.queueInspectionReport(data);
        alert("Koneksi internet tidak tersedia.\n\nInspeksi Anda disimpan secara lokal (antrean offline) dan akan dikirim otomatis ketika perangkat mendapat sinyal.");
        clearInspectionDraft();
        window.location.href = "inspection.html";
        return;
      } catch (err) {
        console.error("Failed to queue offline:", err);
      }
    }
  }

  try {
    let response;
    try {
      response = await fetch(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "submitInspectionReport", data })
      });
    } catch (fetchErr) {
      // Intercept network failure (connection drop) during fetch
      if (typeof OneSapOfflineSync !== "undefined") {
        await OneSapOfflineSync.queueInspectionReport(data);
        alert("Gagal terhubung ke server.\n\nInspeksi Anda telah disimpan secara lokal (antrean offline) dan akan disinkronkan otomatis saat jaringan kembali normal.");
        clearInspectionDraft();
        window.location.href = "inspection.html";
        return;
      }
      throw fetchErr;
    }

    const text = await response.text();
    const result = JSON.parse(text);
    if (result.status === "success") {
      alert("Inspeksi berhasil disimpan!\n\nID: " + (result.id || "-"));
      clearInspectionDraft();
      window.location.href = "inspection.html";
    } else {
      throw new Error(result.message || "Gagal menyimpan inspeksi.");
    }
  } catch (error) {
    alert("Terjadi kesalahan saat submit inspeksi:\n\n" + error.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function setupPhotoPreview() {
  const input = document.getElementById("upload_foto_inspeksi");
  if (!input) return;
  input.addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("File harus berupa gambar.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      event.target.dataset.base64 = e.target.result;
      const preview = document.getElementById("previewFotoInspeksi");
      const img = document.getElementById("imgPreviewInspeksi");
      if (preview && img) {
        img.src = e.target.result;
        preview.style.display = "block";
      }
    };
    reader.readAsDataURL(file);
  });
}

function initializeSignaturePad() {
  const canvas = document.getElementById("signaturePad");
  if (!canvas || typeof SignaturePad === "undefined") return;
  signaturePad = new SignaturePad(canvas, { minWidth: 1, maxWidth: 3 });
  document.getElementById("btnClearSignature")?.addEventListener("click", () => {
    signaturePad.clear();
    canvas.classList.remove("error");
  });
}

function resizeSignaturePad() {
  const canvas = document.getElementById("signaturePad");
  if (!canvas || !signaturePad || !canvas.offsetWidth || canvas.dataset.sized === "1") return;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = 240 * ratio;
  canvas.getContext("2d").scale(ratio, ratio);
  canvas.dataset.sized = "1";
  signaturePad.clear();
}

function populatePicOptions() {
  loadPerusahaanPicOptions();
  document.getElementById("perusahaan_pic")?.addEventListener("change", loadSubcontPicOptions);
  document.getElementById("subcont2")?.addEventListener("change", loadNamaPicOptions);
  document.getElementById("nama_pic")?.addEventListener("change", autoFillDataPic);
}

function loadPerusahaanPicOptions() {
  const select = document.getElementById("perusahaan_pic");
  if (!select) return;
  select.innerHTML = '<option value="">Pilih Perusahaan PIC</option>';
  const list = [...new Set(masterKaryawan.map(item => item["PERUSAHAAN"]).filter(Boolean))].sort();
  list.forEach(item => select.add(new Option(item, item)));
}

function loadSubcontPicOptions() {
  const perusahaan = document.getElementById("perusahaan_pic").value;
  const select = document.getElementById("subcont2");
  select.innerHTML = '<option value="">Pilih Subcont PIC</option>';
  clearAutoFillPic();
  resetNamaPicDropdown();
  if (!perusahaan) return;
  const list = [...new Set(
    masterKaryawan.filter(item => item["PERUSAHAAN"] === perusahaan)
      .map(item => item["SUBCONT"]).filter(Boolean)
  )].sort();
  list.forEach(item => select.add(new Option(item, item)));
}

function loadNamaPicOptions() {
  const perusahaan = document.getElementById("perusahaan_pic").value;
  const subcont = document.getElementById("subcont2").value;
  const select = document.getElementById("nama_pic");
  select.innerHTML = '<option value="">Pilih Nama PIC</option>';
  clearAutoFillPic();
  if (!perusahaan || !subcont) return;
  const list = [...new Set(
    masterKaryawan.filter(item => item["PERUSAHAAN"] === perusahaan && item["SUBCONT"] === subcont)
      .map(item => item["NAMA"]).filter(Boolean)
  )].sort();
  list.forEach(item => {
    const option = new Option(item, item);
    const employee = masterKaryawan.find(row =>
      row["PERUSAHAAN"] === perusahaan &&
      row["SUBCONT"] === subcont &&
      row["NAMA"] === item
    );
    option.dataset.nik = employee?.["NIK"] || "";
    select.add(option);
  });
}

function autoFillDataPic() {
  const perusahaan = document.getElementById("perusahaan_pic").value;
  const subcont = document.getElementById("subcont2").value;
  const nama = document.getElementById("nama_pic").value;
  const selected = masterKaryawan.find(item =>
    item["PERUSAHAAN"] === perusahaan && item["SUBCONT"] === subcont && item["NAMA"] === nama
  );
  if (!selected) return;
  document.getElementById("jabatan_pic").value = selected["JABATAN"] || "";
  document.getElementById("departemen_pic").value = selected["DEPARTEMEN"] || "";
  document.getElementById("no_whatsapp_pic").value = selected["NO WHATSAPP"] || "";
}

function clearAutoFillPic() {
  ["jabatan_pic", "departemen_pic", "no_whatsapp_pic"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function resetNamaPicDropdown() {
  const select = document.getElementById("nama_pic");
  if (!select) return;
  select.innerHTML = '<option value="">Pilih Nama PIC</option>';
}

// ========================================
// AUTO-SAVE DRAFT (INSPECTION)
// ========================================
function getInspectionDraftKey() {
  const params = getQueryParams();
  const type = (params.type || "").toUpperCase();
  return `inspection_draft_${type}`;
}

function saveInspectionDraft() {
  const key = getInspectionDraftKey();
  if (!key || key === 'inspection_draft_') return;
  
  const data = {};
  // Save all text inputs, selects, textareas
  document.querySelectorAll('#step1 input, #step1 select, #step2 input, #step2 select, #step2 textarea, #step3 textarea, #step4 input, #step4 select, #step4 textarea').forEach(el => {
    if (el.id && el.type !== 'file') {
      data[el.id] = el.value || '';
    }
  });
  
  // Save checklist statuses and notes
  const checklistData = [];
  document.querySelectorAll('.inspection-checklist-item').forEach(row => {
    const index = row.dataset.checklistIndex;
    const status = row.dataset.status || '';
    const notes = row.querySelector('textarea');
    checklistData.push({
      index,
      status,
      notes: notes ? notes.value : ''
    });
  });
  data._checklistData = checklistData;
  
  // Save photo if present
  const photoInput = document.getElementById('upload_foto_inspeksi');
  if (photoInput && photoInput.dataset.base64) {
    data.upload_foto_inspeksi_base64 = photoInput.dataset.base64;
  }
  
  // Save checkbox and signature
  const pernyataan = document.getElementById('pernyataan');
  if (pernyataan) data._pernyataan = pernyataan.checked;
  
  if (signaturePad && !signaturePad.isEmpty()) {
    data._signature = signaturePad.toDataURL('image/png');
  }
  
  // Meta info
  data._currentStep = currentStep;
  data._savedAt = new Date().toISOString();
  
  localStorage.setItem(key, JSON.stringify(data));
  showInspectionAutoSaveIndicator();
}

function loadInspectionDraft() {
  const key = getInspectionDraftKey();
  const saved = localStorage.getItem(key);
  if (!saved) return false;
  
  try {
    const data = JSON.parse(saved);
    
    // Restore text inputs, selects, textareas
    Object.keys(data).forEach(k => {
      if (k.startsWith('_') || k === 'upload_foto_inspeksi_base64') return;
      const el = document.getElementById(k);
      if (el && el.type !== 'file') {
        el.value = data[k] || '';
      }
    });
    
    // Restore checklist statuses
    if (data._checklistData && Array.isArray(data._checklistData)) {
      data._checklistData.forEach(item => {
        const row = document.querySelector(`.inspection-checklist-item[data-checklist-index="${item.index}"]`);
        if (row && item.status) {
          row.dataset.status = item.status;
          row.classList.remove('status-normal', 'status-abnormal');
          if (item.status === 'Normal') row.classList.add('status-normal');
          else if (item.status === 'Abnormal') row.classList.add('status-abnormal');
        }
        const notes = document.querySelector(`textarea[data-checklist-index="${item.index}"]`);
        if (notes && item.notes) notes.value = item.notes;
      });
    }
    
    // Restore photo
    if (data.upload_foto_inspeksi_base64) {
      const photoInput = document.getElementById('upload_foto_inspeksi');
      const preview = document.getElementById('previewFotoInspeksi');
      const img = document.getElementById('imgPreviewInspeksi');
      if (photoInput && preview && img) {
        photoInput.dataset.base64 = data.upload_foto_inspeksi_base64;
        img.src = data.upload_foto_inspeksi_base64;
        preview.style.display = 'block';
      }
    }
    
    // Restore checkbox
    if (data._pernyataan) {
      const pernyataan = document.getElementById('pernyataan');
      if (pernyataan) pernyataan.checked = true;
    }
    
    // Restore signature
    if (data._signature && signaturePad) {
      const img = new Image();
      img.onload = () => signaturePad.fromDataURL(data._signature);
      img.src = data._signature;
    }
    
    // Restore step
    if (data._currentStep && data._currentStep > 1) {
      showStep(data._currentStep);
    }
    
    return true;
  } catch (e) {
    console.error('Failed to load inspection draft:', e);
    return false;
  }
}

function clearInspectionDraft() {
  const key = getInspectionDraftKey();
  localStorage.removeItem(key);
}

function showInspectionAutoSaveIndicator() {
  const indicator = document.getElementById('autoSaveIndicator');
  if (indicator) {
    indicator.classList.add('show');
    setTimeout(() => indicator.classList.remove('show'), 2000);
  }
}

function setupInspectionAutosave() {
  const form = document.querySelector('.card');
  if (!form) return;
  
  form.addEventListener('input', () => {
    clearTimeout(inspectionAutosaveTimer);
    inspectionAutosaveTimer = setTimeout(saveInspectionDraft, INSPECTION_AUTOSAVE_DELAY);
  });
  
  form.addEventListener('change', () => {
    clearTimeout(inspectionAutosaveTimer);
    inspectionAutosaveTimer = setTimeout(saveInspectionDraft, INSPECTION_AUTOSAVE_DELAY);
  });
  
  // Also save when clicking checklist buttons
  form.addEventListener('click', (e) => {
    if (e.target.closest('.checklist-option-btn')) {
      clearTimeout(inspectionAutosaveTimer);
      inspectionAutosaveTimer = setTimeout(saveInspectionDraft, INSPECTION_AUTOSAVE_DELAY);
    }
  });
}

function initializeInspectionForm(type) {
   setInspectionType(type);
   loadPerusahaanOptions();
   loadLokasiOptions();
   populatePicOptions();
   populatePelaporOptions();
   initializeSignaturePad();
   const tanggalInput = document.getElementById("tanggal_inspeksi");
   if (tanggalInput) tanggalInput.value = new Date().toISOString().split("T")[0];
  document.getElementById("perusahaan")?.addEventListener("change", () => {
    loadSubcontOptions();
    toggleManualPelaporMode();
  });
  document.getElementById("subcont1")?.addEventListener("change", () => {
    loadNamaOptions();
    toggleManualPelaporMode();
  });
  document.getElementById("nama")?.addEventListener("change", () => {
    autoFillData();
    toggleManualPelaporMode();
  });
  document.getElementById("manualDataPelapor")?.addEventListener("change", toggleManualPelaporMode);
  document.getElementById("btnNext1")?.addEventListener("click", () => { if (validateStep1()) showStep(2); });
  document.getElementById("btnPrev2")?.addEventListener("click", () => showStep(1));
  document.getElementById("btnNext2")?.addEventListener("click", () => { if (validateStep2()) showStep(3); });
  document.getElementById("btnPrev3")?.addEventListener("click", () => showStep(2));
  document.getElementById("btnNext3")?.addEventListener("click", () => { if (validateStep3()) showStep(4); });
  document.getElementById("btnPrev4")?.addEventListener("click", () => showStep(3));
  document.getElementById("btnNext4")?.addEventListener("click", () => { if (validateStep4()) showStep(5); });
  document.getElementById("btnPrev5")?.addEventListener("click", () => showStep(4));
  document.getElementById("btnSubmit")?.addEventListener("click", () => {
    if (validateStep5()) submitForm();
  });
  setupPhotoPreview();
  updateStepIndicator();
  
  // Auto-save: load draft if exists, then setup autosave
  setTimeout(() => {
    loadInspectionDraft();
    setupInspectionAutosave();
  }, 500);
}

async function initPage() {
  try {
    const params = getQueryParams();
    const type = (params.type || "").toUpperCase();
    await Promise.all([loadMasterKaryawan(), loadMasterLokasi(), loadInspectionChecklist()]);
    initializeInspectionForm(type);
  } catch (error) {
    console.error("Gagal memuat data inspeksi:", error);
    showAlert();
    const alertBox = document.getElementById("alertError");
    if (alertBox) alertBox.textContent = "Gagal memuat data pendukung inspeksi.";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    requireLogin();
    renderUserProfile();
    initNotificationBell();
    refreshNotifications().catch(console.error);
  } catch (e) {
    console.error('inspection-form early init error:', e);
  }

  initPage().catch(function(err) {
    console.error('inspection-form initPage error:', err);
    showAlert();
    const alertBox = document.getElementById('alertError');
    if (alertBox) alertBox.textContent = 'Gagal memuat data form inspeksi. ' + ((err && err.message) || err);
  });
});
