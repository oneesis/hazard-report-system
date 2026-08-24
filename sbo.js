// Safe Behavior Observation — list page
let _sboData = [];
let _sboFiltered = [];
let _sboPage = 1;
const SBO_PAGE_SIZE = 20;

async function loadSboReports() {
  try {
    const res = await fetch(`${BASE_URL}?action=getSBOReports`);
    const json = await res.json();
    _sboData = (json.data || json || []).filter(r => r.id);
    populateSboFilters();
    sboRender();
  } catch (e) {
    document.getElementById('sboTbody').innerHTML =
      `<tr><td colspan="7" class="sbo-empty"><i class="fa-solid fa-triangle-exclamation"></i>Gagal memuat data: ${e.message}</td></tr>`;
  }
}

function populateSboFilters() {
  const user = getCurrentUser();
  const isSA = String(user?.role || '').toUpperCase().replace(/\s+/g,'_') === 'SUPER_ADMIN';

  // Bulan
  const months = [...new Set(_sboData.map(r => (r.tgl_observasi || r.timestamp || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const selBulan = document.getElementById('sboFilterBulan');
  months.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    selBulan.appendChild(o);
  });

  // Perusahaan (SA only)
  if (isSA) {
    const cos = [...new Set(_sboData.map(r => r.perusahaan_observer || '').filter(Boolean))].sort();
    const selCo = document.getElementById('sboFilterPerusahaan');
    cos.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; selCo.appendChild(o); });
    selCo.style.display = '';
  }
}

