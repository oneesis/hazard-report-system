const OneSapOfflineSync = {
  db: null,
  getApiUrl() {
    return typeof BASE_URL !== "undefined" 
      ? BASE_URL 
      : "/api";
  },
  
  async initDB() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("OneSapOfflineDB", 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("hazard_reports")) {
          db.createObjectStore("hazard_reports", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("inspection_reports")) {
          db.createObjectStore("inspection_reports", { keyPath: "id", autoIncrement: true });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => {
        console.error("IndexedDB error:", e.target.error);
        reject(e.target.error);
      };
    });
  },

  async queueHazardReport(data) {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("hazard_reports", "readwrite");
      const store = tx.objectStore("hazard_reports");
      const record = {
        data: data,
        queuedAt: new Date().toISOString()
      };
      const req = store.add(record);
      req.onsuccess = () => {
        console.log("Hazard report queued offline in IndexedDB");
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async queueInspectionReport(data) {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("inspection_reports", "readwrite");
      const store = tx.objectStore("inspection_reports");
      const record = {
        data: data,
        queuedAt: new Date().toISOString()
      };
      const req = store.add(record);
      req.onsuccess = () => {
        console.log("Inspection report queued offline in IndexedDB");
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getQueuedReports() {
    await this.initDB();
    const hazardList = await this.getAllFromStore("hazard_reports");
    const inspectionList = await this.getAllFromStore("inspection_reports");
    return { hazardList, inspectionList };
  },

  async getAllFromStore(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteFromStore(storeName, id) {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  async syncQueuedData() {
    if (!navigator.onLine) return;
    try {
      const { hazardList, inspectionList } = await this.getQueuedReports();
      if (hazardList.length === 0 && inspectionList.length === 0) return;

      console.log(`Syncing ${hazardList.length} hazard reports and ${inspectionList.length} inspection reports...`);
      this.showToast(`Menghubungkan... Menyinkronkan ${hazardList.length + inspectionList.length} laporan offline.`);

      for (const report of hazardList) {
        const success = await this.sendReport("submitHazardReport", report.data);
        if (success) {
          await this.deleteFromStore("hazard_reports", report.id);
          this.showNotification("Hazard Report Terkirim", "Laporan offline sukses diunggah ke server.");
        }
      }

      for (const report of inspectionList) {
        const success = await this.sendReport("submitInspectionReport", report.data);
        if (success) {
          await this.deleteFromStore("inspection_reports", report.id);
          this.showNotification("Inspeksi Terkirim", "Inspeksi offline sukses diunggah ke server.");
        }
      }
      
      this.showToast("Sinkronisasi laporan offline selesai!");
    } catch (e) {
      console.error("Sync failed:", e);
    }
  },

  async sendReport(action, data) {
    const url = this.getApiUrl();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action, data: data })
      });
      const text = await response.text();
      const result = JSON.parse(text);
      return result.status === "success";
    } catch (e) {
      console.warn("Failed to send report during sync:", e);
      return false;
    }
  },

  showNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "./assets/Logo EBL.png" });
    } else {
      this.showToast(`${title}: ${body}`);
    }
  },

  showToast(message) {
    let toast = document.getElementById("offlineSyncToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "offlineSyncToast";
      toast.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: #0f172a;
        color: #fff;
        padding: 14px 24px;
        border-radius: 12px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.1);
        display: flex;
        align-items: center;
        gap: 10px;
        animation: toastFadeIn 0.3s ease;
      `;
      document.body.appendChild(toast);
      
      const style = document.createElement("style");
      style.textContent = `
        @keyframes toastFadeIn {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `;
      document.head.appendChild(style);
    }
    toast.innerHTML = `<i class="fa-solid fa-cloud-arrow-up" style="color:#2563eb"></i> <span>${message}</span>`;
    toast.style.display = "flex";
    setTimeout(() => {
      toast.style.display = "none";
    }, 4500);
  }
};

// Start sync check when going online
window.addEventListener("online", () => {
  OneSapOfflineSync.syncQueuedData();
});

// Run once when loaded
window.addEventListener("DOMContentLoaded", () => {
  // Request notification permission
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
  // Try sync
  setTimeout(() => OneSapOfflineSync.syncQueuedData(), 1500);
});
