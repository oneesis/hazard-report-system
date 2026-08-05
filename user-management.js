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
    const res = await fetch('/api?action=getKaryawan', { cache: 'no-store' });
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
  const canResetPw = isSuperAdminRole(user?.role);

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
        ${canResetPw ? `<button class="um-btn-edit" style="background:#6366f1;color:#fff" onclick="openResetPwModal(window._umPageArr[${idx}])"><i class="fa-solid fa-key"></i> Reset PW</button>` : ''}
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
          <button class="um-btn-approve" onclick="reviewChange('${escapeHTML(p['ID'])}','APPROVE')"><i class="fa-solid fa-check"></i> Setuju</button>
          <button class="um-btn-reject"  onclick="promptReject('${escapeHTML(p['ID'])}')"><i class="fa-solid fa-xmark"></i> Tolak</button>
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
  openConfirmModal(
    `Hapus ${user['NAMA']} (${user['NIK'] || '-'})? User akan dinonaktifkan dan tidak bisa login.`,
    () => submitPropose('DELETE', { NIK: user['NIK'], NAMA: user['NAMA'] }),
    { okLabel: 'Ya, Hapus' }
  );
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
    if (result.status === 'success') {
      if (action === 'DELETE' && payload.NIK) {
        // Hapus optimistis — tidak perlu tunggu SUPER_ADMIN approve untuk hilang dari tabel
        const nik = String(payload.NIK);
        umUsers    = umUsers.filter(u => String(u['NIK'] || '') !== nik);
        umFiltered = umFiltered.filter(u => String(u['NIK'] || '') !== nik);
        renderUMTable();
      } else {
        loadUsers();
      }
    }
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
          <button id="rejectConfirmBtn" class="btn-danger" onclick="submitRejectModal()">
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
  const statusBadge = s =>
    `<span class="um-action-badge um-status-${(s||'unknown').toLowerCase()}">${escapeHTML(s||'-')}</span>`;
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

  openConfirmModal(
    `Akan mengimpor ${users.length} user baru. Semua akan mendapat role USER.`,
    () => _executeCsvImport(users),
    { okLabel: 'Ya, Import' }
  );
}

