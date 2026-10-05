// Antrean laporan OFFLINE (IndexedDB) + kirim otomatis saat online.
// Modul: Hazard, Inspeksi, SBO, PC. Saat tak ada jaringan, form memanggil
// OneSapOfflineSync.queue(action, data); begitu online, antrean dikirim urut.
// - Pengunci (in-tab + navigator.locks antar-tab) mencegah laporan terkirim DOBEL.
// - Penanda (pill di bawah layar): menunggu jaringan → mengirim i/n → terkirim.
// - Coba ulang otomatis: event 'online', saat halaman dibuka, & tiap 60 detik.
// - Event window 'offlinequeuechange' {detail:{pending, state}} utk UI lain (beranda).
const OneSapOfflineSync = {
  db: null,
  _syncing: false,
  LABELS: {
    submitHazardReport: 'Hazard Report',
    submitInspectionReport: 'Inspeksi',
    submitSBOReport: 'SBO',
    submitPCReport: 'Personal Contact',
  },
  // Store lama (v1) tetap dibaca supaya antrean yang sudah ada tidak hilang.
  LEGACY: { hazard_reports: 'submitHazardReport', inspection_reports: 'submitInspectionReport' },

  getApiUrl() {
    return typeof BASE_URL !== 'undefined' ? BASE_URL : '/api';
  },

  async initDB() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('OneSapOfflineDB', 2);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of ['hazard_reports', 'inspection_reports', 'queue']) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      request.onerror = (e) => { console.error('IndexedDB error:', e.target.error); reject(e.target.error); };
    });
  },

  _req(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async queue(action, data) {
    await this.initDB();
    await this._req('queue', 'readwrite', s => s.add({ action, data, queuedAt: new Date().toISOString() }));
    this.refreshIndicator();
    return true;
  },
  // API lama — dipertahankan untuk pemanggil yang ada.
  queueHazardReport(data) { return this.queue('submitHazardReport', data); },
  queueInspectionReport(data) { return this.queue('submitInspectionReport', data); },

  async listAll() {
    await this.initDB();
    const out = [];
    for (const [store, action] of Object.entries(this.LEGACY)) {
      for (const r of await this._req(store, 'readonly', s => s.getAll())) out.push({ store, id: r.id, action, data: r.data });
    }
    for (const r of await this._req('queue', 'readonly', s => s.getAll())) out.push({ store: 'queue', id: r.id, action: r.action, data: r.data });
    return out;
  },

  async pendingCount() {
    try { return (await this.listAll()).length; } catch { return 0; }
  },

  async syncQueuedData() {
    if (!navigator.onLine || this._syncing) return;
    const run = async () => {
      if (this._syncing) return;
      this._syncing = true;
      try {
        const items = await this.listAll();
        if (!items.length) return;
        let ok = 0, fail = 0;
        for (let i = 0; i < items.length; i++) {
          this.setIndicator('syncing', `Mengirim laporan offline ${i + 1}/${items.length}…`, items.length - i);
          const it = items[i];
          if (await this.sendReport(it.action, it.data)) {
            await this._req(it.store, 'readwrite', s => s.delete(it.id));
            ok++;
          } else {
            fail++;
          }
        }
        if (fail) this.setIndicator('failed', `${fail} laporan gagal terkirim — dicoba lagi otomatis`, fail, 6000);
        else this.setIndicator('done', `${ok} laporan offline terkirim`, 0, 4000);
        if (ok && typeof invalidateReportsCache === 'function') invalidateReportsCache();
      } catch (e) {
        console.error('Sync failed:', e);
      } finally {
        this._syncing = false;
      }
    };
    // Antar-tab: hanya satu tab yang mengirim; tab lain lewati (ifAvailable).
    if (navigator.locks?.request) await navigator.locks.request('onesap-offline-sync', { ifAvailable: true }, lock => lock && run());
    else await run();
  },

  async sendReport(action, data) {
    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
      });
      const result = JSON.parse(await response.text());
      return result.status === 'success';
    } catch (e) {
      console.warn('Failed to send report during sync:', e);
      return false;
    }
  },

  // ── Penanda (pill) ───────────────────────────────────────────
  _pill: null,
  _hideTimer: null,
  setIndicator(state, text, pending, autoHideMs) {
    window.dispatchEvent(new CustomEvent('offlinequeuechange', { detail: { pending, state } }));
    if (!document.body) return;
    if (!this._pill) {
      const st = document.createElement('style');
      st.textContent = `
        .osync-pill{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9000;display:none;
          align-items:center;gap:8px;max-width:calc(100vw - 32px);padding:10px 16px;border-radius:999px;
          font:600 .82rem/1.2 Inter,system-ui,sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:default}
        .osync-pill.show{display:flex}
        .osync-pill.waiting{background:#b45309;cursor:pointer}.osync-pill.syncing{background:#00205B}
        .osync-pill.done{background:#15803d}.osync-pill.failed{background:#b91c1c}
        .osync-spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:osyncSpin .8s linear infinite;flex-shrink:0}
        @keyframes osyncSpin{to{transform:rotate(360deg)}}
        @media (min-width:769px){.osync-pill{bottom:24px}}`;
      document.head.appendChild(st);
      this._pill = document.createElement('div');
      this._pill.className = 'osync-pill';
      this._pill.setAttribute('role', 'status');
      this._pill.addEventListener('click', () => { if (navigator.onLine) this.syncQueuedData(); });
      document.body.appendChild(this._pill);
    }
    clearTimeout(this._hideTimer);
    const icon = state === 'syncing' ? '<span class="osync-spin"></span>'
      : state === 'done' ? '<i class="fa-solid fa-circle-check"></i>'
      : state === 'failed' ? '<i class="fa-solid fa-triangle-exclamation"></i>'
      : '<i class="fa-solid fa-cloud-arrow-up"></i>';
    this._pill.className = `osync-pill ${state} show`;
    this._pill.innerHTML = `${icon}<span>${text}</span>`;
    if (autoHideMs) this._hideTimer = setTimeout(() => this.refreshIndicator(), autoHideMs);
  },

  async refreshIndicator() {
    if (this._syncing) return;
    const n = await this.pendingCount();
    if (n > 0) {
      this.setIndicator('waiting', navigator.onLine
        ? `${n} laporan offline menunggu dikirim — ketuk untuk kirim`
        : `${n} laporan tersimpan di HP · menunggu jaringan`, n);
    } else {
      window.dispatchEvent(new CustomEvent('offlinequeuechange', { detail: { pending: 0, state: 'idle' } }));
      if (this._pill) this._pill.classList.remove('show');
    }
  },
};

window.addEventListener('online', () => OneSapOfflineSync.syncQueuedData());
window.addEventListener('offline', () => OneSapOfflineSync.refreshIndicator());
window.addEventListener('DOMContentLoaded', () => {
  OneSapOfflineSync.refreshIndicator();
  setTimeout(() => OneSapOfflineSync.syncQueuedData(), 1500);
  // Jaring pengaman: event 'online' kadang tak terpicu (jaringan lemah/berganti).
  setInterval(async () => {
    if (navigator.onLine && !OneSapOfflineSync._syncing && await OneSapOfflineSync.pendingCount()) {
      OneSapOfflineSync.syncQueuedData();
    }
  }, 60_000);
});
