# ONE-SAP — Prompt UI/UX untuk Google Stitch (VERSI WEB/DESKTOP)

Panduan pakai:
1. Di Stitch, pilih mode **Web** (bukan Mobile) sebelum generate.
2. Hasilkan semua layar dalam satu project/sesi agar konsisten.
3. Setiap prompt = satu layar. Selalu awali dengan **Web Style Anchor**;
   untuk layar admin tambahkan **Admin Anchor**.
4. Supaya versi web dan mobile terasa satu keluarga, jangan ubah kode warna
   dan font — hanya layout yang beradaptasi.

---

## WEB STYLE ANCHOR (tempel di awal SETIAP prompt)

```
Design a desktop web app screen (1440px wide) for "ONE-SAP", a hazard
reporting and safety inspection system for a coal mining company in
Indonesia. Style: clean, industrial-professional, high contrast. Primary
brand palette: primary Ocean blue (#003087) for headers and key elements,
accent Sun yellow (#F2A900) for primary buttons and highlights (with
Midnight text on yellow), Midnight navy (#00205B) for dark surfaces, Sky
blue (#307FE2) for links, secondary accents and info states, Sand (#FFE264)
for subtle highlight backgrounds, white (#FFFFFF) background. Status colors
keep safety semantics: green for closed, Sun yellow (#F2A900) for open, red
for overdue. Font: Inter or similar geometric sans. Rounded 12px
cards with subtle shadows, generous whitespace. Persistent left sidebar
(collapsible, Midnight navy #00205B background with Sun yellow active-item indicator) with ONE-SAP logo at top and menu
items with icons: Beranda, Hazard Report, Inspeksi, Dashboard, Profil.
Top bar with page title, search, notification bell, and user avatar menu.
Indonesian language labels.
```

## ADMIN ANCHOR (tambahan setelah Web Style Anchor, khusus layar A1–A4)

```
This is the ADMIN area: the sidebar shows an additional "Admin" section
with menu items Manajemen Laporan, Analitik, Eskalasi. Show an "ADMIN"
badge next to the user avatar. Denser data layout is acceptable.
```

---

# BAGIAN 1 — LAYAR USER (WEB)

## Layar W1 — Login

```
[WEB STYLE ANCHOR]

Screen: Login page, split layout. Left half: panel with Sky-to-Ocean-to-Black vertical gradient with large
ONE-SAP logo, tagline "Sistem Pelaporan Hazard & Inspeksi PT EBL", subtle
diagonal safety-stripe pattern at low opacity, and three small feature
bullets with icons (Lapor Bahaya, Inspeksi Digital, Notifikasi WhatsApp).
Right half: centered login card on off-white background containing NIK
input with badge icon, password field with show/hide toggle, full-width
Sun yellow "Masuk" button with Midnight text, and small footer text with company name. No sidebar
on this screen.
```

## Layar W2 — Beranda / Pemilihan Jenis Laporan

```
[WEB STYLE ANCHOR]

Screen: Home page after login. Top of content area: greeting header
"Halo, [Nama]" with today's date and a small offline/sync status chip.
Below: one wide hero card "Hazard Report" spanning full content width,
with warning triangle icon, description "Laporkan potensi bahaya di area
kerja", and a Sun yellow "Buat Laporan" button with Midnight text on the right side of the card.
Below it, section titled "Inspeksi" with a 4-column grid of 8 tappable
cards, each with an icon and label: Conveyor Belt, Jalan Angkut, Mess dan
Dapur, Kantor dan Gudang, Settling Pond, Tambang, Tangki BBM, Workshop.
Right side of the page: a slim panel "Laporan Terakhir Saya" listing 3
recent reports with status pills.
```

## Layar W3 — Form Multi-Langkah

