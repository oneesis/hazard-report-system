# ONE-SAP — Prompt UI/UX untuk Google Stitch

Panduan pakai:
1. Buat satu project di Stitch, hasilkan semua layar dalam sesi yang sama agar konsisten.
2. Setiap prompt = satu layar. Selalu awali dengan **Style Anchor**; untuk layar admin tambahkan juga **Admin Anchor**.
3. Kalau hasil kurang pas, beri instruksi perbaikan spesifik ("make the KPI cards smaller") daripada regenerate dari nol.
4. Urutan yang disarankan: Login → Home → Form → Dashboard → A1 → A2 → A3 → A4.

---

## STYLE ANCHOR (tempel di awal SETIAP prompt)

```
Design a mobile-first PWA screen for "ONE-SAP", a hazard reporting and safety
inspection app used by coal mining field workers in Indonesia. Style: clean,
industrial-professional, high contrast for outdoor sunlight readability.
Brand palette: primary Ocean blue (#003087) for headers and key elements,
accent Sun yellow (#F2A900) for primary buttons and highlights (with Midnight
text on yellow), Midnight navy (#00205B) for dark surfaces, Sky blue
(#307FE2) for links, secondary accents and info states, Sand (#FFE264) for
subtle highlight backgrounds, white (#FFFFFF) background. Status colors keep
safety semantics: green for closed, Sun yellow (#F2A900) for open, red for
overdue. Font: Inter or similar geometric sans. Large touch
targets (min 48px), generous spacing, rounded 12px cards with subtle shadows.
Bottom navigation bar with 4 items: Home, Report, Dashboard, Profile.
Indonesian language labels.
```

## ADMIN ANCHOR (tambahan setelah Style Anchor, khusus layar A1–A4)

```
This is the ADMIN area: denser information layout is acceptable, add a thin
Midnight navy (#00205B) top bar with "ADMIN" badge next to the ONE-SAP logo.
```

---

# BAGIAN 1 — LAYAR USER

## Layar 1 — Login

```
[STYLE ANCHOR]

Screen: Login page. Centered layout with app logo "ONE-SAP" and tagline
"Sistem Pelaporan Hazard & Inspeksi PT EBL" at top. Card containing: NIK
input field with badge icon, password field with show/hide toggle, large
full-width Sun yellow "Masuk" button with Midnight text. Below the card: small "Instal Aplikasi"
secondary button with download icon. Footer text with company name.
Background uses the Sky-to-Ocean-to-Black vertical gradient with a subtle
diagonal stripe pattern at very low opacity.
```

## Layar 2 — Home / Pemilihan Jenis Laporan

```
[STYLE ANCHOR]

Screen: Home page after login. Header with greeting "Halo, [Nama]" and user
avatar with initials. One large hero card "Hazard Report" with warning
triangle icon and short description "Laporkan potensi bahaya di area kerja".
Below it, a section titled "Inspeksi" with a 2-column grid of 8 tappable
cards, each with an icon and label: Conveyor Belt, Jalan Angkut, Mess dan
Dapur, Kantor dan Gudang, Settling Pond, Tambang, Tangki BBM, Workshop.
Small offline indicator chip at top right showing sync status.
```

## Layar 3 — Form Multi-Langkah

```
[STYLE ANCHOR]

Screen: Multi-step hazard report form, currently on step 3 of 6. Top:
stepper/progress indicator showing 6 steps with labels (Data Pelapor,
Lokasi, Jenis Bahaya, Tindakan, Data PIC, Pernyataan), current step
highlighted Sun yellow, completed steps with checkmarks. Form section titled
"Jenis Bahaya" containing: dropdown "Jenis Bahaya", dropdown
"Ketidaksesuaian", textarea "Deskripsi Bahaya", a risk level selector with
3 pill options (Rendah green, Sedang Sun yellow, Tinggi red), and a photo upload
area showing 2 uploaded photo thumbnails plus a dashed "Tambah Foto" tile
with camera icon. Bottom: two buttons side by side, outlined "Kembali" and
solid Sun yellow "Lanjut".
```

## Layar 4 — Dashboard User

```
[STYLE ANCHOR]

Screen: Reports dashboard. Top row: 4 compact KPI cards in a 2x2 grid —
Total (Ocean blue), Open (Sun yellow), Closed (green), Overdue (red with alert icon).
Below: horizontal filter chips (Semua, Hazard, Inspeksi, Overdue) and a
search bar. Then a scrollable list of report cards, each showing: report ID
badge, hazard type title, location with pin icon, PIC name with avatar, due
date, and a status pill (OPEN Sun yellow / CLOSED green / OVERDUE red). One card
shows overdue state with red left border. Floating Sun yellow action button
bottom right with plus icon for new report.
```

