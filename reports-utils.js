const BASE_URL = "/api";

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

function getReportType(report) {
  return String(report.report_type || "HAZARD").trim().toUpperCase();
}

function getReportTypeLabel(report) {
  return getReportType(report) === "INSPECTION" ? "Inspeksi" : "Hazard";
}

function getUserRelation(report) {
  const user = getCurrentUser();
  if (!user) return null;

  if (String(user.role || "").toUpperCase() === "ADMIN") {
    return "admin";
  }

  const userName = normalizeString(user.nama || user.name || "");
  const userNik = normalizeString(user.nik || user.NIK || "");

  // Robust aliasing because backend key normalization may differ.
  const reporterName = normalizeString(
    getReportValue(
      report,
      [
        "nama",
        "pelapor",
        "reporter",
        "reporter_name",
        // aliases that might appear due to sheet/header mismatch
        "nama_pelapor",
        "nama_pelapor_laporan"
      ],
      ""
    )
  );
  const reporterNik = normalizeString(
    getReportValue(
      report,
      ["nik", "reporter_nik", "nik_reporter", "NIK"],
      ""
    )
  );

  const picName = normalizeString(
    getReportValue(
      report,
      [
        "nama_pic",
        "pic",
        "penanggung_jawab",
        "pic_name",
        "nama_pic_laporan"
      ],
      ""
    )
  );
  const picNik = normalizeString(
    getReportValue(
      report,
      [
        "nik_pic",
        "nip_pic",
        "pic_nik",
        // possible variations
        "nikpic",
        "nik_pic_pic"
      ],
      ""
    )
  );

  const isPic =
    (userNik && picNik && picNik === userNik) ||
    (userName && picName && picName === userName);
  const isReporter =
    (userNik && reporterNik && reporterNik === userNik) ||
    (userName && reporterName && reporterName === userName);

  if (isPic) return "pic";
  if (isReporter) return "reporter";

  // Fallback: if we cannot map relation but the report contains any user-identifying field,
  // treat as visible to avoid empty dashboard due to key/header mismatch.
  if (userNik) {
    const maybeNik = normalizeString(getReportValue(report, ["nik", "nik_pic", "nik_pic_pic"], ""));
    if (maybeNik && maybeNik === userNik) return "reporter";
  }
  if (userName) {
    const maybeName = normalizeString(getReportValue(report, ["nama", "nama_pic"], ""));
    if (maybeName && maybeName === userName) return "reporter";
  }

  return null;
}




function isReportVisible(report) {
  const user = getCurrentUser();
  if (!user) return false;

  const role = String(user.role || "").toUpperCase().replace(/\s+/g, "_");

  if (role === "SUPER_ADMIN") return true;

  if (role === "ADMIN") {
    // Admin hanya lihat laporan dari perusahaan sendiri atau di mana mereka jadi PIC
    const myPerusahaan = String(user.perusahaan || "").trim().toLowerCase();
    const myNama = String(user.nama || "").trim().toLowerCase();
    const myNik  = String(user.nik  || "").trim().toLowerCase();
    const rPerusahaan = String(report.perusahaan || report.company || "").trim().toLowerCase();
    const rPic        = String(report.nama_pic || report.pic || "").trim().toLowerCase();
    const rNikPic     = String(report.nik_pic || "").trim().toLowerCase();
    return (myPerusahaan && rPerusahaan === myPerusahaan) ||
           (myNama && rPic === myNama) ||
           (myNik  && rNikPic === myNik);
  }

  // USER: hanya terlihat jika pelapor atau PIC
  return getUserRelation(report) !== null;
}


function getVisibleReports(reports) {
  return (reports || []).filter(isReportVisible);
}

async function fetchHazardReports() {
  return fetchAllReports();
}

let _fetchAllReportsInFlight = null;
let _fetchAllReportsCache = null; // { data, ts }
const _REPORTS_TTL = 60_000;

function invalidateReportsCache() { _fetchAllReportsCache = null; }

async function fetchAllReports() {
  if (_fetchAllReportsCache && Date.now() - _fetchAllReportsCache.ts < _REPORTS_TTL) {
    return _fetchAllReportsCache.data;
  }
  if (_fetchAllReportsInFlight) return _fetchAllReportsInFlight;
  _fetchAllReportsInFlight = (async () => {
    let response;
    try {
      const user = getCurrentUser();
      const params = new URLSearchParams({ action: "getAllReports" });
      if (user) {
        if (user.nik) params.append("nik", user.nik);
        if (user.nama) params.append("nama", user.nama);
        if (user.role) params.append("role", user.role);
      }
      response = await fetch(`${BASE_URL}?${params.toString()}`);
    } catch (err) {
      throw new Error('Network error saat memanggil API: ' + (err && err.message ? err.message : err));
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (err) {
      throw new Error('Response API bukan JSON valid: ' + text);
    }

    if (result.status !== "success") {
      throw new Error(result.message || "Gagal memuat data.");
    }

    const data = result.data || [];
    _fetchAllReportsCache = { data, ts: Date.now() };
    return data;
  })().finally(() => { _fetchAllReportsInFlight = null; });
  return _fetchAllReportsInFlight;
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
