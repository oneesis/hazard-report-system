// HAZARD REPORT ONE-SAP

const BASE_URL = "/api";

let masterKaryawan = [];
let masterLokasi = [];
let masterTemuan = [];

let namaChoices;
let lokasiChoices;
let ketidaksesuaianChoices;
let subKetidaksesuaianChoices;
let namaPicChoices;
let signaturePad;
let autosaveTimer;
let selectedBahayaPhotos = [];

let currentStep = 1;

// ========================================
// FETCH DATA
// ========================================
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
    window.masterKaryawan = masterKaryawan;
  } catch (err) {
    console.error('Gagal load masterKaryawan:', err);
    masterKaryawan = [];
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
        window.masterKaryawan = masterKaryawan;
      }
    } catch (e) {
      console.error('Fallback masterKaryawan gagal:', e);
    }
  }
}

async function loadMasterLokasi() {
  try {
    const data = await fetchJSON(`${BASE_URL}?action=masterLokasi`);
    masterLokasi = Array.isArray(data) ? data : (data.data || []);
    window.masterLokasi = masterLokasi;
  } catch (err) {
    console.error('Gagal load masterLokasi:', err);
    masterLokasi = [];
    window.masterLokasi = masterLokasi;
  }
}

async function loadMasterTemuan() {
  try {
    const data = await fetchJSON(`${BASE_URL}?action=masterTemuan`);
    masterTemuan = Array.isArray(data) ? data : (data.data || []);
    window.masterTemuan = masterTemuan;
  } catch (err) {
    console.error('Gagal load masterTemuan:', err);
    masterTemuan = [];
    window.masterTemuan = masterTemuan;
  }
}

