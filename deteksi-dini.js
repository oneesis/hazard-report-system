// Dasbor Deteksi Dini (tahap 4, 2026-10-14). Data: GET ?action=deteksiDini (lib/indeks-risiko.js di server).
const esc = (v) => escapeHTML(v ?? '');
const WARNA = { merah: '#dc2626', kuning: '#d97706', hijau: '#16a34a' };
const LABEL = { merah: 'Merah', kuning: 'Kuning', hijau: 'Hijau' };
let DD = null;

async function ddMuat(segar = false) {
  const isi = document.getElementById('ddIsi');
  const btn = document.getElementById('btnSegarkan');
  btn.disabled = true;
  try {
    const res = await fetch('/api?action=deteksiDini' + (segar ? '&segar=1' : ''));
    const j = await res.json();
    if (!res.ok || j.status === 'error') throw new Error(j.message || 'Gagal memuat.');
    DD = j;
    document.getElementById('ddLingkup').textContent = `${j.lingkup} · dihitung ${new Date(j.dihitung).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`;
    isi.innerHTML = render(j);
    isi.querySelectorAll('.dd-pw-btn button').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tanggapiPeringatan', data: { id: b.closest('.dd-pw').dataset.id, tanggapan: b.dataset.t } }) }).then((x) => x.json());
        if (r.status === 'error') throw new Error(r.message);
        showToast(r.message); ddMuat(true);
      } catch (e) { showToast(e.message, 'error'); b.disabled = false; }
    }));
    isi.querySelectorAll('.dd-tab').forEach((b) => b.addEventListener('click', () => {
      isi.querySelectorAll('.dd-tab').forEach((x) => x.classList.toggle('active', x === b));
      isi.querySelectorAll('.dd-tabel').forEach((t) => { t.hidden = t.dataset.dim !== b.dataset.dim; });
    }));
  } catch (e) {
    isi.innerHTML = `<div class="dd-loading">${esc(e.message)}</div>`;
  } finally { btn.disabled = false; }
}
document.getElementById('btnSegarkan').addEventListener('click', () => ddMuat(true));

