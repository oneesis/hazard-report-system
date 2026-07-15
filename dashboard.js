// Data laporan
let reports = [];
let filteredReports = [];
let currentReport = null;
let analyticsRange = 1;    // months: 1, 3, 6
let overdueOnlyFilter = false;
let paretoChartInstance = null;
let riskTrendChartInstance = null;
let paretoData = [];       // {label, count}[]
let paretoInRange = [];    // reports in current range, for drill-down
let selectedParetoIndex = -1;
let selectedAfterPhotoBase64List = [];
let selectedStatus = "OPEN";
let statusChartInstance = null;
let lokasiChartInstance = null;
let trendChartInstance = null;
let currentPage = 1;
const PAGE_SIZE = 20;

// ========================================
// INITIALIZE
// ========================================
document.addEventListener("DOMContentLoaded", () => {
  // Skip auto-init when included as utility by other pages
  if (typeof window.__skipDashboardInit !== 'undefined') return;

  initNotificationBell();
  refreshNotifications().catch(console.error);
  initAnalyticsSection();
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
    .getElementById("typeFilter")
    ?.addEventListener("change", renderTable);

  document
    .getElementById("dateRange")
    ?.addEventListener("change", renderTable);

  document
    .getElementById("btnExportCsv")
    ?.addEventListener("click", exportCsv);

  document
    .getElementById("reportTableBody")
    ?.addEventListener("click", event => {
      const button = event.target.closest(".btn-view");
      if (!button) return;

      const rowIndex = Number(button.dataset.reportIndex);
      const report = filteredReports[rowIndex];
      if (!report) return;

      window.location.href = 'laporan-detail.html?id=' + encodeURIComponent(getReportId(report));
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

  // Photo zoom close
  document.getElementById("photoZoomClose")?.addEventListener("click", () => {
    document.getElementById("photoZoomOverlay")?.classList.remove("active");
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

    reports = await fetchAllReports();

    // Jika ada data di server tetapi pengguna tidak melihatnya karena visibilitas,
    // tampilkan pesan informatif di tabel agar mudah didiagnosis.
    const visible = getVisibleReports(reports) || [];
    if (reports.length > 0 && visible.length === 0) {
document.getElementById('reportTableBody').innerHTML = `
        <tr>
          <td colspan="9" class="loading-row">
            Ditemukan ${reports.length} laporan di server, tetapi tidak ada yang terlihat untuk akun ini.
            Periksa: user login, peran (role), dan kesesuaian 'nama'/'nik' pada laporan.
          </td>
        </tr>
      `;
      // Tetap update KPI dengan nol agar tidak keliru
      updateKPI();
      return;
    }
    window.__reportsCache = reports;

    updateKPI();
    renderTable();
    updateAnalyticsKpi(reports);
    handleOpenReportQuery();

  } catch (error) {
    console.error(error);

    document.getElementById(
      "reportTableBody"
    ).innerHTML = `
      <tr>
        <td colspan="9" class="loading-row">
            Gagal memuat data. ${error && error.message ? '- ' + error.message : ''}
        </td>
      </tr>
    `;
  }
}

function isOverdue(report) {
  if ((report.status_perbaikan || 'OPEN') === 'CLOSED') return false;
  const due = new Date(getReportValue(report, ['batas_waktu', 'due_date'], ''));
  if (isNaN(due)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function getVisibleReportsFromCache() {
  return getVisibleReports(reports);
}

function handleOpenReportQuery() {
  const openId = new URLSearchParams(window.location.search).get("open");
  if (!openId) return;

  const report = reports.find(r => getReportId(r) === openId);
  if (!report || !isReportVisible(report)) return;

  window.location.href = 'laporan-detail.html?id=' + encodeURIComponent(openId);
  if (typeof markNotificationRead === "function") {
    markNotificationRead(openId);
  }
}

// ========================================
// UPDATE KPI
// ========================================
function updateKPI() {
  const visibleReports = getVisibleReportsFromCache();

  const openCount     = visibleReports.filter(r => (r.status_perbaikan || "OPEN") === "OPEN").length;
  const progressCount = visibleReports.filter(r => r.status_perbaikan === "PROGRESS").length;
  const closedCount   = visibleReports.filter(r => r.status_perbaikan === "CLOSED").length;

  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  set("kpiOpen",     openCount);
  set("kpiProgress", progressCount);
  set("kpiClosed",   closedCount);
  set("kpiOverdue",  visibleReports.filter(isOverdue).length);

  // Avg. closing days
  const closed = visibleReports.filter(r => r.status_perbaikan === "CLOSED");
  if (closed.length) {
    const totalDays = closed.reduce((sum, r) => {
      const open  = new Date(r.tanggal_laporan || r.timestamp || 0);
      const close = new Date(r.tanggal_closing || r.closing_date || 0);
      if (isNaN(open) || isNaN(close) || close <= open) return sum;
      return sum + Math.round((close - open) / 86400000);
    }, 0);
    set("kpiAvgClose", Math.round(totalDays / closed.length));
  } else {
    set("kpiAvgClose", "-");
  }
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
  const typeFilter =
    document.getElementById("typeFilter")
      ?.value || "";

  const dateRangeValue = (document.getElementById("dateRange")?.value || "").trim();
  let startDate = null;
  let endDate = null;
  if (dateRangeValue) {
    const parts = dateRangeValue.split(/\s*(?:to|\-|sampai)\s*/i);
    if (parts.length >= 2) {
      startDate = new Date(parts[0]);
      endDate = new Date(parts[1]);
    } else {
      startDate = new Date(parts[0]);
      endDate = new Date(parts[0]);
    }
    if (endDate) endDate.setHours(23, 59, 59, 999);
  }

  const visibleReports = getVisibleReportsFromCache();
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
      getDashboardLocation(report)
        .toLowerCase()
        .includes(search);

    const matchesStatus =
      !statusFilter ||
      status === statusFilter;
    const matchesType =
      !typeFilter ||
      getReportType(report) === typeFilter;

    const reportDate = parseReportDate(report);
    const matchesDate =
      (!startDate || (reportDate && reportDate >= startDate)) &&
      (!endDate || (reportDate && reportDate <= endDate));

    const matchesOverdue = !overdueOnlyFilter || isOverdue(report);
    return matchesSearch && matchesStatus && matchesType && matchesDate && matchesOverdue;
  });

  filteredReports = filtered;
  currentPage = 1;

  renderTablePage();
  renderDashboardCharts(filtered);
}

function renderTablePage() {
  const tbody = document.getElementById("reportTableBody");
  if (!tbody) return;

  if (filteredReports.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="loading-row">Tidak ada data.</td></tr>`;
    renderPagination();
    return;
  }

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, filteredReports.length);

  tbody.innerHTML = filteredReports.slice(startIdx, endIdx)
    .map((report, localIndex) => {
      const globalIndex = startIdx + localIndex;
      const status = report.status_perbaikan || "OPEN";
      const badgeClass = status === "OPEN" ? "status-open" : status === "PROGRESS" ? "status-progress" : "status-closed";
      const overdue = isOverdue(report);

      return `
        <tr${overdue ? ' class="row-overdue"' : ''}>
          <td><strong>${report.id || ""}</strong></td>
          <td><span class="report-type-badge ${getReportType(report).toLowerCase()}">${getReportTypeLabel(report)}</span></td>
          <td>${formatDate(report.timestamp)}</td>
          <td>${report.nama || ""}</td>
          <td>${getDashboardLocation(report)}</td>
          <td>${getDashboardDescription(report)}</td>
          <td>${report.nama_pic || ""}</td>
          <td><span class="status-badge ${badgeClass}">${status}</span>${overdue ? '<span class="badge-overdue">Overdue</span>' : ''}</td>
          <td>
            <button class="btn-view" data-report-index="${globalIndex}" aria-label="Lihat detail laporan">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5c-7 0-10 6.3-10 7s3 7 10 7 10-6.3 10-7-3-7-10-7zm0 12c-3.9 0-6.7-2.7-8-5 1.3-2.3 4.1-5 8-5s6.7 2.7 8 5c-1.3 2.3-4.1 5-8 5zm0-9a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>
              View
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  renderPagination();
}

function renderPagination() {
  const container = document.getElementById("tablePagination");
  if (!container) return;

  const total = filteredReports.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);

  if (total <= PAGE_SIZE) {
    container.innerHTML = `<div class="pagination-info">${total} laporan</div>`;
    return;
  }

  container.innerHTML = `
    <div class="pagination-info">Menampilkan ${start}–${end} dari ${total} laporan</div>
    <div class="pagination-controls">
      <button class="pagination-btn" ${currentPage <= 1 ? "disabled" : ""} onclick="goToPage(${currentPage - 1})" aria-label="Halaman sebelumnya">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <span class="pagination-page">${currentPage} / ${totalPages}</span>
      <button class="pagination-btn" ${currentPage >= totalPages ? "disabled" : ""} onclick="goToPage(${currentPage + 1})" aria-label="Halaman berikutnya">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
  `;
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, page), totalPages);
  renderTablePage();
  document.querySelector(".table-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDashboardCharts(reportsList) {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js is not loaded yet.");
    return;
  }

  // 1. Process Status Data
  let statusCounts = { OPEN: 0, PROGRESS: 0, CLOSED: 0 };
  reportsList.forEach(r => {
    const status = r.status_perbaikan || "OPEN";
    if (statusCounts[status] !== undefined) {
      statusCounts[status]++;
    }
  });

  // 2. Process Location Data
  let locationCounts = {};
  reportsList.forEach(r => {
    const loc = getDashboardLocation(r) || "Tidak Diketahui";
    const normalizedLoc = loc.trim();
    locationCounts[normalizedLoc] = (locationCounts[normalizedLoc] || 0) + 1;
  });

  let sortedLocations = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  let locationLabels = sortedLocations.map(item => item[0]);
  let locationData = sortedLocations.map(item => item[1]);

  if (locationLabels.length === 0) {
    locationLabels = ["Tidak Ada Data"];
    locationData = [0];
  }

  // --- Render Status Chart (Doughnut) ---
  const ctxStatus = document.getElementById("chartStatus")?.getContext("2d");
  if (ctxStatus) {
    if (statusChartInstance) {
      statusChartInstance.destroy();
    }

    statusChartInstance = new Chart(ctxStatus, {
      type: "doughnut",
      data: {
        labels: ["OPEN", "PROGRESS", "CLOSED"],
        datasets: [{
          data: [statusCounts.OPEN, statusCounts.PROGRESS, statusCounts.CLOSED],
          backgroundColor: ["#dc2626", "#d97706", "#16a34a"],
          borderWidth: 1,
          borderColor: "#ffffff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              font: {
                family: "Inter, system-ui, sans-serif",
                weight: "bold",
                size: 11
              },
              color: "#475569"
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const value = context.raw;
                const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                return ` ${context.label}: ${value} (${percentage}%)`;
              }
            }
          }
        },
        cutout: "70%"
      }
    });
  }

  // --- Render Trend Chart (Stacked Bar by Status) ---
  const ctxTrend = document.getElementById("chartTrend")?.getContext("2d");
  if (ctxTrend) {
    if (trendChartInstance) trendChartInstance.destroy();
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }), year: d.getFullYear(), month: d.getMonth() };
    });
    const byMonth = (status) => months.map(m =>
      reportsList.filter(r => {
        const d = parseReportDate(r);
        return d && d.getFullYear() === m.year && d.getMonth() === m.month &&
               (r.status_perbaikan || "OPEN") === status;
      }).length
    );
    trendChartInstance = new Chart(ctxTrend, {
      type: "bar",
      data: {
        labels: months.map(m => m.label),
        datasets: [
          { label: "OPEN",     data: byMonth("OPEN"),     backgroundColor: "rgba(220,38,38,.75)",  borderRadius: 4 },
          { label: "PROGRESS", data: byMonth("PROGRESS"), backgroundColor: "rgba(245,158,11,.75)", borderRadius: 4 },
          { label: "CLOSED",   data: byMonth("CLOSED"),   backgroundColor: "rgba(22,163,74,.75)",  borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 11 }, color: "#475569" } }
        },
        scales: {
          x: { stacked: true, ticks: { color: "#475569", font: { weight: "bold", size: 11 } }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: "#64748b", font: { size: 11 } }, grid: { color: "#f1f5f9" } }
        }
      }
    });
  }

  // --- Analytics: Leaderboard + Dept Breakdown ---
  renderLeaderboard(reportsList);
  renderDeptBreakdown(reportsList);

  // --- Render Location Chart (Horizontal Bar) ---
  const ctxLokasi = document.getElementById("chartLokasi")?.getContext("2d");
  if (ctxLokasi) {
    if (lokasiChartInstance) {
      lokasiChartInstance.destroy();
    }

    lokasiChartInstance = new Chart(ctxLokasi, {
      type: "bar",
      data: {
        labels: locationLabels,
        datasets: [{
          label: "Jumlah Temuan",
          data: locationData,
          backgroundColor: "rgba(37, 99, 235, 0.8)",
          hoverBackgroundColor: "#2563eb",
          borderRadius: 8,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: "#64748b",
              font: {
                family: "Inter, system-ui, sans-serif",
                size: 10
              }
            },
            grid: {
              color: "#f1f5f9"
            }
          },
          y: {
            ticks: {
              color: "#475569",
              font: {
                family: "Inter, system-ui, sans-serif",
                weight: "bold",
                size: 10
              }
            },
            grid: {
              display: false
            }
          }
        }
      }
    });
  }
}

