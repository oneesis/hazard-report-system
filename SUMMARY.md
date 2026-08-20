# Hazard Report ONE-SAP — Summary

Aplikasi pelaporan hazard dan inspeksi berbasis web (PWA) untuk PT EBL, dibangun sebagai static site dengan serverless backend di Vercel.

---

## Stack Teknologi

| Lapisan | Teknologi |
|---|---|
| Frontend | HTML, CSS, Vanilla JS (tanpa framework) |
| Backend | Vercel Serverless Functions (Node.js) |
| Database | Google Sheets (via Google Sheets API v4) |
| Penyimpanan Foto | Google Drive (via Drive API v3) |
| Auth | Service Account (Google) |
| Notifikasi | Fonnte (WhatsApp API) |
| PWA | Service Worker + IndexedDB (offline sync) |

---

## Fitur Utama

### Hazard Report
- Form 6 langkah: data pelapor → lokasi → jenis bahaya → tindakan → data PIC → pernyataan
- Upload foto bahaya (multiple)
- Tanda tangan digital
- Auto-populate Section 1 dari data karyawan
- Skeleton loading saat data API dimuat

### Inspeksi (8 Jenis)
| Kode | Nama |
|---|---|
| INS_CB | Inspeksi Conveyor Belt |
| INS_JA | Inspeksi Jalan Angkut |
| INS_MD | Inspeksi Mess dan Dapur |
| INS_KG | Inspeksi Kantor dan Gudang |
| INS_SP | Inspeksi Settling Pond |
| INS_T | Inspeksi Tambang |
| INS_TB | Inspeksi Tangki BBM |
| INS_WS | Inspeksi Workshop |

- Checklist dinamis per jenis inspeksi
- Form 5 langkah dengan struktur serupa hazard report
- Skeleton loading Section 1

### Dashboard
- KPI Cards: Total, Open, Closed, Overdue
- Tabel laporan dengan filter, search, dan paginasi
- Badge overdue otomatis (merah) jika batas waktu terlewat
- Tren laporan per bulan (Chart.js — 6 bulan terakhir)
- Status chart (Pie)
- Role-based: ADMIN lihat semua, USER hanya laporan milik sendiri / sebagai PIC
- Closing note dengan upload foto perbaikan

### Notifikasi WhatsApp (Fonnte)
- Otomatis terkirim ke PIC saat laporan baru dibuat
- Berisi: ID laporan, jenis, lokasi, dan batas waktu
- Berlaku untuk hazard report dan semua jenis inspeksi

### PWA & Offline
- Installable di HP dan laptop (Add to Home Screen)
- Offline sync via IndexedDB — laporan tersimpan lokal jika tidak ada koneksi, otomatis terkirim saat online

---

## Struktur File

```
/
├── index.html              # Landing / login redirect
├── login.html              # Halaman login
├── dashboard.html          # Dashboard laporan
├── inspection-form.html    # Form inspeksi (semua jenis)
├── script.js               # Logic hazard report form
├── inspection-form.js      # Logic inspeksi form
├── dashboard.js            # Logic dashboard
├── auth.js                 # Auth helper
├── style.css               # Global styles
├── dashboard.css           # Dashboard styles
├── api/
│   └── index.js            # Semua endpoint serverless (GET + POST)
├── vercel.json             # Konfigurasi Vercel
└── package.json
```

---

## Environment Variables (Vercel)

| Key | Keterangan |
|---|---|
| `SPREADSHEET_ID` | ID Google Spreadsheet |
| `FOLDER_HAZARD_ID` | ID folder Drive untuk foto hazard |
| `FOLDER_CLOSING_ID` | ID folder Drive untuk foto closing |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON key Service Account Google |
| `FONNTE_TOKEN` | Token device Fonnte untuk WA notifikasi |
| `SISTER_MINER_SPREADSHEET_ID` | ID spreadsheet SISTER MINER — cross-read status cuti karyawan (2026-08-20). Service account harus punya akses baca. Kosong = fitur cuti tidak aktif (semua dianggap "aktif"). |
| `SIMANTRA_SPREADSHEET_ID` | ID spreadsheet SIMANTRA K3 — cross-read bridge `akun_karyawan` & training `TR_REINDUKSI` buat gate Reinduksi Pasca Cuti (2026-08-20). Opsional; tanpa ini fallback bridge nrp+nama tetap jalan tapi status pasca-cuti selalu "wajib_reinduksi" sampai var ini diisi. |

---

## API Endpoints

Base URL: `https://sap-ebl.vercel.app/api`

### GET
| Action | Keterangan |
|---|---|
| `login` | Autentikasi user via NIK + password |
| `getMasterKaryawan` | Data karyawan untuk auto-populate |
| `getMasterLokasi` | Data lokasi |
| `getMasterTemuan` | Data temuan/checklist |
| `getAllReports` | Semua laporan (hazard + inspeksi) |

### POST
| Action | Keterangan |
|---|---|
| `submitHazardReport` | Simpan laporan hazard + kirim WA ke PIC |
| `submitInspectionReport` | Simpan laporan inspeksi + kirim WA ke PIC |
| `updateHazardReport` | Update closing hazard report |
| `updateInspectionReport` | Update closing inspeksi |

---

## Deployment

- **Platform**: Vercel (GitHub integration — auto-deploy on push to `main`)
- **URL Produksi**: https://sap-ebl.vercel.app
- **Repo**: https://github.com/oneesis/hazard-report-system