```
[WEB STYLE ANCHOR]

Screen: Multi-step hazard report form, step 3 of 6. Layout: vertical
stepper on the left side of the content area showing 6 steps with labels
(Data Pelapor, Lokasi, Jenis Bahaya, Tindakan, Data PIC, Pernyataan) —
completed steps with green checkmarks, current step highlighted Sun yellow.
Main form card on the right (max 720px wide) titled "Jenis Bahaya"
containing: two dropdowns side by side ("Jenis Bahaya" and
"Ketidaksesuaian"), full-width textarea "Deskripsi Bahaya", a risk level
selector with 3 pill options (Rendah green, Sedang Sun yellow, Tinggi red),
and a photo upload area showing 2 uploaded photo thumbnails plus a dashed
"Tambah Foto" tile with camera icon. Bottom of card: outlined "Kembali"
button left, solid Sun yellow "Lanjut" button right. Small autosave indicator
text "Draft tersimpan otomatis" near the buttons.
```

## Layar W4 — Dashboard User

```
[WEB STYLE ANCHOR]

Screen: Reports dashboard. Top row: 4 KPI cards in a single row — Total
(Ocean blue), Open (Sun yellow), Closed (green), Overdue (red with alert icon).
Second row: two chart cards side by side — bar chart "Tren Laporan per
Bulan" (6 months) and donut chart "Status Laporan". Below: toolbar with
filter chips (Semua, Hazard, Inspeksi, Overdue), search bar, and an
Sun yellow "Buat Laporan" button aligned right. Then a data table with
columns: ID, Jenis, Lokasi, PIC, Batas Waktu, Status pill (OPEN Sun yellow /
CLOSED green / OVERDUE red). One row shows overdue state with subtle red
background tint and red left border. Pagination at bottom.
```

---

# BAGIAN 2 — LAYAR ADMIN (WEB)

## Layar WA1 — Dashboard Admin (Analitik)

```
[WEB STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Admin analytics dashboard showing ALL reports across the company.
Top toolbar: date range selector chips (Bulan Ini, 3 Bulan, 6 Bulan,
Custom) on the left, "Export" outlined button with download icon on the
right. Row of 5 KPI cards: Total Laporan, Open, Closed, Overdue (red),
Rata-rata Hari Closing. Second row: two large chart cards side by side —
stacked bar chart "Tren Laporan per Bulan" (6 months, hazard vs inspeksi)
and donut chart "Status Laporan" with center total number. Third row:
horizontal bar chart card "Bahaya per Lokasi" (top 5 locations, highest
bar Sun yellow) next to a "Leaderboard Pelapor" card with top 5 reporters,
each row showing rank number, avatar initials, name, department, and
report count badge. Fourth row: full-width heatmap-style card "Laporan
per Departemen per Bulan".
```

## Layar WA2 — Manajemen Laporan (Tabel Penuh)

```
[WEB STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Admin report management. Top toolbar: search bar, four filter
dropdowns (Jenis, Status, Departemen, Lokasi), a red chip counter
"12 Overdue" acting as quick filter, and a bulk action button "Kirim
Reminder Massal" that appears when rows are selected. Full-width data
table with checkbox column and columns: ID, Jenis, Pelapor, Lokasi, PIC,
Batas Waktu, Status pill. Overdue rows have subtle red background tint
and red left border. Each row has a kebab menu (3 dots) with actions:
Lihat Detail, Kirim Reminder WA, Ubah PIC. Sortable column headers with
arrows. Pagination bottom right showing "1-20 dari 148 laporan", rows
per page selector bottom left.
```

## Layar WA3 — Detail Laporan + Verifikasi Closing

```
[WEB STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Report detail page, two-column layout. Header: breadcrumb
"Manajemen Laporan / HR-20260705...", report ID badge, status pill
OVERDUE in red with days-late counter "Terlambat 3 hari", and a "Kirim
Reminder" button with WhatsApp icon. Left column (60%): card "Detail
Bahaya" with location, hazard type, risk level pill Tinggi in red,
description text, and a 3-photo gallery with lightbox hint; below it
card "Closing" with photo upload area for repair evidence, textarea
"Catatan Closing", outlined "Simpan Draft" and solid green "Tandai
CLOSED" buttons. Right column (40%): card "Data Pelapor" with avatar,
name, department, WhatsApp number; card "PIC" with avatar and contact;
vertical timeline card showing: Dibuat → Notifikasi WA Terkirim →
Reminder → (pending) Closed, each with timestamp.
```