// ========================================
// HELPER - GET VALUE FROM VARIOUS HEADERS
// ========================================
function getValue(obj, possibleKeys) {
  for (const key of possibleKeys) {
    const value = obj[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

// ========================================
// STEP 1 - DATA PELAPOR
// ========================================
function loadPerusahaanOptions() {
  const select = document.getElementById("perusahaan");
  if (!select) return;

  select.innerHTML = '<option value="">Pilih Perusahaan</option>';

  const list = [...new Set(masterKaryawan.map(item => item["PERUSAHAAN"]).filter(Boolean))].sort();
  list.forEach(item => select.add(new Option(item, item)));
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

  if (!perusahaan || !subcont) {
    initializeNamaChoices();
    return;
  }

  const list = [...new Set(
    masterKaryawan.filter(item => item["PERUSAHAAN"] === perusahaan && item["SUBCONT"] === subcont)
      .map(item => item["NAMA"]).filter(Boolean)
  )].sort();
  list.forEach(item => select.add(new Option(item, item)));

  initializeNamaChoices();
}

function setSection1Editable(editable) {
  ["perusahaan", "subcont1", "nama"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !editable;
  });
}

function autoFillData() {
  const perusahaan = document.getElementById("perusahaan").value;
  const subcont = document.getElementById("subcont1").value;
  const nama = document.getElementById("nama").value;

  const selected = masterKaryawan.find(
    item => item["PERUSAHAAN"] === perusahaan && item["SUBCONT"] === subcont && item["NAMA"] === nama
  );

  if (!selected) return;

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
  initializeNamaChoices();
}

// ========================================
// STEP 2 - DETAIL KEJADIAN
// ========================================
function loadLokasiOptions() {
  const select = document.getElementById("lokasi_bahaya");
  if (!select) return;

  select.innerHTML = '<option value="">Pilih Lokasi Bahaya</option>';

  const list = [...new Set(
    masterLokasi.map(item => {
      const key = Object.keys(item)[0];
      return item[key];
    }).filter(Boolean)
  )].sort();
  list.forEach(item => select.add(new Option(item, item)));
}

// ========================================
// STEP 3 - IDENTIFIKASI BAHAYA
// ========================================
function loadKetidaksesuaianOptions() {
  const select = document.getElementById("ketidaksesuaian_bahaya");
  if (!select) return;

  select.innerHTML = '<option value="">Pilih Ketidaksesuaian Bahaya</option>';

  const list = [...new Set(
    masterTemuan.map(item => getValue(item, ["KETIDAKSESUAIAN", "KETIDAKSESUAIAN BAHAYA", "KETIDAKSESUAIAN_BAHAYA"])).filter(Boolean)
  )].sort();
  list.forEach(item => select.add(new Option(item, item)));

  initializeKetidaksesuaianChoices();
}

function loadSubKetidaksesuaianOptions() {
  const ketidaksesuaian = document.getElementById("ketidaksesuaian_bahaya").value;
  const select = document.getElementById("sub_ketidaksesuaian");
  const risiko = document.getElementById("tingkat_risiko");

  select.innerHTML = '<option value="">Pilih Sub Ketidaksesuaian</option>';
  if (risiko) risiko.value = "";

  if (!ketidaksesuaian) {
    initializeSubKetidaksesuaianChoices();
    return;
  }

  const list = [...new Set(
    masterTemuan.filter(item => {
      const kategori = item["KETIDAKSESUAIAN"] || item["KETIDAKSESUAIAN BAHAYA"];
      return kategori === ketidaksesuaian;
    }).map(item => item["SUB KETIDAKSESUAIAN"]).filter(Boolean)
  )].sort();
  list.forEach(item => select.add(new Option(item, item)));

  initializeSubKetidaksesuaianChoices();
}

function autoFillRisiko() {
  const ketidaksesuaian = document.getElementById("ketidaksesuaian_bahaya").value;
  const sub = document.getElementById("sub_ketidaksesuaian").value;

  const selected = masterTemuan.find(item => {
    const kategori = item["KETIDAKSESUAIAN"] || item["KETIDAKSESUAIAN BAHAYA"];
    return kategori === ketidaksesuaian && item["SUB KETIDAKSESUAIAN"] === sub;
  });

  if (!selected) return;

  document.getElementById("tingkat_risiko").value = selected["RESIKO"] || selected["TINGKAT RESIKO"] || "";
}

// ========================================
// STEP 5 - DATA PIC
// ========================================
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

  if (!perusahaan || !subcont) {
    initializeNamaPicChoices();
    return;
  }

  const list = [...new Set(
    masterKaryawan.filter(item => item["PERUSAHAAN"] === perusahaan && item["SUBCONT"] === subcont)
      .map(item => item["NAMA"]).filter(Boolean)
  )].sort();
  list.forEach(item => select.add(new Option(item, item)));

  initializeNamaPicChoices();
}

function autoFillDataPic() {
  const perusahaan = document.getElementById("perusahaan_pic").value;
  const subcont = document.getElementById("subcont2").value;
  const nama = document.getElementById("nama_pic").value;

  const selected = masterKaryawan.find(
    item => item["PERUSAHAAN"] === perusahaan && item["SUBCONT"] === subcont && item["NAMA"] === nama
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
  initializeNamaPicChoices();
}

// ========================================
// CHOICES.JS
// ========================================
function createChoices(selector, placeholder) {
  return new Choices(selector, {
    searchEnabled: true,
    itemSelectText: "",
    shouldSort: false,
    placeholder: true,
    placeholderValue: placeholder,
    noResultsText: "Data tidak ditemukan",
    noChoicesText: "Tidak ada data",
    searchFloor: 1
  });
}

function initializeNamaChoices() {
  if (namaChoices) namaChoices.destroy();
  namaChoices = createChoices("#nama", "Cari dan pilih nama");
}

function initializeLokasiChoices() {
  if (lokasiChoices) lokasiChoices.destroy();
  lokasiChoices = createChoices("#lokasi_bahaya", "Cari lokasi bahaya");
}

function initializeKetidaksesuaianChoices() {
  if (ketidaksesuaianChoices) ketidaksesuaianChoices.destroy();
  ketidaksesuaianChoices = createChoices("#ketidaksesuaian_bahaya", "Cari ketidaksesuaian");
}

function initializeSubKetidaksesuaianChoices() {
  if (subKetidaksesuaianChoices) subKetidaksesuaianChoices.destroy();
  subKetidaksesuaianChoices = createChoices("#sub_ketidaksesuaian", "Cari sub ketidaksesuaian");
}

function initializeNamaPicChoices() {
  if (namaPicChoices) namaPicChoices.destroy();
  namaPicChoices = createChoices("#nama_pic", "Cari dan pilih nama PIC");
}

function initializeSignaturePad() {
  const canvas = document.getElementById("signaturePad");
  if (!canvas) return;

  signaturePad = new SignaturePad(canvas, {
    minWidth: 1,
    maxWidth: 3
  });

  signaturePad.addEventListener("endStroke", () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveDraft, AUTOSAVE_DELAY);
  });

  document.getElementById("btnClearSignature")?.addEventListener("click", () => {
    signaturePad.clear();
    canvas.dataset.sized = "";
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveDraft, AUTOSAVE_DELAY);
  });
}

function resizeSignaturePad() {
  const canvas = document.getElementById("signaturePad");
  if (!canvas || !signaturePad || !canvas.offsetWidth) return;
  if (canvas.dataset.sized === "1") return;

  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const empty = signaturePad.isEmpty();
  let dataUrl = "";
  if (!empty) {
    dataUrl = signaturePad.toDataURL("image/png");
  }

  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = 220 * ratio;
  canvas.getContext("2d").scale(ratio, ratio);
  canvas.dataset.sized = "1";

  signaturePad.clear();
  if (!empty && dataUrl) {
    const img = new Image();
    img.onload = () => signaturePad.fromDataURL(dataUrl);
    img.src = dataUrl;
  }
}

// ========================================
// AUTO-SAVE DRAFT
// ========================================
const AUTOSAVE_KEY = "hazard_draft";
const AUTOSAVE_DELAY = 2000;

function saveDraft() {
  const data = getFormData();
  data._currentStep = currentStep;
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  showAutoSaveIndicator();
}

