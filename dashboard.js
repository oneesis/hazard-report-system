// ========================================
// KONFIGURASI
// ========================================
// Gunakan URL Web App Google Apps Script yang sama
const BASE_URL =
  "https://script.google.com/macros/s/AKfycbxyxWUQuFddbDxsqq3TNB_K6SBzdDbAFPgrf0DZr38niuOy0dgkqTkfFUeZevudvS8c/exec";

// Data laporan
let reports = [];
let filteredReports = [];
let currentReport = null;
let selectedAfterPhotoFile = null;
let selectedStatus = "OPEN";

// ========================================
// INITIALIZE
// ========================================
document.addEventListener("DOMContentLoaded", () => {
  loadReports();

  document
    .getElementById("btnRefresh")
    ?.addEventListener("click", loadReports);

  document
    .getElementById("searchInput")
    ?.addEventListener("input", renderTable);

  document
    .getElementById("statusFilter")
    ?.addEventListener("change", renderTable);

  document
    .getElementById("reportTableBody")
    ?.addEventListener("click", event => {
      const button = event.target.closest(".btn-view");
      if (!button) return;

      const rowIndex = Number(button.dataset.reportIndex);
      const report = filteredReports[rowIndex];
      if (!report) return;

      openReportModal(report);
    });

  document
    .getElementById("modalClose")
    ?.addEventListener("click", closeReportModal);

  document
    .querySelector(".modal-overlay")
    ?.addEventListener("click", closeReportModal);

  document
    .getElementById("btnDownloadPdf")
    ?.addEventListener("click", downloadReportPDF);

  document
    .getElementById("btnSubmitClosing")
    ?.addEventListener("click", submitClosingNote);

  document
    .getElementById("modalInputClosingNote")
    ?.addEventListener("input", () => {
      const row = document.querySelector(".field-row.field-row-textarea");
      row?.classList.remove("error");
    });

  document.querySelectorAll(".status-button").forEach(button => {
    button.addEventListener("click", handleStatusButtonClick);
  });

  document
    .getElementById("modalInputAfterPhoto")
    ?.addEventListener("change", handleAfterPhotoChange);

  document
    .getElementById("btnPrint")
    ?.addEventListener("click", printReport);

  document
    .getElementById("modalPhotoBefore")
    ?.addEventListener("click", toggleZoomPhoto);

  document
    .getElementById("modalPhotoAfter")
    ?.addEventListener("click", toggleZoomPhoto);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeReportModal();
    }
  });
});

