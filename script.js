// HAZARD REPORT ONE-SAP
// STEP 1 - DATA PELAPOR
// STEP 2 - DETAIL KEJADIAN
// STEP 3 - IDENTIFIKASI BAHAYA

const BASE_URL =
  "https://script.google.com/macros/s/AKfycbxyxWUQuFddbDxsqq3TNB_K6SBzdDbAFPgrf0DZr38niuOy0dgkqTkfFUeZevudvS8c/exec";

let masterKaryawan = [];
let masterLokasi = [];
let masterTemuan = [];


let namaChoices;
let lokasiChoices;
let ketidaksesuaianChoices;
let subKetidaksesuaianChoices;
let namaPicChoices;
let signaturePad;

let currentStep = 1;

// ========================================
// INITIALIZE
// ========================================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Load master data PARALLEL (bukan sequential)
    await Promise.all([
      loadMasterKaryawan(),
      loadMasterLokasi(),
      loadMasterTemuan()
    ]);

    // Populate dropdowns
    loadPerusahaanOptions();
    loadLokasiOptions();
    loadKetidaksesuaianOptions();
    loadPerusahaanPicOptions();

    // Initialize Choices.js
    initializeNamaChoices();
    initializeLokasiChoices();
    initializeKetidaksesuaianChoices();
    initializeSubKetidaksesuaianChoices();
    initializeNamaPicChoices();
    initializeSignaturePad();

    // Default tanggal kejadian = hari ini
    const tanggalInput = document.getElementById("tanggal_kejadian");
    if (tanggalInput) {
      tanggalInput.value = new Date().toISOString().split("T")[0];
    }

    // ========================================
    // EVENT LISTENERS STEP 1
    // ========================================
    document
      .getElementById("perusahaan")
      ?.addEventListener("change", loadSubcontOptions);

    document
      .getElementById("subcont1")
      ?.addEventListener("change", loadNamaOptions);

    document
      .getElementById("nama")
      ?.addEventListener("change", autoFillData);

    // ========================================
    // EVENT LISTENERS STEP 3
    // ========================================
    document
      .getElementById("ketidaksesuaian_bahaya")
      ?.addEventListener("change", loadSubKetidaksesuaianOptions);

    document
      .getElementById("sub_ketidaksesuaian")
      ?.addEventListener("change", autoFillRisiko);

    document
    .getElementById("upload_foto_bahaya")
    ?.addEventListener("change", function () {
        const file = this.files[0];
        if (!file) return;

        // Validasi sederhana (opsional)
        if (!file.type.startsWith("image/")) {
        alert("File harus berupa gambar.");
        this.value = "";
        return;
        }

        const reader = new FileReader();

        reader.onload = (e) => {
        // Simpan Base64 agar bisa dikirim saat submit
        this.dataset.base64 = e.target.result;

        // Tampilkan preview
        const preview =
            document.getElementById("previewFotoBahaya");

        if (preview) {
            preview.src = e.target.result;
            preview.style.display = "block";
        }
        };

        reader.readAsDataURL(file);
    });

     // ========================================
        // NAVIGATION STEP 4
        // ========================================
        document
        .getElementById("btnNext3")
        ?.addEventListener("click", () => {
            if (validateSection3()) {
            showStep(4);
            }
        });

        document
        .getElementById("btnBack4")
        ?.addEventListener("click", () => {
            showStep(3);
        });

        document
        .getElementById("btnNext4")
        ?.addEventListener("click", () => {
            if (validateSection4()) {
            showStep(5);
            }
        }); 
    // ========================================
    // NAVIGATION
    // ========================================
    document
      .getElementById("btnNext1")
      ?.addEventListener("click", () => {
        if (validateSection1()) showStep(2);
      });

    document
      .getElementById("btnBack2")
      ?.addEventListener("click", () => showStep(1));

    document
      .getElementById("btnNext2")
      ?.addEventListener("click", () => {
        if (validateSection2()) showStep(3);
      });

    document
      .getElementById("btnBack3")
      ?.addEventListener("click", () => showStep(2));

    document
      .getElementById("btnNext3")
      ?.addEventListener("click", () => {
        if (validateSection3()) showStep(4);
      });
    document
    .getElementById("perusahaan_pic")
    ?.addEventListener("change", loadSubcontPicOptions);

    document
    .getElementById("subcont2")
    ?.addEventListener("change", loadNamaPicOptions);

    document
    .getElementById("nama_pic")
    ?.addEventListener("change", autoFillDataPic);
    document
    .getElementById("btnNext4")
    ?.addEventListener("click", () => {
        if (validateSection4()) {
        showStep(5);
        }
    });

    document
    .getElementById("btnBack5")
    ?.addEventListener("click", () => {
        showStep(4);
    });

    document
    .getElementById("btnNext5")
    ?.addEventListener("click", () => {
        if (validateSection5()) {
        showStep(6);
        }
    });

    // Tampilkan step pertama
    showStep(1);

    if (!isAdmin()) {
      setSection1Editable(false);
    }

    autofillDataPelapor();
  } catch (error) {
    console.error(error);
    console.error("Terjadi kesalahan saat memuat data:", error);
// alert di-nonaktifkan agar tidak mengganggu user
  }
});
document
  .getElementById("btnNext5")
  ?.addEventListener("click", () => {
    if (validateSection5()) {
      showStep(6);
    }
  });

