# REDESIGN SPEC — ONE-SAP UI/UX

Spesifikasi implementasi redesain UI berdasarkan desain Stitch (3 mockup terlampir:
`dashboard-drilldown-desktop.png`, `dashboard-mobile.png`, `dashboard-analitik-desktop.png`).
Dokumen ini adalah SATU-SATUNYA sumber kebenaran untuk pekerjaan redesain.
Jika mockup dan spec ini bertentangan, SPEC INI YANG MENANG.

---

## 0. BATASAN KERAS — BACA SEBELUM MENYENTUH APA PUN

JANGAN PERNAH:
1. Mengubah, memindahkan, atau me-refactor file di `api/` — backend TIDAK termasuk scope.
2. Menyentuh `auth.js` bagian token/interceptor, `service-worker.js`, `offline-sync.js`,
   atau logika submit form. Ini kode keamanan/reliabilitas yang baru diaudit.
3. Mengubah atau menghapus `id` dan `class` yang direferensikan JavaScript.
   SEBELUM mengedit file HTML apa pun, jalankan dan simpan hasilnya:
   ```
   grep -ohE "getElementById\(['\"][^'\"]+|querySelector(All)?\(['\"][^'\"]+" *.js | sort -u
   ```
   Semua id/selector dalam daftar itu WAJIB tetap ada di HTML hasil redesain.
4. Menambahkan framework, build step, atau library baru. Stack tetap:
   HTML + CSS + vanilla JS + Chart.js (sudah ada).
5. Mengubah arsitektur multi-page menjadi SPA.
6. Menyalin HTML hasil export Stitch secara mentah. Mockup adalah acuan VISUAL;
   struktur HTML existing dipertahankan dan di-restyle.
7. Mengubah teks/istilah fungsional yang sudah dipakai user (nama menu, label form).
8. Hardcode label kategori chart (mis. "Unsafe Act", "PPE Issues" di mockup adalah
   placeholder Stitch). Semua label chart berasal dari data API.

KOREKSI TERHADAP MOCKUP (Stitch berhalusinasi, jangan diikuti):
- Tagline "PRECISION LOGISTICS" → JANGAN dipakai. Gunakan: "PT Energi Batubara Lestari".
- Kartu "Safety Score" (mockup desktop 1) → TIDAK ADA metrik ini. KPI yang benar:
  Total Laporan, % Closing Tepat Waktu, Rata-rata Hari Closing, Overdue.
- Donut "Tindak Lanjut 68% Completion" (mockup desktop 1) → SKIP, tidak diimplementasikan.
- Foto profil manusia (mockup 3) → gunakan avatar inisial (sudah ada polanya di app).

---

## 1. DESIGN TOKENS — buat file baru `tokens.css`

Buat `tokens.css` di root, muat sebagai stylesheet PERTAMA di semua halaman HTML
(sebelum file CSS lain). Semua file CSS lain secara bertahap wajib memakai var ini —
tidak boleh ada hex hardcoded baru.

```css
:root {
  /* Brand — palet resmi */
  --color-primary:        #003087;  /* Ocean — header, elemen utama, bar chart */
  --color-primary-dark:   #00205B;  /* Midnight — sidebar, top bar, permukaan gelap */
  --color-accent:         #F2A900;  /* Sun — tombol utama, highlight, garis kumulatif */
  --color-accent-soft:    #FFE264;  /* Sand — background highlight halus */
  --color-info:           #307FE2;  /* Sky — link, aksen sekunder */

  /* Teks di atas warna */
  --color-on-primary:     #FFFFFF;
  --color-on-accent:      #00205B;  /* teks Midnight di atas tombol Sun */

  /* Status — semantik K3, JANGAN diganti warna brand */
  --color-status-open:    #F2A900;
  --color-status-closed:  #16A34A;
  --color-status-overdue: #DC2626;
  --color-risk-low:       #16A34A;
  --color-risk-mid:       #F2A900;
  --color-risk-high:      #DC2626;

  /* Netral */
  --color-bg:             #F5F7FB;
  --color-surface:        #FFFFFF;
  --color-border:         #E2E8F0;
  --color-text:           #1E293B;
  --color-text-muted:     #64748B;

  /* Bentuk & ruang */
  --radius-card:          12px;
  --radius-control:       8px;
  --shadow-card:          0 1px 3px rgba(0, 32, 91, 0.08);
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-5: 24px; --space-6: 32px;

  /* Tipografi */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

  /* Touch target minimum */
  --tap-min: 48px;
}
```

