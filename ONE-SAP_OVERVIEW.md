# ONE-SAP — Safety Accountability Program
### Web App Overview untuk Keperluan Poster

---

## Apa itu ONE-SAP?

**ONE-SAP** (Safety Observation and Action Program) adalah aplikasi web berbasis PWA (Progressive Web App) untuk pelaporan dan pengelolaan keselamatan kerja di lingkungan PT EBL / Hasnur Group. Dapat diakses dari browser HP maupun desktop tanpa perlu instal aplikasi.

**URL Produksi:** https://sap-ebl.vercel.app

---

## Fitur Utama

### 1. Hazard Report
Pelaporan potensi bahaya di area kerja secara real-time.
- Input: lokasi, kategori bahaya, deskripsi, foto bukti
- Tanda tangan digital pelapor
- Sistem penugasan PIC otomatis

### 2. Inspeksi K3 (8 Jenis)
Form inspeksi terstruktur dengan checklist per area:

| Kode | Area Inspeksi |
|------|--------------|
| INS_CB | Conveyor Belt |
| INS_JA | Jalan Angkut |
| INS_MD | Mess dan Dapur |
| INS_KG | Kantor & Gudang |
| INS_SP | Settling Pond |
| INS_T | Tambang |
| INS_TB | Tangki BBM |
| INS_WS | Workshop |

### 3. Alur Tindak Lanjut (Workflow)
Setiap laporan mengikuti alur yang terstruktur:

```
OPEN → Rencana (PIC) → Review (Pelapor) → IN PROGRESS → CLOSED
```

| Status | Keterangan |
|--------|-----------|
| OPEN | Laporan baru masuk |
| pending_review | PIC sudah isi rencana, menunggu persetujuan pelapor |
| approved | Rencana disetujui, PIC mulai perbaikan |
| IN PROGRESS | Sedang dalam perbaikan |
| CLOSED | Laporan ditutup dengan foto & catatan closing |

### 4. Dashboard & Analytics
- Grafik laporan per kategori, per periode, per status
- KPI ringkasan (total laporan, open, closed, overdue)
- Filter per departemen, perusahaan, dan tanggal

### 5. Notifikasi
- Notifikasi in-app real-time saat status laporan berubah
- Notifikasi WhatsApp otomatis via Fonnte API ke PIC

### 6. Monitoring Eskalasi
Pantau laporan yang melewati batas waktu penyelesaian (overdue) untuk tindakan cepat.

### 7. Manajemen User (Admin)
- Tambah, ubah, nonaktifkan akun karyawan
- Sistem approval perubahan data (dual-control)
- Reset password

### 8. Manajemen Laporan (Admin)
- Tampilan semua laporan seluruh karyawan
- Filter multi-kriteria
- Akses langsung ke detail dan tindak lanjut

---

## Teknis Singkat

| Komponen | Teknologi |
|----------|-----------|
| Frontend | Vanilla HTML / CSS / JavaScript (PWA) |
| Backend API | Node.js Serverless (Vercel Functions) |
| Database | Google Sheets (via Google Sheets API v4) |
| Hosting | Vercel (CDN global) |
| Autentikasi | JWT Token + bcrypt password hash |
| Notif WhatsApp | Fonnte API |
| Foto | Google Drive (base64 → Drive URL) |
| Offline | Service Worker + Cache API |

---

## Role Pengguna

| Role | Akses |
|------|-------|
| **USER** | Laporan milik sendiri + sebagai PIC |
| **ADMIN** | Semua laporan perusahaan + manajemen |
| **SUPER_ADMIN** | Semua laporan semua perusahaan + manajemen user |

---

## Keunggulan Aplikasi

- **Tanpa Instal** — langsung buka dari browser HP
- **Responsif** — optimal di HP maupun desktop
- **Offline-ready** — halaman tetap terbuka saat sinyal buruk
- **Real-time** — notifikasi langsung saat status berubah
- **Terintegrasi WhatsApp** — PIC langsung mendapat notif WA
- **Audit Trail** — setiap perubahan tercatat dengan timestamp
- **Multi-perusahaan** — mendukung kontraktor & subkontraktor EBL

---

*Versi dokumen: Juli 2026*