## Layar WA4 — Monitoring Eskalasi Overdue

```
[WEB STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Overdue escalation monitor. Top: summary strip with 3 large
numbers in cards — Mendekati Batas (Sun yellow), Overdue (red), Sudah
Dieskalasi (Ocean blue). Below: two-column kanban-style layout — left column
"Mendekati Batas Waktu" and right column "Overdue", each containing
escalation cards showing: report ID, PIC name with avatar, days
remaining/overdue in bold, department, WhatsApp delivery status icons
(sent/delivered) with timestamps for each reminder, and an "Eskalasi ke
Atasan" button on overdue cards. Top right: toggle "Otomatis kirim
reminder harian" with time selector showing 07:00 WITA. Empty state for
each column: checkmark shield illustration with text "Semua laporan
terkendali".
```


## Layar WA5 — Dashboard Analitik SHE

```
[WEB STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: SHE analytics dashboard for hazard reports. Top row: 4 KPI cards —
"Total Laporan" (Ocean blue), "% Closing Tepat Waktu" shown as large
percentage with small trend arrow (green), "Rata-rata Hari Closing", and
"Overdue" (red, with alert icon, visually tappable as a filter). Second
row, two chart cards side by side: left card "Pareto Ketidaksesuaian" —
vertical bar chart sorted descending with an overlaid cumulative
percentage line in Sun yellow, bars in Ocean blue, a small hint text
"Klik bar untuk lihat detail sub"; right card "Tren Tingkat Risiko" —
stacked bar chart of 6 months with green (Rendah), Sun yellow (Sedang),
red (Tinggi) segments and a compact legend. Third row, three cards:
"Top 5 Lokasi Bahaya" horizontal bar chart with highest bar in Sun
yellow; "Aging Laporan Open" showing three bucket tiles (0-7 hari green,
8-14 hari Sun yellow, >14 hari red) each with a large count; "Hotspot
Sub-Ketidaksesuaian × Lokasi" — a compact 5-row table with columns Sub,
Lokasi, Jumlah (count as a small Ocean blue badge). Date range chips at
top (Bulan Ini, 3 Bulan, 6 Bulan, Custom) and an export button.
```

## Layar WA6 — Dashboard Analitik: State Drill-down Pareto

```
[WEB STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Same SHE analytics dashboard, but the Pareto chart card is in
drill-down state. The "Pareto Ketidaksesuaian" card is expanded: the
clicked bar "APD" is highlighted in Sun yellow while other bars are
dimmed Ocean blue at low opacity. Below the main chart, inside the same
card, a breakdown panel titled "Sub Ketidaksesuaian: APD" slides in,
showing a horizontal bar chart of 5-6 sub items (e.g. "Tidak memakai
kacamata safety", "Tidak memakai sarung tangan", "Helm tidak dikancing")
with counts, and a small "× Tutup" close button top right of the panel.
A subtle breadcrumb inside the card: "Semua Ketidaksesuaian / APD". The
rest of the dashboard remains visible but slightly de-emphasized.
```

---

## Catatan

- Gunakan project Stitch yang sama dengan versi mobile kalau ingin Stitch
  menjaga benang merah visual antar keduanya; kalau project terpisah,
  anchor warna/font di atas yang menjaga konsistensinya.
- Layar WA2 dan WA4 memuat fitur yang belum ada (reminder massal, toggle
  cron otomatis, tracking eskalasi) — disiapkan untuk fitur cron eskalasi
  yang akan dibangun berikutnya.
- Aplikasi ONE-SAP saat ini responsive dari satu codebase, jadi desain web
  ini bukan berarti bikin app terpisah — anggap ini target tampilan
  breakpoint desktop (≥1024px), sementara desain mobile jadi target
  breakpoint kecil. Struktur section yang sama di kedua versi memudahkan
  implementasi CSS-nya.