function loadDraft() {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (!saved) return;

  try {
    const data = JSON.parse(saved);
    
    // Restore basic inputs
    const basicKeys = [
      "perusahaan", "subcont1", "tanggal_kejadian", "shift_kejadian", 
      "detail_lokasi_bahaya", "deskripsi_bahaya", "tingkat_risiko", 
      "tindakan_langsung", "tindakan_usulan_pic", "perusahaan_pic",
      "subcont2", "batas_waktu", "no_whatsapp", "jabatan", "departemen", "nik",
      "jabatan_pic", "departemen_pic", "no_whatsapp_pic"
    ];
    
    basicKeys.forEach(key => {
      if (data[key] !== undefined) {
        const el = document.getElementById(key);
        if (el) {
          el.value = data[key];
        }
      }
    });

    if (data.pernyataan !== undefined) {
      const el = document.getElementById("pernyataan");
      if (el) el.checked = (data.pernyataan === "Ya");
    }

    // Restore dependent selects and choices.js
    if (data.perusahaan) {
      loadSubcontOptions(true);
      if (data.subcont1) {
        const subcontEl = document.getElementById("subcont1");
        if (subcontEl) subcontEl.value = data.subcont1;
        loadNamaOptions(true);
        if (data.nama) {
          const namaEl = document.getElementById("nama");
          if (namaEl) {
            namaEl.value = data.nama;
            if (namaChoices) {
              try {
                namaChoices.setChoiceByValue(data.nama);
              } catch(e) {}
            }
          }
          autoFillData();
        }
      }
    }

    if (data.lokasi_bahaya) {
      const el = document.getElementById("lokasi_bahaya");
      if (el) {
        el.value = data.lokasi_bahaya;
        if (lokasiChoices) {
          try {
            lokasiChoices.setChoiceByValue(data.lokasi_bahaya);
          } catch(e) {}
        }
      }
    }

    if (data.ketidaksesuaian_bahaya) {
      const el = document.getElementById("ketidaksesuaian_bahaya");
      if (el) {
        el.value = data.ketidaksesuaian_bahaya;
        if (ketidaksesuaianChoices) {
          try {
            ketidaksesuaianChoices.setChoiceByValue(data.ketidaksesuaian_bahaya);
          } catch(e) {}
        }
      }
      loadSubKetidaksesuaianOptions();
      
      if (data.sub_ketidaksesuaian) {
        const subEl = document.getElementById("sub_ketidaksesuaian");
        if (subEl) {
          subEl.value = data.sub_ketidaksesuaian;
          if (subKetidaksesuaianChoices) {
            try {
              subKetidaksesuaianChoices.setChoiceByValue(data.sub_ketidaksesuaian);
            } catch(e) {}
          }
        }
        autoFillRisiko();
      }
    }

    if (data.perusahaan_pic) {
      loadSubcontPicOptions();
      if (data.subcont2) {
        const sub2El = document.getElementById("subcont2");
        if (sub2El) sub2El.value = data.subcont2;
        loadNamaPicOptions();
        
        if (data.nama_pic) {
          const picEl = document.getElementById("nama_pic");
          if (picEl) {
            picEl.value = data.nama_pic;
            if (namaPicChoices) {
              try {
                namaPicChoices.setChoiceByValue(data.nama_pic);
              } catch(e) {}
            }
          }
          autoFillDataPic();
        }
      }
    }

    // Restore photos
    const fileInput = document.getElementById("upload_foto_bahaya");
    if (fileInput && data.upload_foto_bahaya) {
      try {
        if (data.upload_foto_bahaya.indexOf("[") === 0) {
          selectedBahayaPhotos = JSON.parse(data.upload_foto_bahaya);
        } else {
          selectedBahayaPhotos = [data.upload_foto_bahaya];
        }
      } catch (e) {
        selectedBahayaPhotos = [data.upload_foto_bahaya];
      }
      renderBahayaPhotosPreview();
    }

    // Restore signature
    if (data.tanda_tangan && signaturePad) {
      const img = new Image();
      img.onload = () => signaturePad.fromDataURL(data.tanda_tangan);
      img.src = data.tanda_tangan;
    }

    // Restore step
    if (data._currentStep && data._currentStep > 1) {
      showStep(data._currentStep);
    }
  } catch (e) {
    console.error("Failed to load draft:", e);
  }
}

function clearDraft() {
  localStorage.removeItem(AUTOSAVE_KEY);
  selectedBahayaPhotos = [];
  const preview = document.getElementById("previewFotoBahaya");
  if (preview) {
    preview.innerHTML = "";
    preview.style.display = "none";
  }
}

function showAutoSaveIndicator() {
  const indicator = document.getElementById("autoSaveIndicator");
  if (indicator) {
    indicator.classList.add("show");
    setTimeout(() => indicator.classList.remove("show"), 2000);
  }
}

// ========================================
// CHARACTER COUNTER
// ========================================
function setupCharCounter(textareaId, maxLength = 500) {
  const textarea = document.getElementById(textareaId);
  if (!textarea) return;

  const formGroup = textarea.closest(".form-group");
  if (!formGroup) return;

  const counter = document.createElement("div");
  counter.className = "char-counter";
  counter.textContent = `0/${maxLength}`;
  formGroup.appendChild(counter);

  textarea.addEventListener("input", () => {
    const length = textarea.value.length;
    counter.textContent = `${length}/${maxLength}`;
    counter.classList.toggle("warning", length > maxLength * 0.8 && length <= maxLength);
    counter.classList.toggle("danger", length > maxLength);
  });
}

