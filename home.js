document.addEventListener("DOMContentLoaded", initHomePage);

async function initHomePage() {
  initNotificationBell();

  try {
    const reports = await refreshNotifications();
    updateHomeKpis(reports);
    updateHighRiskList(reports);
  } catch (error) {
    console.error(error);
    const list = document.getElementById("highRiskList");
    if (list) {
      list.innerHTML = "<li>Gagal memuat data.</li>";
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshNotifications()
      .then(reports => {
        updateHomeKpis(reports);
        updateHighRiskList(reports);
      })
      .catch(console.error);
  });

  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    refreshNotifications()
      .then(reports => {
        updateHomeKpis(reports);
        updateHighRiskList(reports);
      })
      .catch(console.error);
  }, 120000);
}

function updateHomeKpis(reports) {
  const visible = getVisibleReports(reports);

  const totalEl = document.getElementById("kpiTotal");
  const openEl = document.getElementById("kpiOpen");
  const progressEl = document.getElementById("kpiProgress");
  const closedEl = document.getElementById("kpiClosed");

  if (totalEl) totalEl.textContent = visible.length;
  if (openEl) {
    openEl.textContent = visible.filter(
      r => getReportStatus(r) === "OPEN"
    ).length;
  }
  if (progressEl) {
    progressEl.textContent = visible.filter(
      r => getReportStatus(r) === "PROGRESS"
    ).length;
  }
  if (closedEl) {
    closedEl.textContent = visible.filter(
      r => getReportStatus(r) === "CLOSED"
    ).length;
  }
}

function updateHighRiskList(reports) {
  const list = document.getElementById("highRiskList");
  if (!list) return;

  const visible = getVisibleReports(reports);
  const highRisk = visible
    .filter(r => {
      const risk = (
        r.tingkat_risiko ||
        r.tingkat_resiko ||
        ""
      ).toUpperCase();
      return risk.includes("HIGH") || risk.includes("EXTREME");
    })
    .slice(0, 5);

  list.innerHTML = highRisk.length
    ? highRisk
        .map(
          r =>
            `<li><strong>${escapeHTML(getReportId(r) || "-")}</strong> - ${escapeHTML(r.deskripsi_bahaya || "-")} (${escapeHTML(r.nama_pic || "-")})</li>`
        )
        .join("")
    : "<li>Tidak ada hazard High/Extreme.</li>";
}
