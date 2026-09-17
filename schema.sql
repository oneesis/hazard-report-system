-- ============================================================================
-- ONE-SAP (sap-ebl) — Skema PostgreSQL (Neon)
-- ----------------------------------------------------------------------------
-- Migrasi dari Google Sheets. FOTO tetap di Google Drive; kolom foto di sini
-- hanya menyimpan URL Drive-nya (tipe TEXT).
--
-- Konvensi: snake_case, timestamptz utk waktu, date utk tanggal kalender,
-- boolean utk ya/tidak, jsonb utk data fleksibel (checklist).
--
-- Cara pakai di Neon: buka SQL Editor → tempel seluruh file ini → Run.
-- ============================================================================

-- ── Master karyawan (roster) ────────────────────────────────────────────────
-- Dibagi pakai bersama quiz-she (lihat schema quiz-she: role read-only).
CREATE TABLE karyawan (
  nik                TEXT PRIMARY KEY,
  nama               TEXT NOT NULL,
  perusahaan         TEXT,
  subcont            TEXT,
  jabatan            TEXT,
  departemen         TEXT,
  no_whatsapp        TEXT,
  password_hash      TEXT,                 -- bcrypt (kolom PASSWORD lama)
  role               TEXT NOT NULL DEFAULT 'USER',   -- USER/ADMIN/SUPER_ADMIN/DELETED
  email              TEXT,
  email_verified_at  TIMESTAMPTZ,
  obj_hr             INT  NOT NULL DEFAULT 0,
  obj_ins            INT  NOT NULL DEFAULT 0,
  obj_sbo            INT  NOT NULL DEFAULT 0,
  obj_pc             INT  NOT NULL DEFAULT 0,
  obj_st             INT  NOT NULL DEFAULT 0,
  login_locked_until BIGINT,               -- epoch ms (kolom LOGIN_LOCKED_UNTIL)
  last_logout_at     BIGINT,               -- epoch ms (invalidasi token)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_karyawan_email ON karyawan (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX ix_karyawan_perusahaan ON karyawan (perusahaan);
CREATE INDEX ix_karyawan_departemen ON karyawan (departemen);

-- ── Hazard report ───────────────────────────────────────────────────────────
CREATE TABLE hazard_report (
  id                    TEXT PRIMARY KEY,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- pelapor
  perusahaan            TEXT,
  subcont1              TEXT,
  nama                  TEXT,
  nik                   TEXT,
  jabatan               TEXT,
  departemen            TEXT,
  no_whatsapp           TEXT,
  -- kejadian
  tanggal_kejadian      DATE,
  shift_kejadian        TEXT,
  lokasi_bahaya         TEXT,
  detail_lokasi_bahaya  TEXT,
  jenis_bahaya          TEXT,
  ketidaksesuaian_bahaya TEXT,
  sub_ketidaksesuaian   TEXT,
  deskripsi_bahaya      TEXT,
  tingkat_risiko        TEXT,               -- RENDAH/SEDANG/TINGGI/EKSTRIM
  foto_bahaya           TEXT,               -- URL Google Drive
  -- tindakan & PIC
  tindakan_langsung     TEXT,
  tindakan_usulan_pic   TEXT,
  perusahaan_pic        TEXT,
  subcont2              TEXT,
  departemen_pic        TEXT,
  jabatan_pic           TEXT,
  nama_pic              TEXT,
  no_whatsapp_pic       TEXT,
  nik_pic               TEXT,
  batas_waktu           DATE,
  -- workflow
  timestamp_close       TIMESTAMPTZ,
  status_perbaikan      TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN/PROGRESS/CLOSED
  pernyataan            TEXT,
  tanda_tangan          TEXT,               -- URL/data tanda tangan
  wa_pic_status         TEXT
);
CREATE INDEX ix_hazard_nik      ON hazard_report (nik);
CREATE INDEX ix_hazard_nik_pic  ON hazard_report (nik_pic);
CREATE INDEX ix_hazard_status   ON hazard_report (status_perbaikan);
CREATE INDEX ix_hazard_tanggal  ON hazard_report (tanggal_kejadian);

-- ── Inspeksi (konsolidasi semua jenis: dulu per-sheet INS_*) ────────────────
-- Field per-jenis yang bervariasi disimpan di checklist (jsonb) + temuan teks.
CREATE TABLE inspection_report (
  id                    TEXT PRIMARY KEY,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  jenis                 TEXT,               -- inspection_sheet: INS_CB, INS_JA, ...
  perusahaan            TEXT,
  subcont1              TEXT,
  nama                  TEXT,
  nik                   TEXT,
  jabatan               TEXT,
  departemen            TEXT,
  no_whatsapp           TEXT,
  tanggal_inspeksi      DATE,
  lokasi_inspeksi       TEXT,
  detail_lokasi_inspeksi TEXT,
  temuan_inspeksi       TEXT,               -- ringkasan item abnormal (teks)
  inspection_checklist  JSONB,              -- [{index,item,status,notes}]
  foto_inspeksi         TEXT,               -- URL Google Drive
  -- PIC & workflow (sama pola dengan hazard)
  perusahaan_pic        TEXT,
  subcont2              TEXT,
  departemen_pic        TEXT,
  jabatan_pic           TEXT,
  nama_pic              TEXT,
  no_whatsapp_pic       TEXT,
  nik_pic               TEXT,
  batas_waktu           DATE,
  timestamp_close       TIMESTAMPTZ,
  status_perbaikan      TEXT NOT NULL DEFAULT 'OPEN',
  upload_foto_perbaikan_pic TEXT,           -- URL Drive
  wa_pic_status         TEXT
);
CREATE INDEX ix_ins_nik     ON inspection_report (nik);
CREATE INDEX ix_ins_jenis   ON inspection_report (jenis);
CREATE INDEX ix_ins_status  ON inspection_report (status_perbaikan);
CREATE INDEX ix_ins_tanggal ON inspection_report (tanggal_inspeksi);

-- ── SBO (Safe Behavior Observation) ─────────────────────────────────────────
CREATE TABLE sbo_report (
  id                    TEXT PRIMARY KEY,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  tgl_observasi         DATE,
  nama_pekerjaan        TEXT,
  lokasi                TEXT,
  -- observer
  nama_observer         TEXT,
  nik_observer          TEXT,
  jabatan_observer      TEXT,
  departemen_observer   TEXT,
  perusahaan_observer   TEXT,
  -- observee
  nama_observee         TEXT,
  perusahaan_observee   TEXT,
  subcont_observee      TEXT,
  jabatan_observee      TEXT,
  departemen_observee   TEXT,
  -- kategori observasi
  tindakan_segera       TEXT,
  potensi_bahaya        TEXT,
  apd                   TEXT,
  alat_peralatan        TEXT,
  prosedur              TEXT,
  kebersihan            TEXT,
  status_observasi      TEXT,               -- AMAN / ADA_TEMUAN
  jenis_temuan          TEXT,
  kategori_temuan       TEXT,
  deskripsi_temuan      TEXT,
  foto_temuan           TEXT,               -- URL Google Drive
  rencana_tindakan      TEXT,
  referensi_sop         TEXT,
  -- PIC & workflow
  nama_pic              TEXT,
  nik_pic               TEXT,
  perusahaan_pic        TEXT,
  subcont_pic           TEXT,
  departemen_pic        TEXT,
  jabatan_pic           TEXT,
  no_wa_pic             TEXT,
  batas_waktu           DATE,
  upload_foto_perbaikan_pic TEXT,           -- URL Drive
  status_perbaikan      TEXT NOT NULL DEFAULT 'OPEN',
  pernyataan            TEXT,
  wa_pic_status         TEXT
);
CREATE INDEX ix_sbo_observer ON sbo_report (nik_observer);
CREATE INDEX ix_sbo_status   ON sbo_report (status_perbaikan);
CREATE INDEX ix_sbo_tanggal  ON sbo_report (tgl_observasi);

-- ── Personal Contact / Coaching ─────────────────────────────────────────────
CREATE TABLE pc_report (
  id                    TEXT PRIMARY KEY,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  tgl_pc                DATE,
  lokasi_pc             TEXT,
  -- coach
  nama_coach            TEXT,
  nik_coach             TEXT,
  jabatan_coach         TEXT,
  departemen_coach      TEXT,
  perusahaan_coach      TEXT,
  -- coachee
  nama_coachee          TEXT,
  nik_coachee           TEXT,
  jabatan_coachee       TEXT,
  departemen_coachee    TEXT,
  perusahaan_coachee    TEXT,
  subcont_coachee       TEXT,
  no_wa_coachee         TEXT,
  -- isi coaching
  topik_coaching        TEXT,
  judul_coaching        TEXT,
  deskripsi_coaching    TEXT,
  komitmen_perbaikan    TEXT,
  batas_waktu_pc        DATE,
  foto_pc               TEXT,               -- URL Google Drive
  status                TEXT NOT NULL DEFAULT 'OPEN',
  foto_komitmen         TEXT,               -- URL Drive
  pesan_komitmen        TEXT,
  timestamp_close       TIMESTAMPTZ,
  wa_pic_status         TEXT
);
CREATE INDEX ix_pc_coach   ON pc_report (nik_coach);
CREATE INDEX ix_pc_coachee ON pc_report (nik_coachee);
CREATE INDEX ix_pc_tanggal ON pc_report (tgl_pc);

-- ── Safety Talk: jadwal ─────────────────────────────────────────────────────
CREATE TABLE safety_talk_schedule (
  id                 TEXT PRIMARY KEY,      -- "ST-1789..." (= kode topik di quiz-she)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  tanggal            DATE,
  bulan              TEXT,                  -- 'YYYY-MM'
  judul_materi       TEXT NOT NULL,
  deskripsi_materi   TEXT,
  nama_pemateri      TEXT,
  nik_pemateri       TEXT,
  jabatan_pemateri   TEXT,
  perusahaan_target  TEXT,                  -- kosong = semua perusahaan
  status             TEXT NOT NULL DEFAULT 'AKTIF',  -- AKTIF/SELESAI
  created_by         TEXT
);
CREATE INDEX ix_st_sched_bulan  ON safety_talk_schedule (bulan);
CREATE INDEX ix_st_sched_status ON safety_talk_schedule (status);

-- ── Safety Talk: absensi ────────────────────────────────────────────────────
CREATE TABLE safety_talk_absensi (
  schedule_id        TEXT NOT NULL REFERENCES safety_talk_schedule(id) ON DELETE CASCADE,
  nik                TEXT NOT NULL,
  bulan              TEXT,                  -- 'YYYY-MM' (denormal utk query capaian cepat)
  nama               TEXT,
  perusahaan         TEXT,
  departemen         TEXT,
  jabatan            TEXT,
  status_kehadiran   TEXT NOT NULL DEFAULT 'HADIR',  -- HADIR/CUTI/DINAS_LUAR/SHIFT_MALAM/LIBUR/SECURITY_JAGA/MANGKIR
  quiz_done          BOOLEAN NOT NULL DEFAULT FALSE,
  checked_by         TEXT,
  checked_at         TIMESTAMPTZ,
  PRIMARY KEY (schedule_id, nik)            -- satu baris per (jadwal, orang)
);
CREATE INDEX ix_st_abs_nik   ON safety_talk_absensi (nik);
CREATE INDEX ix_st_abs_bulan ON safety_talk_absensi (bulan);

-- ── Email OTP (verifikasi email) ────────────────────────────────────────────
CREATE TABLE email_otp (
  nik          TEXT PRIMARY KEY,            -- satu OTP aktif per NIK
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,               -- bcrypt
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Usulan perubahan user (approval flow admin) ─────────────────────────────
CREATE TABLE pending_change (
  id                 TEXT PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  action             TEXT NOT NULL,         -- ADD/EDIT/DELETE
  proposed_by_nik    TEXT,
  proposed_by_nama   TEXT,
  perusahaan         TEXT,
  target_nik         TEXT,
  data               JSONB,                 -- payload perubahan
  status             TEXT NOT NULL DEFAULT 'PENDING',
  reviewed_by        TEXT,
  reviewed_at        TIMESTAMPTZ,
  rejection_reason   TEXT
);
CREATE INDEX ix_pending_status ON pending_change (status);

-- ── Web push subscription ───────────────────────────────────────────────────
CREATE TABLE push_subscription (
  nik         TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT,
  auth        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint)
);
CREATE INDEX ix_push_nik ON push_subscription (nik);

-- ── (OPSIONAL) Foreign key laporan → karyawan ──────────────────────────────
-- Jalankan SETELAH data diimpor & NIK dibersihkan. Dikomentari karena roster
-- bisa punya baris yang tak cocok; aktifkan bila data sudah rapi.
-- ALTER TABLE hazard_report     ADD CONSTRAINT fk_hazard_nik     FOREIGN KEY (nik) REFERENCES karyawan(nik) ON DELETE SET NULL;
-- ALTER TABLE inspection_report ADD CONSTRAINT fk_ins_nik        FOREIGN KEY (nik) REFERENCES karyawan(nik) ON DELETE SET NULL;
-- ALTER TABLE sbo_report        ADD CONSTRAINT fk_sbo_observer   FOREIGN KEY (nik_observer) REFERENCES karyawan(nik) ON DELETE SET NULL;
-- ALTER TABLE pc_report         ADD CONSTRAINT fk_pc_coach       FOREIGN KEY (nik_coach)    REFERENCES karyawan(nik) ON DELETE SET NULL;
-- ALTER TABLE safety_talk_absensi ADD CONSTRAINT fk_abs_nik      FOREIGN KEY (nik) REFERENCES karyawan(nik) ON DELETE CASCADE;