document
  .getElementById("btnBack6")
  ?.addEventListener("click", () => {
    showStep(5);
  });

document
  .getElementById("btnSubmit")
  ?.addEventListener("click", async () => {
    if (validateSection6()) {
      await submitForm();
    }
  });

// ========================================
// FETCH DATA
// ========================================
async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

async function loadMasterKaryawan() {
  masterKaryawan = await fetchJSON(
    `${BASE_URL}?action=masterKaryawan`
  );
}

async function loadMasterLokasi() {
  masterLokasi = await fetchJSON(
    `${BASE_URL}?action=masterLokasi`
  );
}

async function loadMasterTemuan() {
  masterTemuan = await fetchJSON(
    `${BASE_URL}?action=masterTemuan`
  );
}
// ========================================
// HELPER - AMBIL NILAI DARI BERBAGAI HEADER
// ========================================
function getValue(obj, possibleKeys) {
  for (const key of possibleKeys) {
    const value = obj[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
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

  select.innerHTML =
    '<option value="">Pilih Perusahaan</option>';

  const list = [
    ...new Set(
      masterKaryawan
        .map(item => item["PERUSAHAAN"])
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });
}

function loadSubcontOptions() {
  const perusahaan =
    document.getElementById("perusahaan").value;
  const select = document.getElementById("subcont1");

  select.innerHTML =
    '<option value="">Pilih Subcont</option>';

  clearAutoFill();
  resetNamaDropdown();

  if (!perusahaan) return;

  const list = [
    ...new Set(
      masterKaryawan
        .filter(
          item => item["PERUSAHAAN"] === perusahaan
        )
        .map(item => item["SUBCONT"])
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });
}

function loadNamaOptions() {
  const perusahaan =
    document.getElementById("perusahaan").value;
  const subcont =
    document.getElementById("subcont1").value;
  const select = document.getElementById("nama");

  select.innerHTML =
    '<option value="">Pilih Nama</option>';

  clearAutoFill();

  if (!perusahaan || !subcont) {
    initializeNamaChoices();
    return;
  }

  const list = [
    ...new Set(
      masterKaryawan
        .filter(
          item =>
            item["PERUSAHAAN"] === perusahaan &&
            item["SUBCONT"] === subcont
        )
        .map(item => item["NAMA"])
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });

  initializeNamaChoices();
}

function setSection1Editable(editable) {
  const section1Ids = ["perusahaan", "subcont1", "nama"];
  section1Ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !editable;
  });
}

function autoFillData() {
  const perusahaan =
    document.getElementById("perusahaan").value;
  const subcont =
    document.getElementById("subcont1").value;
  const nama =
    document.getElementById("nama").value;

  const selected = masterKaryawan.find(
    item =>
      item["PERUSAHAAN"] === perusahaan &&
      item["SUBCONT"] === subcont &&
      item["NAMA"] === nama
  );

  if (!selected) return;

  document.getElementById("nik").value =
    selected["NIK"] || "";
  document.getElementById("jabatan").value =
    selected["JABATAN"] || "";
  document.getElementById("departemen").value =
    selected["DEPARTEMEN"] || "";
  document.getElementById("no_whatsapp").value =
    selected["NO WHATSAPP"] || "";
}