---

# BAGIAN 2 — LAYAR ADMIN

## Layar A1 — Dashboard Admin (Analitik)

```
[STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Admin analytics dashboard showing ALL reports across the company.
Top: date range selector chip (Bulan Ini, 3 Bulan, 6 Bulan, Custom) and
export icon button. Row of 5 KPI cards: Total Laporan, Open, Closed,
Overdue (red), and Rata-rata Hari Closing. Below: two side-by-side chart
cards — left a bar chart "Tren Laporan per Bulan" (6 months, hazard vs
inspeksi stacked), right a donut chart "Status Laporan". Below that:
horizontal bar chart card "Bahaya per Lokasi" showing top 5 locations
ranked, highest bar in Sun yellow. Bottom section: "Leaderboard Pelapor" card
with top 5 reporters, each row showing rank number, avatar initials, name,
department, and report count badge.
```

## Layar A2 — Manajemen Laporan (Tabel Penuh)

```
[STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Admin report management table view. Top: search bar, filter
dropdowns (Jenis, Status, Departemen, Lokasi), and a red chip counter
"12 Overdue" that acts as a quick filter. Dense table/list with columns:
ID, Jenis, Pelapor, Lokasi, PIC, Batas Waktu, Status pill. Overdue rows
have subtle red background tint and red left border. Each row has a
kebab menu (3 dots) revealing actions: Lihat Detail, Kirim Reminder WA,
Ubah PIC. Pagination at bottom showing "1-20 dari 148 laporan". On mobile
the table collapses into stacked cards.
```

## Layar A3 — Detail Laporan + Verifikasi Closing

```
[STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Report detail page for admin review. Header: report ID badge
"HR-20260705..." with status pill OVERDUE in red and days-late counter
"Terlambat 3 hari". Sections as cards: (1) Data Pelapor with avatar, name,
department; (2) Detail Bahaya with location, hazard type, risk level pill
Tinggi in red, description text, and a 3-photo gallery of hazard photos;
(3) Tindakan & PIC showing assigned PIC with WhatsApp icon button "Kirim
Reminder"; (4) Closing section: photo upload area for repair evidence,
textarea "Catatan Closing", and two buttons — outlined "Simpan Draft" and
solid green "Tandai CLOSED". Timeline strip at bottom showing: Dibuat →
Notifikasi WA Terkirim → Reminder → (pending) Closed.
```

## Layar A4 — Monitoring Eskalasi Overdue

```
[STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: Overdue escalation monitor. Top: summary strip with 3 numbers —
Mendekati Batas (Sun yellow), Overdue (red), Sudah Dieskalasi (Ocean blue). List of
escalation cards grouped by urgency, each showing: report ID, PIC name and
avatar, days overdue in bold red, department, and WhatsApp delivery status
icons (sent/delivered) for each reminder with timestamps. Each card has
"Eskalasi ke Atasan" button. Empty state illustration for when nothing is
overdue showing a checkmark shield with text "Semua laporan terkendali".
```


## Layar A5 — Dashboard Analitik SHE (Mobile)

```
[STYLE ANCHOR]
[ADMIN ANCHOR]

Screen: SHE analytics dashboard, mobile. KPI cards in 2x2 grid: Total
Laporan, % Closing Tepat Waktu (with trend arrow), Rata-rata Hari
Closing, Overdue (red). Below, vertically stacked full-width chart
cards in this order: "Pareto Ketidaksesuaian" bar chart with cumulative
line in Sun yellow and hint "Ketuk bar untuk detail sub"; "Tren Tingkat
Risiko" stacked bar 6 months (green/Sun yellow/red); "Aging Laporan
Open" as three horizontal bucket tiles; "Top 5 Lokasi" horizontal bars;
"Hotspot Sub × Lokasi" compact list with count badges. Sticky date
range chips below the header (Bulan Ini, 3 Bulan, 6 Bulan). Charts
sized for one-hand scrolling, minimum 16px labels.
```

---

## Catatan

- Layar A2 dan A4 memuat fitur yang belum ada di aplikasi (reminder manual,
  ubah PIC, tracking eskalasi) — sengaja disiapkan untuk fitur cron eskalasi
  yang akan dibangun, agar UI tidak perlu dirombak ulang nanti.
- Setelah desain jadi, Stitch bisa export ke Figma atau kode HTML/CSS.
  Versi kodenya biasanya perlu dirapikan, tapi struktur layout dan token
  warna (Ocean #003087, Sun #F2A900, Midnight #00205B, Sky #307FE2, Sand #FFE264) bisa langsung diadopsi ke style.css
  dan dashboard.css.
