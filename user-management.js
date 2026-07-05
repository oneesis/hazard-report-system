// User Management Tab — hanya untuk ADMIN dan SUPER_ADMIN
let umUsers = [];
let umFiltered = [];
let umPage = 1;
const UM_PAGE_SIZE = 20;

async function initUserManagement() {
  const user = getCurrentUser();
  if (!isAdminOrAbove(user?.role)) return;

  renderUMTab();
  await loadUsers();
  if (isSuperAdminRole(user?.role)) await loadPendingChanges();
}

async function loadUsers() {
  const tbody = document.getElementById('umTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px">Memuat...</td></tr>';
  try {
    const res = await fetch('/api?action=getKaryawan');
    const result = await res.json();
    umUsers = (result.data || []).filter(r => String(r['ROLE'] || '').toUpperCase() !== 'DELETED');
    umFiltered = [...umUsers];
    umPage = 1;
    renderUMTable();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:#ef4444">${e.message}</td></tr>`;
  }
}

async function loadPendingChanges() {
  try {
    const res = await fetch('/api?action=getPendingChanges');
    const result = await res.json();
    window.__pendingChanges = result.data || [];
    renderPendingChanges(window.__pendingChanges);
  } catch { /* silent */ }
}

function filterUsers() {
  const q = (document.getElementById('umSearch')?.value || '').toLowerCase();
  umFiltered = umUsers.filter(u =>
    !q ||
    String(u['NAMA'] || '').toLowerCase().includes(q) ||
    String(u['NIK'] || '').toLowerCase().includes(q) ||
    String(u['DEPARTEMEN'] || '').toLowerCase().includes(q)
  );
  umPage = 1;
  renderUMTable();
}

function renderUMTable() {
  const tbody = document.getElementById('umTableBody');
  if (!tbody) return;
  const start = (umPage - 1) * UM_PAGE_SIZE;
  const page  = umFiltered.slice(start, start + UM_PAGE_SIZE);
  const user  = getCurrentUser();
  const canEdit = isAdminOrAbove(user?.role);

  if (!page.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada data</td></tr>';
    renderUMPagination();
    return;
  }

  window._umPageArr = page;
  tbody.innerHTML = page.map((u, idx) => `
    <tr>
      <td>${escapeHTML(u['PERUSAHAAN'] || '')}</td>
      <td>${escapeHTML(u['NAMA'] || '')}</td>
      <td>${escapeHTML(u['NIK'] || '-')}</td>
      <td>${escapeHTML(u['JABATAN'] || '')}</td>
      <td>${escapeHTML(u['DEPARTEMEN'] || '')}</td>
      <td>${escapeHTML(u['NO WHATSAPP'] || '')}</td>
      <td class="um-center">${escapeHTML(String(u['OBJ HR'] || '0'))}</td>
      <td class="um-center">${escapeHTML(String(u['OBJ INS'] || '0'))}</td>
      <td class="um-center">${escapeHTML(String(u['OBJ SBO'] || '0'))}</td>
      <td class="um-center">${escapeHTML(String(u['OBJ PC'] || '0'))}</td>
      ${canEdit ? `<td class="um-actions">
        <button class="um-btn-edit" onclick="openEditUser(window._umPageArr[${idx}])">Edit</button>
        <button class="um-btn-delete" onclick="confirmDeleteUser(window._umPageArr[${idx}])">Hapus</button>
      </td>` : ''}
    </tr>`).join('');

  renderUMPagination();
}

function renderUMPagination() {
  const el = document.getElementById('umPagination');
  if (!el) return;
  const total = Math.ceil(umFiltered.length / UM_PAGE_SIZE);
  if (total <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = Array.from({ length: total }, (_, i) =>
    `<button class="um-page-btn${umPage === i+1 ? ' active' : ''}" onclick="umGoPage(${i+1})">${i+1}</button>`
  ).join('');
}

function umGoPage(p) { umPage = p; renderUMTable(); }

function renderPendingChanges(list) {
  const section = document.getElementById('umPendingSection');
  if (!section) return;
  const pending = list.filter(r => String(r['STATUS'] || '').toUpperCase() === 'PENDING');
  // update badge
  const badge = document.getElementById('pendingBadge');
  if (badge) { badge.textContent = pending.length; badge.style.display = pending.length ? '' : 'none'; }
  if (!pending.length) { section.innerHTML = '<p class="um-empty">Tidak ada permohonan pending.</p>'; return; }

  section.innerHTML = `<table class="um-pending-table">
    <thead><tr><th>Waktu</th><th>Oleh</th><th>Perusahaan</th><th>Action</th><th>Data</th><th>Keputusan</th></tr></thead>
    <tbody>${pending.map(p => {
      const data = safeParseJson(p['DATA']);
      return `<tr>
        <td>${formatDate(p['TIMESTAMP'])}</td>
        <td>${escapeHTML(p['PROPOSED_BY_NAMA'] || '')}</td>
        <td>${escapeHTML(p['PERUSAHAAN'] || '')}</td>
        <td><span class="um-action-badge um-action-${(p['ACTION']||'').toLowerCase()}">${escapeHTML(p['ACTION']||'')}</span></td>
        <td class="um-data-cell">${escapeHTML(data.NAMA || data.NIK || '-')}</td>
        <td class="um-review-btns">
          <button class="um-btn-approve" onclick="reviewChange('${escapeHTML(p['ID'])}','APPROVE')">✅ Setuju</button>
          <button class="um-btn-reject"  onclick="promptReject('${escapeHTML(p['ID'])}')">❌ Tolak</button>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function safeParseJson(s) { try { return JSON.parse(s); } catch { return {}; } }
function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return isNaN(d) ? ts : d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}

// ===== MODALS =====

function openAddUser() {
  openUMModal({}, 'ADD');
}

function openEditUser(user) {
  openUMModal(user, 'EDIT');
}

function openUMModal(user, action) {
  const isEdit = action === 'EDIT';
  let modal = document.getElementById('umModal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'umModal'; document.body.appendChild(modal); }

  modal.innerHTML = `
    <div class="cp-overlay" onclick="closeUMModal()"></div>
    <div class="cp-box um-modal-box" role="dialog">
      <h3><i class="fa-solid fa-user${isEdit ? '-pen' : '-plus'}"></i> ${isEdit ? 'Edit' : 'Tambah'} Karyawan</h3>
      <div class="um-modal-grid">
        ${umField('PERUSAHAAN','Perusahaan',user['PERUSAHAAN']||'')}
        ${umField('SUBCONT','Subcont',user['SUBCONT']||'')}
        ${umField('NAMA','Nama Lengkap',user['NAMA']||'')}
        ${umField('NIK','NIK',user['NIK']||'', isEdit)}
        ${umField('JABATAN','Jabatan',user['JABATAN']||'')}
        ${umField('DEPARTEMEN','Departemen',user['DEPARTEMEN']||'')}
        ${umField('NO WHATSAPP','No WhatsApp',user['NO WHATSAPP']||'')}
        ${!isEdit ? umField('PASSWORD','Password (min. 6 karakter)','') : ''}
        ${isSuperAdminRole(getCurrentUser()?.role) ? `<div class="cp-field">
          <label>Role</label>
          <select id="umf_ROLE">
            ${['USER','ADMIN','SUPER_ADMIN'].map(r => `<option value="${r}"${String(user['ROLE']||'USER').toUpperCase()===r?' selected':''}>${r}</option>`).join('')}
          </select>
        </div>` : '<input type="hidden" id="umf_ROLE" value="USER">'}
        ${umFieldNum('OBJ HR','Target HR/Bulan',user['OBJ HR']||'0')}
        ${umFieldNum('OBJ INS','Target Inspeksi/Bulan',user['OBJ INS']||'0')}
        ${umFieldNum('OBJ SBO','Target SBO/Bulan',user['OBJ SBO']||'0')}
        ${umFieldNum('OBJ PC','Target PC/Bulan',user['OBJ PC']||'0')}
      </div>
      <p id="umModalMsg" class="cp-msg"></p>
      <div class="cp-actions">
        <button class="cp-btn-cancel" onclick="closeUMModal()">Batal</button>
        <button class="cp-btn-submit" onclick="submitUMModal('${action}','${escapeHTML(user['NIK']||'')}')">Kirim Permohonan</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function umField(key, label, val, readonly=false) {
  const id = 'umf_' + key.replace(/\s/g,'_');
  return `<div class="cp-field">
    <label>${escapeHTML(label)}</label>
    <input type="text" id="${id}" value="${escapeHTML(val)}"${readonly?' readonly style="opacity:.6"':''}>
  </div>`;
}
function umFieldNum(key, label, val) {
  const id = 'umf_' + key.replace(/\s/g,'_');
  return `<div class="cp-field">
    <label>${escapeHTML(label)}</label>
    <input type="number" id="${id}" value="${escapeHTML(String(val))}" min="0">
  </div>`;
}

function closeUMModal() {
  const m = document.getElementById('umModal');
  if (m) m.style.display = 'none';
}

async function submitUMModal(action, originalNik) {
  const msg = document.getElementById('umModalMsg');
  msg.textContent = ''; msg.className = 'cp-msg';
  const get = key => (document.getElementById('umf_' + key.replace(/\s/g,'_'))?.value || '').trim();

  const payload = {
    PERUSAHAAN: get('PERUSAHAAN'), SUBCONT: get('SUBCONT'), NAMA: get('NAMA'),
    NIK: action === 'EDIT' ? originalNik : get('NIK'),
    JABATAN: get('JABATAN'), DEPARTEMEN: get('DEPARTEMEN'),
    'NO WHATSAPP': get('NO_WHATSAPP'), ROLE: get('ROLE'),
    'OBJ HR': get('OBJ_HR'), 'OBJ INS': get('OBJ_INS'),
    'OBJ SBO': get('OBJ_SBO'), 'OBJ PC': get('OBJ_PC')
  };

  if (action === 'ADD') {
    payload.PASSWORD = get('PASSWORD');
    if (!payload.NAMA || !payload.PASSWORD) { msg.textContent = 'Nama dan password wajib diisi.'; return; }
    if (payload.PASSWORD.length < 6) { msg.textContent = 'Password minimal 6 karakter.'; return; }
  }

  const btn = document.querySelector('#umModal .cp-btn-submit');
  btn.disabled = true; btn.textContent = 'Mengirim...';
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'proposeChange', data: { action, payload } })
    });
    const result = await res.json();
    if (result.status !== 'success') throw new Error(result.message);
    msg.className = 'cp-msg cp-success';
    msg.textContent = result.message;
    setTimeout(() => { closeUMModal(); loadUsers(); }, 1500);
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Kirim Permohonan';
  }
}

function confirmDeleteUser(user) {
  if (!confirm(`Hapus ${user['NAMA']} (${user['NIK'] || '-'})?\n\nUser akan dinonaktifkan dan tidak bisa login.`)) return;
  submitPropose('DELETE', { NIK: user['NIK'], NAMA: user['NAMA'] });
}

async function submitPropose(action, payload) {
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'proposeChange', data: { action, payload } })
    });
    const result = await res.json();
    showAdminToast(result.message || (result.status === 'success' ? 'Permohonan terkirim.' : 'Gagal.'),
      result.status === 'success' ? 'success' : 'error');
    if (result.status === 'success') loadUsers();
  } catch (e) { showAdminToast(e.message || 'Terjadi kesalahan.', 'error'); }
}

async function reviewChange(changeId, decision) {
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reviewChange', data: { change_id: changeId, decision } })
    });
    const result = await res.json();
    showAdminToast(result.message || (result.status === 'success' ? 'Berhasil.' : 'Gagal.'),
      result.status === 'success' ? 'success' : 'error');
    if (result.status === 'success') { loadUsers(); loadPendingChanges(); }
  } catch (e) { showAdminToast(e.message || 'Terjadi kesalahan.', 'error'); }
}

function showAdminToast(msg, type = 'success') {
  let t = document.getElementById('adminToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'adminToast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:10px;font-size:.85rem;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.15);transition:opacity .3s;pointer-events:none;white-space:nowrap;max-width:90vw;text-align:center';
    document.body.appendChild(t);
  }
  t.style.background = type === 'success' ? '#003087' : '#dc2626';
  t.style.color = '#fff';
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

function promptReject(changeId) {
  const pending = (window.__pendingChanges || []).find(p => p['ID'] === changeId);
  let modal = document.getElementById('rejectModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'rejectModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div class="cp-overlay" onclick="closeRejectModal()"></div>
      <div class="cp-box" style="width:min(480px,94vw)">
        <h3 style="margin:0 0 16px;font-size:1rem;display:flex;align-items:center;gap:8px;color:#dc2626">
          <i class="fa-solid fa-circle-xmark"></i> Tolak Pengajuan
        </h3>
        <div id="rejectDetail" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:.82rem;color:#334155;line-height:1.7"></div>
        <div class="cp-field">
          <label for="rejectReason">Alasan Penolakan <span style="color:#94a3b8;font-weight:400">(opsional)</span></label>
          <textarea id="rejectReason" rows="3"
            placeholder="Jelaskan alasan penolakan kepada pengaju..."
            style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.85rem;resize:vertical;font-family:'Inter',sans-serif;box-sizing:border-box;transition:border-color .15s"
            onfocus="this.style.borderColor='#307FE2'" onblur="this.style.borderColor='#e2e8f0'"></textarea>
        </div>
        <p id="rejectMsg" style="font-size:.82rem;color:#ef4444;min-height:18px;margin:0 0 12px"></p>
        <div class="cp-actions">
          <button class="cp-btn-cancel" onclick="closeRejectModal()">Batal</button>
          <button id="rejectConfirmBtn"
            style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:.85rem;transition:background .15s"
            onmouseover="this.style.background='#b91c1c'" onmouseout="this.style.background='#dc2626'"
            onclick="submitRejectModal()">
            <i class="fa-solid fa-xmark"></i> Konfirmasi Tolak
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  modal.dataset.changeId = changeId;
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectMsg').textContent = '';

  const detail = document.getElementById('rejectDetail');
  if (pending) {
    const data = safeParseJson(pending['DATA'] || '{}');
    const actionLabel = { ADD:'Tambah User', EDIT:'Edit User', DELETE:'Hapus User' };
    const actionColor = { ADD:'#dcfce7;color:#15803d', EDIT:'#dbeafe;color:#003087', DELETE:'#fee2e2;color:#dc2626' };
    const ac = (pending['ACTION'] || '').toUpperCase();
    detail.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="padding:2px 10px;border-radius:20px;font-size:.72rem;font-weight:700;background:${actionColor[ac]||'#f1f5f9;color:#475569'}">${actionLabel[ac]||ac}</span>
      </div>
      <div style="display:grid;grid-template-columns:100px 1fr;gap:4px">
        <span style="color:#94a3b8">Diajukan oleh</span>
        <strong>${escapeHTML(pending['PROPOSED_BY_NAMA'] || pending['PROPOSED_BY_NIK'] || '-')}</strong>
        <span style="color:#94a3b8">Perusahaan</span>
        <span>${escapeHTML(pending['PERUSAHAAN'] || '-')}</span>
        <span style="color:#94a3b8">User</span>
        <strong>${escapeHTML(data.NAMA || data.NIK || pending['TARGET_NIK'] || '-')}</strong>
        <span style="color:#94a3b8">Waktu</span>
        <span>${escapeHTML(formatDate(pending['TIMESTAMP']))}</span>
      </div>`;
  } else {
    detail.innerHTML = `<span style="color:#94a3b8">ID: ${escapeHTML(changeId)}</span>`;
  }

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('rejectReason')?.focus(), 60);
}

function closeRejectModal() {
  const m = document.getElementById('rejectModal');
  if (m) m.style.display = 'none';
}

async function submitRejectModal() {
  const modal = document.getElementById('rejectModal');
  const changeId = modal?.dataset.changeId;
  const reason = (document.getElementById('rejectReason')?.value || '').trim();
  const btn = document.getElementById('rejectConfirmBtn');
  const msg = document.getElementById('rejectMsg');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
  msg.textContent = '';

  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reviewChange', data: { change_id: changeId, decision: 'REJECT', reason } })
    });
    const result = await res.json();
    if (result.status !== 'success') throw new Error(result.message || 'Gagal memproses.');
    closeRejectModal();
    showAdminToast('Pengajuan berhasil ditolak.', 'error');
    loadPendingChanges();
  } catch (e) {
    msg.textContent = e.message || 'Gagal memproses.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Konfirmasi Tolak';
  }
}