Breakpoint standar (WAJIB — gantikan breakpoint campur aduk yang ada):
- Mobile: default (< 768px)
- Tablet: `@media (min-width: 768px)`
- Desktop: `@media (min-width: 1024px)`
Saat me-restyle sebuah file CSS, konsolidasikan media query lamanya
(640/700/760/900/992/1100/1200) ke tiga titik ini.

Update juga `manifest.json`: `"theme_color": "#003087"`, `"background_color": "#00205B"`.

---

## 2. PEMETAAN MOCKUP → FILE

| Mockup | Halaman | File yang boleh disentuh |
|---|---|---|
| dashboard-analitik-desktop.png | Dashboard analitik admin | `dashboard.html`, `dashboard.css`, `dashboard.js` (hanya bagian render/chart) |
| dashboard-drilldown-desktop.png | State drill-down Pareto (halaman sama) | idem |
| dashboard-mobile.png | Dashboard versi mobile (halaman sama, responsive) | idem |

Elemen layout global (sidebar Midnight, top bar) → `layout.js` + `layout.css`.
Sidebar desktop: background `--color-primary-dark`, item aktif dengan indikator kiri
`--color-accent` (lihat mockup). Mobile: bottom nav 4 item (Beranda, Lapor, Dashboard,
Profil) + top bar tipis dengan badge ADMIN untuk role ADMIN.

---

## 3. SPESIFIKASI DASHBOARD ANALITIK

### 3.1 Baris KPI (4 kartu)
1. **Total Laporan** — kartu solid `--color-primary`, teks putih, tampilkan delta
   "+X% vs periode sebelumnya" jika dapat dihitung.
2. **% Closing Tepat Waktu** — angka besar; hijau jika ≥ 90, Sun jika 70–89,
   merah jika < 70. Definisi: dari laporan CLOSED dalam rentang waktu terpilih,
   persentase dengan TANGGAL CLOSING ≤ BATAS WAKTU.
3. **Rata-rata Hari Closing** — rata-rata (TANGGAL CLOSING − TIMESTAMP) dalam hari,
   1 desimal, hanya laporan CLOSED dalam rentang.
4. **Overdue** — kartu outline merah, count laporan open yang melewati BATAS WAKTU.
   Klik kartu → filter tabel laporan existing ke overdue (pakai mekanisme filter
   yang sudah ada di dashboard.js, jangan bikin baru).

### 3.2 Pareto Ketidaksesuaian (Chart.js, tipe bar + line)
- Bar: count per `KETIDAKSESUAIAN BAHAYA`, urut menurun, warna `--color-primary`.
- Line (axis kanan, 0–100%): kumulatif %, warna `--color-accent`, tebal 2–3px.
- PENTING: bar harus terlihat jelas (mockup Stitch me-render bar terlalu pudar —
  itu artefak, jangan ditiru).
- Hint kecil di bawah chart: "Klik bar untuk lihat detail sub".

### 3.3 Drill-down Sub Ketidaksesuaian
- Chart.js `onClick` pada bar → tampilkan panel DI DALAM kartu yang sama
  (bukan halaman/modal baru), berisi:
  - Breadcrumb: "Semua Ketidaksesuaian / {kategori}"
  - Horizontal bar `SUB KETIDAKSESUAIAN` untuk kategori terpilih, urut menurun,
    max 8 item, dengan count dan persentase terhadap total kategori.
  - Tombol "× Tutup" kanan atas panel.
- Saat drill-down aktif: bar terpilih tetap `--color-accent`, bar lain
  `--color-primary` opacity 0.35 (lihat mockup drill-down).

### 3.4 Tren Tingkat Risiko (Chart.js, stacked bar, 6 bulan)
- Sumbu X: 6 bulan terakhir dari TIMESTAMP. Stack per TINGKAT RESIKO:
  `--color-risk-low` / `--color-risk-mid` / `--color-risk-high`.
