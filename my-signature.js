// Tanda tangan tersimpan (fitur 2.1, 2026-10-07) — form Hazard & Inspeksi.
// Saat kotak tanda tangan terlihat & masih kosong, tanda tangan tersimpan dipasang
// otomatis. Bila pelapor menggambar BARU, tanda tangan itu disimpan setelah laporan
// terkirim (yang lama dipakai apa adanya tidak disimpan ulang — kalau disimpan ulang,
// gambar akan mengecil tiap kali karena diletakkan dengan margin).
// Backend: getMySignature / saveMySignature (api/index.js).
const MySignature = (() => {
  let saved = null;      // null = belum dimuat
  let drawnNew = false;  // pelapor menggambar goresan baru
  const pad = () => (typeof signaturePad !== 'undefined' ? signaturePad : null);

  async function fetchSaved() {
    if (saved !== null) return saved;
    try { const j = await (await fetch('/api?action=getMySignature')).json(); saved = j?.data || ''; }
    catch { saved = ''; }
    return saved;
  }

  function note(canvas, text) {
    let el = canvas.parentElement.querySelector('.sig-saved-note');
    if (!el) {
      el = document.createElement('div');
      el.className = 'sig-saved-note';
      el.style.cssText = 'font-size:.78rem;color:#15803d;font-weight:600;margin-top:6px';
      canvas.insertAdjacentElement('afterend', el);
    }
    el.textContent = text;
  }

  // Letakkan gambar di tengah kanvas, proporsional (tidak gepeng).
  function draw(canvas, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
        const k = Math.min(cw / img.width, ch / img.height) * 0.92;
        const w = img.width * k, h = img.height * k;
        Promise.resolve(pad().fromDataURL(url, { width: w, height: h, xOffset: (cw - w) / 2, yOffset: (ch - h) / 2 }))
          .then(resolve, resolve);
      };
      img.onerror = resolve;
      img.src = url;
    });
  }

  function init() {
    const canvas = document.getElementById('signaturePad');
    if (!canvas || !('IntersectionObserver' in window)) return;
    fetchSaved();
    canvas.addEventListener('pointerdown', () => {
      drawnNew = true;
      if (saved) note(canvas, 'Tanda tangan baru — akan disimpan untuk laporan berikutnya.');
    });
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      const p = pad();
      if (!p || !p.isEmpty() || drawnNew) return; // draft sudah berisi TTD / sudah menggambar
      const url = await fetchSaved();
      io.disconnect();
      if (!url || !p.isEmpty()) return;
      await draw(canvas, url);
      note(canvas, '✓ Tanda tangan tersimpan dipakai otomatis. Tekan "Hapus Tanda Tangan" untuk membuat yang baru.');
    }, { rootMargin: '0px 0px 150% 0px' }); // terpasang begitu halamannya dibuka, tanpa perlu scroll
    io.observe(canvas);
  }

  // Dipanggil setelah laporan berhasil terkirim.
  function remember(dataUrl) {
    if (!drawnNew || !/^data:image\//.test(String(dataUrl || ''))) return;
    saved = dataUrl;
    drawnNew = false;
    fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveMySignature', data: { tanda_tangan: dataUrl } }),
    }).catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
  return { remember };
})();
