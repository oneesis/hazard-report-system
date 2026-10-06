// "PIC yang dicantumkan salah" (2026-10-06) — panel bersama untuk detail Hazard/
// Inspeksi (laporan-detail) & modal SBO (sbo). PIC mengajukan → email admin;
// Super Admin / Admin perusahaan pelapor menetapkan PIC baru atau menolak.
// Backend: action disputePic / resolvePicDispute (api/index.js).
const PicDispute = (() => {
  let _roster = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const role = () => String(getCurrentUser()?.role || '').toUpperCase().replace(/\s+/g, '_');
  const parse = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
  const fmtDate = (v) => { const d = new Date(v); return isNaN(d) ? '-' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

  async function roster() {
    if (_roster) return _roster;
    const res = await fetch('/api?action=masterKaryawan');
    const j = await res.json().catch(() => []);
    _roster = (Array.isArray(j) ? j : j.data || []).filter((k) => k.NIK && k.NAMA);
    return _roster;
  }
  // Isian "Nama — NIK" via <datalist>; NIK diambil dari bagian setelah " — ".
  const nikFrom = (v) => { const m = String(v || '').match(/—\s*([^\s—]+)\s*$/); return m ? m[1].trim() : ''; };
  async function fillDatalist(id) {
    const list = document.getElementById(id);
    if (!list || list.childElementCount) return;
    const ks = await roster();
    list.innerHTML = ks.map((k) => `<option value="${esc(k.NAMA)} — ${esc(k.NIK)}">${esc(k.JABATAN || '')} · ${esc(k.PERUSAHAAN || '')}</option>`).join('');
  }

  // Deadline usulan = hari ini + (deadline lama − tanggal laporan); sama rumus server.
  function suggestDeadline(tanggal, batas) {
    const a = new Date(tanggal), b = new Date(batas);
    const dur = !isNaN(a) && !isNaN(b) ? Math.max(1, Math.round((b - a) / 864e5)) : 7;
    const t = new Date(); t.setDate(t.getDate() + dur);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  async function post(action, data) {
    const res = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.status !== 'success') throw new Error(j.message || 'Gagal memproses.');
    return j;
  }
  const toast = (msg, type) => (typeof showToast === 'function' ? showToast(msg, type) : alert(msg));

  const box = (border, bg, inner) => `<div style="border:1px solid ${border};background:${bg};border-radius:12px;padding:14px 16px;margin-top:12px;font-size:.86rem;color:#0f172a;line-height:1.5">${inner}</div>`;
  const btn = (label, onclick, bg, fg = '#fff', extra = '') => `<button type="button" onclick="${onclick}" style="padding:9px 14px;border-radius:9px;border:${bg === '#fff' ? '1px solid #fca5a5' : '0'};background:${bg};color:${fg};font-weight:700;font-size:.84rem;cursor:pointer;${extra}">${label}</button>`;
  const field = 'width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #cbd5e1;border-radius:9px;font:inherit;font-size:.86rem;margin-top:4px';

  function history(dispute) {
    const log = Array.isArray(dispute?.log) ? dispute.log : [];
    if (!log.length) return '';
    const line = (x) => x.type === 'AJUAN'
      ? `<b>${esc(x.by_nama)}</b> menyatakan bukan PIC — "${esc(x.alasan)}"${x.usulan_nama ? ` (usul: ${esc(x.usulan_nama)})` : ''}`
      : x.type === 'DIGANTI'
        ? `<b>${esc(x.by_nama)}</b> mengganti PIC ${esc(x.dari)} → <b>${esc(x.ke)}</b>, batas ${esc(x.batas)}${x.catatan ? ` — ${esc(x.catatan)}` : ''}`
        : `<b>${esc(x.by_nama)}</b> menolak pengajuan — ${esc(x.catatan)}`;
    return `<details style="margin-top:10px"><summary style="cursor:pointer;color:#475569;font-weight:600">Riwayat perubahan PIC (${log.length})</summary>
      <ul style="margin:8px 0 0;padding-left:18px;color:#334155">${log.map((x) => `<li style="margin:4px 0">${line(x)} <span style="color:#94a3b8">· ${fmtDate(x.at)}</span></li>`).join('')}</ul></details>`;
  }

  /**
   * opts: { modul: 'HAZARD'|'INSPECTION'|'SBO', report, isPic: bool, perusahaan, tanggal, batas, status, onDone }
   */
  function render(container, opts) {
    if (!container) return;
    const { modul, report } = opts;
    const id = report.id;
    const dispute = parse(report.pic_dispute);
    const status = String(opts.status || 'OPEN').toUpperCase();
    const open = !['CLOSED', 'FOLLOWUP'].includes(status);
    const r = role();
    const u = getCurrentUser() || {};
    const canResolve = r === 'SUPER_ADMIN' || (r === 'ADMIN' && String(u.perusahaan || '').trim().toUpperCase() === String(opts.perusahaan || '').trim().toUpperCase());
    const key = `pd_${String(id).replace(/[^A-Za-z0-9]/g, '')}`;
    window[key] = { modul, id, opts };
    let html = '';

    if (dispute?.status === 'PENDING') {
      html += box('#fcd34d', '#fffbeb', `
        <div style="font-weight:800;color:#92400e"><i class="fa-solid fa-user-xmark"></i> PIC menyatakan bukan PIC yang tepat — menunggu keputusan admin</div>
        <div style="margin-top:6px"><b>Diajukan oleh:</b> ${esc(dispute.by_nama)} · ${fmtDate(dispute.at)}</div>
        <div><b>Alasan:</b> ${esc(dispute.alasan)}</div>
        ${dispute.usulan ? `<div><b>Usulan PIC:</b> ${esc(dispute.usulan.nama)} (${esc(dispute.usulan.nik)}) — ${esc(dispute.usulan.jabatan)}, ${esc(dispute.usulan.perusahaan)}</div>` : ''}
        <div style="color:#92400e;margin-top:4px;font-size:.8rem">Pengingat batas waktu dijeda sampai admin memutuskan.</div>
        ${canResolve ? `
        <div style="border-top:1px dashed #fcd34d;margin-top:12px;padding-top:12px">
          <label style="font-weight:700">PIC yang benar
            <input id="${key}_pic" list="${key}_dl" placeholder="Ketik nama / NIK…" style="${field}" value="${dispute.usulan ? `${esc(dispute.usulan.nama)} — ${esc(dispute.usulan.nik)}` : ''}">
          </label>
          <datalist id="${key}_dl"></datalist>
          <label style="font-weight:700;display:block;margin-top:8px">Batas waktu baru
            <input id="${key}_batas" type="date" style="${field}" value="${suggestDeadline(opts.tanggal, opts.batas)}">
          </label>
          <label style="font-weight:700;display:block;margin-top:8px">Catatan (wajib bila menolak)
            <textarea id="${key}_cat" rows="2" style="${field}" placeholder="mis. area ini tanggung jawab dept. X"></textarea>
          </label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            ${btn('<i class="fa-solid fa-user-check"></i> Tetapkan PIC Baru', `PicDispute._resolve('${key}','GANTI')`, '#00205B')}
            ${btn('Tolak — PIC sudah benar', `PicDispute._resolve('${key}','TOLAK')`, '#fff', '#b91c1c')}
          </div>
        </div>` : ''}
        ${history(dispute)}`);
    } else if (opts.isPic && open) {
      const log = Array.isArray(dispute?.log) ? dispute.log : [];
      const already = log.some((x) => x.type === 'AJUAN' && String(x.by_nik) === String(u.nik));
      html += already ? '' : `
        <div style="margin-top:12px">
          ${btn('<i class="fa-solid fa-user-xmark"></i> PIC yang dicantumkan salah', `PicDispute._toggle('${key}')`, '#fff', '#b91c1c')}
          <div id="${key}_form" style="display:none">${box('#fecaca', '#fef2f2', `
            <div style="font-weight:700;color:#991b1b">Laporkan bahwa kamu bukan PIC yang tepat</div>
            <div style="color:#7f1d1d;font-size:.8rem;margin-top:2px">Admin akan menentukan PIC yang benar. Pengajuan hanya bisa sekali.</div>
            <label style="font-weight:700;display:block;margin-top:10px">Alasan <span style="color:#dc2626">*</span>
              <textarea id="${key}_alasan" rows="3" style="${field}" placeholder="mis. lokasi ini tanggung jawab departemen lain"></textarea>
            </label>
            <label style="font-weight:700;display:block;margin-top:8px">Usulan PIC yang benar (opsional)
              <input id="${key}_usul" list="${key}_dl" placeholder="Ketik nama / NIK…" style="${field}">
            </label>
            <datalist id="${key}_dl"></datalist>
            <div style="display:flex;gap:8px;margin-top:10px">
              ${btn('<i class="fa-solid fa-paper-plane"></i> Kirim ke Admin', `PicDispute._submit('${key}')`, '#b91c1c')}
              ${btn('Batal', `PicDispute._toggle('${key}')`, '#fff', '#475569', 'border-color:#cbd5e1')}
            </div>`)}
          </div>
        </div>`;
      if (dispute) html += history(dispute);
    } else if (dispute) {
      html += history(dispute);
    }
    container.innerHTML = html;
    if (dispute?.status === 'PENDING' && canResolve) fillDatalist(`${key}_dl`);
  }

  async function _toggle(key) {
    const f = document.getElementById(`${key}_form`);
    if (!f) return;
    f.style.display = f.style.display === 'none' ? '' : 'none';
    if (f.style.display === '') fillDatalist(`${key}_dl`);
  }

  async function _submit(key) {
    const { modul, id, opts } = window[key];
    const alasan = document.getElementById(`${key}_alasan`)?.value.trim() || '';
    if (alasan.length < 5) return toast('Isi alasan (minimal 5 karakter).', 'error');
    const usulRaw = document.getElementById(`${key}_usul`)?.value || '';
    const usulan_nik = nikFrom(usulRaw);
    if (usulRaw.trim() && !usulan_nik) return toast('Pilih usulan PIC dari daftar (format "Nama — NIK").', 'error');
    if (!confirm('Kirim pengajuan "PIC yang dicantumkan salah" ke admin?')) return;
    try {
      const j = await post('disputePic', { modul, id, alasan, usulan_nik });
      toast(j.message);
      opts.onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function _resolve(key, keputusan) {
    const { modul, id, opts } = window[key];
    const catatan = document.getElementById(`${key}_cat`)?.value.trim() || '';
    const data = { modul, id, keputusan, catatan };
    if (keputusan === 'GANTI') {
      data.nik_pic_baru = nikFrom(document.getElementById(`${key}_pic`)?.value);
      data.batas_waktu = document.getElementById(`${key}_batas`)?.value || '';
      if (!data.nik_pic_baru) return toast('Pilih PIC baru dari daftar (format "Nama — NIK").', 'error');
      if (!confirm(`Tetapkan PIC baru? Batas waktu baru ${data.batas_waktu || '(otomatis)'}.`)) return;
    } else {
      if (!catatan) return toast('Isi catatan alasan penolakan.', 'error');
      if (!confirm('Tolak pengajuan? PIC tetap yang sekarang.')) return;
    }
    try {
      const j = await post('resolvePicDispute', data);
      toast(j.message);
      opts.onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  }

  return { render, _toggle, _submit, _resolve };
})();