/** Garis kecil 12 minggu (SVG, tanpa library). */
function spark(seri, warna = '#1e3a8a', w = 110, h = 28) {
  const max = Math.max(...seri, 1);
  const pts = seri.map((v, i) => `${(i / (seri.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  return `<svg class="dd-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline fill="none" stroke="${warna}" stroke-width="1.8" points="${pts}"/></svg>`;
}

function render(d) {
  const lok = d.lokasi, n = (s) => lok.filter((x) => x.status === s).length;
  const perhatian = lok.filter((x) => x.status !== 'hijau');
  const link = (m) => (m.sumber === 'SBO' ? esc(m.id) : `<a href="laporan-detail.html?id=${encodeURIComponent(m.id)}" target="_blank">${esc(m.id)}</a>`);
  const tabel = (rows, dim) => `<div class="dd-tabel" data-dim="${dim}"${dim === 'lokasi' ? '' : ' hidden'}>
    ${rows.length ? rows.map((x) => `<div class="dd-baris">
      <span class="dd-dot" style="background:${WARNA[x.status]}" title="${LABEL[x.status]}"></span>
      <span class="dd-nama">${esc(x.nama)}<small>${x.alasan.length ? esc(x.alasan.join(' · ')) : 'Normal'}</small></span>
      <span class="dd-angka" title="Skor minggu ini (rata-rata 8 minggu)"><b>${x.skor}</b><small>rata ${x.baseline ?? '-'}</small></span>
      <span class="dd-angka dd-angka-mayor" title="Temuan Mayor terbuka / lewat batas"><b>${x.mayorTerbuka}</b><small>Mayor buka${x.terlambat ? ` · ${x.terlambat} lewat` : ''}</small></span>
      ${spark(x.seri, WARNA[x.status])}
    </div>`).join('') : '<div class="dd-kosong">Belum ada data.</div>'}</div>`;

  const bar = (rows, warna) => {
    const max = Math.max(...rows.map((r) => r.jumlah), 1);
    return rows.map((r) => `<div class="dd-bar"><span class="dd-bar-lbl"><b>${esc(r.kode)}</b> ${esc(r.nama)}${r.pernahInsiden ? ' <i class="fa-solid fa-car-burst" title="Pernah jadi penyebab insiden"></i>' : ''}</span>
      <span class="dd-bar-isi"><span style="width:${(r.jumlah / max) * 100}%;background:${warna}"></span></span><span class="dd-bar-n">${r.jumlah}</span></div>`).join('') || '<div class="dd-kosong">-</div>';
  };

  const maxSeri = Math.max(...d.seriTotal, 1);
  const tren = `<div class="dd-tren">${d.seriTotal.map((v, i) => `<div class="dd-tren-kol" title="Minggu s/d ${esc(d.minggu[i])}: skor ${v}">
      <span style="height:${(v / maxSeri) * 100}%"></span><small>${esc(d.minggu[i].slice(5))}</small></div>`).join('')}</div>`;

  const p = d.piramida;
  const lapis = [['Fatal / LTI', p.berat, '#7f1d1d'], ['MTI / P3K', p.ringan, '#dc2626'], ['Kerugian aset / kebakaran / lingkungan', p.kerugian, '#ea580c'],
    ['Near miss', p.nearMiss, '#d97706'], ['Temuan Mayor', p.temuanMayor, '#2563eb'], ['Semua temuan', p.temuan, '#64748b']];
  const maxP = Math.max(...lapis.map((l) => l[1]), 1);
  const piramida = lapis.map(([lbl, v, c]) => `<div class="dd-pir"><span class="dd-pir-bar" style="width:${Math.max(6, Math.sqrt(v / maxP) * 100)}%;background:${c}">${v}</span><span>${lbl}</span></div>`).join('');

  let sa = '';
  if (d.kpi) {
    const k = d.kpi, pct = (v) => (v === null ? '-' : v + '%');
    sa = `<h2 class="dd-h2"><i class="fa-solid fa-gauge-high"></i> KPI Program <span class="dd-badge">Super Admin</span></h2>
    <div class="dd-kpi">
      <div><b>${pct(k.hari30.areaOperasional)}</b><span>Laporan Hazard dari area operasional / kritis (30 hari)</span><small>semua: ${pct(k.semua.areaOperasional)}</small></div>
      <div><b>${pct(k.hari30.tindakan)}</b><span>Temuan berupa tindakan tidak aman (30 hari)</span><small>semua: ${pct(k.semua.tindakan)}</small></div>
      <div><b>${pct(k.hari30.mayorTepatWaktu)}</b><span>Temuan Mayor ditutup tepat waktu (30 hari, ${k.hari30.mayorJatuhTempo} jatuh tempo)</span><small>semua: ${pct(k.semua.mayorTepatWaktu)}</small></div>
    </div>
    <div class="dd-grid2">
      <div class="dd-kartu"><h3>Rasio temuan : insiden per lokasi</h3>
        ${k.rasio.map((r) => `<div class="dd-rasio"><span>${esc(r.lokasi)}</span><span>${r.temuan} temuan</span><span>${r.insiden} insiden</span>
          <b class="${r.temuan < r.insiden ? 'kurang' : ''}">${r.insiden ? (r.temuan / r.insiden).toFixed(1) : '-'}</b></div>`).join('')}
        <p class="dd-ket">Rasio &lt; 1 (merah): lebih banyak insiden daripada temuan yang dilaporkan — area yang kurang dilaporkan.</p></div>
      <div class="dd-kartu"><h3>Capaian berbobot area (30 hari) <small>terpisah dari capaian SAP resmi</small></h3>
        ${d.capaianBobot.slice(0, 15).map((c) => `<div class="dd-rasio"><span>${esc(c.departemen)}</span><span>${c.laporan} laporan</span><span>${c.pctOperasional}% operasional</span><b>${c.skor}</b></div>`).join('') || '-'}
        <p class="dd-ket">Bobot: area Operasional / Kritis ×2, Lingkungan / Kendaraan ×1,5, Fasilitas ×1.</p></div>
    </div>`;
  }

  return `
    <div class="dd-ringkas">
      <div class="r-merah"><b>${n('merah')}</b><span>Area merah</span></div>
      <div class="r-kuning"><b>${n('kuning')}</b><span>Area kuning</span></div>
      <div><b>${d.mayorTerbuka.length}</b><span>Temuan Mayor terbuka</span></div>
      <div><b>${d.berulang.length}</b><span>Temuan berulang (30 hari)</span></div>
      <div><b>${d.jumlah.temuan}</b><span>Temuan (${d.jumlah.hazard} HR · ${d.jumlah.inspeksi} INS · ${d.jumlah.sbo} SBO)</span></div>
      <div><b>${d.jumlah.insiden}</b><span>Insiden tercatat</span></div>
    </div>

    ${(d.peringatan || []).length ? `<h2 class="dd-h2"><i class="fa-solid fa-bell"></i> Peringatan terkirim (14 hari)</h2>
    <div class="dd-kartu">${d.peringatan.map((w) => `<div class="dd-pw" data-id="${w.id}">
      <div><b>${esc(w.jenis === 'hujan' ? 'Hujan lebat ' + w.nama : (w.dimensi === 'lokasi' ? 'Area ' : 'Departemen ') + w.nama)}</b>
        <small>${esc(w.dibuat)} · ${esc((w.alasan || []).join('; '))}</small></div>
      ${w.tanggapan ? `<span class="dd-pw-t">${esc(w.tanggapan)} · ${esc(w.ditanggapi_oleh || '')}</span>`
        : '<span class="dd-pw-btn"><button class="btn-secondary" data-t="Ditindaklanjuti">Ditindaklanjuti</button><button class="btn-secondary" data-t="Tidak relevan">Tidak relevan</button></span>'}
    </div>`).join('')}<p class="dd-ket">Tanggapanmu dipakai untuk menyetel bobot indeks agar peringatan makin tepat.</p></div>` : ''}

    ${perhatian.length ? `<h2 class="dd-h2"><i class="fa-solid fa-triangle-exclamation"></i> Area perlu perhatian</h2>
    <div class="dd-perhatian">${perhatian.map((x) => `<div class="dd-alert dd-alert--${x.status}">
      <div class="dd-alert-top"><b>${esc(x.nama)}</b><span>${LABEL[x.status]}</span></div>
      <ul>${x.alasan.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>${spark(x.seri, WARNA[x.status], 220, 34)}</div>`).join('')}</div>` : ''}

    <h2 class="dd-h2"><i class="fa-solid fa-ranking-star"></i> Indeks risiko</h2>
    <div class="dd-tabs"><button class="dd-tab active" data-dim="lokasi">Lokasi</button><button class="dd-tab" data-dim="departemen">Departemen</button>
      ${d.perusahaan.length ? '<button class="dd-tab" data-dim="perusahaan">Perusahaan</button>' : ''}</div>
    ${tabel(d.lokasi, 'lokasi')}${tabel(d.departemen, 'departemen')}${d.perusahaan.length ? tabel(d.perusahaan, 'perusahaan') : ''}

    <h2 class="dd-h2"><i class="fa-solid fa-chart-column"></i> Tren skor risiko 12 minggu</h2>
    <div class="dd-kartu">${tren}<p class="dd-ket">Jumlah skor semua lokasi per minggu (minggu terakhir termasuk denda temuan Mayor lewat batas waktu).</p></div>

    <div class="dd-grid2">
      <div class="dd-kartu"><h3>Temuan Mayor terbuka</h3>
        ${d.mayorTerbuka.slice(0, 25).map((m) => `<div class="dd-mayor${m.lewatHari > 0 ? ' lewat' : ''}">
          <span>${link(m)} · ${esc(m.sumber)} · ${esc(m.tanggal)}</span>
          <b>${esc(m.kode)} ${esc(m.nama)}${m.kritis ? ' <em>kritis</em>' : ''}</b>
          <span>${esc(m.lokasi)}${m.sub ? ' — ' + esc(m.sub) : ''} · ${m.lewatHari > 0 ? `lewat batas ${m.lewatHari} hari` : m.batas ? 'batas ' + esc(m.batas) : 'tanpa batas'}</span></div>`).join('') || '<div class="dd-kosong">Tidak ada.</div>'}</div>
      <div class="dd-kartu"><h3>Temuan berulang (30 hari)</h3>
        ${d.berulang.map((b) => `<div class="dd-mayor"><b>${esc(b.kode)} ${esc(b.nama)}</b>
          <span>${esc(b.lokasi)}${b.sub ? ' — ' + esc(b.sub) : ''} · ${b.jumlah} laporan pada ${b.hari} hari berbeda</span></div>`).join('') || '<div class="dd-kosong">Tidak ada.</div>'}</div>
    </div>

    <div class="dd-grid2">
      <div class="dd-kartu"><h3>Temuan terbanyak (30 hari)</h3>${bar(d.penyebab30, '#2563eb')}
        <p class="dd-ket"><i class="fa-solid fa-car-burst"></i> = kode yang pernah jadi penyebab insiden.</p></div>
      <div class="dd-kartu"><h3>Penyebab insiden terbanyak (riwayat)</h3>${bar(d.penyebabInsiden, '#dc2626')}</div>
    </div>

    <h2 class="dd-h2"><i class="fa-solid fa-layer-group"></i> Piramida keselamatan (12 bulan)</h2>
    <div class="dd-kartu dd-piramida">${piramida}</div>
    ${sa}`;
}