function clearAutoFill() {
  ["nik", "jabatan", "departemen", "no_whatsapp"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
}

function resetNamaDropdown() {
  const select = document.getElementById("nama");
  if (!select) return;

  select.innerHTML =
    '<option value="">Pilih Nama</option>';

  initializeNamaChoices();
}

// ========================================
// STEP 2 - DETAIL KEJADIAN
// ========================================
function loadLokasiOptions() {
  const select =
    document.getElementById("lokasi_bahaya");
  if (!select) return;

  select.innerHTML =
    '<option value="">Pilih Lokasi Bahaya</option>';

  const list = [
    ...new Set(
      masterLokasi
        .map(item => {
          const key = Object.keys(item)[0];
          return item[key];
        })
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });
}

// ========================================
// STEP 3 - IDENTIFIKASI BAHAYA
// ========================================
function loadKetidaksesuaianOptions() {
  const select =
    document.getElementById("ketidaksesuaian_bahaya");

  if (!select) return;

  select.innerHTML =
    '<option value="">Pilih Ketidaksesuaian Bahaya</option>';

  const list = [
    ...new Set(
      masterTemuan
        .map(item =>
          getValue(item, [
            "KETIDAKSESUAIAN",
            "KETIDAKSESUAIAN BAHAYA",
            "KETIDAKSESUAIAN_BAHAYA"
          ])
        )
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });

  initializeKetidaksesuaianChoices();
}
function loadSubKetidaksesuaianOptions() {
  const ketidaksesuaian =
    document.getElementById(
      "ketidaksesuaian_bahaya"
    ).value;

  const select =
    document.getElementById("sub_ketidaksesuaian");
  const risiko =
    document.getElementById("tingkat_risiko");

  select.innerHTML =
    '<option value="">Pilih Sub Ketidaksesuaian</option>';

  if (risiko) risiko.value = "";

  if (!ketidaksesuaian) {
    initializeSubKetidaksesuaianChoices();
    return;
  }

  const list = [
    ...new Set(
      masterTemuan
        .filter(item => {
          const kategori =
            item["KETIDAKSESUAIAN"] ||
            item["KETIDAKSESUAIAN BAHAYA"];

          return kategori === ketidaksesuaian;
        })
        .map(item =>
          item["SUB KETIDAKSESUAIAN"]
        )
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });

  initializeSubKetidaksesuaianChoices();
}

function autoFillRisiko() {
  const ketidaksesuaian =
    document.getElementById(
      "ketidaksesuaian_bahaya"
    ).value;

  const sub =
    document.getElementById(
      "sub_ketidaksesuaian"
    ).value;

  const selected = masterTemuan.find(item => {
    const kategori =
      item["KETIDAKSESUAIAN"] ||
      item["KETIDAKSESUAIAN BAHAYA"];

    return (
      kategori === ketidaksesuaian &&
      item["SUB KETIDAKSESUAIAN"] === sub
    );
  });

  if (!selected) return;

  document.getElementById("tingkat_risiko").value =
    selected["RESIKO"] ||
    selected["TINGKAT RESIKO"] ||
    "";
}

function previewFotoBahaya(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Validasi file gambar
  if (!file.type.startsWith("image/")) {
    alert("File harus berupa gambar.");
    event.target.value = "";
    return;
  }

  // Ambil elemen preview
  const preview = document.getElementById("previewFotoBahaya");
  const img = document.getElementById("imgPreviewBahaya");

  // Pastikan elemen ditemukan
  if (!preview || !img) {
    console.error("Elemen preview foto tidak ditemukan.");
    return;
  }

  // Baca file
  const reader = new FileReader();

  reader.onload = function (e) {
    const base64 = e.target.result;

    // Simpan Base64 untuk submit ke Google Apps Script
    event.target.dataset.base64 = base64;

    // Tampilkan preview
    img.src = base64;
    preview.style.display = "block";

    console.log("Preview foto berhasil ditampilkan.");
  };

  reader.readAsDataURL(file);
}
function loadPerusahaanPicOptions() {
  const select = document.getElementById("perusahaan_pic");
  if (!select) return;

  select.innerHTML =
    '<option value="">Pilih Perusahaan PIC</option>';

  const list = [
    ...new Set(
      masterKaryawan
        .map(item => item["PERUSAHAAN"])
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });
}
function loadSubcontPicOptions() {
  const perusahaan =
    document.getElementById("perusahaan_pic").value;
  const select = document.getElementById("subcont2");

  select.innerHTML =
    '<option value="">Pilih Subcont PIC</option>';

  clearAutoFillPic();
  resetNamaPicDropdown();

  if (!perusahaan) return;

  const list = [
    ...new Set(
      masterKaryawan
        .filter(
          item => item["PERUSAHAAN"] === perusahaan
        )
        .map(item => item["SUBCONT"])
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });
}
function loadNamaPicOptions() {
  const perusahaan =
    document.getElementById("perusahaan_pic").value;
  const subcont =
    document.getElementById("subcont2").value;
  const select = document.getElementById("nama_pic");

  select.innerHTML =
    '<option value="">Pilih Nama PIC</option>';

  clearAutoFillPic();

  if (!perusahaan || !subcont) {
    initializeNamaPicChoices();
    return;
  }

  const list = [
    ...new Set(
      masterKaryawan
        .filter(
          item =>
            item["PERUSAHAAN"] === perusahaan &&
            item["SUBCONT"] === subcont
        )
        .map(item => item["NAMA"])
        .filter(Boolean)
    )
  ].sort();

  list.forEach(item => {
    select.add(new Option(item, item));
  });

  initializeNamaPicChoices();
}
function autoFillDataPic() {
  const perusahaan =
    document.getElementById("perusahaan_pic").value;
  const subcont =
    document.getElementById("subcont2").value;
  const nama =
    document.getElementById("nama_pic").value;

  const selected = masterKaryawan.find(
    item =>
      item["PERUSAHAAN"] === perusahaan &&
      item["SUBCONT"] === subcont &&
      item["NAMA"] === nama
  );

  if (!selected) return;

  document.getElementById("jabatan_pic").value =
    selected["JABATAN"] || "";

  document.getElementById("departemen_pic").value =
    selected["DEPARTEMEN"] || "";

  document.getElementById("no_whatsapp_pic").value =
    selected["NO WHATSAPP"] || "";
}
function clearAutoFillPic() {
  [
    "jabatan_pic",
    "departemen_pic",
    "no_whatsapp_pic"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function resetNamaPicDropdown() {
  const select = document.getElementById("nama_pic");
  if (!select) return;

  select.innerHTML =
    '<option value="">Pilih Nama PIC</option>';

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
  namaChoices = createChoices(
    "#nama",
    "Cari dan pilih nama"
  );
}

function initializeLokasiChoices() {
  if (lokasiChoices) lokasiChoices.destroy();
  lokasiChoices = createChoices(
    "#lokasi_bahaya",
    "Cari lokasi bahaya"
  );
}

function initializeKetidaksesuaianChoices() {
  if (ketidaksesuaianChoices)
    ketidaksesuaianChoices.destroy();

  ketidaksesuaianChoices = createChoices(
    "#ketidaksesuaian_bahaya",
    "Cari ketidaksesuaian"
  );
}

function initializeSubKetidaksesuaianChoices() {
  if (subKetidaksesuaianChoices)
    subKetidaksesuaianChoices.destroy();

  subKetidaksesuaianChoices = createChoices(
    "#sub_ketidaksesuaian",
    "Cari sub ketidaksesuaian"
  );
}
function initializeNamaPicChoices() {
  if (namaPicChoices) {
    namaPicChoices.destroy();
  }

  namaPicChoices = createChoices(
    "#nama_pic",
    "Cari dan pilih nama PIC"
  );
}
function initializeSignaturePad() {
  const canvas = document.getElementById("signaturePad");
  if (!canvas) return;

  signaturePad = new SignaturePad(canvas, {
    minWidth: 1,
    maxWidth: 3
  });

  // Tombol hapus tanda tangan
  document
    .getElementById("btnClearSignature")
    ?.addEventListener("click", () => {
      signaturePad.clear();
    });
}
// ========================================
// MULTI STEP
// ========================================
function showStep(stepNumber) {
  currentStep = stepNumber;

  document
    .querySelectorAll(".form-step")
    .forEach(step =>
      step.classList.remove("active")
    );

  document
    .getElementById(`step${stepNumber}`)
    ?.classList.add("active");

  document
    .querySelectorAll(".step-progress .step")
    .forEach(step => {
      const value = Number(step.dataset.step);

      step.classList.remove(
        "active",
        "completed"
      );

      if (value < stepNumber) {
        step.classList.add("completed");
      } else if (value === stepNumber) {
        step.classList.add("active");
      }
    });

  hideAlert();
  clearFieldErrors();

  document.querySelector(".card")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// ========================================
// VALIDATION
// ========================================
// ========================================
// VALIDATION
// ========================================
function validateSection1() {
  return validateRequiredFields([
    "perusahaan",
    "subcont1",
    "nama"
  ]);
}

function validateSection2() {
  return validateRequiredFields([
    "tanggal_kejadian",
    "shift_kejadian",
    "lokasi_bahaya",
    "detail_lokasi_bahaya"
  ]);
}

function validateSection3() {
  return validateRequiredFields([
    "jenis_bahaya",
    "ketidaksesuaian_bahaya",
    "sub_ketidaksesuaian",
    "deskripsi_bahaya"
  ]);
}

function validateSection4() {
  return validateRequiredFields([
    "tindakan_langsung",
    "tindakan_usulan_pic"
  ]);
}

function validateSection5() {
  return validateRequiredFields([
    "perusahaan_pic",
    "subcont2",
    "nama_pic",
    "batas_waktu"
  ]);
}

function validateSection6() {
  hideAlert();
  clearFieldErrors();

  let isValid = true;
  let firstInvalid = null;

  // Validasi checkbox pernyataan
  const pernyataan = document.getElementById("pernyataan");

  if (!pernyataan || !pernyataan.checked) {
    isValid = false;

    const checkboxLabel =
      pernyataan?.closest(".checkbox-label");

    if (checkboxLabel) {
      checkboxLabel.classList.add("error");

      const error = document.createElement("div");
      error.className = "field-error";
      error.textContent = "Pernyataan wajib disetujui.";

      const formGroup =
        checkboxLabel.closest(".form-group");

      formGroup?.appendChild(error);
    }

    if (!firstInvalid) {
      firstInvalid =
        checkboxLabel || pernyataan;
    }
  }

  // Validasi tanda tangan
  const canvas =
    document.getElementById("signaturePad");

  if (!signaturePad || signaturePad.isEmpty()) {
    isValid = false;

    if (canvas) {
      canvas.classList.add("error");

      const error = document.createElement("div");
      error.className = "field-error";
      error.textContent = "Tanda tangan wajib diisi.";

      const formGroup =
        canvas.closest(".form-group");

      formGroup?.appendChild(error);
    }

    if (!firstInvalid) {
      firstInvalid = canvas;
    }
  }

  // Jika tidak valid
  if (!isValid && firstInvalid) {
    showAlert();

    firstInvalid.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
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

    const value =
      (field.value || "").trim();

    if (!value) {
      isValid = false;

      if (!firstInvalid) {
        firstInvalid = field;
      }

      addFieldError(field);

      const formGroup =
        field.closest(".form-group");

      if (formGroup) {
        const error =
          document.createElement("div");
        error.className = "field-error";
        error.textContent =
          "Field ini wajib diisi.";
        formGroup.appendChild(error);
      }
    }
  });

  if (!isValid && firstInvalid) {
    showAlert();

    const group =
      firstInvalid.closest(".form-group");

    group?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    setTimeout(() => {
      firstInvalid.focus?.();
    }, 400);
  }

  return isValid;
}

function addFieldError(field) {
  const choicesInner =
    field.closest(".form-group")
      ?.querySelector(".choices__inner");

  if (choicesInner) {
    choicesInner.classList.add("error");
  } else {
    field.classList.add("error");
  }
}

function clearFieldErrors() {
  document
    .querySelectorAll(".error")
    .forEach(el =>
      el.classList.remove("error")
    );

  document
    .querySelectorAll(".field-error")
    .forEach(el => el.remove());
}

function showAlert() {
  const alertBox =
    document.getElementById("alertError");
  if (alertBox) {
    alertBox.style.display = "block";
  }
}

function hideAlert() {
  const alertBox =
    document.getElementById("alertError");
  if (alertBox) {
    alertBox.style.display = "none";
  }
}
// ========================================
// LOADING OVERLAY
// ========================================
function showLoading() {
  const overlay = document.getElementById("loadingOverlay");
  const progress = document.getElementById("loadingProgress");
  const percent = document.getElementById("loadingPercent");

  if (overlay) {
    overlay.style.display = "flex";
  }

  if (progress) {
    progress.style.width = "0%";
  }

  if (percent) {
    percent.textContent = "0%";
  }

  // Animasi progress bertahap
  setTimeout(() => updateLoading(20), 200);
  setTimeout(() => updateLoading(45), 800);
  setTimeout(() => updateLoading(70), 1500);
  setTimeout(() => updateLoading(90), 2500);
}

function updateLoading(value) {
  const progress = document.getElementById("loadingProgress");
  const percent = document.getElementById("loadingPercent");

  if (progress) {
    progress.style.width = value + "%";
  }

  if (percent) {
    percent.textContent = value + "%";
  }
}

function hideLoading() {
  updateLoading(100);

  setTimeout(() => {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) {
      overlay.style.display = "none";
    }
  }, 500);
}
// ========================================
// COLLECT FORM DATA
// ========================================
function getFormData() {
  return {
    // Section 1
    perusahaan: document.getElementById("perusahaan")?.value || "",
    subcont1: document.getElementById("subcont1")?.value || "",
    nama: document.getElementById("nama")?.value || "",
    nik: document.getElementById("nik")?.value || "",
    jabatan: document.getElementById("jabatan")?.value || "",
    departemen: document.getElementById("departemen")?.value || "",
    no_whatsapp:
      document.getElementById("no_whatsapp")?.value || "",

    // Section 2
    tanggal_kejadian:
      document.getElementById("tanggal_kejadian")?.value || "",
    shift_kejadian:
      document.getElementById("shift_kejadian")?.value || "",
    lokasi_bahaya:
      document.getElementById("lokasi_bahaya")?.value || "",
    detail_lokasi_bahaya:
      document.getElementById("detail_lokasi_bahaya")?.value || "",

        // Section 3
    jenis_bahaya:
    document.getElementById("jenis_bahaya")?.value || "",
    ketidaksesuaian_bahaya:
    document.getElementById("ketidaksesuaian_bahaya")?.value || "",
    sub_ketidaksesuaian:
    document.getElementById("sub_ketidaksesuaian")?.value || "",
    deskripsi_bahaya:
    document.getElementById("deskripsi_bahaya")?.value || "",
    tingkat_risiko:
    document.getElementById("tingkat_risiko")?.value || "",
    upload_foto_bahaya:
    document.getElementById("upload_foto_bahaya")
    ?.dataset?.base64 || "",

    // Section 4
    tindakan_langsung:
      document.getElementById("tindakan_langsung")?.value || "",
    tindakan_usulan_pic:
      document.getElementById("tindakan_usulan_pic")?.value || "",

    // Section 5
    perusahaan_pic:
      document.getElementById("perusahaan_pic")?.value || "",
    subcont2:
      document.getElementById("subcont2")?.value || "",
    nama_pic:
      document.getElementById("nama_pic")?.value || "",
    jabatan_pic:
      document.getElementById("jabatan_pic")?.value || "",
    departemen_pic:
      document.getElementById("departemen_pic")?.value || "",
    no_whatsapp_pic:
      document.getElementById("no_whatsapp_pic")?.value || "",
    batas_waktu:
      document.getElementById("batas_waktu")?.value || "",

    // Section 6
    pernyataan:
      document.getElementById("pernyataan")?.checked
        ? "Ya"
        : "Tidak",

    tanda_tangan:
      signaturePad && !signaturePad.isEmpty()
        ? signaturePad.toDataURL("image/png")
        : ""
  };
}
// ========================================
// SUBMIT FORM DATA
// ========================================
async function submitForm() {
  try {
    const data = getFormData();
    showLoading();
    const btnSubmit =
      document.getElementById("btnSubmit");

    // Disable tombol
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = "Submitting...";
    }

    console.log("Submitting data:", data);

    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type":
          "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        action: "submitHazardReport",
        data: data
      })
    });

    const text = await response.text();
    console.log("Raw Response:", text);

    let result;
    try {
      result = JSON.parse(text);
    } catch (err) {
      throw new Error(
        "Response bukan JSON valid: " + text
      );
    }

    if (result.status === "success") {
      alert(
        "Hazard Report berhasil disimpan!\n\nID: " +
        result.id
      );
    } else {
      throw new Error(
        result.message ||
        "Gagal menyimpan data."
      );
    }
  } catch (error) {
    console.error("Submit Error:", error);
    alert(
      "Terjadi kesalahan saat submit:\n\n" +
      error.message
    );
  } finally {
    hideLoading();
    const btnSubmit =
      document.getElementById("btnSubmit");

    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent =
        "Submit Report";
    }
  }
}
async function autofillDataPelapor() {
  const user = getCurrentUser();
  if (!user || !masterKaryawan || masterKaryawan.length === 0) return;

  // Show loading
  const loadingAutofillOverlay = document.getElementById("loadingAutofill");
  if (loadingAutofillOverlay) loadingAutofillOverlay.style.display = "flex";

  try {
    // Master data sudah pasti siap, langsung cari user record
    const userRecord = masterKaryawan.find(item => {
      const itemNik = String(item["NIK"] || "").trim();
      const itemNama = String(item["NAMA"] || "").trim();
      const userNik = String(user.nik || "").trim();
      const userNama = String(user.nama || "").trim();

      return (
        (userNik && itemNik.toUpperCase() === userNik.toUpperCase()) ||
        (userNama && itemNama.toUpperCase() === userNama.toUpperCase())
      );
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

    // 1. SET PERUSAHAAN
    if (perusahaan && userRecord["PERUSAHAAN"]) {
      const opt = Array.from(perusahaan.options).find(o =>
        String(o.value).trim().toUpperCase() === 
        String(userRecord["PERUSAHAAN"]).trim().toUpperCase()
      );
      if (opt) {
        perusahaan.value = opt.value;
        perusahaan.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // 2. SET SUBCONT (very short wait)
    await new Promise(r => setTimeout(r, 50));
    if (subcont && userRecord["SUBCONT"]) {
      const opt = Array.from(subcont.options).find(o =>
        String(o.value).trim().toUpperCase() === 
        String(userRecord["SUBCONT"]).trim().toUpperCase()
      );
      if (opt) {
        subcont.value = opt.value;
        subcont.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // 3. SET NAMA (very short wait)
    await new Promise(r => setTimeout(r, 50));
    if (nama && userRecord["NAMA"]) {
      const opt = Array.from(nama.options).find(o =>
        String(o.value).trim().toUpperCase() === 
        String(userRecord["NAMA"]).trim().toUpperCase()
      );
      if (opt) {
        nama.value = opt.value;
        if (namaChoices) {
          namaChoices.setChoiceByValue(opt.value);
        }
        nama.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // 4. FILL DATA TURUNAN
    if (nikField) nikField.value = userRecord["NIK"] || "";
    if (jabatanField) jabatanField.value = userRecord["JABATAN"] || "";
    if (departemanField) departemanField.value = userRecord["DEPARTEMEN"] || "";
    if (noWaField) noWaField.value = userRecord["NO WHATSAPP"] || "";

    // 5. LOCK SEMUA FIELD
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

    // Hide loading dengan delay kecil agar animasi terlihat
    await new Promise(r => setTimeout(r, 300));
    if (loadingAutofillOverlay) loadingAutofillOverlay.style.display = "none";

  } catch (error) {
    console.error("Error saat autofill data pelapor:", error);
    if (loadingAutofillOverlay) loadingAutofillOverlay.style.display = "none";
  }
}
/* ========================================
   INITIALIZE FORM WITH AUTOFILL
======================================== */
async function initializeFormWithAutofill() {
  try {
    // Jika ada fungsi loadMasterData, tunggu sampai selesai
    if (typeof loadMasterData === "function") {
      await loadMasterData();
    }

    // Jika ada fungsi initializeForm lama, jalankan juga
    if (typeof initializeForm === "function") {
      await initializeForm();
    }

    // Setelah semua dropdown siap, isi otomatis data pelapor
    autofillDataPelapor();
  } catch (error) {
    console.error("Gagal inisialisasi form:", error);

    // Fallback: tetap coba autofill
    setTimeout(() => {
      autofillDataPelapor();
    }, 1000);
  }
}