- Legend ringkas di kanan atas kartu (Rendah / Sedang / Tinggi).

### 3.5 Top 5 Lokasi Bahaya
- Horizontal bar dari `LOKASI BAHAYA`, top 5, bar #1 warna `--color-accent`,
  sisanya `--color-primary`. Boleh HTML/CSS murni (div bar) seperti mockup,
  tidak wajib Chart.js.

### 3.6 Aging Laporan Open
- Tiga tile bucket dari umur laporan OPEN (hari ini − TIMESTAMP):
  0–7 hari (hijau, label "Dalam SLA"), 8–14 hari (Sun, "Mendekati Deadline"),
  >14 hari (merah, "Critical / Eskalasi"). Angka besar per tile.

### 3.7 Hotspot Matriks
- Tabel 5 baris: kombinasi `SUB KETIDAKSESUAIAN` × `LOKASI BAHAYA` dengan count
  tertinggi. Kolom: Sub-Kategori, Lokasi, Jumlah (badge `--color-primary`).

### 3.8 Filter rentang waktu
- Chips: Bulan Ini / 3 Bulan / 6 Bulan (Custom boleh di-skip dulu). Chip aktif
  solid `--color-primary-dark` teks putih; semua chart & KPI mengikuti rentang.

### 3.9 Sumber data & role
- SEMUA agregasi dihitung client-side dari respons `getAllReports` yang sudah ada.
  Jangan buat endpoint baru, jangan ubah `api/`.
- Halaman analitik penuh hanya dirender untuk role ADMIN (cek `getCurrentUser().role`
  — pola pengecekan role sudah ada di dashboard.js, ikuti pola itu).
- HATI-HATI PARSING TANGGAL: format TIMESTAMP / BATAS WAKTU / TANGGAL CLOSING di
  sheet harus diverifikasi terhadap data asli SEBELUM menulis fungsi hitung.
  Buat satu fungsi `parseSheetDate(value)` terpusat, beri komentar TODO untuk
  dikonfirmasi dengan data sample. Jangan asumsikan `new Date(string)` benar.
- Semua render teks dari data WAJIB lewat `escapeHTML()` yang sudah ada.

### 3.10 Responsive (mockup mobile)
- < 768px: KPI jadi grid 2×2, semua kartu chart full-width stacked
  (urutan: Pareto → Tren Risiko → Aging → Top Lokasi → Hotspot),
  chips rentang waktu sticky di bawah header, FAB "+" kanan bawah
  (pakai FAB existing jika sudah ada).

---

## 4. URUTAN PENGERJAAN (satu fase = satu commit)

1. **Fase 0**: `tokens.css` + muat di semua HTML + update `manifest.json`. Commit.
2. **Fase 1**: Restyle `layout.js`/`layout.css` (sidebar + top bar + bottom nav)
   sesuai token. Verifikasi semua halaman masih berfungsi. Commit.
3. **Fase 2**: Baris KPI + filter rentang waktu di dashboard. Commit.
4. **Fase 3**: Pareto + drill-down. Commit.
5. **Fase 4**: Tren Risiko + Aging + Top Lokasi + Hotspot. Commit.
6. **Fase 5**: Responsive pass (mockup mobile) + konsolidasi breakpoint. Commit.

Checklist verifikasi TIAP fase sebelum commit:
- [ ] Login → dashboard → buka form hazard → kembali: tidak ada error console.
- [ ] Semua id/selector dari grep di Batasan #3 masih ada di HTML.
- [ ] Tampilan dicek di lebar 375px dan 1280px.
- [ ] Tidak ada perubahan pada `api/`, `auth.js`, `service-worker.js`, `offline-sync.js`
    (`git diff --stat` untuk memastikan).

Kerjakan di branch `redesign-ui`. JANGAN push ke `main` (auto-deploy produksi).

---

## 5. DEFINISI SELESAI

Redesain dianggap selesai jika: semua fase ter-commit di `redesign-ui`,
checklist tiap fase lolos, tampilan sesuai mockup dengan koreksi di Bagian 0,
dan preview deployment Vercel dari branch bisa dibuka serta login berfungsi normal.
