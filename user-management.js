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

function isAdminOrAbove(role) {
  const r = String(role || '').toUpperCase();
  return r === 'ADMIN' || r === 'SUPER_ADMIN';
}
function isSuperAdminRole(role) { return String(role || '').toUpperCase() === 'SUPER_ADMIN'; }

async function loadUsers() {
  const tbody = document.getElementById('umTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px">Memuat...</td></tr>';
  try {
    const res = await fetch('/api?action=getKaryawan');
    const result = await res.json();
    umUsers = (result.data || []).filter(r => String(r['ROLE'] || '').toUpperCase() !== 'DELETED');
    umFiltered = [...umUsers];
    umPage = 1;
    renderUMTable();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#ef4444">${e.message}</td></tr>`;
  }
}

async function loadPendingChanges() {
  try {
    const res = await fetch('/api?action=getPendingChanges');
    const result = await res.json();
    renderPendingChanges(result.data || []);
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
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada data</td></tr>';
    renderUMPagination();
    return;
  }

  tbody.innerHTML = page.map(u => `
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
        <button class="um-btn-edit" onclick='openEditUser(${JSON.stringify(u)})'>Edit</button>
        <button class="um-btn-delete" onclick='confirmDeleteUser(${JSON.stringify(u)})'>Hapus</button>
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
        <div class="cp-field">
          <label>Role</label>
          <select id="umf_ROLE">
            ${['USER','ADMIN','SUPER_ADMIN'].map(r => `<option value="${r}"${String(user['ROLE']||'USER').toUpperCase()===r?' selected':''}>${r}</option>`).join('')}
          </select>
        </div>
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
    alert(result.message);
    if (result.status === 'success') loadUsers();
  } catch (e) { alert(e.message); }
}

async function reviewChange(changeId, decision) {
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reviewChange', data: { change_id: changeId, decision } })
    });
    const result = await res.json();
    alert(result.message);
    if (result.status === 'success') { loadUsers(); loadPendingChanges(); }
  } catch (e) { alert(e.message); }
}

function promptReject(changeId) {
  const reason = prompt('Alasan penolakan (opsional):');
  if (reason === null) return; // cancelled
  rejectChange(changeId, reason);
}

async function rejectChange(changeId, reason) {
  try {
    const res = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reviewChange', data: { change_id: changeId, decision: 'REJECT', reason } })
    });
    const result = await res.json();
    alert(result.message);
    if (result.status === 'success') loadPendingChanges();
  } catch (e) { alert(e.message); }
}

function renderUMTab() {
  // Sudah di-render dari HTML, fungsi ini hanya untuk inisialisasi event
  const search = document.getElementById('umSearch');
  if (search) search.addEventListener('input', filterUsers);
}