// ========================================
// MODAL DETAIL
// ========================================
function getReportImages(report, keys = []) {
  const rawValue = getReportValue(report, keys, "");
  if (!rawValue) return [];
  const urls = String(rawValue).split(/[\n,;]+/).map(u => u.trim()).filter(Boolean);
  return urls.map(normalizeImageUrl);
}

function isInspectionReport(report) {
  return getReportType(report) === "INSPECTION";
}

function renderPhotosIntoContainer(containerId, placeholderText, imageUrls, altText) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = ""; // clear

  if (!imageUrls || imageUrls.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "photo-placeholder";
    placeholder.textContent = placeholderText;
    container.appendChild(placeholder);
    return;
  }

  // Set container layout based on count
  container.style.display = "grid";
  if (imageUrls.length === 1) {
    container.style.gridTemplateColumns = "1fr";
  } else if (imageUrls.length === 2) {
    container.style.gridTemplateColumns = "1fr 1fr";
  } else {
    container.style.gridTemplateColumns = "repeat(auto-fit, minmax(120px, 1fr))";
  }
  container.style.gap = "10px";
  container.style.padding = "10px";
  container.style.width = "100%";
  container.style.boxSizing = "border-box";

  imageUrls.forEach((url, index) => {
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
    img.src = url;
    img.alt = `${altText} - ${index + 1}`;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.cursor = "pointer";

    img.addEventListener("click", () => {
      const overlay = document.getElementById("photoZoomOverlay");
      const zoomImg = document.getElementById("zoomedPhoto");
      if (overlay && zoomImg) {
        zoomImg.src = url;
        overlay.classList.add("active");
      }
    });

    wrapper.appendChild(img);
    container.appendChild(wrapper);
  });
}