// ========================================
// LOAD REPORTS
// ========================================
async function loadReports() {
  try {
    const tbody =
      document.getElementById("reportTableBody");

    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="loading-row">
          Memuat data...
        </td>
      </tr>
    `;

    const response = await fetch(
      `${BASE_URL}?action=getHazardReports`
    );

    const result = await response.json();

    if (result.status !== "success") {
      throw new Error(
        result.message || "Gagal memuat data."
      );
    }

    reports = result.data || [];

    updateKPI();
    renderTable();

  } catch (error) {
    console.error(error);

    document.getElementById(
      "reportTableBody"
    ).innerHTML = `
      <tr>
        <td colspan="9" class="loading-row">
          Gagal memuat data.
        </td>
      </tr>
    `;
  }
}

function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}

function isReportVisible(report) {
  const user = getCurrentUser();
  if (!user) return false;
  if (String(user.role || "").toUpperCase() === "ADMIN") {
    return true;
  }

  const userName = normalizeString(user.nama || user.name || "");
  const userNik = normalizeString(user.nik || user.NIK || "");

  const reporterName = normalizeString(
    getReportValue(report, ["nama", "pelapor", "reporter", "reporter_name"], "")
  );
  const reporterNik = normalizeString(
    getReportValue(report, ["nik", "NIK", "reporter_nik"], "")
  );
  const picName = normalizeString(
    getReportValue(report, ["nama_pic", "pic", "penanggung_jawab"], "")
  );
  const picNik = normalizeString(
    getReportValue(report, ["nik_pic", "nip_pic", "pic_nik"], "")
  );

  return (
    (userName && (reporterName === userName || picName === userName)) ||
    (userNik && (reporterNik === userNik || picNik === userNik))
  );
}

function getVisibleReports() {
  return reports.filter(isReportVisible);
}

// ========================================
// UPDATE KPI
// ========================================
function updateKPI() {
  const visibleReports = getVisibleReports();

  const openCount =
    visibleReports.filter(
      r => (r.status_perbaikan || "OPEN") === "OPEN"
    ).length;

  const progressCount =
    visibleReports.filter(
      r => r.status_perbaikan === "PROGRESS"
    ).length;

  const closedCount =
    visibleReports.filter(
      r => r.status_perbaikan === "CLOSED"
    ).length;

  document.getElementById("kpiOpen").textContent =
    openCount;

  document.getElementById(
    "kpiProgress"
  ).textContent = progressCount;

  document.getElementById("kpiClosed").textContent =
    closedCount;
}

// ========================================
// RENDER TABLE
// ========================================
function renderTable() {
  const tbody =
    document.getElementById("reportTableBody");

  const search =
    document.getElementById("searchInput")
      .value
      .toLowerCase();

  const statusFilter =
    document.getElementById("statusFilter")
      .value;

  const visibleReports = getVisibleReports();
  const filtered = visibleReports.filter(report => {
    const status =
      report.status_perbaikan || "OPEN";

    const matchesSearch =
      !search ||
      (report.id || "")
        .toLowerCase()
        .includes(search) ||
      (report.nama || "")
        .toLowerCase()
        .includes(search) ||
      (report.nama_pic || "")
        .toLowerCase()
        .includes(search) ||
      (report.lokasi_bahaya || "")
        .toLowerCase()
        .includes(search);

    const matchesStatus =
      !statusFilter ||
      status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  filteredReports = filtered;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="loading-row">
          Tidak ada data.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((report, index) => {
      const status =
        report.status_perbaikan || "OPEN";

      const badgeClass =
        status === "OPEN"
          ? "status-open"
          : status === "PROGRESS"
          ? "status-progress"
          : "status-closed";

      return `
        <tr>
          <td><strong>${report.id || ""}</strong></td>
          <td>${formatDate(report.timestamp)}</td>
          <td>${report.nama || ""}</td>
          <td>${report.lokasi_bahaya || ""}</td>
          <td>${report.deskripsi_bahaya || ""}</td>
          <td>${getReportValue(report, ["tingkat_resiko", "tingkat_risiko", "risiko", "risk_level"], "-")}</td>
          <td>${report.nama_pic || ""}</td>
          <td>
            <span class="status-badge ${badgeClass}">
              ${status}
            </span>
          </td>
          <td>
            <button class="btn-primary btn-view" data-report-index="${index}">
              👁 View
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

// ========================================
// MODAL DETAIL
// ========================================
function getReportValue(report, keys = [], fallback = "-") {
  for (const key of keys) {
    const value = report[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
}

function getReportImage(report, keys = []) {
  const rawValue = getReportValue(report, keys, "");
  return rawValue ? normalizeImageUrl(rawValue) : "";
}

function normalizeImageUrl(url) {
  if (!url) return "";

  const trimmed = String(url).trim();

  // Format: https://drive.google.com/file/d/FILE_ID/view
  const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    const fileId = fileMatch[1];
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`;
  }

  // Format: ...?id=FILE_ID
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    const fileId = idMatch[1];
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`;
  }

  return trimmed;
}

function openReportModal(report) {
  const status = report.status_perbaikan || "OPEN";
  selectedStatus = status;
  const badgeClass =
    status === "OPEN"
      ? "status-open"
      : status === "PROGRESS"
      ? "status-progress"
      : "status-closed";

  const hazardNumber = getReportValue(report, ["id", "nomor_hazard", "no_hazard"], "-");
  currentReport = report;
  selectedAfterPhotoFile = null;
  const beforePhoto = getReportImage(report, ["upload_foto_bahaya", "upload_foto_bahaya_pic", "foto_temuan", "foto_before", "foto_before_url", "foto_bahaya"]);
  const afterPhoto = getReportImage(report, ["upload_foto_perbaikan_pic", "upload_foto_perbaikan", "foto_perbaikan", "foto_after", "foto_after_url", "after_photo"]);

  document.getElementById("modalStatusBadge").textContent = status;
  document.getElementById("modalStatusBadge").className = `status-badge ${badgeClass}`;
  document.getElementById("modalFieldStatus").textContent = status;
  document.querySelectorAll(".status-button").forEach(button => {
    button.classList.toggle("selected", button.dataset.status === status);
  });
  document.getElementById("modalHazardNumber").textContent = `Hazard #${hazardNumber}`;
  document.getElementById("modalFieldHazardNumber").textContent = hazardNumber;
  document.getElementById("modalFieldDate").textContent = formatDate(
    getReportValue(report, ["timestamp", "tanggal_laporan", "tgl_laporan", "tanggal_laporan_hazard"], "-")
  );
  document.getElementById("modalFieldReporter").textContent =
    getReportValue(report, ["nama", "pelapor"], "-");
  document.getElementById("modalFieldDepartment").textContent =
    getReportValue(report, ["departemen", "department", "bagian"], "-");
  document.getElementById("modalFieldLocation").textContent =
    getReportValue(report, ["lokasi_bahaya", "lokasi", "location"], "-");
  document.getElementById("modalFieldCategory").textContent =
    getReportValue(report, ["jenis_bahaya", "kategori_hazard", "kategori", "hazard_category"], "-");
  document.getElementById("modalFieldRisk").textContent =
    getReportValue(report, ["tingkat_resiko", "tingkat_risiko", "risiko", "risk_level"], "-");
  document.getElementById("modalFieldDescription").textContent =
    getReportValue(report, ["deskripsi_bahaya", "deskripsi", "description"], "-");
  document.getElementById("modalFieldRecommendation").textContent =
    getReportValue(report, [
      "tindakan_perbaikan_yang_diusulkan_kepada_penanggungjawab_pic",
      "tindakan_perbaikan_yang_langsung_dilakukan",
      "tindakan_usulan_pic",
      "rekomendasi_perbaikan",
      "recommendation",
      "rekomendasi",
      "tindakan_perbaikan",
    ],
    "-");
  document.getElementById("modalFieldPic").textContent =
    getReportValue(report, ["nama_pic", "pic", "penanggung_jawab"], "-");
  document.getElementById("modalFieldDueDate").textContent = formatDate(
    getReportValue(report, ["batas_waktu", "due_date", "tanggal_due", "due_date_laporan", "tgl_jatuh_tempo"], "-")
  );
  document.getElementById("modalFieldStatus").textContent = status;
  document.getElementById("modalInputClosingNote").value =
    getReportValue(report, ["catatan_closing", "closing_note", "catatan", "catatan_closing_pic"], "");
  document.getElementById("modalFieldClosingDate").textContent = formatDate(
    getReportValue(report, ["tanggal_closing", "closing_date", "tgl_closing", "tanggal_selesai", "tgl_selesai"], "-")
  );

  const beforeImage = document.getElementById("modalPhotoBefore");
  const beforePlaceholder = document.getElementById("modalPhotoBeforePlaceholder");
  const afterImage = document.getElementById("modalPhotoAfter");
  const afterPlaceholder = document.getElementById("modalPhotoAfterPlaceholder");
  const afterPhotoInput = document.getElementById("modalInputAfterPhoto");

  if (beforePhoto) {
    beforeImage.src = beforePhoto;
    beforeImage.alt = `Foto temuan hazard ${hazardNumber}`;
    beforeImage.classList.remove("hidden", "zoomed");
    beforePlaceholder.style.display = "none";
  } else {
    beforeImage.removeAttribute("src");
    beforeImage.classList.add("hidden");
    beforePlaceholder.style.display = "block";
  }

  if (afterPhoto) {
    afterImage.src = afterPhoto;
    afterImage.alt = `Foto perbaikan hazard ${hazardNumber}`;
    afterImage.classList.remove("hidden", "zoomed");
    afterPlaceholder.style.display = "none";
  } else {
    afterImage.removeAttribute("src");
    afterImage.classList.add("hidden");
    afterPlaceholder.style.display = "block";
  }

  if (afterPhotoInput) {
    afterPhotoInput.value = "";
  }

  document.body.classList.add("no-scroll");
  const modal = document.getElementById("reportModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeReportModal() {
  const modal = document.getElementById("reportModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");

  const beforeImage = document.getElementById("modalPhotoBefore");
  const afterImage = document.getElementById("modalPhotoAfter");
  beforeImage.classList.remove("zoomed");
  afterImage.classList.remove("zoomed");
}

function downloadReportPDF() {
  window.print();
}

async function submitClosingNote() {
  if (!currentReport) return;

  const noteField = document.getElementById("modalInputClosingNote");
    const note = noteField.value.trim();

    const noteRow = document.querySelector(
    ".field-row.field-row-textarea"
    );

    const photoInput = document.getElementById(
    "modalInputAfterPhoto"
    );

    // ========================================
    // VALIDASI KHUSUS JIKA STATUS = CLOSED
    // ========================================
    if (selectedStatus === "CLOSED") {
    // Validasi catatan closing
    if (!note) {
        noteRow?.classList.add("error");
        noteRow?.scrollIntoView({
        behavior: "smooth",
        block: "center"
        });
        noteField.focus();
        showToast(
        "Catatan Closing wajib diisi jika status CLOSED.",
        "error"
        );
        return;
    }

    // Validasi foto perbaikan:
    // wajib jika belum ada foto lama dan user belum memilih foto baru
    const existingAfterPhoto =
        currentReport?.upload_foto_perbaikan_pic ||
        currentReport?.upload_foto_perbaikan ||
        currentReport?.foto_perbaikan ||
        "";

    const hasNewPhoto = !!selectedAfterPhotoFile;
    const hasExistingPhoto = !!existingAfterPhoto;

    if (!hasNewPhoto && !hasExistingPhoto) {
        photoInput?.scrollIntoView({
        behavior: "smooth",
        block: "center"
        });

        showToast(
        "Upload Foto Perbaikan wajib diisi jika status CLOSED.",
        "error"
        );

        photoInput?.focus();
        return;
    }
    }

  const submitButton = document.getElementById("btnSubmitClosing");
  const originalText = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.innerHTML = "⏳ Menyimpan...";

  const closingDate = new Date().toISOString();

  try {
    const updateData = {
      id: currentReport.id,
      catatan_closing: note,
      tanggal_closing: closingDate,
      status_perbaikan: selectedStatus
    };

    if (selectedAfterPhotoFile) {
      const base64 = await readFileAsDataURL(selectedAfterPhotoFile);
      updateData.upload_foto_perbaikan_pic = base64;
    }

    const response = await fetch(BASE_URL, {
    method: "POST",
    body: JSON.stringify({
        action: "updateHazardReport",
        data: updateData
    })
    });

    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch (err) {
      throw new Error("Response bukan JSON valid: " + text);
    }

    if (result.status !== "success") {
      throw new Error(result.message || "Gagal memperbarui catatan closing.");
    }

    currentReport.catatan_closing = note;
    currentReport.tanggal_closing = closingDate;
    currentReport.status_perbaikan = selectedStatus;
    if (result.foto_perbaikan_url) {
    currentReport.upload_foto_perbaikan_pic =
    result.foto_perbaikan_url;
    }
    document.getElementById("modalFieldClosingDate").textContent = formatDate(closingDate);
    document.getElementById("modalFieldStatus").textContent = selectedStatus;
    document.querySelectorAll(".status-button").forEach(button => {
      button.classList.toggle("selected", button.dataset.status === selectedStatus);
    });
    showToast("Catatan closing berhasil disimpan.");
    renderTable();
  } catch (error) {
    console.error("Update closing note error:", error);
    showToast(
  "Terjadi kesalahan: " + error.message,
  "error"
);
  } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
  }
}

function handleStatusButtonClick(event) {
  const button = event.currentTarget;
  selectedStatus = button.dataset.status || "OPEN";
  document.getElementById("modalFieldStatus").textContent = selectedStatus;
  document.querySelectorAll(".status-button").forEach(btn => {
    btn.classList.toggle("selected", btn === button);
  });
}

function printReport() {
  window.print();
}

function handleAfterPhotoChange(event) {
  const file = event.target.files?.[0];
  selectedAfterPhotoFile = file || null;

  const afterImage = document.getElementById("modalPhotoAfter");
  const afterPlaceholder = document.getElementById("modalPhotoAfterPlaceholder");

  if (file && afterImage) {
    const reader = new FileReader();
    reader.onload = () => {
      afterImage.src = reader.result;
      afterImage.alt = `Foto perbaikan dipilih`;
      afterImage.classList.remove("hidden", "zoomed");
      afterPlaceholder.style.display = "none";
    };
    reader.readAsDataURL(file);
  } else if (afterImage) {
    afterImage.removeAttribute("src");
    afterImage.classList.add("hidden");
    afterPlaceholder.style.display = "block";
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function handleStatusButtonClick(event) {
  const button = event.currentTarget;
  selectedStatus = button.dataset.status || "OPEN";
  document.getElementById("modalFieldStatus").textContent = selectedStatus;
  document.querySelectorAll(".status-button").forEach(btn => {
    btn.classList.toggle("selected", btn === button);
  });
}

function toggleZoomPhoto(event) {
  const image = event.currentTarget;
  if (!image || !image.src) return;
  image.classList.toggle("zoomed");
}

// ========================================
// FORMAT DATE
// ========================================
function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (isNaN(date)) return value;

  return date.toLocaleDateString("id-ID");
}
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast ${type}`;

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}