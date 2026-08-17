# Graph Report - .  (2026-08-09)

## Corpus Check
- 63 files · ~159,871 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 622 nodes · 1205 edges · 31 communities (23 shown, 8 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 143 edges (avg confidence: 0.84)
- Token cost: 596,086 input · 0 output

## Community Hubs (Navigation)
- Backend API Layer
- Hazard Report Form Logic
- User Management Admin
- Inspection Form Logic
- Dashboard Analytics
- App Pages & Project Docs
- Report Detail Page
- Notification System
- AI Design Skill Docs
- Auth & Session Management
- SAP Achievement Dashboard
- Desktop Analytics Mockup
- Admin Reports Management
- Home Page
- Report Data Utilities
- NPM Dependencies
- PWA Manifest
- Core Values Graphic
- Shared Layout & Navigation
- Mobile Dashboard Mockup
- Login Page
- Push Notification Setup
- Password Hashing Script
- Vercel Deployment Config
- Service Worker Cache
- Full-Output Enforcement Skill
- EBL Logo
- Hasnur Group Logo
- Inspection Draft Loader
- Inspection Time-Ago Helper
- API Health Check Example

## God Nodes (most connected - your core abstractions)
1. `initializeInspectionForm()` - 22 edges
2. `getSheetData()` - 15 edges
3. `renderDetail()` - 13 edges
4. `Design Taste Frontend Skill v2 (Anti-Slop Frontend Skill, current default)` - 12 edges
5. `Design Tokens System (tokens.css)` - 12 edges
6. `submitForm()` - 11 edges
7. `syncNotificationHistory()` - 11 edges
8. `loadDraft()` - 11 edges
9. `Design Taste Frontend v1 Skill (High-Agency Frontend Skill, legacy)` - 11 edges
10. `Dashboard Analitik SHE (Desktop) - ONE-SAP` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Manajemen User Page (admin.html)` --references--> `initUserManagement()`  [INFERRED]
  admin.html → user-management.js
- `Manajemen User Page (admin.html)` --references--> `openAddUser()`  [INFERRED]
  admin.html → user-management.js
- `Manajemen User Page (admin.html)` --references--> `handleCsvFile()`  [INFERRED]
  admin.html → user-management.js
- `Manajemen User Page (admin.html)` --references--> `submitResetPw()`  [INFERRED]
  admin.html → user-management.js
- `Manajemen User Page (admin.html)` --references--> `exportToExcel()`  [INFERRED]
  admin.html → user-management.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Image-First Generation Workflow Family (web, mobile, and general image-to-code)** — _agents_skills_image_to_code_skill_image_to_code, _agents_skills_imagegen_frontend_web_skill_imagegen_frontend_web, _agents_skills_imagegen_frontend_mobile_skill_imagegen_frontend_mobile [INFERRED 0.85]
- **Anti-AI-Slop Frontend Engineering Skill Family (dial systems, banned patterns, spring-physics motion)** — _agents_skills_design_taste_frontend_v1_skill_design_taste_frontend_v1, _agents_skills_design_taste_frontend_skill_design_taste_frontend, _agents_skills_gpt_taste_skill_gpt_taste, _agents_skills_high_end_visual_design_skill_high_end_visual_design [INFERRED 0.85]
- **Banned AI Design Pattern Cluster (AI Tells: Lila gradients, Inter font, 3-card rows, AI copy clichés)** — _agents_skills_design_taste_frontend_v1_skill_lila_ban, _agents_skills_design_taste_frontend_v1_skill_inter_font_ban, _agents_skills_design_taste_frontend_v1_skill_three_card_row_ban, _agents_skills_design_taste_frontend_v1_skill_ai_copywriting_cliche_ban [INFERRED 0.85]
- **Shared App-Shell Layout (sidebar/topbar/bottom-nav via layout.js)** — admin_page, dashboard_page, capaian_sap_page, eskalasi_page, index_home_page, inspection_page, laporan_admin_page, laporan_detail_page [INFERRED 0.85]
- **dashboard.js Reuse via window.__skipDashboardInit Flag** — dashboard_page, eskalasi_page, laporan_admin_page [EXTRACTED 1.00]
- **Multi-Step Report Form Wizard Pattern (stepper + signature pad + autosave)** — index_page, inspection_form_page, index_multi_step_form_wizard [INFERRED 0.85]

## Communities (31 total, 8 thin omitted)

### Community 0 - "Backend API Layer"
Cohesion: 0.07
Nodes (69): adminResetPassword(), applyUserChange(), assertReportRole(), bcrypt, changePassword(), checkIpRateLimit(), _checkLimit(), checkLoginRateLimit() (+61 more)

### Community 1 - "Hazard Report Form Logic"
Cohesion: 0.06
Nodes (56): OneSapOfflineSync, addFieldError(), autoFillData(), autofillDataPelapor(), autoFillDataPic(), autoFillRisiko(), clearAutoFill(), clearAutoFillPic() (+48 more)

### Community 2 - "User Management Admin"
Cohesion: 0.06
Nodes (61): showSection() — Admin Subnav Tab Switcher, _achComputed, _achFiltered, _achHazardReports, _achInsReports, _achKaryawan, _achPctCell(), _achSameMonth() (+53 more)

### Community 3 - "Inspection Form Logic"
Cohesion: 0.08
Nodes (60): addFieldError(), autoFillData(), autoFillDataPic(), clearAutoFill(), clearAutoFillPic(), clearFieldErrors(), clearInspectionDraft(), compressImage() (+52 more)

### Community 4 - "Dashboard Analytics"
Cohesion: 0.08
Nodes (47): closeDrilldown(), closeReportModal(), compressImage(), escapeCsv(), exportCsv(), filteredReports, formatDate(), getDashboardCategory() (+39 more)

### Community 5 - "App Pages & Project Docs"
Cohesion: 0.09
Nodes (36): Manajemen User Page (admin.html), Field Consistency Audit (AUDIT_FIELD_CONSISTENCY.md), KETIDAKSESUAIAN Column Naming Variation, NO WHATSAPP Column Naming Issue, SUBCONT Column Name Mismatch Issue, Dashboard Laporan Page (dashboard.html), Design Folder Readme (Stitch Mockups Index), Mockup: dashboard-analitik-desktop.png (+28 more)

### Community 6 - "Report Detail Page"
Cohesion: 0.13
Nodes (26): detailAfterPhotos, fillRekomendasiPelapor(), fmt(), getDashboardCategory(), getDashboardDescription(), getDashboardLocation(), getDetailUser(), getImages() (+18 more)

### Community 7 - "Notification System"
Cohesion: 0.20
Nodes (25): buildNotificationItems(), buildNotificationMessage(), closeNotificationMenu(), ensureNotificationsInitialized(), getDashboardReportUrl(), getNotificationUserKey(), initNotificationBell(), isRecentReport() (+17 more)

### Community 8 - "AI Design Skill Docs"
Cohesion: 0.25
Nodes (25): Brandkit Skill (Premium Brand-Kit Image Generation), Design Taste Frontend Skill v2 (Anti-Slop Frontend Skill, current default), GSAP ScrollTrigger Sticky-Stack Pattern (canonical skeleton), AI Copywriting Cliché Ban (Elevate/Seamless/Unleash/Next-Gen), Bento Grid Layout Pattern, Design Taste Frontend v1 Skill (High-Agency Frontend Skill, legacy), Design Variance / Motion Intensity / Visual Density Dial System, Inter Font Ban (premium/creative contexts) (+17 more)

### Community 9 - "Auth & Session Management"
Cohesion: 0.12
Nodes (14): closeChangePasswordModal(), closeUserMenu(), escapeHTML(), getAuthToken(), getCurrentUser(), getUserInitials(), isAdmin(), isTokenExpired() (+6 more)

### Community 10 - "SAP Achievement Dashboard"
Cohesion: 0.19
Nodes (16): _capAggregateBy(), _capComputed, _capFiltered, _capHazardReports, _capInsReports, _capKaryawan, _capPctCell(), _capSameMonth() (+8 more)

### Community 11 - "Desktop Analytics Mockup"
Cohesion: 0.15
Nodes (17): Dashboard Analitik SHE (Desktop) - ONE-SAP, Aging Laporan Open widget (0-7, 8-14, >14 hari buckets), % Closing Tepat Waktu KPI tile (94.2%, target 90%), Hotspot Matriks table (Sub-Kategori x Lokasi x Jumlah), Overdue Reports KPI tile (27, needs immediate action), Pareto Ketidaksesuaian chart (findings by category), Rata-rata Hari Closing KPI tile (4.8 hari, SLA 7 hari), Sidebar navigation (Beranda, Hazard Report, Inspeksi, Dashboard, Profil, Manajemen Laporan, Analitik, Eskalasi) (+9 more)

### Community 12 - "Admin Reports Management"
Cohesion: 0.26
Nodes (16): exportCsv(), getCardPhoto(), getRiskLevel(), initLaporan(), lmFiltered, lmGoPage(), lmRender(), lmReports (+8 more)

### Community 13 - "Home Page"
Cohesion: 0.22
Nodes (13): computeActionItems(), DAYS_ID, fetchMyObj(), initHomePage(), INSPECTION_AREAS, MONTHS_ID, renderActionBanner(), renderGreeting() (+5 more)

### Community 14 - "Report Data Utilities"
Cohesion: 0.22
Nodes (10): fetchAllReports(), fetchHazardReports(), getReportId(), getReportType(), getReportTypeLabel(), getReportValue(), getUserRelation(), getVisibleReports() (+2 more)

### Community 15 - "NPM Dependencies"
Cohesion: 0.17
Nodes (11): bcryptjs, @fortawesome/fontawesome-free, googleapis, jsonwebtoken, dependencies, bcryptjs, @fortawesome/fontawesome-free, googleapis (+3 more)

### Community 16 - "PWA Manifest"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 17 - "Core Values Graphic"
Cohesion: 0.25
Nodes (8): Nilai Inti (Core Value) - Hasnur Group, Bijaksana (Wise), Dapat Dipercaya (Trustworthy), Disiplin (Discipline), Keadilan (Justice/Fairness), Kebersamaan (Togetherness), Kesatuan Sikap (Unity of Attitude), Pantang Menyerah (Never Give Up)

### Community 18 - "Shared Layout & Navigation"
Cohesion: 0.36
Nodes (4): getActivePage(), navItem(), renderMobileNav(), renderSidebar()

### Community 19 - "Mobile Dashboard Mockup"
Cohesion: 0.38
Nodes (7): Dashboard Mobile Screen (ONE-SAP), Bottom Navigation Bar (Beranda, Lapor, Dashboard, Profil), Floating Action Button (Add Report), KPI Summary Cards (Total Laporan, % Closing Tepat Waktu, Rerata Hari Closing), Overdue Critical Alert Card, Pareto Ketidaksesuaian Chart, Time Period Filter Tabs (Bulan Ini / 3 Bulan / 6 Bulan / Calendar)

### Community 20 - "Login Page"
Cohesion: 0.33
Nodes (5): btnLogin, errorMessage, loginForm, passwordInput, passwordToggle

### Community 22 - "Password Hashing Script"
Cohesion: 0.40
Nodes (5): APPLY, bcrypt, colIndexToLetter(), { google }, main()

### Community 23 - "Vercel Deployment Config"
Cohesion: 0.33
Nodes (5): maxDuration, functions, api/index.js, headers, redirects

## Knowledge Gaps
- **101 isolated node(s):** `{ google }`, `https`, `bcrypt`, `jwt`, `webPush` (+96 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Design Tokens System (tokens.css)` connect `App Pages & Project Docs` to `SAP Achievement Dashboard`, `Report Detail Page`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `Manajemen User Page (admin.html)` connect `App Pages & Project Docs` to `User Management Admin`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `OneSapOfflineSync` connect `Hazard Report Form Logic` to `Inspection Form Logic`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `Design Taste Frontend Skill v2 (Anti-Slop Frontend Skill, current default)` (e.g. with `Bento Grid Layout Pattern` and `Design Variance / Motion Intensity / Visual Density Dial System`) actually correct?**
  _`Design Taste Frontend Skill v2 (Anti-Slop Frontend Skill, current default)` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ google }`, `https`, `bcrypt` to the rest of the system?**
  _101 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend API Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.0715372907153729 - nodes in this community are weakly interconnected._
- **Should `Hazard Report Form Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.05750658472344162 - nodes in this community are weakly interconnected._