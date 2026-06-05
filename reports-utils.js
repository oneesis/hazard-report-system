const BASE_URL =
  "https://script.google.com/macros/s/AKfycbxyxWUQuFddbDxsqq3TNB_K6SBzdDbAFPgrf0DZr38niuOy0dgkqTkfFUeZevudvS8c/exec";

function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}

function getReportValue(report, keys = [], fallback = "-") {
  for (const key of keys) {
    const value = report[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
}

function getReportId(report) {
  return String(
    getReportValue(report, ["id", "nomor_hazard", "no_hazard"], "")
  ).trim();
}

function getReportStatus(report) {
  return report.status_perbaikan || "OPEN";
}

function getUserRelation(report) {
  const user = getCurrentUser();
  if (!user) return null;

  if (String(user.role || "").toUpperCase() === "ADMIN") {
    return "admin";
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

  const isPic =
    (userNik && picNik && picNik === userNik) ||
    (userName && picName && picName === userName);
  const isReporter =
    (userNik && reporterNik && reporterNik === userNik) ||
    (userName && reporterName && reporterName === userName);

  if (isPic) return "pic";
  if (isReporter) return "reporter";
  return null;
}

function isReportVisible(report) {
  const user = getCurrentUser();
  if (!user) return false;
  if (String(user.role || "").toUpperCase() === "ADMIN") {
    return true;
  }
  return getUserRelation(report) !== null;
}

function getVisibleReports(reports) {
  return (reports || []).filter(isReportVisible);
}

async function fetchHazardReports() {
  const response = await fetch(`${BASE_URL}?action=getHazardReports`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.status !== "success") {
    throw new Error(result.message || "Gagal memuat data.");
  }

  return result.data || [];
}

function formatNotificationDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date)) return String(value);
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
