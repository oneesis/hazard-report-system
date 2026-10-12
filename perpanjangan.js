// Perpanjangan batas waktu laporan (A6, 2026-10-12). PIC mengajukan tanggal baru + alasan;
// pelapor (atau admin/SHE) menyetujui/menolak. Server: ajukanPerpanjangan / putuskanPerpanjangan.
const Perpanjangan = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const tgl = (v) => { const d = new Date(String(v).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? (v || '-') : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const kotak = 'margin:12px 0;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;font-size:.88rem;color:#1e293b';
  const tombol = (warna) => `border:none;border-radius:8px;padding:9px 14px;font-weight:700;font-size:.85rem;cursor:pointer;background:${warna};color:#fff`;

  async function kirim(action, data, el, onDone) {
    el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const res = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
      const j = await res.json();
      if (j.status !== 'success') throw new Error(j.message || 'Gagal');
      if (typeof showToast === 'function') showToast(j.message);
      onDone && onDone();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Gagal: ' + e.message, 'error');
      el.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  }

  /** opts: { report, status, batas, isPic, bolehPutus, onDone } */
  function render(el, o) {
    if (!el) return;
    const p = o.report.perpanjangan || null;
    const aktif = !['CLOSED', 'FOLLOWUP'].includes(o.status);
    let html = '';
    if (p?.status === 'PENDING') {
      html = `<div style="${kotak}">
        <div style="font-weight:700;color:#003087;margin-bottom:4px"><i class="fa-solid fa-calendar-plus"></i> Pengajuan perpanjangan batas waktu</div>
        <div>Dari <b>${esc(tgl(p.batas_lama))}</b> menjadi <b>${esc(tgl(p.tanggal_baru))}</b> — diajukan ${esc(p.by_nama || 'PIC')}</div>
        <div style="color:#475569;margin-top:2px">Alasan: ${esc(p.alasan)}</div>
        ${o.bolehPutus && aktif ? `
          <textarea data-pp="catatan" rows="2" placeholder="Catatan (wajib bila menolak)" style="width:100%;margin-top:8px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;box-sizing:border-box"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button type="button" data-pp="setuju" style="${tombol('#16a34a')}"><i class="fa-solid fa-check"></i> Setujui</button>
            <button type="button" data-pp="tolak" style="${tombol('#dc2626')}"><i class="fa-solid fa-xmark"></i> Tolak</button>
          </div>` : '<div style="color:#64748b;margin-top:6px;font-size:.82rem">Menunggu keputusan pelapor / SHE.</div>'}
      </div>`;
    } else {
      const terakhir = p ? `<div style="color:#64748b;font-size:.82rem;margin-bottom:6px">Perpanjangan terakhir ${p.status === 'DISETUJUI' ? 'disetujui' : 'ditolak'} oleh ${esc(p.keputusan_by || '-')}${p.catatan ? ` — "${esc(p.catatan)}"` : ''}.</div>` : '';
      if (o.isPic && aktif) {
        html = `<div style="${kotak}">${terakhir}
          <details>
            <summary style="cursor:pointer;font-weight:700;color:#003087"><i class="fa-solid fa-calendar-plus"></i> Ajukan perpanjangan batas waktu</summary>
            <div style="margin-top:8px;color:#475569;font-size:.82rem">Batas waktu sekarang: <b>${esc(tgl(o.batas))}</b>. Ajukan bila perbaikan memang butuh waktu lebih — disetujui pelapor/SHE.</div>
            <label style="display:block;margin-top:8px;font-weight:600;font-size:.82rem">Tanggal batas waktu baru</label>
            <input type="date" data-pp="tanggal" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit">
            <label style="display:block;margin-top:8px;font-weight:600;font-size:.82rem">Alasan</label>
            <textarea data-pp="alasan" rows="2" placeholder="mis. menunggu suku cadang dari vendor" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;box-sizing:border-box"></textarea>
            <button type="button" data-pp="ajukan" style="${tombol('#003087')};margin-top:8px"><i class="fa-solid fa-paper-plane"></i> Kirim pengajuan</button>
          </details>
        </div>`;
      } else if (terakhir) html = `<div style="${kotak}">${terakhir}</div>`;
    }
    el.innerHTML = html;
    const q = (k) => el.querySelector(`[data-pp="${k}"]`);
    q('ajukan')?.addEventListener('click', () => kirim('ajukanPerpanjangan', { id: o.report.id, tanggal_baru: q('tanggal').value, alasan: q('alasan').value }, el, o.onDone));
    q('setuju')?.addEventListener('click', () => kirim('putuskanPerpanjangan', { id: o.report.id, keputusan: 'setuju', catatan: q('catatan').value }, el, o.onDone));
    q('tolak')?.addEventListener('click', () => kirim('putuskanPerpanjangan', { id: o.report.id, keputusan: 'tolak', catatan: q('catatan').value }, el, o.onDone));
  }
  return { render };
})();