async function _executeCsvImport(users) {
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

// ===== CAPAIAN SAP ACHIEVEMENT =====
let _achKaryawan = [];
let _achHazardReports = [];
let _achInsReports = [];
let _achReportsLoaded = false;
let _achFiltered = [];
let _achComputed = [];
let _achPage = 1;
const ACH_PAGE_SIZE = 25;

function _achSameMonth(ts, monthStr) {
  if (!ts || !monthStr) return false;
  const d = new Date(ts);
  if (isNaN(d)) return false;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === monthStr;
}

async function loadAchievement() {
  const tbody = document.getElementById('achTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:20px">Memuat data...</td></tr>';

  const user = getCurrentUser();
  const isSA = isSuperAdminRole(user?.role);
  const coSel = document.getElementById('achPerusahaan');
  if (coSel) coSel.style.display = isSA ? '' : 'none';

  try {
    const [karRes, hrRes, insRes] = await Promise.all([
      fetch('/api?action=getKaryawan').then(r => r.json()),
      fetch('/api?action=getHazardReports').then(r => r.json()),
      fetch('/api?action=getInspectionReports').then(r => r.json()),
    ]);

    _achKaryawan = (karRes.data || []).filter(r =>
      String(r['ROLE'] || '').toUpperCase().replace(/\s+/g, '_') !== 'DELETED'
    );
    _achHazardReports = hrRes.data || [];
    _achInsReports    = insRes.data || [];
    _achReportsLoaded = true;

    const depts = [...new Set(_achKaryawan.map(k => k['DEPARTEMEN'] || '').filter(Boolean))].sort();
    const deptSel = document.getElementById('achDept');
    if (deptSel) {
      const cur = deptSel.value;
      deptSel.innerHTML = '<option value="">Semua Departemen</option>' +
        depts.map(d => `<option value="${escapeHTML(d)}"${d === cur ? ' selected' : ''}>${escapeHTML(d)}</option>`).join('');
    }

    if (isSA && coSel) {
      const cos = [...new Set(_achKaryawan.map(k => k['PERUSAHAAN'] || '').filter(Boolean))].sort();
      const cur = coSel.value;
      coSel.innerHTML = '<option value="">Semua Perusahaan</option>' +
        cos.map(c => `<option value="${escapeHTML(c)}"${c === cur ? ' selected' : ''}>${escapeHTML(c)}</option>`).join('');
    }

    const thead = document.getElementById('achTableHead');
    if (thead) {
      thead.innerHTML = `<tr>
        ${isSA ? '<th>Perusahaan</th>' : ''}
        <th>Nama</th><th>NIK</th><th>Jabatan</th><th>Departemen</th>
        <th class="um-center">OBJ HR</th><th class="um-center">Capaian HR</th><th class="um-center">% HR</th>
        <th class="um-center">OBJ INS</th><th class="um-center">Capaian INS</th><th class="um-center">% INS</th>
        <th class="um-center">% Total</th>
      </tr>`;
    }

    computeAndRenderAchievement();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#ef4444;padding:20px">${escapeHTML(e.message)}</td></tr>`;
  }
}

function computeAndRenderAchievement() {
  if (!_achReportsLoaded) return;

  const monthStr = document.getElementById('achMonth')?.value || '';
  const deptF    = (document.getElementById('achDept')?.value || '').toLowerCase();
  const coF      = (document.getElementById('achPerusahaan')?.value || '').toLowerCase();
  const allRep   = [..._achHazardReports, ..._achInsReports];

  _achComputed = _achKaryawan.map(k => {
    const nik  = String(k['NIK']  || '').trim();
    const nama = String(k['NAMA'] || '').trim().toLowerCase();
    const mine = monthStr ? allRep.filter(r => {
      const rNik  = String(r.nik || r.nik_pelapor || '').trim();
      const rNama = String(r.nama || r.pelapor || '').trim().toLowerCase();
      return ((nik && rNik === nik) || (nama && rNama === nama)) &&
             _achSameMonth(r.timestamp || r.tanggal_laporan || r.tgl_laporan || r.tanggal_inspeksi, monthStr);
    }) : [];

    const achHR    = mine.filter(r => r.report_type === 'HAZARD').length;
    const achINS   = mine.filter(r => r.report_type === 'INSPECTION').length;
    const objHR    = parseInt(k['OBJ HR']  || 0) || 0;
    const objINS   = parseInt(k['OBJ INS'] || 0) || 0;
    const pctHR    = objHR  > 0 ? Math.round(achHR  / objHR  * 100) : null;
    const pctINS   = objINS > 0 ? Math.round(achINS / objINS * 100) : null;
    const totalObj = objHR + objINS;
    const pctTotal = totalObj > 0 ? Math.round((achHR + achINS) / totalObj * 100) : null;
    return { k, achHR, achINS, objHR, objINS, pctHR, pctINS, pctTotal };
  });

  _achFiltered = _achComputed.filter(row => {
    const dept = String(row.k['DEPARTEMEN'] || '').toLowerCase();
    const co   = String(row.k['PERUSAHAAN'] || '').toLowerCase();
    return (!deptF || dept.includes(deptF)) && (!coF || co.includes(coF));
  });

  _achPage = 1;
  renderAchTable();
  renderAchKpi();
}

function _achPctCell(pct) {
  if (pct === null) return '<td class="um-center" style="color:#cbd5e1">-</td>';
  const color = pct >= 100 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  const bg    = pct >= 100 ? '#f0fdf4' : pct >= 50 ? '#fffbeb' : '#fff1f2';
  return `<td class="um-center"><span style="background:${bg};color:${color};font-weight:700;padding:2px 8px;border-radius:6px;font-size:.78rem">${pct}%</span></td>`;
}

function renderAchTable() {
  const tbody = document.getElementById('achTableBody');
  if (!tbody) return;

  const monthStr = document.getElementById('achMonth')?.value || '';
  const isSA     = isSuperAdminRole(getCurrentUser()?.role);
  const colSpan  = isSA ? 12 : 11;

  if (!monthStr) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:24px;color:#94a3b8">Pilih bulan untuk melihat capaian SAP</td></tr>`;
    document.getElementById('achPagination').innerHTML = '';
    return;
  }

  if (!_achFiltered.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada data</td></tr>`;
    renderAchPagination();
    return;
  }

  const start = (_achPage - 1) * ACH_PAGE_SIZE;
  tbody.innerHTML = _achFiltered.slice(start, start + ACH_PAGE_SIZE).map(row => `
    <tr>
      ${isSA ? `<td>${escapeHTML(row.k['PERUSAHAAN'] || '')}</td>` : ''}
      <td>${escapeHTML(row.k['NAMA'] || '')}</td>
      <td>${escapeHTML(String(row.k['NIK'] || '-'))}</td>
      <td>${escapeHTML(row.k['JABATAN'] || '')}</td>
      <td>${escapeHTML(row.k['DEPARTEMEN'] || '')}</td>
      <td class="um-center">${row.objHR || '-'}</td>
      <td class="um-center"><b>${row.achHR}</b></td>
      ${_achPctCell(row.pctHR)}
      <td class="um-center">${row.objINS || '-'}</td>
      <td class="um-center"><b>${row.achINS}</b></td>
      ${_achPctCell(row.pctINS)}
      ${_achPctCell(row.pctTotal)}
    </tr>`).join('');

  renderAchPagination();
}

function renderAchPagination() {
  const el    = document.getElementById('achPagination');
  if (!el) return;
  const pages = Math.ceil(_achFiltered.length / ACH_PAGE_SIZE);
  if (pages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = Array.from({length: pages}, (_, i) => i + 1)
    .map(p => `<button class="um-page-btn${p === _achPage ? ' active' : ''}" onclick="_achGoPage(${p})">${p}</button>`)
    .join('');
}

window._achGoPage = function(p) { _achPage = p; renderAchTable(); };

function renderAchKpi() {
  const el = document.getElementById('achKpi');
  if (!el) return;
  const monthStr = document.getElementById('achMonth')?.value || '';
  if (!monthStr || !_achFiltered.length) { el.style.display = 'none'; return; }

  const avg = (key) => {
    const valid = _achFiltered.filter(r => r[key] !== null);
    return valid.length ? Math.round(valid.reduce((s, r) => s + r[key], 0) / valid.length) : null;
  };

  const kpiItem = (label, val, icon) => {
    if (val === null) return '';
    const color = val >= 100 ? '#22c55e' : val >= 50 ? '#f59e0b' : '#ef4444';
    return `<div class="ach-kpi-cell">
      <i class="fa-solid ${icon}" style="color:${color};font-size:1.1rem"></i>
      <div class="ach-kpi-num" style="color:${color}">${val}%</div>
      <div class="ach-kpi-label">${label}</div>
    </div>`;
  };

  el.style.display = 'flex';
  el.innerHTML = `
    <div class="ach-kpi-cell">
      <i class="fa-solid fa-users" style="color:#64748b;font-size:1.1rem"></i>
      <div class="ach-kpi-num" style="color:#0f172a">${_achFiltered.length}</div>
      <div class="ach-kpi-label">Total Karyawan</div>
    </div>
    ${kpiItem('Rata-rata HR',    avg('pctHR'),    'fa-triangle-exclamation')}
    ${kpiItem('Rata-rata INS',   avg('pctINS'),   'fa-clipboard-check')}
    ${kpiItem('Rata-rata Total', avg('pctTotal'), 'fa-trophy')}`;
}

function exportAchievementCsv() {
  if (!_achFiltered.length) { alert('Tidak ada data untuk di-export.'); return; }
  const monthStr = document.getElementById('achMonth')?.value || 'semua';
  const isSA     = isSuperAdminRole(getCurrentUser()?.role);

  const headers = [
    ...(isSA ? ['Perusahaan'] : []),
    'Nama', 'NIK', 'Jabatan', 'Departemen',
    'OBJ HR', 'Capaian HR', '% HR',
    'OBJ INS', 'Capaian INS', '% INS', '% Total',
  ];

  const rows = _achFiltered.map(r => [
    ...(isSA ? [r.k['PERUSAHAAN'] || ''] : []),
    r.k['NAMA'] || '', String(r.k['NIK'] || ''), r.k['JABATAN'] || '', r.k['DEPARTEMEN'] || '',
    r.objHR, r.achHR, r.pctHR    !== null ? r.pctHR    + '%' : '-',
    r.objINS, r.achINS, r.pctINS !== null ? r.pctINS   + '%' : '-',
    r.pctTotal !== null ? r.pctTotal + '%' : '-',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = `capaian_sap_${monthStr}.csv`;
  a.click();
}

// ===== RESET PASSWORD (SUPER_ADMIN) =====

let _resetPwTarget = null;

function openResetPwModal(user) {
  _resetPwTarget = user;
  document.getElementById('resetPwNama').textContent = user['NAMA'] || '-';
  document.getElementById('resetPwNik').textContent  = user['NIK']  || '-';
  document.getElementById('resetPwInput').value = '';
  document.getElementById('resetPwMsg').textContent = '';
  document.getElementById('resetPwModal').style.display = 'flex';
}

function closeResetPwModal() {
  document.getElementById('resetPwModal').style.display = 'none';
  _resetPwTarget = null;
}

async function submitResetPw() {
  if (!_resetPwTarget) return;
  const pw  = document.getElementById('resetPwInput').value.trim();
  const msg = document.getElementById('resetPwMsg');
  if (!pw) { msg.textContent = 'Password tidak boleh kosong.'; msg.style.color = '#ef4444'; return; }
  if (pw.length < 8) { msg.textContent = 'Minimal 8 karakter.'; msg.style.color = '#ef4444'; return; }
  const btn = document.getElementById('btnSubmitResetPw');
  btn.disabled = true;
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'adminResetPassword', data: { nik: _resetPwTarget['NIK'], new_password: pw } })
    });
    const json = await res.json();
    if (json.status === 'success') {
      msg.textContent = 'Password berhasil direset!';
      msg.style.color = '#16a34a';
      setTimeout(closeResetPwModal, 1200);
    } else {
      msg.textContent = json.message || 'Gagal reset password.';
      msg.style.color = '#ef4444';
    }
  } catch (e) {
    msg.textContent = e.message;
    msg.style.color = '#ef4444';
  } finally {
    btn.disabled = false;
  }
}

// ===== PENARIKAN DATA / EXPORT LAPORAN =====

let _expAllReports = [];
let _expFiltered   = [];
let _expPage       = 1;
const EXP_PAGE_SIZE = 50;

// Kolom untuk preview tabel (9 kolom)
const EXP_PREVIEW_COLS = [
  { keys: ['report_type'],                                                  label: 'Tipe' },
  { keys: ['id'],                                                           label: 'ID' },
  { keys: ['timestamp','tanggal_laporan','tgl_laporan','tanggal_kejadian'], label: 'Tanggal' },
  { keys: ['perusahaan'],                                                   label: 'Perusahaan' },
  { keys: ['nama'],                                                         label: 'Nama Pelapor' },
  { keys: ['departemen'],                                                   label: 'Departemen' },
  { keys: ['deskripsi_bahaya','temuan_inspeksi','deskripsi'],               label: 'Deskripsi / Temuan' },
  { keys: ['status_perbaikan'],                                             label: 'Status' },
  { keys: ['nama_pic'],                                                     label: 'PIC' },
];

// Kolom untuk export (semua, tanpa WA)
const EXP_ALL_COLS = [
  { keys: ['report_type'],                                                         label: 'Tipe Laporan' },
  { keys: ['id'],                                                                  label: 'ID Laporan' },
  { keys: ['timestamp','tanggal_laporan','tgl_laporan'],                           label: 'Tanggal Laporan' },
  { keys: ['perusahaan'],                                                          label: 'Perusahaan' },
  { keys: ['perusahaan_subcont1','subcont1','subcont'],                            label: 'Subcont' },
  { keys: ['nama'],                                                                label: 'Nama Pelapor' },
  { keys: ['nik'],                                                                 label: 'NIK Pelapor' },
  { keys: ['jabatan'],                                                             label: 'Jabatan Pelapor' },
  { keys: ['departemen'],                                                          label: 'Departemen Pelapor' },
  // NO WHATSAPP: dihilangkan
  { keys: ['tanggal_kejadian','tanggal_inspeksi'],                                 label: 'Tanggal Kejadian / Inspeksi' },
  { keys: ['shift_kejadian','shift_inspeksi'],                                     label: 'Shift' },
  { keys: ['lokasi_bahaya','lokasi_inspeksi','lokasi'],                            label: 'Lokasi' },
  { keys: ['detail_lokasi_bahaya','detail_lokasi_inspeksi'],                       label: 'Detail Lokasi' },
  { keys: ['jenis_bahaya','jenis_inspeksi'],                                       label: 'Jenis' },
  { keys: ['ketidaksesuaian_bahaya'],                                              label: 'Ketidaksesuaian' },
  { keys: ['sub_ketidaksesuaian','subketidaksesuaian'],                            label: 'Sub Ketidaksesuaian' },
  { keys: ['deskripsi_bahaya','temuan_inspeksi','deskripsi'],                      label: 'Deskripsi / Temuan' },
  { keys: ['tingkat_risiko','tingkat_resiko'],                                     label: 'Tingkat Risiko' },
  { keys: ['tindakan_langsung'],                                                   label: 'Tindakan Langsung' },
  { keys: ['tindakan_usulan_pic','rekomendasi_perbaikan'],                         label: 'Tindakan Usulan PIC' },
  { keys: ['perusahaan_pic'],                                                      label: 'Perusahaan PIC' },
  { keys: ['nama_pic'],                                                            label: 'Nama PIC' },
  { keys: ['nik_pic'],                                                             label: 'NIK PIC' },
  { keys: ['jabatan_pic'],                                                         label: 'Jabatan PIC' },
  { keys: ['departemen_pic'],                                                      label: 'Departemen PIC' },
  // NO WHATSAPP PIC: dihilangkan
  { keys: ['batas_waktu'],                                                         label: 'Batas Waktu' },
  { keys: ['status_perbaikan'],                                                    label: 'Status' },
  { keys: ['plan_status'],                                                         label: 'Status Rencana' },
  { keys: ['rencana_tindakan'],                                                    label: 'Rencana Tindakan' },
  { keys: ['tanggal_rencana'],                                                     label: 'Tanggal Rencana' },
  { keys: ['catatan_closing'],                                                     label: 'Catatan Closing' },
  { keys: ['tanggal_closing'],                                                     label: 'Tanggal Closing' },
  { keys: ['closing_status'],                                                      label: 'Status Konfirmasi Closing' },
  { keys: ['closing_review_comment'],                                              label: 'Catatan Penolakan Closing' },
];

function _expVal(r, keys) {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function _expFmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d) ? str : d.toLocaleDateString('id-ID', { day:'2-digit', month:'2-digit', year:'numeric' });
}

async function loadExportData() {
  const tbody = document.getElementById('expTableBody');
  const countEl = document.getElementById('expCount');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px">Memuat data...</td></tr>';
  if (countEl) countEl.textContent = '';
  try {
    const res  = await fetch('/api?action=getAllReports');
    const json = await res.json();
    _expAllReports = json.data || [];

    // Scope ADMIN ke perusahaannya sendiri (SUPER_ADMIN dapat semua)
    const auth = getCurrentUser();
    if (!isSuperAdminRole(auth?.role)) {
      const co = String(auth?.perusahaan || '').trim().toUpperCase();
      if (co) _expAllReports = _expAllReports.filter(r =>
        String(r.perusahaan || '').trim().toUpperCase() === co
      );
    }

    filterExportData();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ef4444;padding:20px">${escapeHTML(e.message)}</td></tr>`;
  }
}

function filterExportData() {
  const type = document.getElementById('expType')?.value  || '';
  const from = document.getElementById('expFrom')?.value  || '';
  const to   = document.getElementById('expTo')?.value    || '';

  _expFiltered = _expAllReports.filter(r => {
    if (type && String(r.report_type || '').toUpperCase() !== type) return false;
    const dateStr = _expVal(r, ['timestamp','tanggal_laporan','tgl_laporan','tanggal_kejadian','tanggal_inspeksi']);
    if (dateStr) {
      const ymd = new Date(dateStr);
      if (!isNaN(ymd)) {
        const s = ymd.toISOString().slice(0, 10);
        if (from && s < from) return false;
        if (to   && s > to)   return false;
      }
    } else if (from || to) {
      return false;
    }
    return true;
  });

  _expFiltered.sort((a, b) => {
    const da = new Date(_expVal(a, ['timestamp','tanggal_laporan','tgl_laporan']));
    const db = new Date(_expVal(b, ['timestamp','tanggal_laporan','tgl_laporan']));
    return isNaN(da) - isNaN(db) || da - db;
  });

  _expPage = 1;
  const n = _expFiltered.length;
  if (document.getElementById('expCount'))
    document.getElementById('expCount').textContent = n ? `${n} laporan` : 'Tidak ada data';
  renderExportTable();
}

function renderExportTable() {
  const tbody = document.getElementById('expTableBody');
  if (!tbody) return;
  if (!_expFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada laporan sesuai filter</td></tr>';
    document.getElementById('expPagination').innerHTML = '';
    return;
  }

  const STATUS_LABELS = { OPEN:'Open', PROGRESS:'In Progress', CLOSED:'Closed', FOLLOWUP:'Menunggu Konfirmasi' };
  const start = (_expPage - 1) * EXP_PAGE_SIZE;
  const rows  = _expFiltered.slice(start, start + EXP_PAGE_SIZE);

  tbody.innerHTML = rows.map(r => {
    const isIns   = r.report_type === 'INSPECTION';
    const typeBadge = `<span class="report-type-badge ${isIns ? 'inspection' : 'hazard'}" style="font-size:.72rem;padding:2px 7px">${isIns ? 'Inspeksi' : 'Hazard'}</span>`;
    const st      = _expVal(r, ['status_perbaikan']) || '-';
    const stBadge = `<span class="status-badge status-${(st).toLowerCase()}" style="font-size:.72rem;padding:2px 7px">${STATUS_LABELS[st] || st}</span>`;
    return '<tr>' + EXP_PREVIEW_COLS.map(col => {
      if (col.keys[0] === 'report_type') return `<td>${typeBadge}</td>`;
      if (col.keys[0] === 'status_perbaikan') return `<td>${stBadge}</td>`;
      let v = _expVal(r, col.keys);
      if (col.keys.some(k => k.includes('timestamp') || k.includes('tanggal') || k.includes('tgl'))) v = _expFmtDate(v) || v;
      const display = v.length > 80 ? v.slice(0, 77) + '...' : v;
      return `<td>${escapeHTML(display || '-')}</td>`;
    }).join('') + '</tr>';
  }).join('');

  renderExpPagination();
}

function renderExpPagination() {
  const el    = document.getElementById('expPagination');
  if (!el) return;
  const pages = Math.ceil(_expFiltered.length / EXP_PAGE_SIZE);
  if (pages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = Array.from({ length: pages }, (_, i) => i + 1)
    .map(p => `<button class="um-page-btn${p === _expPage ? ' active' : ''}" onclick="_expGoPage(${p})">${p}</button>`)
    .join('');
}

window._expGoPage = function(p) { _expPage = p; renderExportTable(); };

function exportToExcel() {
  if (!_expFiltered.length) { alert('Tidak ada data untuk di-export. Pastikan filter sudah dipilih.'); return; }

  const from  = document.getElementById('expFrom')?.value || 'awal';
  const to    = document.getElementById('expTo')?.value   || 'akhir';
  const type  = (document.getElementById('expType')?.value || 'semua').toLowerCase();

  const isDateKey = k => k.includes('timestamp') || k.includes('tanggal') || k.includes('tgl');

  const headers = EXP_ALL_COLS.map(c => c.label);
  const dataRows = _expFiltered.map(r =>
    EXP_ALL_COLS.map(col => {
      let v = _expVal(r, col.keys);
      if (col.keys.some(isDateKey) && v) v = _expFmtDate(v) || v;
      if (col.keys[0] === 'report_type') v = v === 'INSPECTION' ? 'Inspeksi' : v === 'HAZARD' ? 'Hazard Report' : v;
      return v;
    })
  );

  const csv = [headers, ...dataRows]
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = `laporan_${type}_${from}_${to}.csv`;
  a.click();
}
