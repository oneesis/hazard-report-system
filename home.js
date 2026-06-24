document.addEventListener("DOMContentLoaded", initHomePage);

async function initHomePage() {
  initNotificationBell();

  // Trigger GSAP entrance animations synchronously and instantly to avoid element hiding during network delays
  if (typeof gsap !== "undefined") {
    try {
      // Temporarily disable CSS transitions during animation setup to avoid conflicts
      const animatedSelectors = [".hero-top", ".logos .logo", "h1", ".hero > p", ".actions .btn", ".feature-card", ".card"];
      animatedSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.classList.add("no-transition"));
      });

      gsap.from(".hero-top", { 
        opacity: 0, 
        y: -20, 
        duration: 0.8, 
        ease: "power2.out", 
        clearProps: "all",
        onComplete: () => document.querySelectorAll(".hero-top").forEach(el => el.classList.remove("no-transition"))
      });
      
      gsap.from(".logos .logo", { 
        opacity: 0, 
        scale: 0.9, 
        duration: 0.8, 
        delay: 0.2, 
        stagger: 0.15, 
        ease: "back.out(1.7)", 
        clearProps: "all",
        onComplete: () => document.querySelectorAll(".logos .logo").forEach(el => el.classList.remove("no-transition"))
      });
      
      gsap.from("h1", { 
        opacity: 0, 
        y: 20, 
        duration: 0.8, 
        delay: 0.3, 
        ease: "power3.out", 
        clearProps: "all",
        onComplete: () => document.querySelectorAll("h1").forEach(el => el.classList.remove("no-transition"))
      });
      
      gsap.from(".hero > p", { 
        opacity: 0, 
        y: 15, 
        duration: 0.8, 
        delay: 0.4, 
        ease: "power3.out", 
        clearProps: "all",
        onComplete: () => document.querySelectorAll(".hero > p").forEach(el => el.classList.remove("no-transition"))
      });
      
      gsap.from(".actions .btn", { 
        opacity: 0, 
        y: 20, 
        duration: 0.6, 
        delay: 0.5, 
        stagger: 0.1, 
        ease: "back.out(1.2)", 
        clearProps: "all",
        onComplete: () => document.querySelectorAll(".actions .btn").forEach(el => el.classList.remove("no-transition"))
      });
      
      gsap.from(".feature-card", { 
        opacity: 0, 
        y: 30, 
        duration: 0.8, 
        delay: 0.7, 
        stagger: 0.15, 
        ease: "power2.out", 
        clearProps: "all",
        onComplete: () => document.querySelectorAll(".feature-card").forEach(el => el.classList.remove("no-transition"))
      });
      
      gsap.from(".card", { 
        opacity: 0, 
        y: 30, 
        duration: 0.8, 
        delay: 0.9, 
        ease: "power2.out", 
        clearProps: "all",
        onComplete: () => document.querySelectorAll(".card").forEach(el => el.classList.remove("no-transition"))
      });
    } catch (e) {
      console.warn("GSAP animation error, falling back to static layout:", e);
      // Clean up classes if error occurs
      document.querySelectorAll(".no-transition").forEach(el => el.classList.remove("no-transition"));
    }
  }

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
