const BASE_URL = "/api";

// ── Draft sync helpers (shared: Hazard, Inspeksi, PC, SBO) ────────
// Key per-akun agar draft tidak bercampur antar user di device sama
function _draftKey(formType) {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  return `draft_${formType}_${user?.nik || user?.nama || 'guest'}`;
}

let __draftSrvTimer = null;
function _draftSaveToServer(formType, draft) {
  clearTimeout(__draftSrvTimer);
  __draftSrvTimer = setTimeout(() => {
    fetch(BASE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveDraft', data: { form_type: formType, draft } }),
    }).catch(() => {});
  }, 4000);
}

function _draftClearServer(formType) {
  fetch(BASE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clearDraft', data: { form_type: formType } }),
  }).catch(() => {});
}

// Cek server — jika draft server lebih baru dari localTs, panggil onNewer(serverDraft)
async function _draftCheckServer(formType, localTs, onNewer) {
  try {
    const res  = await fetch(`${BASE_URL}?action=getDraft&form_type=${encodeURIComponent(formType)}`);
    const json = await res.json();
    const d = json.draft;
    if (!d) return;
    const ts = typeof d._ts === 'string' ? new Date(d._ts).getTime() : (d._ts || 0);
    if (ts > (localTs || 0)) onNewer({ ...d, _ts: ts });
  } catch {}
}

function _draftBanner(draft, onApply, onDiscard) {
  const ts = typeof draft._ts === 'string' ? new Date(draft._ts).getTime() : (draft._ts || 0);
  if (!ts) return;
  const ageMin = Math.round((Date.now() - ts) / 60000);
  const ageStr = ageMin < 1 ? 'baru saja'
    : ageMin < 60 ? `${ageMin} menit lalu`
    : `${Math.round(ageMin / 60)} jam lalu`;
  document.getElementById('_fdbanner')?.remove();
  const b = document.createElement('div');
  b.id = '_fdbanner';
  b.style.cssText = 'background:#fef3c7;border:1.5px solid #f59e0b;border-radius:12px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap';
  b.innerHTML = `<i class="fa-solid fa-clock-rotate-left" style="color:#d97706;font-size:1.1rem;flex-shrink:0"></i>
    <span style="font-size:.88rem;color:#78350f;font-weight:500;flex:1">Draft lebih baru dari perangkat lain (<strong>${ageStr}</strong>). Gunakan?</span>
    <button id="_fdApply" style="padding:7px 14px;background:#d97706;color:#fff;border:none;border-radius:8px;font-size:.8rem;font-weight:700;cursor:pointer"><i class="fa-solid fa-rotate-left"></i> Ya, Gunakan</button>
    <button id="_fdKeep" style="padding:7px 14px;background:transparent;color:#92400e;border:1.5px solid #fbbf24;border-radius:8px;font-size:.8rem;font-weight:600;cursor:pointer">Tetap Pakai Ini</button>`;
  b.querySelector('#_fdApply').onclick = () => { b.remove(); onApply(draft); };
  b.querySelector('#_fdKeep').onclick  = () => { b.remove(); if (onDiscard) onDiscard(); };
  const anchor = document.querySelector('.card, .form-card, .step-progress, form') || document.body;
  if (anchor.parentNode) anchor.parentNode.insertBefore(b, anchor); else document.body.prepend(b);
}

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

  const userName = normalizeString(user.nama || user.name || "");
  const userNik  = normalizeString(user.nik  || user.NIK  || "");

  // Cek PIC/reporter untuk SEMUA role (termasuk ADMIN dan SUPER_ADMIN)
  const reporterName = normalizeString(getReportValue(report, ["nama","pelapor","reporter","reporter_name","nama_pelapor","nama_pelapor_laporan"], ""));
  const reporterNik  = normalizeString(getReportValue(report, ["nik","reporter_nik","nik_reporter","NIK"], ""));
  const picName      = normalizeString(getReportValue(report, ["nama_pic","pic","penanggung_jawab","pic_name","nama_pic_laporan"], ""));
  const picNik       = normalizeString(getReportValue(report, ["nik_pic","nip_pic","pic_nik","nikpic","nik_pic_pic"], ""));

  const isPic      = (userNik && picNik && picNik === userNik) || (userName && picName && picName === userName);
  const isReporter = (userNik && reporterNik && reporterNik === userNik) || (userName && reporterName && reporterName === userName);

  if (isPic)      return "pic";
  if (isReporter) return "reporter";

  const role = String(user.role || "").toUpperCase().replace(/\s+/g, "_");
  // ADMIN/SUPER_ADMIN tanpa relasi personal = null (tidak ada notifikasi untuk laporan ini)
  if (role === "ADMIN" || role === "SUPER_ADMIN") return null;

  // USER: fallback broad check untuk laporan lama yang NIK-nya mungkin tidak ter-normalize
  if (userNik) {
    const maybeNik = normalizeString(getReportValue(report, ["nik","nik_pic","nik_pic_pic"], ""));
    if (maybeNik && maybeNik === userNik) return "reporter";
  }
  if (userName) {
    const maybeName = normalizeString(getReportValue(report, ["nama","nama_pic"], ""));
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
const _REPORTS_TTL = 120_000; // 2 menit in-memory
const _REPORTS_LS_TTL = 600_000; // 10 menit localStorage stale

function _reportsLsKey() {
  try { const u = getCurrentUser(); return u ? `_rpts_v1_${u.nik || u.nama}` : null; } catch { return null; }
}
function _reportsLsRead() {
  try {
    const key = _reportsLsKey(); if (!key) return null;
    const raw = localStorage.getItem(key); if (!raw) return null;
    const p = JSON.parse(raw);
    return (p && Array.isArray(p.data) && Date.now() - p.ts < _REPORTS_LS_TTL) ? p : null;
  } catch { return null; }
}
function _reportsLsWrite(data) {
  try { const key = _reportsLsKey(); if (key) localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

function invalidateReportsCache() { _fetchAllReportsCache = null; }

async function fetchAllReports() {
  if (_fetchAllReportsCache && Date.now() - _fetchAllReportsCache.ts < _REPORTS_TTL) {
    return _fetchAllReportsCache.data;
  }

  // stale-while-revalidate: kembalikan localStorage cache sekarang, fetch di background
  const ls = _reportsLsRead();
  if (ls && !_fetchAllReportsInFlight) {
    _fetchAllReportsCache = ls; // set in-memory dari ls agar call berikutnya dalam TTL juga instan
    _doFetchReports().then(data => {
      document.dispatchEvent(new CustomEvent('reportsRefreshed', { detail: data }));
    }).catch(() => {});
    return ls.data;
  }

  if (_fetchAllReportsInFlight) return _fetchAllReportsInFlight;
  return _doFetchReports();
}

async function _doFetchReports() {
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
    _reportsLsWrite(data);
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