function renderUMTab() {
  const search = document.getElementById('umSearch');
  if (search) search.addEventListener('input', filterUsers);
}

// ===== RIWAYAT PENGAJUAN =====

async function loadMyHistory() {
  const section = document.getElementById('umHistorySection');
  if (!section) return;
  section.innerHTML = '<p class="um-empty">Memuat...</p>';
  try {
    const res = await fetch('/api?action=getPendingChanges');
    const result = await res.json();
    const user = getCurrentUser();
    const myNik  = String(user?.nik  || '').trim().toLowerCase();
    const myNama = String(user?.nama  || '').trim().toLowerCase();
    const all = (result.data || []).filter(r => {
      const rNik  = String(r['PROPOSED_BY_NIK']  || '').trim().toLowerCase();
      const rNama = String(r['PROPOSED_BY_NAMA'] || '').trim().toLowerCase();
      return (myNik && rNik === myNik) || (myNama && rNama === myNama);
    });
    renderMyHistory(all);
  } catch (e) {
    if (section) section.innerHTML = `<p class="um-empty" style="color:#ef4444">${e.message}</p>`;
  }
}

function renderMyHistory(list) {
  const section = document.getElementById('umHistorySection');
  if (!section) return;
  if (!list.length) { section.innerHTML = '<p class="um-empty">Belum ada riwayat pengajuan.</p>'; return; }
  const statusBadge = s => {
    const map = { PENDING:'background:#fef9c3;color:#854d0e', APPROVED:'background:#dcfce7;color:#15803d', REJECTED:'background:#fee2e2;color:#dc2626' };
    const style = map[String(s).toUpperCase()] || 'background:#f1f5f9;color:#475569';
    return `<span class="um-action-badge" style="${style}">${escapeHTML(s)}</span>`;
  };
  section.innerHTML = `<table class="um-pending-table">
    <thead><tr><th>Waktu</th><th>Action</th><th>Data</th><th>Status</th><th>Catatan</th></tr></thead>
    <tbody>${list.map(p => {
      const data = safeParseJson(p['DATA']);
      return `<tr>
        <td>${formatDate(p['TIMESTAMP'])}</td>
        <td><span class="um-action-badge um-action-${(p['ACTION']||'').toLowerCase()}">${escapeHTML(p['ACTION']||'')}</span></td>
        <td class="um-data-cell">${escapeHTML(data.NAMA || data.NIK || '-')}</td>
        <td>${statusBadge(p['STATUS'] || '-')}</td>
        <td>${escapeHTML(p['REJECTION_REASON'] || p['REASON'] || p['CATATAN'] || '-')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ===== CSV IMPORT/EXPORT =====

const CSV_COLUMNS = ['PERUSAHAAN','SUBCONT','NAMA','NIK','JABATAN','DEPARTEMEN','NO WHATSAPP','PASSWORD','OBJ HR','OBJ INS','OBJ SBO','OBJ PC'];

function downloadCsvTemplate() {
  const header = CSV_COLUMNS.join(',');
  const example = ['PT Contoh','Subcont A','Nama Karyawan','123456','Operator','HSE','08123456789','password123','2','4','2','1'].join(',');
  const blob = new Blob([header + '\n' + example + '\n'], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'template_import_user.csv'; a.click();
  URL.revokeObjectURL(url);
}

function triggerCsvImport() {
  document.getElementById('csvFileInput')?.click();
}

function handleCsvFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => processCsvImport(e.target.result);
  reader.readAsText(file, 'UTF-8');
  input.value = '';
}

async function processCsvImport(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { showAdminToast('File CSV kosong atau hanya berisi header.', 'error'); return; }
  const header = parseCsvLine(lines[0]).map(h => h.trim().toUpperCase());
  const rows = lines.slice(1).map(l => parseCsvLine(l));

  const users = rows.map(cols => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
    return obj;
  }).filter(u => u['NAMA'] && u['PASSWORD']);

  if (!users.length) { showAdminToast('Tidak ada data valid. Pastikan kolom NAMA dan PASSWORD terisi.', 'error'); return; }

  const confirmed = confirm(`Akan mengimpor ${users.length} user baru. Semua akan mendapat role USER.\n\nLanjutkan?`);
  if (!confirmed) return;

  let success = 0, failed = 0;
  for (const u of users) {
    const payload = {
      PERUSAHAAN: u['PERUSAHAAN'] || '', SUBCONT: u['SUBCONT'] || '',
      NAMA: u['NAMA'], NIK: u['NIK'] || '',
      JABATAN: u['JABATAN'] || '', DEPARTEMEN: u['DEPARTEMEN'] || '',
      'NO WHATSAPP': u['NO WHATSAPP'] || '', PASSWORD: u['PASSWORD'],
      ROLE: 'USER',
      'OBJ HR': u['OBJ HR'] || '0', 'OBJ INS': u['OBJ INS'] || '0',
      'OBJ SBO': u['OBJ SBO'] || '0', 'OBJ PC': u['OBJ PC'] || '0',
    };
    try {
      const res = await fetch('/api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'proposeChange', data: { action: 'ADD', payload } })
      });
      const result = await res.json();
      if (result.status === 'success') success++; else failed++;
    } catch { failed++; }
  }
  showAdminToast(`Import selesai. Berhasil: ${success}, Gagal: ${failed}`, success ? 'success' : 'error');
  if (success) loadUsers();
}

function parseCsvLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}