// ========================================
// OFFLINE DETECTION
// ========================================
function initOfflineDetection() {
  const offlineEl = document.getElementById("offlineNotification");

  function updateOnlineStatus() {
    if (navigator.onLine) {
      if (offlineEl) offlineEl.classList.remove("show");
    } else {
      if (offlineEl) offlineEl.classList.add("show");
    }
  }

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();
}

// ========================================
// CONFIRMATION DIALOG
// ========================================
function showConfirmationDialog() {
  return new Promise((resolve) => {
    const dialog = document.getElementById("confirmationDialog");
    const overlay = document.getElementById("confirmationOverlay");
    if (!dialog || !overlay) {
      resolve(true);
      return;
    }

    dialog.classList.add("show");
    overlay.classList.add("show");

    const confirmBtn = document.getElementById("confirmSubmit");
    const cancelBtn = document.getElementById("cancelSubmit");

    const cleanup = () => {
      dialog.classList.remove("show");
      overlay.classList.remove("show");
      confirmBtn?.removeEventListener("click", onConfirm);
      cancelBtn?.removeEventListener("click", onCancel);
    };

    const onConfirm = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };

    confirmBtn?.addEventListener("click", onConfirm);
    cancelBtn?.addEventListener("click", onCancel);
    overlay?.addEventListener("click", onCancel);
  });
}

// ========================================
// PHOTO ZOOM
// ========================================
function setupPhotoZoom() {
  const preview = document.getElementById("previewFotoBahaya");
  if (!preview) return;

  preview.addEventListener("click", () => {
    const overlay = document.getElementById("photoZoomOverlay");
    const zoomImg = document.getElementById("zoomedPhoto");
    const img = document.getElementById("imgPreviewBahaya");

    if (overlay && zoomImg && img && img.src) {
      zoomImg.src = img.src;
      overlay.classList.add("active");
    }
  });
}

// ========================================
// PHOTO PREVIEW (for inline onchange in HTML)
// ========================================
function renderBahayaPhotosPreview() {
  const preview = document.getElementById("previewFotoBahaya");
  const fileInput = document.getElementById("upload_foto_bahaya");
  if (!preview || !fileInput) return;

  preview.innerHTML = "";
  
  if (selectedBahayaPhotos.length === 0) {
    preview.style.display = "none";
    fileInput.dataset.base64 = "";
    return;
  }

  preview.style.display = "grid";
  const totalItems = selectedBahayaPhotos.length + 1; // +1 for the add button card
  if (totalItems === 1) {
    preview.style.gridTemplateColumns = "1fr";
  } else if (totalItems === 2) {
    preview.style.gridTemplateColumns = "1fr 1fr";
  } else {
    preview.style.gridTemplateColumns = "repeat(auto-fit, minmax(120px, 1fr))";
  }
  preview.style.gap = "10px";

  selectedBahayaPhotos.forEach((base64, index) => {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.aspectRatio = "4 / 3";
    wrapper.style.overflow = "hidden";
    wrapper.style.borderRadius = "12px";
    wrapper.style.background = "#f1f5f9";
    wrapper.style.border = "1px solid #cbd5e1";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "center";

    const img = document.createElement("img");
    img.src = base64;
    img.alt = `Preview Foto Bahaya - ${index + 1}`;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.cursor = "pointer";

    img.addEventListener("click", () => {
      const overlay = document.getElementById("photoZoomOverlay");
      const zoomImg = document.getElementById("zoomedPhoto");
      if (overlay && zoomImg) {
        zoomImg.src = base64;
        overlay.classList.add("active");
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    deleteBtn.style.position = "absolute";
    deleteBtn.style.top = "6px";
    deleteBtn.style.right = "6px";
    deleteBtn.style.width = "28px";
    deleteBtn.style.height = "28px";
    deleteBtn.style.borderRadius = "50%";
    deleteBtn.style.background = "rgba(239, 68, 68, 0.9)";
    deleteBtn.style.color = "#ffffff";
    deleteBtn.style.border = "none";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.style.display = "flex";
    deleteBtn.style.alignItems = "center";
    deleteBtn.style.justifyContent = "center";
    deleteBtn.style.fontSize = "12px";
    deleteBtn.style.zIndex = "10";
    deleteBtn.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
    deleteBtn.title = "Hapus foto";

    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedBahayaPhotos.splice(index, 1);
      fileInput.dataset.base64 = JSON.stringify(selectedBahayaPhotos);
      renderBahayaPhotosPreview();
      saveDraft();
    });

    wrapper.appendChild(img);
    wrapper.appendChild(deleteBtn);
    preview.appendChild(wrapper);
  });

  const addCard = document.createElement("div");
  addCard.style.position = "relative";
  addCard.style.aspectRatio = "4 / 3";
  addCard.style.overflow = "hidden";
  addCard.style.borderRadius = "12px";
  addCard.style.background = "linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(37, 99, 235, 0.03) 100%)";
  addCard.style.border = "2px dashed rgba(37, 99, 235, 0.4)";
  addCard.style.display = "flex";
  addCard.style.flexDirection = "column";
  addCard.style.alignItems = "center";
  addCard.style.justifyContent = "center";
  addCard.style.cursor = "pointer";
  addCard.style.color = "#2563eb";
  addCard.style.transition = "all 0.2s ease";

  addCard.addEventListener("mouseenter", () => {
    addCard.style.background = "linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, rgba(37, 99, 235, 0.06) 100%)";
    addCard.style.borderColor = "#2563eb";
  });
  addCard.addEventListener("mouseleave", () => {
    addCard.style.background = "linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(37, 99, 235, 0.03) 100%)";
    addCard.style.borderColor = "rgba(37, 99, 235, 0.4)";
  });

  addCard.addEventListener("click", () => {
    fileInput.click();
  });

  const plusIcon = document.createElement("i");
  plusIcon.className = "fa-solid fa-plus";
  plusIcon.style.fontSize = "20px";
  plusIcon.style.marginBottom = "4px";

  const addText = document.createElement("span");
  addText.textContent = "Tambah Foto";
  addText.style.fontSize = "11px";
  addText.style.fontWeight = "600";

  addCard.appendChild(plusIcon);
  addCard.appendChild(addText);
  preview.appendChild(addCard);

  fileInput.dataset.base64 = JSON.stringify(selectedBahayaPhotos);
}

function compressImage(base64Str, maxWidth = 800, maxHeight = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
      resolve(compressedBase64);
    };
    img.onerror = () => {
      resolve(base64Str);
    };
  });
}

