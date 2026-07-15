const NOTIF_PREVIEW_COUNT = 5;

function getNotificationUserKey() {
  const user = getCurrentUser();
  return normalizeString(user?.nik || user?.NIK || user?.nama || "guest") || "guest";
}

function storageKey(suffix) {
  return `report_notification_${suffix}_v3_${getNotificationUserKey()}`;
}

function loadReadIds() {
  try {
    const raw = localStorage.getItem(storageKey("read"));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(readSet) {
  localStorage.setItem(storageKey("read"), JSON.stringify([...readSet]));
}

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(storageKey("snapshot"));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSnapshot(snapshot) {
  localStorage.setItem(storageKey("snapshot"), JSON.stringify(snapshot));
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(storageKey("history"));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(storageKey("history"), JSON.stringify(history.slice(0, 100)));
}

function isRecentReport(report, maxHours = 72) {
  const raw = getReportValue(
    report,
    ["timestamp", "tanggal_laporan", "tgl_laporan"],
    ""
  );
  const date = new Date(raw);
  if (isNaN(date)) return true;
  return Date.now() - date.getTime() <= maxHours * 60 * 60 * 1000;
}

function seedNotificationsFromReports(reports) {
  const snapshot = {};
  getVisibleReports(reports).forEach(report => {
    const id = getReportId(report);
    if (!id) return;
    snapshot[id] = { status: getReportStatus(report) };
  });
  saveSnapshot(snapshot);
  localStorage.setItem(storageKey("init"), "1");
}

function ensureNotificationsInitialized(reports) {
  if (localStorage.getItem(storageKey("init"))) return;
  seedNotificationsFromReports(reports);
}

function upsertHistoryEntry(history, entry) {
  const index = history.findIndex(item => item.id === entry.id);
  if (index >= 0) {
    history[index] = { ...history[index], ...entry };
  } else {
    history.unshift(entry);
  }
}

function syncNotificationHistory(reports) {
  const visible = getVisibleReports(reports);
  const snapshot = loadSnapshot();
  const readIds = loadReadIds();
  const history = loadHistory();
  let changed = false;

  visible.forEach(report => {
    const id = getReportId(report);
    if (!id) return;

    const status = getReportStatus(report);
    const relation = getUserRelation(report) || "admin";
    const prev = snapshot[id];
    let kind = null;

    const inHistory = history.some(item => item.id === id);

    if (!prev) {
      kind = "new";
    } else if (prev.status !== status) {
      kind = "status";
      readIds.delete(id);
    } else if (!inHistory && isRecentReport(report)) {
      // PIC / user lain yang baru login tetap dapat notifikasi laporan baru
      kind = "new";
    }

    if (!kind) return;

    snapshot[id] = { status };

    upsertHistoryEntry(history, {
      id,
      kind,
      relation,
      status,
      message: buildNotificationMessage(report, kind, relation),
      date: getReportValue(
        report,
        ["timestamp", "tanggal_laporan", "tgl_laporan"],
        ""
      ),
      roleLabel:
        relation === "pic"
          ? "PIC"
          : relation === "reporter"
          ? "Pelapor"
          : "Admin",
      updatedAt: Date.now(),
    });

    changed = true;
  });

  if (changed) {
    saveSnapshot(snapshot);
    saveReadIds(readIds);
    saveHistory(history);
  }
}

function markNotificationRead(reportId) {
  if (!reportId) return;

  const readIds = loadReadIds();
  readIds.add(reportId);
  saveReadIds(readIds);

  const snapshot = loadSnapshot();
  const report = (window.__reportsCache || []).find(
    r => getReportId(r) === reportId
  );
  if (report) {
    snapshot[reportId] = { status: getReportStatus(report) };
    saveSnapshot(snapshot);
  }
}

function buildNotificationMessage(report, kind, relation) {
  const id = getReportId(report);
  const status = getReportStatus(report);
  const desc = getReportValue(
    report,
    ["deskripsi_bahaya", "temuan_inspeksi", "deskripsi", "description"],
    ""
  );
  const shortDesc =
    desc.length > 60 ? `${desc.slice(0, 57)}...` : desc || "Tanpa deskripsi";

  if (kind === "status") {
    return `Status laporan ${id} diperbarui menjadi ${status}`;
  }

  const typeLabel = getReportTypeLabel(report);
  if (relation === "pic") {
    return `Anda ditugaskan sebagai PIC ${typeLabel} — ${id}: ${shortDesc}`;
  }
  if (relation === "reporter") {
    return `Laporan ${typeLabel} Anda tercatat — ${id}: ${shortDesc}`;
  }
  return `Laporan ${typeLabel} baru — ${id}: ${shortDesc}`;
}

function buildNotificationItems(reports) {
  syncNotificationHistory(reports);

  const readIds = loadReadIds();
  const history = loadHistory();

  return history
    .map(entry => {
      const report = reports.find(r => getReportId(r) === entry.id);
      if (!report) return null;

      // Only show notifications that match current user's visibility/role
      if (!isReportVisible(report)) return null;

      const relation = getUserRelation(report) || entry.relation || "admin";
      const status = getReportStatus(report);

      return {
        id: entry.id,
        report,
        kind: entry.kind,
        relation,
        status,
        unread: !readIds.has(entry.id),
        message:
          entry.message ||
          buildNotificationMessage(report, entry.kind, relation),
        date:
          entry.date ||
          getReportValue(
            report,
            ["timestamp", "tanggal_laporan", "tgl_laporan"],
            ""
          ),
        roleLabel:
          entry.roleLabel ||
          (relation === "pic"
            ? "PIC"
            : relation === "reporter"
            ? "Pelapor"
            : "Admin"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const da = new Date(a.date);
      const db = new Date(b.date);
      if (!isNaN(da) && !isNaN(db)) return db - da;
      return String(b.id).localeCompare(String(a.id));
    });
}

function getDashboardReportUrl(reportId) {
  return `laporan-detail.html?id=${encodeURIComponent(reportId)}`;
}

let notificationItems = [];
let notificationListExpanded = false;

function renderNotificationBadge() {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;

  const unreadCount = notificationItems.filter(item => item.unread).length;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.classList.remove("hidden");
  } else {
    badge.textContent = "";
    badge.classList.add("hidden");
  }
}

function renderNotificationItemHtml(item) {
  const dateLabel = formatNotificationDate(item.date);
  const unreadClass = item.unread ? " unread" : "";
  const readDot = item.unread
    ? '<span class="notification-dot" aria-hidden="true"></span>'
    : "";

  return `
    <li>
      <a
        href="${getDashboardReportUrl(item.id)}"
        class="notification-item${unreadClass}"
        data-report-id="${escapeHTML(item.id)}"
      >
        <span class="notification-item-top">
          <strong>${readDot}${escapeHTML(item.id)}</strong>
          <span class="notification-role">${escapeHTML(item.roleLabel)}</span>
        </span>
        <span class="notification-message">${escapeHTML(item.message)}</span>
        <span class="notification-meta">
          <span class="status-pill">${escapeHTML(item.status)}</span>
          ${dateLabel ? `<span>${escapeHTML(dateLabel)}</span>` : ""}
        </span>
      </a>
    </li>
  `;
}

function renderNotificationList() {
  const list = document.getElementById("notificationList");
  const footer = document.getElementById("notificationListFooter");
  if (!list) return;

  if (!notificationItems.length) {
    list.innerHTML =
      '<li class="notification-empty">Belum ada notifikasi laporan.</li>';
    if (footer) footer.innerHTML = "";
    return;
  }

  const hasMore = notificationItems.length > NOTIF_PREVIEW_COUNT;
  const itemsToShow = notificationListExpanded
    ? notificationItems
    : notificationItems.slice(0, NOTIF_PREVIEW_COUNT);

  list.innerHTML = itemsToShow.map(renderNotificationItemHtml).join("");
  list.classList.toggle("expanded", notificationListExpanded);

  if (footer) {
    if (!hasMore) {
      footer.innerHTML = "";
      return;
    }

    if (notificationListExpanded) {
      footer.innerHTML = `
        <button type="button" class="notification-toggle" data-action="collapse">
          Tampilkan lebih sedikit
        </button>
      `;
    } else {
      footer.innerHTML = `
        <button type="button" class="notification-toggle" data-action="expand">
          Klik untuk lihat laporan sebelumnya (${notificationItems.length - NOTIF_PREVIEW_COUNT} lainnya)
        </button>
      `;
    }
  }
}

function closeNotificationMenu() {
  const menu = document.getElementById("notificationMenu");
  const button = document.getElementById("notificationButton");
  menu?.classList.remove("open");
  button?.setAttribute("aria-expanded", "false");
}

function toggleNotificationMenu() {
  const menu = document.getElementById("notificationMenu");
  const button = document.getElementById("notificationButton");
  if (!menu || !button) return;

  closeUserMenu();

  const isOpen = menu.classList.toggle("open");
  button.setAttribute("aria-expanded", String(isOpen));

  if (!isOpen) {
    notificationListExpanded = false;
    renderNotificationList();
  }
}

function initNotificationBell() {
  const mount = document.getElementById("notificationBell");
  if (!mount || mount.dataset.ready === "1") return;

  mount.dataset.ready = "1";
  mount.innerHTML = `
    <div class="notification-menu" id="notificationMenu">
      <button
        id="notificationButton"
        class="notification-button"
        type="button"
        aria-label="Notifikasi laporan"
        aria-haspopup="true"
        aria-expanded="false"
        aria-controls="notificationDropdown"
      >
        <i class="fa-solid fa-bell" aria-hidden="true"></i>
        <span id="notificationBadge" class="notification-badge hidden">0</span>
      </button>
      <div
        id="notificationDropdown"
        class="notification-dropdown"
        role="region"
        aria-label="Daftar notifikasi"
      >
        <div class="notification-dropdown-header">
          <h3>Notifikasi</h3>
          <span id="notificationSummary" class="notification-summary"></span>
        </div>
        <ul id="notificationList" class="notification-list">
          <li class="notification-empty">Memuat...</li>
        </ul>
        <div id="notificationListFooter" class="notification-list-footer"></div>
      </div>
    </div>
  `;

  document
    .getElementById("notificationButton")
    ?.addEventListener("click", event => {
      event.stopPropagation();
      toggleNotificationMenu();
    });

  document.getElementById("notificationList")?.addEventListener("click", event => {
    const link = event.target.closest(".notification-item");
    if (!link) return;
    const reportId = link.dataset.reportId;
    if (reportId) {
      markNotificationRead(reportId);
      const item = notificationItems.find(n => n.id === reportId);
      if (item) item.unread = false;
      renderNotificationBadge();
      renderNotificationList();
    }
    closeNotificationMenu();
  });

  document
    .getElementById("notificationListFooter")
    ?.addEventListener("click", event => {
      const button = event.target.closest(".notification-toggle");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      notificationListExpanded = button.dataset.action === "expand";
      renderNotificationList();
    });

  document.addEventListener("click", event => {
    const menu = document.getElementById("notificationMenu");
    if (menu && !menu.contains(event.target)) {
      closeNotificationMenu();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeNotificationMenu();
  });
}

async function refreshNotifications() {
  const reports = await fetchAllReports();
  window.__reportsCache = reports;

  ensureNotificationsInitialized(reports);
  notificationItems = buildNotificationItems(reports);

  const summary = document.getElementById("notificationSummary");
  if (summary) {
    const unread = notificationItems.filter(item => item.unread).length;
    const total = notificationItems.length;
    summary.textContent = unread
      ? `${unread} belum dibaca`
      : total
      ? `${total} riwayat`
      : "Kosong";
  }

  renderNotificationBadge();
  renderNotificationList();
  return reports;
}
