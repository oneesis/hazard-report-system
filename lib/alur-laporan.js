// Aturan otomatis alur pelaporan Hazard & Inspeksi (keputusan user 2026-10-12, A3–A5).
// Murni (tanpa I/O) — dieksekusi harian oleh cronAlurLaporan di api/index.js.
//   A3: rencana tindakan menunggu persetujuan pelapor > 2 hari → otomatis disetujui
//   A5: closing menunggu konfirmasi pelapor > 3 hari → otomatis dikonfirmasi (CLOSED)
//   A4: eskalasi — OPEN tanpa rencana ≥ 3 hari → ingatkan PIC; ≥ 7 hari → Section Head
//       departemen PIC; lewat batas waktu (belum CLOSED) → SHE. Tiap tingkat sekali per laporan.

const HARI_SETUJU_RENCANA = 2;
const HARI_KONFIRMASI_CLOSING = 3;
const HARI_INGATKAN_PIC = 3;
const HARI_SECTION_HEAD = 7;

const umurHari = (iso, now) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (now - t) / 864e5;
};

/** laporan: [{ tabel, id, status, data }] → daftar aksi { aksi, tabel, id, data }. */
function rencanakanAlur(laporan, now = Date.now(), today = new Date(now).toISOString().slice(0, 10)) {
  const out = [];
  for (const l of laporan) {
    const d = l.data || {};
    const st = String(l.status || d.status_perbaikan || '').toUpperCase();
    if (st === 'CLOSED') continue;
    const add = (aksi) => out.push({ aksi, tabel: l.tabel, id: l.id, data: d });

    if (d.plan_status === 'pending_review') {
      const u = umurHari(d.plan_submitted_at, now);
      if (u !== null && u >= HARI_SETUJU_RENCANA) add('setujuiRencana');
    }
    if (String(d.closing_status || '').toLowerCase() === 'pending_review') {
      const u = umurHari(d.closing_submitted_at || d.plan_reviewed_at || d.timestamp, now);
      if (u !== null && u >= HARI_KONFIRMASI_CLOSING) add('konfirmasiClosing');
      continue; // sudah tahap closing — tak perlu eskalasi
    }
    if (d.pic_dispute && d.pic_dispute.status === 'PENDING') continue; // PIC dipersoalkan → jeda

    const tanpaRencana = st === 'OPEN' && !String(d.rencana_tindakan || '').trim();
    const umur = umurHari(d.timestamp, now);
    if (tanpaRencana && umur !== null) {
      if (umur >= HARI_INGATKAN_PIC && !d.eskalasi_pic_at) add('ingatkanPic');
      if (umur >= HARI_SECTION_HEAD && !d.eskalasi_sect_at) add('eskalasiSect');
    }
    const batas = String(d.batas_waktu || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(batas) && batas < today && !d.eskalasi_she_at) add('eskalasiShe');
  }
  return out;
}

module.exports = { rencanakanAlur, HARI_SETUJU_RENCANA, HARI_KONFIRMASI_CLOSING, HARI_INGATKAN_PIC, HARI_SECTION_HEAD };