function previewFotoBahaya(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  const invalidFile = files.find(file => !file.type.startsWith("image/"));
  if (invalidFile) {
    alert("Semua file harus berupa gambar.");
    event.target.value = "";
    return;
  }

  const base64Promises = files.map(file => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        resolve(e.target.result);
      };
      reader.readAsDataURL(file);
    });
  });

  Promise.all(base64Promises).then(async base64Array => {
    const compressedPromises = base64Array.map(base64 => compressImage(base64));
    const compressedArray = await Promise.all(compressedPromises);

    selectedBahayaPhotos = selectedBahayaPhotos.concat(compressedArray);
    renderBahayaPhotosPreview();
    saveDraft();
    event.target.value = "";
  });
}

// ========================================
// KEYBOARD NAVIGATION
// ========================================
function setupKeyboardNavigation() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      const nextBtn = document.getElementById(`btnNext${currentStep}`);
      if (nextBtn) nextBtn.click();
    }

    if (e.key === "Escape" && currentStep > 1) {
      const backBtn = document.getElementById(`btnBack${currentStep}`);
      if (backBtn) backBtn.click();
    }
  });
}

// ========================================
// MULTI STEP
// ========================================
const STEP_LABELS = ["Data Pelapor", "Detail Kejadian", "Identifikasi Bahaya", "Tindakan Perbaikan", "Data PIC", "Verifikasi"];