function sboRender() {
  const bulan   = document.getElementById('sboFilterBulan')?.value || '';
  const status  = document.getElementById('sboFilterStatus')?.value || '';
  const co      = document.getElementById('sboFilterPerusahaan')?.value || '';
  const search  = (document.getElementById('sboFilterSearch')?.value || '').trim().toLowerCase();

  _sboFiltered = _sboData.filter(r => {
    const date = r.tgl_observasi || r.timestamp || '';
    if (bulan  && !date.startsWith(bulan)) return false;
    const st = (r.status_perbaikan || 'AMAN').toUpperCase();
    if (status && st !== status.toUpperCase()) return false;
    if (co     && (r.perusahaan_observer || '').toUpperCase() !== co.toUpperCase()) return false;
    if (search) {
      const hay = [r.id, r.nama_observer, r.nama_observee, r.lokasi, r.nama_pekerjaan].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  // KPI
  document.getElementById('kpiTotal').textContent = _sboFiltered.length;
  document.getElementById('kpiAman').textContent  = _sboFiltered.filter(r => (r.status_perbaikan||r.status_observasi||'').toUpperCase() === 'AMAN').length;
  document.getElementById('kpiOpen').textContent  = _sboFiltered.filter(r => (r.status_perbaikan||'').toUpperCase() === 'OPEN').length;

  const total = _sboFiltered.length;
  const pages = Math.max(1, Math.ceil(total / SBO_PAGE_SIZE));
  if (_sboPage > pages) _sboPage = 1;
  const start = (_sboPage - 1) * SBO_PAGE_SIZE;
  const page  = _sboFiltered.slice(start, start + SBO_PAGE_SIZE);

  const tbody = document.getElementById('sboTbody');
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="sbo-empty"><i class="fa-solid fa-binoculars"></i>Tidak ada laporan ditemukan</td></tr>`;
    document.getElementById('sboPagination').style.display = 'none';
    return;
  }

  tbody.innerHTML = page.map(r => {
    const st = (r.status_perbaikan || r.status_observasi || 'AMAN').toUpperCase();
    const badge = st === 'AMAN'      ? '<span class="badge badge-aman">Aman</span>'
                : st === 'OPEN'      ? '<span class="badge badge-open">Open</span>'
                : st === 'FOLLOWUP'  ? '<span class="badge badge-followup">Follow Up</span>'
                : st === 'CLOSED'    ? '<span class="badge badge-closed">Closed</span>'
                : `<span class="badge">${st}</span>`;
    const tgl = (r.tgl_observasi || r.timestamp || '').slice(0, 10);
    return `<tr>
      <td style="font-family:monospace;font-size:.78rem">${r.id}</td>
      <td>${tgl}</td>
      <td>${r.nama_observer || '-'}</td>
      <td>${r.nama_observee || '-'}</td>
      <td>${r.nama_pekerjaan || '-'}</td>
      <td>${badge}</td>
      <td><button class="sbo-detail-btn" onclick="openSboModal('${r.id}')"><i class="fa-solid fa-eye"></i> Detail</button></td>
    </tr>`;
  }).join('');

  const pag = document.getElementById('sboPagination');
  pag.style.display = '';
  document.getElementById('sboPagInfo').textContent = `${start + 1}–${Math.min(start + SBO_PAGE_SIZE, total)} dari ${total}`;
  document.getElementById('sboBtnPrev').disabled = _sboPage <= 1;
  document.getElementById('sboBtnNext').disabled = _sboPage >= pages;
}

function sboPageNav(dir) { _sboPage += dir; sboRender(); }

// ===== MODAL DETAIL =====
const SBO_CAT_LABELS = {
  potensi_bahaya: 'A. Potensi Bahaya',
  apd: 'B. Alat Pelindung Diri',
  alat_peralatan: 'C. Alat & Peralatan',
  prosedur: 'D. Prosedur',
  kebersihan: 'E. Kebersihan & Kerapian (5R)',
};
const SBO_ITEMS = {
  potensi_bahaya: ['Potensi Menabrak','Potensi Terjepit','Potensi Terhirup / terpapar debu atau bahan kimia','Potensi Terseret / tertarik','Potensi Terkena Listrik','Potensi Terjatuh / kejatuhan / tenggelam','Potensi Terpukul / tertusuk'],
  apd: ['Pelindung Kepala','Pelindung Telinga dan mata','Pelindung Muka dan pernafasan','Pelindung Tangan dan lengan','Harness & pelampung','Pelindung Kaki dan tungkai'],
  alat_peralatan: ['Sesuai untuk pekerjaan','Benar menggunakannya','Kondisi peralatan aman','Pelindung dan rambu peringatan terpasang','Pengendalian memadai','Pengecekan keselamatan sebelum kerja'],
  prosedur: ['Prosedur telah dibuat','Prosedur memadai dan telah disosialisasikan','Ijin kerja telah dibuat dan disahkan','Mengetahui nomer emergency dan jalur komunikasi'],
  kebersihan: ['Sampah / Limbah dibersihkan','Perkakas tangan ditata rapi','Penyimpanan barang diatur','Hambatan / gangguan dibuang','Tangga dan tempat berpijakan kuat & kokoh'],
};

function renderChecklistVal(jsonStr, catKey) {
  try {
    const obj = JSON.parse(jsonStr || '{}');
    const items = SBO_ITEMS[catKey] || [];
    return items.map((label, i) => {
      const v = obj[String(i + 1)] || obj[label] || 'NA';
      const cls = v === 'AMAN' ? 'val-aman' : v === 'TIDAK_AMAN' ? 'val-tidak' : 'val-na';
      const txt = v === 'AMAN' ? '✅ Aman' : v === 'TIDAK_AMAN' ? '❌ Tidak Aman' : '— N.A.';
      return `<div class="item"><span>${label}</span><span class="${cls}">${txt}</span></div>`;
    }).join('');
  } catch { return '<em>-</em>'; }
}

function openSboModal(id) {
  const r = _sboData.find(x => x.id === id);
  if (!r) return;

  const user = getCurrentUser();
  const isAdmin = ['ADMIN','SUPER_ADMIN'].includes(String(user?.role||'').toUpperCase().replace(/\s+/g,'_'));
  const isMyReport = (r.nik_observer || r.nama_observer) === (user?.nik || user?.nama);
  const isPic = r.nik_pic === user?.nik || (r.nama_pic && r.nama_pic === user?.nama);
  const st = (r.status_perbaikan || r.status_observasi || 'AMAN').toUpperCase();
  const hasFinding = r.status_observasi === 'ADA_TEMUAN' || (st !== 'AMAN');

  // Tindakan segera
  let tindakanHtml = '-';
  try {
    const arr = JSON.parse(r.tindakan_segera || '[]');
    if (arr.length) tindakanHtml = arr.map(t => `• ${t}`).join('<br>');
  } catch {}

  // Checklist
  let checklistHtml = '';
  for (const [key, catLabel] of Object.entries(SBO_CAT_LABELS)) {
    checklistHtml += `<div class="cat-title">${catLabel}</div>
      <div class="checklist-display">${renderChecklistVal(r[key] || '{}', key)}</div>`;
  }

  // Foto temuan
  let fotoHtml = '-';
  if (r.foto_temuan) {
    const urls = String(r.foto_temuan).split(',').map(u => u.trim()).filter(Boolean);
    fotoHtml = urls.map(u => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" style="height:64px;border-radius:6px;border:1px solid #e2e8f0;margin:2px"></a>`).join('');
  }

  // Foto perbaikan
  let fotoPerbaikanHtml = '-';
  if (r.upload_foto_perbaikan_pic) {
    const urls2 = String(r.upload_foto_perbaikan_pic).split(',').map(u => u.trim()).filter(Boolean);
    fotoPerbaikanHtml = urls2.map(u => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" style="height:64px;border-radius:6px;border:1px solid #e2e8f0;margin:2px"></a>`).join('');
  }

  const dl = (label, val) => `<div class="sbo-dl-item"><div class="sbo-dl-label">${label}</div><div class="sbo-dl-val">${val || '-'}</div></div>`;

  document.getElementById('sboModalTitle').textContent = `SBO — ${id}`;
  document.getElementById('sboModalBody').innerHTML = `
    <div class="sbo-dl">
      <div class="sbo-section-sep">📋 Informasi Observasi</div>
      ${dl('ID', r.id)}
      ${dl('Tanggal', (r.tgl_observasi || '').slice(0, 10))}
      ${dl('Nama Pekerjaan', r.nama_pekerjaan)}
      ${dl('Lokasi', r.lokasi)}
      <div class="sbo-section-sep">👷 Observer</div>
      ${dl('Nama', r.nama_observer)}
      ${dl('Jabatan', r.jabatan_observer)}
      ${dl('Departemen', r.departemen_observer)}
      ${dl('Perusahaan', r.perusahaan_observer)}
      <div class="sbo-section-sep">👤 Observee (yang diobservasi)</div>
      ${dl('Nama', r.nama_observee)}
      ${dl('Jabatan', r.jabatan_observee)}
      ${dl('Departemen', r.departemen_observee)}
      ${dl('Perusahaan', r.perusahaan_observee)}
      <div class="sbo-section-sep">✅ Tindakan Segera</div>
      <div class="sbo-dl-item" style="grid-column:1/-1"><div class="sbo-dl-val">${tindakanHtml}</div></div>
      <div class="sbo-section-sep">📊 Checklist Observasi</div>
      <div style="grid-column:1/-1">${checklistHtml}</div>
      ${hasFinding ? `
      <div class="sbo-section-sep">🔍 Temuan</div>
      ${dl('Status', `<span class="badge badge-${st.toLowerCase()}">${st}</span>`)}
      ${dl('Jenis Temuan', r.jenis_temuan)}
      ${dl('Kategori', r.kategori_temuan)}
      <div class="sbo-dl-item" style="grid-column:1/-1">${dl('Deskripsi', r.deskripsi_temuan)}</div>
      <div class="sbo-dl-item" style="grid-column:1/-1"><div class="sbo-dl-label">Foto Temuan</div><div class="sbo-dl-val">${fotoHtml}</div></div>
      <div class="sbo-section-sep">🎯 Rencana Tindakan & PIC</div>
      <div class="sbo-dl-item" style="grid-column:1/-1">${dl('Rencana', r.rencana_tindakan)}</div>
      ${dl('Nama PIC', r.nama_pic)}
      ${dl('Departemen PIC', r.departemen_pic)}
      ${dl('Perusahaan PIC', r.perusahaan_pic)}
      ${dl('Batas Waktu', r.batas_waktu)}
      <div class="sbo-section-sep">📸 Update PIC</div>
      <div class="sbo-dl-item" style="grid-column:1/-1"><div class="sbo-dl-label">Foto Perbaikan</div><div class="sbo-dl-val">${fotoPerbaikanHtml}</div></div>
      ` : `<div class="sbo-section-sep">✅ Semua Aman</div><div style="grid-column:1/-1;color:#16a34a;font-weight:700;font-size:.9rem">Tidak ada temuan. Observasi dinyatakan aman.</div>`}
    </div>
    ${(isPic || isAdmin) && st === 'OPEN' ? `
    <div class="sbo-update-section">
      <h4><i class="fa-solid fa-upload"></i> Update Perbaikan (PIC)</h4>
      <div style="margin-bottom:10px">
        <label style="font-size:.8rem;font-weight:600;color:#475569;display:block;margin-bottom:5px">Catatan</label>
        <textarea id="sboUpdateCatatan" placeholder="Catatan perbaikan..."></textarea>
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:.8rem;font-weight:600;color:#475569;display:block;margin-bottom:5px">Foto Perbaikan</label>
        <input type="file" id="sboUpdateFoto" accept="image/*" multiple>
      </div>
      <button id="sboUpdateBtn" onclick="submitSboUpdate('${id}')" style="padding:9px 18px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;border-radius:9px;font-size:.85rem;font-weight:700;cursor:pointer">
        <i class="fa-solid fa-paper-plane"></i> Kirim Perbaikan ke Review
      </button>
    </div>` : ''}
  `;
  document.getElementById('sboModalFooter').innerHTML = '';
  document.getElementById('sboModal').style.display = 'flex';
}

function closeSboModal() {
  document.getElementById('sboModal').style.display = 'none';
}

async function submitSboUpdate(id) {
  const catatan = document.getElementById('sboUpdateCatatan')?.value?.trim() || '';
  const fileInput = document.getElementById('sboUpdateFoto');
  const btn = document.getElementById('sboUpdateBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }

  let fotoBase64 = '';
  const files = fileInput?.files || [];
  if (files.length) {
    const reads = await Promise.all([...files].map(f => new Promise(res => {
      const fr = new FileReader();
      fr.onload = e => res(e.target.result);
      fr.readAsDataURL(f);
    })));
    fotoBase64 = JSON.stringify(reads);
  }

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateSBOReport', data: {
        id, catatan_closing: catatan,
        upload_foto_perbaikan_pic: fotoBase64 || undefined,
        status_perbaikan: 'CLOSED',
      }})
    });
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'Gagal');
    showToast('Perbaikan berhasil disubmit! Status menunggu review admin.');
    closeSboModal();
    await loadSboReports();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Perbaikan'; }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  requireLogin();
  renderUserProfile();
  loadSboReports();
});