function getDashboardLocation(report) {
  return String(getReportValue(report, [
    "lokasi_bahaya",
    "lokasi_inspeksi",
    "lokasi",
    "location"
  ], ""));
}

function getDashboardDescription(report) {
  return String(getReportValue(report, [
    "deskripsi_bahaya",
    "temuan_inspeksi",
    "deskripsi",
    "description"
  ], ""));
}

function getDashboardCategory(report) {
  return getReportValue(report, [
    "jenis_bahaya",
    "jenis_inspeksi",
    "kategori_hazard",
    "kategori"
  ], "-");
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

function parseReportDate(report) {
  const rawValue = getReportValue(report, [
    "timestamp",
    "tanggal_laporan",
    "tgl_laporan",
    "tanggal_laporan_hazard",
    "tanggal_inspeksi",
    "tanggal_kejadian",
    "tanggal",
    "date"
  ], "");

  if (!rawValue) return null;

  const value = String(rawValue).trim();
  let parsed = new Date(value);
  if (!isNaN(parsed)) {
    return parsed;
  }

  const parts = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (parts) {
    const day = parts[1].padStart(2, "0");
    const month = parts[2].padStart(2, "0");
    const year = parts[3];
    parsed = new Date(`${year}-${month}-${day}`);
    return isNaN(parsed) ? null : parsed;
  }

  return null;
}

function getReportDateString(report) {
  return getReportValue(report, [
    "timestamp",
    "tanggal_laporan",
    "tgl_laporan",
    "tanggal_laporan_hazard",
    "tanggal_inspeksi",
    "tanggal_kejadian",
    "tanggal",
    "date"
  ], "");
}

function escapeCsv(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function exportCsv() {
  if (!filteredReports || filteredReports.length === 0) {
    showToast("Tidak ada data untuk diekspor.", "error");
    return;
  }

  const header = [
    "ID",
    "Jenis",
    "Tanggal",
    "Pelapor",
    "Lokasi",
    "Deskripsi Temuan",
    "PIC",
    "Status"
  ];

  const rows = filteredReports.map(report => {
    const status = report.status_perbaikan || "OPEN";
    return [
      escapeCsv(getReportValue(report, ["id", "nomor_hazard", "no_hazard"], "")),
      escapeCsv(getReportTypeLabel(report)),
      escapeCsv(formatDate(getReportDateString(report))),
      escapeCsv(getReportValue(report, ["nama", "pelapor"], "")),
      escapeCsv(getDashboardLocation(report)),
      escapeCsv(getDashboardDescription(report)),
      escapeCsv(getReportValue(report, ["nama_pic", "pic", "penanggung_jawab"], "")),
      escapeCsv(status)
    ].join(",");
  });

  const csvContent = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `one_sap_reports_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast("Data berhasil diekspor ke CSV.");
}

function downloadReportPDF() {
  window.print();
}

function openReportModal(report) {
  const inspection = isInspectionReport(report);
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
  selectedAfterPhotoBase64List = [];
  const beforePhotos = getReportImages(report, ["upload_foto_bahaya", "upload_foto_inspeksi", "upload_foto_bahaya_pic", "foto_temuan", "foto_before", "foto_before_url", "foto_bahaya"]);
  const afterPhotos = getReportImages(report, ["upload_foto_perbaikan_pic", "upload_foto_perbaikan", "foto_perbaikan", "foto_after", "foto_after_url", "after_photo"]);

  document.getElementById("modalStatusBadge").textContent = status;
  document.getElementById("modalStatusBadge").className = `status-badge ${badgeClass}`;
  document.getElementById("modalFieldStatus").textContent = status;
  document.querySelectorAll(".status-button").forEach(button => {
    button.classList.toggle("selected", button.dataset.status === status);
  });
  document.getElementById("modalReportTag").textContent = `Preview Laporan ${getReportTypeLabel(report)}`;
  document.getElementById("modalTitle").textContent = `Detail Laporan ${getReportTypeLabel(report)}`;
  document.getElementById("modalHazardNumber").textContent = `${getReportTypeLabel(report)} #${hazardNumber}`;
  document.getElementById("modalNumberLabel").textContent = inspection ? "Nomor Inspeksi" : "Nomor Hazard";
  document.getElementById("modalCategoryLabel").textContent = inspection ? "Jenis Inspeksi" : "Kategori Hazard";
  document.getElementById("modalRiskLabel").textContent = inspection ? "Shift Inspeksi" : "Tingkat Risiko";
  document.getElementById("modalDescriptionTitle").textContent = inspection ? "Temuan Inspeksi" : "Deskripsi Hazard";
  document.getElementById("modalFieldHazardNumber").textContent = hazardNumber;
  document.getElementById("modalFieldDate").textContent = formatDate(
    getReportValue(report, ["timestamp", "tanggal_laporan", "tgl_laporan", "tanggal_laporan_hazard", "tanggal_inspeksi", "tanggal_kejadian"], "-")
  );
  document.getElementById("modalFieldReporter").textContent =
    getReportValue(report, ["nama", "pelapor"], "-");
  document.getElementById("modalFieldDepartment").textContent =
    getReportValue(report, ["departemen", "department", "bagian"], "-");
  document.getElementById("modalFieldLocation").textContent =
    getDashboardLocation(report) || "-";
  document.getElementById("modalFieldCategory").textContent =
    getDashboardCategory(report);
  document.getElementById("modalFieldRisk").textContent =
    inspection
      ? getReportValue(report, ["shift_inspeksi", "shift_kejadian"], "-")
      : getReportValue(report, ["tingkat_resiko", "tingkat_risiko", "risiko", "risk_level"], "-");
  document.getElementById("modalFieldDescription").textContent =
    getDashboardDescription(report) || "-";
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
  document.getElementById("modalFieldStatement").textContent =
    getReportValue(report, ["pernyataan"], "-") === "Ya"
      ? "Pelapor telah menyetujui pernyataan laporan."
      : getReportValue(report, ["pernyataan"], "-");
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

  const afterPhotoInput = document.getElementById("modalInputAfterPhoto");
  const reporterSignature = document.getElementById("modalReporterSignature");
  const signatureValue = getReportValue(report, ["tanda_tangan", "signature"], "");

  renderPhotosIntoContainer("modalPhotoBeforeContainer", "Tidak ada foto temuan", beforePhotos, `Foto temuan ${getReportTypeLabel(report)}`);
  renderPhotosIntoContainer("modalPhotoAfterContainer", "Belum ada foto perbaikan", afterPhotos, `Foto perbaikan hazard`);

  if (afterPhotoInput) {
    afterPhotoInput.value = "";
  }
  if (signatureValue) {
    reporterSignature.src = signatureValue;
    reporterSignature.classList.remove("hidden");
  } else {
    reporterSignature.removeAttribute("src");
    reporterSignature.classList.add("hidden");
  }

  // "Buka halaman detail" link
  const detailLinkEl = document.getElementById('modalDetailLink');
  if (detailLinkEl) detailLinkEl.href = `laporan-detail.html?id=${encodeURIComponent(hazardNumber)}`;

  document.body.classList.add("no-scroll");
  const modal = document.getElementById("reportModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function handleStatusButtonClick(event) {
  const button = event.currentTarget;
  selectedStatus = button.dataset.status || "OPEN";
  document.getElementById("modalFieldStatus").textContent = selectedStatus;
  document.querySelectorAll(".status-button").forEach(btn => {
    btn.classList.toggle("selected", btn === button);
  });
}

function closeReportModal() {
  const modal = document.getElementById("reportModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");

}

async function submitClosingNote() {
  if (!currentReport) return;

  const noteField = document.getElementById("modalInputClosingNote");
  const note = noteField.value.trim();

  const noteRow = document.querySelector(".field-row.field-row-textarea");

  const photoInput = document.getElementById("modalInputAfterPhoto");

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

    const hasNewPhoto = selectedAfterPhotoBase64List && selectedAfterPhotoBase64List.length > 0;
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
  submitButton.innerHTML = "Menyimpan...";

  const closingDate = new Date().toISOString();

  try {
    const updateData = {
      id: currentReport.id,
      inspection_sheet: currentReport.inspection_sheet || "",
      catatan_closing: note,
      tanggal_closing: closingDate,
      status_perbaikan: selectedStatus
    };

    if (selectedAfterPhotoBase64List && selectedAfterPhotoBase64List.length > 0) {
      updateData.upload_foto_perbaikan_pic = JSON.stringify(selectedAfterPhotoBase64List);
    }

    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: isInspectionReport(currentReport)
          ? "updateInspectionReport"
          : "updateHazardReport",
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
      currentReport.upload_foto_perbaikan_pic = result.foto_perbaikan_url;
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

function printReport() {
  window.print();
}

function renderAfterPhotosPreview() {
  const container = document.getElementById("modalPhotoAfterContainer");
  const fileInput = document.getElementById("modalInputAfterPhoto");
  if (!container || !fileInput) return;

  container.innerHTML = "";

  if (selectedAfterPhotoBase64List.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "photo-placeholder";
    placeholder.id = "modalPhotoAfterPlaceholder";
    placeholder.textContent = "Belum ada foto perbaikan";
    container.appendChild(placeholder);
    return;
  }

  container.style.display = "grid";
  const totalItems = selectedAfterPhotoBase64List.length + 1; // +1 for the add button card
  if (totalItems === 1) {
    container.style.gridTemplateColumns = "1fr";
  } else if (totalItems === 2) {
    container.style.gridTemplateColumns = "1fr 1fr";
  } else {
    container.style.gridTemplateColumns = "repeat(auto-fit, minmax(120px, 1fr))";
  }
  container.style.gap = "10px";
  container.style.padding = "10px";

  selectedAfterPhotoBase64List.forEach((base64, index) => {
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
    img.alt = `Foto perbaikan dipilih - ${index + 1}`;
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
      selectedAfterPhotoBase64List.splice(index, 1);
      renderAfterPhotosPreview();
    });

    wrapper.appendChild(img);
    wrapper.appendChild(deleteBtn);
    container.appendChild(wrapper);
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
  container.appendChild(addCard);
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

function handleAfterPhotoChange(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  const invalidFile = files.find(file => !file.type.startsWith("image/"));
  if (invalidFile) {
    showToast("Semua file harus berupa gambar.", "error");
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

    selectedAfterPhotoBase64List = selectedAfterPhotoBase64List.concat(compressedArray);
    renderAfterPhotosPreview();
    event.target.value = "";
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
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

// ========================================
// LEADERBOARD
// ========================================
function renderLeaderboard(reportsList) {
  const el = document.getElementById("leaderboardList");
  if (!el) return;

  const counts = {};
  const depts  = {};
  reportsList.forEach(r => {
    const name = (r.nama || r.pelapor || "").trim();
    if (!name) return;
    counts[name] = (counts[name] || 0) + 1;
    if (!depts[name]) depts[name] = r.departemen || r.department || "";
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!sorted.length) { el.innerHTML = '<p style="color:#94a3b8;font-size:.82rem;padding:12px 0">Belum ada data</p>'; return; }

  const max = sorted[0][1];
  el.innerHTML = sorted.map(([name, count], i) => {
    const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    const dept     = escapeHTML(depts[name] || "");
    const pct      = Math.round((count / max) * 100);
    const rankCls  = i < 3 ? `rank-${i + 1}` : "";
    return `<div class="leader-item">
      <div class="leader-rank ${rankCls}">${i + 1}</div>
      <div class="leader-avatar">${escapeHTML(initials)}</div>
      <div class="leader-info">
        <div class="leader-name">${escapeHTML(name)}</div>
        ${dept ? `<div class="leader-dept">${dept}</div>` : ""}
      </div>
      <div class="leader-bar-wrap"><div class="leader-bar" style="width:${pct}%"></div></div>
      <div class="leader-count">${count}</div>
    </div>`;
  }).join("");
}

// ========================================
// DEPT BREAKDOWN
// ========================================
function renderDeptBreakdown(reportsList) {
  const el = document.getElementById("deptBreakdown");
  if (!el) return;

  const counts = {};
  reportsList.forEach(r => {
    const dept = (r.departemen || r.department || "Lainnya").trim() || "Lainnya";
    counts[dept] = (counts[dept] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!sorted.length) { el.innerHTML = '<p style="color:#94a3b8;font-size:.82rem;padding:12px 0">Belum ada data</p>'; return; }

  const max = sorted[0][1];
  el.innerHTML = sorted.map(([dept, count]) => {
    const pct = Math.round((count / max) * 100);
    return `<div class="dept-row">
      <div class="dept-name" title="${escapeHTML(dept)}">${escapeHTML(dept)}</div>
      <div class="dept-bar-wrap"><div class="dept-bar" style="width:${pct}%"></div></div>
      <div class="dept-count">${count}</div>
    </div>`;
  }).join("");
}

// ========================================
// ANALYTICS KPI (admin-only)
// ========================================

// TODO: Confirm actual date formats from a live data sample before relying on this.
// Sheet dates may be DD/MM/YYYY, ISO strings, or Excel serial numbers.
function parseSheetDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  // ISO / native parse (works for most standard formats)
  let d = new Date(s);
  if (!isNaN(d)) return d;

  // DD/MM/YYYY or D/M/YYYY (common Indonesian format)
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    d = new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
    if (!isNaN(d)) return d;
  }

  return null;
}

function initAnalyticsSection() {
  const role = String((typeof getCurrentUser === 'function' ? getCurrentUser() : null)?.role || '').toUpperCase();
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return;

  const section = document.getElementById('analyticsSection');
  if (!section) return;
  section.style.display = '';

  section.querySelectorAll('.range-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      section.querySelectorAll('.range-chip').forEach(b => b.classList.remove('range-chip--active'));
      btn.classList.add('range-chip--active');
      analyticsRange = Number(btn.dataset.range);
      updateAnalyticsKpi(reports);
    });
  });

  document.getElementById('akpiOverdueCard')?.addEventListener('click', () => {
    overdueOnlyFilter = !overdueOnlyFilter;
    document.getElementById('akpiOverdueCard').classList.toggle('akpi-overdue-card--active', overdueOnlyFilter);
    renderTable();
    document.querySelector('.table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('drilldownClose')?.addEventListener('click', closeDrilldown);
}

function updateAnalyticsKpi(allReports) {
  const role = String((typeof getCurrentUser === 'function' ? getCurrentUser() : null)?.role || '').toUpperCase();
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return;

  const visible = getVisibleReports(allReports) || [];
  const now = new Date();

  const rangeStart = new Date(now.getFullYear(), now.getMonth() - analyticsRange + 1, 1);
  rangeStart.setHours(0, 0, 0, 0);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - analyticsRange * 2 + 1, 1);
  prevStart.setHours(0, 0, 0, 0);

  const dateKeys = ['timestamp','tanggal_laporan','tanggal_inspeksi','tanggal_kejadian','tanggal','date'];
  const inRange = visible.filter(r => {
    const d = parseSheetDate(getReportValue(r, dateKeys, ''));
    return d && d >= rangeStart;
  });
  const inPrev = visible.filter(r => {
    const d = parseSheetDate(getReportValue(r, dateKeys, ''));
    return d && d >= prevStart && d < rangeStart;
  });

  // 1. Total Laporan
  const total = inRange.length;
  const el1 = document.getElementById('akpiTotal');
  if (el1) el1.textContent = total.toLocaleString('id-ID');

  const deltaEl = document.getElementById('akpiTotalDelta');
  if (deltaEl) {
    if (inPrev.length > 0) {
      const pct = Math.round(((total - inPrev.length) / inPrev.length) * 100);
      deltaEl.textContent = (pct >= 0 ? '+' : '') + pct + '% vs periode sebelumnya';
      deltaEl.className = 'akpi-delta ' + (pct >= 0 ? 'akpi-delta--up' : 'akpi-delta--down');
    } else {
      deltaEl.textContent = '';
    }
  }

  // 2. % Closing Tepat Waktu
  const closed = inRange.filter(r => r.status_perbaikan === 'CLOSED');
  const ontimeEl = document.getElementById('akpiOntime');
  const ontimeTag = document.getElementById('akpiOntimeTag');
  if (closed.length > 0) {
    const ontime = closed.filter(r => {
      const closing = parseSheetDate(getReportValue(r, ['tanggal_closing','closing_date','tgl_closing','tanggal_selesai'], ''));
      const due     = parseSheetDate(getReportValue(r, ['batas_waktu','due_date','tanggal_due'], ''));
      return closing && due && closing <= due;
    });
    const pct = Math.round((ontime.length / closed.length) * 100);
    if (ontimeEl) {
      ontimeEl.textContent = pct + '%';
      ontimeEl.style.color = pct >= 90 ? 'var(--color-status-closed)'
                           : pct >= 70 ? 'var(--color-accent)'
                           : 'var(--color-status-overdue)';
    }
    if (ontimeTag) {
      ontimeTag.textContent = pct >= 90 ? 'High Perf' : pct >= 70 ? 'Cukup' : 'Perlu Perhatian';
      ontimeTag.className = 'akpi-tag ' + (pct >= 90 ? 'akpi-tag--green' : pct >= 70 ? 'akpi-tag--sun' : 'akpi-tag--red');
    }
  } else {
    if (ontimeEl) { ontimeEl.textContent = '—'; ontimeEl.style.color = ''; }
    if (ontimeTag) { ontimeTag.textContent = 'Tidak ada data'; ontimeTag.className = 'akpi-tag'; }
  }

  // 3. Rata-rata hari closing
  const avgEl = document.getElementById('akpiAvgDays');
  if (avgEl) {
    let totalDays = 0, count = 0;
    closed.forEach(r => {
      const open  = parseSheetDate(getReportValue(r, dateKeys, ''));
      const close = parseSheetDate(getReportValue(r, ['tanggal_closing','closing_date','tgl_closing','tanggal_selesai'], ''));
      if (!open || !close || close <= open) return;
      totalDays += (close - open) / 86400000;
      count++;
    });
    avgEl.textContent = count > 0 ? (totalDays / count).toFixed(1) : '—';
  }

  // 4. Overdue (all visible, not range-gated — you always want total open overdue)
  const overdueEl = document.getElementById('akpiOverdueCount');
  if (overdueEl) overdueEl.textContent = visible.filter(isOverdue).length;

  renderParetoChart(allReports);
  renderRiskTrend(allReports);
  renderAging(allReports);
  renderTopLokasi();
  renderHotspot();
}

// ========================================
// PARETO CHART + DRILL-DOWN (Fase 3)
// ========================================
function renderParetoChart(allReports) {
  const role = String((typeof getCurrentUser === 'function' ? getCurrentUser() : null)?.role || '').toUpperCase();
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return;

  const ctx = document.getElementById('chartPareto')?.getContext('2d');
  if (!ctx) return;

  const visible = getVisibleReports(allReports) || [];
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - analyticsRange + 1, 1);
  rangeStart.setHours(0, 0, 0, 0);

  const dateKeys = ['timestamp','tanggal_laporan','tanggal_inspeksi','tanggal_kejadian','tanggal','date'];
  paretoInRange = visible.filter(r => {
    const d = parseSheetDate(getReportValue(r, dateKeys, ''));
    return d && d >= rangeStart;
  });

  // Count by ketidaksesuaian_bahaya (hazard-only field)
  const counts = {};
  paretoInRange.forEach(r => {
    const val = String(r.ketidaksesuaian_bahaya || '').trim();
    if (!val) return;
    counts[val] = (counts[val] || 0) + 1;
  });

  paretoData = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));

  const card = document.getElementById('paretoCard');
  if (!paretoData.length) {
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = '';

  selectedParetoIndex = -1;
  closeDrilldown();

  const total = paretoData.reduce((s, d) => s + d.count, 0);
  let running = 0;
  const cumulative = paretoData.map(d => { running += d.count; return Math.round((running / total) * 100); });

  if (paretoChartInstance) paretoChartInstance.destroy();

  paretoChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: paretoData.map(d => d.label),
      datasets: [
        {
          type: 'bar',
          label: 'Jumlah',
          data: paretoData.map(d => d.count),
          backgroundColor: paretoData.map(() => '#003087'),
          borderWidth: 0,
          borderRadius: 4,
          yAxisID: 'y',
          order: 2
        },
        {
          type: 'line',
          label: 'Kumulatif %',
          data: cumulative,
          borderColor: '#F2A900',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#F2A900',
          tension: 0.3,
          yAxisID: 'y2',
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        openDrilldown(elements[0].index);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.datasetIndex === 1
              ? ` Kumulatif: ${ctx.raw}%`
              : ` Jumlah: ${ctx.raw}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#475569', font: { size: 11, weight: '600', family: 'Inter,sans-serif' }, maxRotation: 30 }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { precision: 0, color: '#64748b', font: { size: 11 } }
        },
        y2: {
          position: 'right',
          min: 0, max: 100,
          grid: { display: false },
          ticks: { color: '#F2A900', font: { size: 11 }, callback: v => v + '%' }
        }
      }
    }
  });
}

function openDrilldown(idx) {
  const item = paretoData[idx];
  if (!item) return;

  selectedParetoIndex = idx;

  // Highlight selected bar, fade others
  if (paretoChartInstance) {
    paretoChartInstance.data.datasets[0].backgroundColor = paretoData.map((_, i) =>
      i === idx ? '#F2A900' : 'rgba(0,48,135,0.35)'
    );
    paretoChartInstance.update('none');
  }

  // Count sub_ketidaksesuaian for selected category
  const subCounts = {};
  paretoInRange.forEach(r => {
    if (String(r.ketidaksesuaian_bahaya || '').trim() !== item.label) return;
    const sub = String(r.sub_ketidaksesuaian || '').trim();
    if (!sub) return;
    subCounts[sub] = (subCounts[sub] || 0) + 1;
  });

  const subs = Object.entries(subCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const catTotal = subs.reduce((s, [, c]) => s + c, 0);

  const breadcrumb = document.getElementById('drilldownBreadcrumb');
  if (breadcrumb) breadcrumb.textContent = `Semua Ketidaksesuaian / ${item.label}`;

  const barsEl = document.getElementById('drilldownBars');
  if (barsEl) {
    if (!subs.length) {
      barsEl.innerHTML = '<p class="drilldown-empty">Tidak ada data sub ketidaksesuaian.</p>';
    } else {
      barsEl.innerHTML = subs.map(([sub, count]) => {
        const pct = catTotal > 0 ? Math.round((count / catTotal) * 100) : 0;
        return `<div class="drilldown-row">
          <div class="drilldown-row-label" title="${escapeHTML(sub)}">${escapeHTML(sub)}</div>
          <div class="drilldown-row-bar-wrap"><div class="drilldown-row-bar" style="width:${pct}%"></div></div>
          <div class="drilldown-row-count">${count}</div>
          <span class="drilldown-row-pct">${pct}%</span>
        </div>`;
      }).join('');
    }
  }

  document.getElementById('paretoDrilldown').style.display = '';
}

function closeDrilldown() {
  const panel = document.getElementById('paretoDrilldown');
  if (panel) panel.style.display = 'none';

  if (paretoChartInstance && selectedParetoIndex !== -1) {
    selectedParetoIndex = -1;
    paretoChartInstance.data.datasets[0].backgroundColor = paretoData.map(() => '#003087');
    paretoChartInstance.update('none');
  }
}

// ========================================
// TREN TINGKAT RISIKO (Fase 4)
// ========================================
function renderRiskTrend(allReports) {
  const role = String((typeof getCurrentUser === 'function' ? getCurrentUser() : null)?.role || '').toUpperCase();
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return;

  const ctx = document.getElementById('chartRiskTrend')?.getContext('2d');
  if (!ctx) return;

  const visible = getVisibleReports(allReports) || [];
  const now = new Date();

  // Fixed 6 months per spec
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }), year: d.getFullYear(), month: d.getMonth() };
  });

  const dateKeys = ['timestamp','tanggal_laporan','tanggal_inspeksi','tanggal_kejadian','tanggal','date'];

  function normalizeRisk(r) {
    const val = String(getReportValue(r, ['tingkat_resiko','tingkat_risiko','risiko','risk_level'], '')).toLowerCase();
    if (val.includes('rendah') || val.includes('low'))   return 'Rendah';
    if (val.includes('sedang') || val.includes('med'))   return 'Sedang';
    if (val.includes('tinggi') || val.includes('high'))  return 'Tinggi';
    return null;
  }

  const byMonth = level => months.map(m =>
    visible.filter(r => {
      const d = parseSheetDate(getReportValue(r, dateKeys, ''));
      return d && d.getFullYear() === m.year && d.getMonth() === m.month && normalizeRisk(r) === level;
    }).length
  );

  if (riskTrendChartInstance) riskTrendChartInstance.destroy();

  riskTrendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        { label: 'Rendah', data: byMonth('Rendah'), backgroundColor: '#16A34A', borderRadius: 3 },
        { label: 'Sedang', data: byMonth('Sedang'), backgroundColor: '#F2A900', borderRadius: 3 },
        { label: 'Tinggi', data: byMonth('Tinggi'), backgroundColor: '#DC2626', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: '#475569', font: { size: 11 } } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { precision: 0, color: '#64748b', font: { size: 11 } } }
      }
    }
  });
}

// ========================================
// AGING LAPORAN OPEN (Fase 4)
// ========================================
function renderAging(allReports) {
  const role = String((typeof getCurrentUser === 'function' ? getCurrentUser() : null)?.role || '').toUpperCase();
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return;

  const visible = getVisibleReports(allReports) || [];
  const openReports = visible.filter(r => (r.status_perbaikan || 'OPEN') !== 'CLOSED');
  const now = Date.now();
  const dateKeys = ['timestamp','tanggal_laporan','tanggal_inspeksi','tanggal_kejadian','tanggal','date'];

  let c0_7 = 0, c8_14 = 0, cOver14 = 0;
  openReports.forEach(r => {
    const d = parseSheetDate(getReportValue(r, dateKeys, ''));
    if (!d) return;
    const age = Math.floor((now - d) / 86400000);
    if (age <= 7)       c0_7++;
    else if (age <= 14) c8_14++;
    else                cOver14++;
  });

  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  set('agingCount0_7', c0_7);
  set('agingCount8_14', c8_14);
  set('agingCountOver14', cOver14);
}

// ========================================
// TOP 5 LOKASI BAHAYA (Fase 4)
// ========================================
function renderTopLokasi() {
  const el = document.getElementById('topLokasiList');
  if (!el) return;

  const counts = {};
  paretoInRange.forEach(r => {
    const loc = getDashboardLocation(r).trim();
    if (!loc) return;
    counts[loc] = (counts[loc] || 0) + 1;
  });

  const top5 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top5.length) { el.innerHTML = '<p class="top-lokasi-empty">Tidak ada data</p>'; return; }

  const max = top5[0][1];
  el.innerHTML = top5.map(([loc, count], i) => {
    const pct = Math.round((count / max) * 100);
    const color = i === 0 ? 'var(--color-accent)' : 'var(--color-primary)';
    return `<div class="top-lokasi-row">
      <div class="top-lokasi-label" title="${escapeHTML(loc)}">${escapeHTML(loc)}</div>
      <div class="top-lokasi-bar-wrap"><div class="top-lokasi-bar" style="width:${pct}%;background:${color}"></div></div>
      <div class="top-lokasi-count">${count}</div>
    </div>`;
  }).join('');
}

// ========================================
// HOTSPOT MATRIKS (Fase 4)
// ========================================
function renderHotspot() {
  const tbody = document.getElementById('hotspotTableBody');
  if (!tbody) return;

  const counts = {};
  paretoInRange.forEach(r => {
    const sub = String(r.sub_ketidaksesuaian || '').trim();
    const loc = getDashboardLocation(r).trim();
    if (!sub || !loc) return;
    const key = sub + '\x00' + loc;
    counts[key] = (counts[key] || 0) + 1;
  });

  const top5 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top5.length) { tbody.innerHTML = '<tr><td colspan="3" class="hotspot-empty">Tidak ada data</td></tr>'; return; }

  tbody.innerHTML = top5.map(([key, count]) => {
    const sep = key.indexOf('\x00');
    const sub = key.slice(0, sep);
    const loc = key.slice(sep + 1);
    return `<tr>
      <td class="hotspot-td-sub">${escapeHTML(sub)}</td>
      <td class="hotspot-td-loc">${escapeHTML(loc)}</td>
      <td><span class="hotspot-badge">${count}</span></td>
    </tr>`;
  }).join('');
}