function showStep(stepNumber) {
  currentStep = stepNumber;

  document.querySelectorAll(".form-step").forEach(step => step.classList.remove("active"));
  document.getElementById(`step${stepNumber}`)?.classList.add("active");

  if (stepNumber === 6) {
    requestAnimationFrame(resizeSignaturePad);
  }

  document.querySelectorAll(".step-progress .step").forEach(step => {
    const value = Number(step.dataset.step);
    step.classList.remove("active", "completed");
    if (value < stepNumber) step.classList.add("completed");
    else if (value === stepNumber) step.classList.add("active");
  });

  const summary = document.getElementById("stepSummary");
  if (summary) summary.textContent = `Langkah ${stepNumber} dari ${STEP_LABELS.length} — ${STEP_LABELS[stepNumber - 1]}`;

  hideAlert();
  clearFieldErrors();

  document.querySelector(".card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ========================================
// VALIDATION
// ========================================
function validateSection1() {
  return validateRequiredFields(["perusahaan", "subcont1", "nama"]);
}

function validateSection2() {
  return validateRequiredFields(["tanggal_kejadian", "shift_kejadian", "lokasi_bahaya", "detail_lokasi_bahaya"]);
}

function validateSection3() {
  const textValid = validateRequiredFields(["jenis_bahaya", "ketidaksesuaian_bahaya", "sub_ketidaksesuaian", "deskripsi_bahaya"]);

  if (selectedBahayaPhotos.length === 0) {
    const fileInput = document.getElementById("upload_foto_bahaya");
    const formGroup = fileInput?.closest(".form-group");
    if (formGroup && !formGroup.querySelector(".field-error")) {
      const error = document.createElement("div");
      error.className = "field-error";
      error.textContent = "Minimal 1 foto bahaya wajib diupload.";
      formGroup.appendChild(error);
    }
    if (fileInput) fileInput.classList.add("error");
    showAlert();
    if (textValid) formGroup?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }

  return textValid;
}

function validateSection4() {
  return validateRequiredFields(["tindakan_langsung", "tindakan_usulan_pic"]);
}

function validateSection5() {
  const valid = validateRequiredFields(["perusahaan_pic", "subcont2", "nama_pic", "batas_waktu"]);
  if (!valid) return false;

  const batasWaktuEl = document.getElementById("batas_waktu");
  if (batasWaktuEl && batasWaktuEl.value) {
    const selected = new Date(batasWaktuEl.value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selected < today) {
      addFieldError(batasWaktuEl);
      const formGroup = batasWaktuEl.closest(".form-group");
      if (formGroup) {
        const error = document.createElement("div");
        error.className = "field-error";
        error.textContent = "Batas waktu tidak boleh di masa lampau.";
        formGroup.appendChild(error);
        formGroup.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      showAlert();
      return false;
    }
  }

  return true;
}

function validateSection6() {
  hideAlert();
  clearFieldErrors();

  let isValid = true;
  let firstInvalid = null;

  const pernyataan = document.getElementById("pernyataan");
  if (!pernyataan || !pernyataan.checked) {
    isValid = false;
    const checkboxLabel = pernyataan?.closest(".checkbox-label");
    if (checkboxLabel) {
      checkboxLabel.classList.add("error");
      const error = document.createElement("div");
      error.className = "field-error";
      error.textContent = "Pernyataan wajib disetujui.";
      checkboxLabel.closest(".form-group")?.appendChild(error);
    }
    if (!firstInvalid) firstInvalid = checkboxLabel || pernyataan;
  }

  const canvas = document.getElementById("signaturePad");
  if (!signaturePad || signaturePad.isEmpty()) {
    isValid = false;
    if (canvas) {
      canvas.classList.add("error");
      const error = document.createElement("div");
      error.className = "field-error";
      error.textContent = "Tanda tangan wajib diisi.";
      canvas.closest(".form-group")?.appendChild(error);
    }
    if (!firstInvalid) firstInvalid = canvas;
  }

  if (!isValid && firstInvalid) {
    showAlert();
    firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return isValid;
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
    firstInvalid.closest(".form-group")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => firstInvalid.focus?.(), 400);
  }

  return isValid;
}

function addFieldError(field) {
  const choicesInner = field.closest(".form-group")?.querySelector(".choices__inner");
  if (choicesInner) choicesInner.classList.add("error");
  else field.classList.add("error");
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

// ========================================
// LOADING OVERLAY
// ========================================
function showLoading() {
  const overlay = document.getElementById("loadingOverlay");
  const progress = document.getElementById("loadingProgress");
  const percent = document.getElementById("loadingPercent");

  if (overlay) overlay.style.display = "flex";

  if (progress) progress.style.width = "0%";
  if (percent) percent.textContent = "0%";

  setTimeout(() => updateLoading(20), 200);
  setTimeout(() => updateLoading(45), 800);
  setTimeout(() => updateLoading(70), 1500);
  setTimeout(() => updateLoading(90), 2500);
}

function updateLoading(value) {
  const progress = document.getElementById("loadingProgress");
  const percent = document.getElementById("loadingPercent");
  if (progress) progress.style.width = value + "%";
  if (percent) percent.textContent = value + "%";
}

function hideLoading() {
  updateLoading(100);
  setTimeout(() => {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.style.display = "none";
  }, 500);
}

// ========================================
// COLLECT FORM DATA
// ========================================
function getFormData() {
  return {
    perusahaan: document.getElementById("perusahaan")?.value || "",
    subcont1: document.getElementById("subcont1")?.value || "",
    nama: document.getElementById("nama")?.value || "",
    nik: document.getElementById("nik")?.value || "",
    jabatan: document.getElementById("jabatan")?.value || "",
    departemen: document.getElementById("departemen")?.value || "",
    no_whatsapp: document.getElementById("no_whatsapp")?.value || "",

    tanggal_kejadian: document.getElementById("tanggal_kejadian")?.value || "",
    shift_kejadian: document.getElementById("shift_kejadian")?.value || "",
    lokasi_bahaya: document.getElementById("lokasi_bahaya")?.value || "",
    detail_lokasi_bahaya: document.getElementById("detail_lokasi_bahaya")?.value || "",

    jenis_bahaya: document.getElementById("jenis_bahaya")?.value || "",
    ketidaksesuaian_bahaya: document.getElementById("ketidaksesuaian_bahaya")?.value || "",
    sub_ketidaksesuaian: document.getElementById("sub_ketidaksesuaian")?.value || "",
    deskripsi_bahaya: document.getElementById("deskripsi_bahaya")?.value || "",
    tingkat_risiko: document.getElementById("tingkat_risiko")?.value || "",
    upload_foto_bahaya: document.getElementById("upload_foto_bahaya")?.dataset?.base64 || "",

    tindakan_langsung: document.getElementById("tindakan_langsung")?.value || "",
    tindakan_usulan_pic: document.getElementById("tindakan_usulan_pic")?.value || "",

    perusahaan_pic: document.getElementById("perusahaan_pic")?.value || "",
    subcont2: document.getElementById("subcont2")?.value || "",
    nama_pic: document.getElementById("nama_pic")?.value || "",
    jabatan_pic: document.getElementById("jabatan_pic")?.value || "",
    departemen_pic: document.getElementById("departemen_pic")?.value || "",
    no_whatsapp_pic: document.getElementById("no_whatsapp_pic")?.value || "",
    batas_waktu: document.getElementById("batas_waktu")?.value || "",

    pernyataan: document.getElementById("pernyataan")?.checked ? "Ya" : "Tidak",
    tanda_tangan: signaturePad && !signaturePad.isEmpty() ? signaturePad.toDataURL("image/png") : ""
  };
}

// ========================================
// SUBMIT FORM DATA
// ========================================
async function submitForm() {
  try {
    const data = getFormData();
    showLoading();

    const btnSubmit = document.getElementById("btnSubmit");
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = "Submitting...";
    }

    // Intercept explicitly offline state
    if (!navigator.onLine) {
      if (typeof OneSapOfflineSync !== "undefined") {
        await OneSapOfflineSync.queueHazardReport(data);
        alert("Koneksi internet tidak tersedia.\n\nHazard Report Anda disimpan secara lokal (antrean offline) dan akan dikirim otomatis ketika perangkat mendapat sinyal.");
        window.location.href = "index-home.html";
        return;
      }
    }

    let response;
    try {
      response = await fetch(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submitHazardReport", data: data })
      });
    } catch (fetchError) {
      // Intercept network failure (connection drop) during fetch
      if (typeof OneSapOfflineSync !== "undefined") {
        await OneSapOfflineSync.queueHazardReport(data);
        alert("Gagal terhubung ke server.\n\nHazard Report Anda disimpan secara lokal (antrean offline) dan akan dikirim otomatis ketika sinyal terhubung kembali.");
        window.location.href = "index-home.html";
        return;
      }
      throw fetchError;
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (err) {
      throw new Error("Response bukan JSON valid: " + text);
    }

    if (result.status === "success") {
      alert("Hazard Report berhasil disimpan!\n\nID: " + result.id);
      window.location.href = "index-home.html";
    } else {
      throw new Error(result.message || "Gagal menyimpan data.");
    }
  } catch (error) {
    alert("Terjadi kesalahan saat submit:\n\n" + error.message);
  } finally {
    hideLoading();
    const btnSubmit = document.getElementById("btnSubmit");
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Submit Report";
    }
  }
}

// ========================================
// AUTO-FILL DATA PELAPOR
// ========================================
async function autofillDataPelapor() {
  const user = getCurrentUser();
  if (!user || !masterKaryawan || masterKaryawan.length === 0) return;

  const loadingAutofillOverlay = document.getElementById("loadingAutofill");
  if (loadingAutofillOverlay) loadingAutofillOverlay.style.display = "flex";

  try {
    const userRecord = masterKaryawan.find(item => {
      const itemNik = String(item["NIK"] || "").trim();
      const itemNama = String(item["NAMA"] || "").trim();
      const userNik = String(user.nik || "").trim();
      const userNama = String(user.nama || "").trim();

      return (userNik && itemNik.toUpperCase() === userNik.toUpperCase()) ||
             (userNama && itemNama.toUpperCase() === userNama.toUpperCase());
    });

    if (!userRecord) {
      if (loadingAutofillOverlay) loadingAutofillOverlay.style.display = "none";
      return;
    }

    const perusahaan = document.getElementById("perusahaan");
    const subcont = document.getElementById("subcont1");
    const nama = document.getElementById("nama");
    const nikField = document.getElementById("nik");
    const jabatanField = document.getElementById("jabatan");
    const departemanField = document.getElementById("departemen");
    const noWaField = document.getElementById("no_whatsapp");

    // Set dropdown values without triggering clearAutoFill
    if (perusahaan && userRecord["PERUSAHAAN"]) {
      const opt = Array.from(perusahaan.options).find(o =>
        String(o.value).trim().toUpperCase() === String(userRecord["PERUSAHAAN"]).trim().toUpperCase()
      );
      if (opt) {
        perusahaan.value = opt.value;
        perusahaan.disabled = true;
        loadSubcontOptions(true);
      }
    }

    if (subcont && userRecord["SUBCONT"]) {
      const opt = Array.from(subcont.options).find(o =>
        String(o.value).trim().toUpperCase() === String(userRecord["SUBCONT"]).trim().toUpperCase()
      );
      if (opt) {
        subcont.value = opt.value;
        subcont.disabled = true;
        loadNamaOptions(true);
      }
    }

    if (nama && userRecord["NAMA"]) {
      const opt = Array.from(nama.options).find(o =>
        String(o.value).trim().toUpperCase() === String(userRecord["NAMA"]).trim().toUpperCase()
      );
      if (opt) {
        nama.value = opt.value;
        nama.disabled = true;
        if (namaChoices) namaChoices.setChoiceByValue(opt.value);
        autoFillData();
      }
    }

    if (nikField) nikField.value = userRecord["NIK"] || "";
    if (jabatanField) jabatanField.value = userRecord["JABATAN"] || "";
    if (departemanField) departemanField.value = userRecord["DEPARTEMEN"] || "";
    if (noWaField) noWaField.value = userRecord["NO WHATSAPP"] || "";

    [nikField, jabatanField, departemanField, noWaField].forEach(el => {
      if (el) el.readOnly = true;
    });

    if (perusahaan) perusahaan.disabled = true;
    if (subcont) subcont.disabled = true;
    if (nama) {
      nama.disabled = true;
      nama.addEventListener("change", (e) => {
        e.preventDefault();
        return false;
      }, true);
    }

    if (loadingAutofillOverlay) loadingAutofillOverlay.style.display = "none";

  } catch (error) {
    console.error("Error saat autofill data pelapor:", error);
    if (loadingAutofillOverlay) loadingAutofillOverlay.style.display = "none";
  }
}

// ========================================
// INITIALIZE
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById('step1')?.classList.add('section-1-skeleton');
  try {
    await Promise.all([loadMasterKaryawan(), loadMasterLokasi(), loadMasterTemuan()]);
    loadPerusahaanOptions();
    loadLokasiOptions();
    loadKetidaksesuaianOptions();
    loadPerusahaanPicOptions();

    initializeNamaChoices();
    initializeLokasiChoices();
    initializeKetidaksesuaianChoices();
    initializeSubKetidaksesuaianChoices();
    initializeNamaPicChoices();
    initializeSignaturePad();

    const today = new Date().toISOString().split("T")[0];
    const tanggalInput = document.getElementById("tanggal_kejadian");
    if (tanggalInput) tanggalInput.value = today;

    const batasWaktuInput = document.getElementById("batas_waktu");
    if (batasWaktuInput) batasWaktuInput.min = today;

    // Event listeners
    document.getElementById("perusahaan")?.addEventListener("change", loadSubcontOptions);
    document.getElementById("subcont1")?.addEventListener("change", loadNamaOptions);
    document.getElementById("nama")?.addEventListener("change", autoFillData);

    // Photo upload preview
    document.getElementById("upload_foto_bahaya")?.addEventListener("change", previewFotoBahaya);

    document.getElementById("ketidaksesuaian_bahaya")?.addEventListener("change", loadSubKetidaksesuaianOptions);
    document.getElementById("sub_ketidaksesuaian")?.addEventListener("change", autoFillRisiko);

    document.getElementById("perusahaan_pic")?.addEventListener("change", loadSubcontPicOptions);
    document.getElementById("subcont2")?.addEventListener("change", loadNamaPicOptions);
    document.getElementById("nama_pic")?.addEventListener("change", autoFillDataPic);

    // Navigation buttons
    document.getElementById("btnNext1")?.addEventListener("click", () => { if (validateSection1()) showStep(2); });
    document.getElementById("btnBack2")?.addEventListener("click", () => showStep(1));
    document.getElementById("btnNext2")?.addEventListener("click", () => { if (validateSection2()) showStep(3); });
    document.getElementById("btnBack3")?.addEventListener("click", () => showStep(2));
    document.getElementById("btnNext3")?.addEventListener("click", () => { if (validateSection3()) showStep(4); });
    document.getElementById("btnBack4")?.addEventListener("click", () => showStep(3));
    document.getElementById("btnNext4")?.addEventListener("click", () => { if (validateSection4()) showStep(5); });
    document.getElementById("btnBack5")?.addEventListener("click", () => showStep(4));
    document.getElementById("btnNext5")?.addEventListener("click", () => { if (validateSection5()) showStep(6); });
    document.getElementById("btnBack6")?.addEventListener("click", () => showStep(5));
    document.getElementById("btnSubmit")?.addEventListener("click", async () => {
      if (validateSection6()) {
        const confirmed = await showConfirmationDialog();
        if (confirmed) {
          await submitForm();
          clearDraft();
        }
      }
    });

// Photo zoom close
    document.getElementById("photoZoomClose")?.addEventListener("click", () => {
      document.getElementById("photoZoomOverlay")?.classList.remove("active");
    });

    showStep(1);

    if (!isAdmin()) setSection1Editable(false);
    autofillDataPelapor();
    document.getElementById('step1')?.classList.remove('section-1-skeleton');

    // Initialize enhancements
    loadDraft();
    setupCharCounter("deskripsi_bahaya");
    setupCharCounter("detail_lokasi_bahaya");
    setupCharCounter("tindakan_langsung");
    setupCharCounter("tindakan_usulan_pic", 600);
    setupPhotoZoom();
    setupKeyboardNavigation();
    initOfflineDetection();

    // Auto-save on input/change events inside the card
    const cardEl = document.querySelector(".card");
    if (cardEl) {
      cardEl.addEventListener("input", () => {
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(saveDraft, AUTOSAVE_DELAY);
      });
      cardEl.addEventListener("change", () => {
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(saveDraft, AUTOSAVE_DELAY);
      });
    }
   } catch (error) {
     console.error("Terjadi kesalahan saat memuat data:", error);
   }
 });