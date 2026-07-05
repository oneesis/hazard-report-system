# Auth Hardening — ONE-SAP

## Apa yang berubah

**Masalah yang ditutup:**
1. `?action=masterKaryawan` sebelumnya mengembalikan seluruh sheet karyawan **termasuk kolom PASSWORD** tanpa autentikasi — sekarang wajib token dan kolom PASSWORD tidak pernah dikirim ke client.
2. Login via GET query string (password nyangkut di log) — sekarang via POST body.
3. Password plaintext di sheet — sekarang bcrypt hash.
4. Semua endpoint terbuka tanpa autentikasi — sekarang wajib JWT (berlaku 12 jam).
5. `getAllReports` percaya parameter `role` dari client (bisa dipalsukan jadi ADMIN) — sekarang role diambil dari token yang ditandatangani server.

**File yang berubah:** `api/index.js`, `auth.js`, `login.js`, `package.json`
**File baru:** `scripts/hash-passwords.js`
**Tidak berubah:** `dashboard.js`, `script.js`, `inspection-form.js`, `offline-sync.js` — fetch interceptor di `auth.js` otomatis menambahkan header Authorization ke semua request `/api`.

## Urutan deploy (PENTING — jangan dibalik)

### 1. Tambah environment variable di Vercel
Buka Vercel → Project Settings → Environment Variables, tambahkan:

```
JWT_SECRET = <string acak panjang>
```

Generate string acak di terminal:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 2. Deploy kode baru
```bash
git add api/index.js auth.js login.js package.json scripts/
git commit -m "feat: auth hardening (JWT + bcrypt + endpoint protection)"
git push
```

Kode baru mendukung **dua mode**: password yang masih plaintext tetap bisa login (fallback), yang sudah di-hash pakai bcrypt. Jadi tidak ada user yang terkunci saat transisi.

### 3. Jalankan migrasi hash password (di laptop, satu kali)
```bash
export SPREADSHEET_ID="<id spreadsheet>"
export GOOGLE_SERVICE_ACCOUNT_JSON='<isi json service account>'

# Dry-run dulu — hanya menampilkan rencana, tidak menulis apa pun
node scripts/hash-passwords.js

# Kalau hasilnya masuk akal, eksekusi:
node scripts/hash-passwords.js --apply
```

⚠️ Setelah `--apply`, password asli **tidak bisa dikembalikan** dari hash. Kalau perlu arsip password awal untuk keperluan reset manual, simpan salinannya di tempat aman SEBELUM menjalankan script.

### 4. Verifikasi
- Buka `https://sap-ebl.vercel.app/api?action=masterKaryawan` di browser tanpa login → harus dapat error 401 "Tidak terautentikasi".
- Login normal di aplikasi → harus berhasil dan dashboard jalan seperti biasa.
- Cek sheet Master_Karyawan → kolom PASSWORD berisi hash `$2b$10$...`.

### 5. Informasikan ke user
Semua user harus **login ulang satu kali** (sesi lama tidak punya token). Password mereka tetap sama.

## Catatan perilaku baru
- Sesi berlaku 12 jam; setelah itu otomatis diarahkan ke halaman login. Durasi bisa diubah di `TOKEN_TTL` (api/index.js).
- Pesan error login sekarang generik ("NIK atau password salah") — sengaja, agar tidak membocorkan NIK mana yang terdaftar.
- Respons 401 dari API di halaman mana pun otomatis logout (ditangani interceptor di auth.js).

## Batasan yang perlu diketahui
- Token disimpan di localStorage. Untuk aplikasi internal ini itu trade-off yang wajar, tapi artinya XSS tetap bisa mencuri token — jaga agar semua render data pakai `escapeHTML()` yang sudah ada.
- Offline sync: laporan yang tersimpan di IndexedDB saat offline akan dikirim dengan token saat online. Kalau token sudah kedaluwarsa saat itu, pengiriman gagal 401 dan user harus login ulang lalu submit ulang — cek logic retry di offline-sync.js kalau mau ditangani lebih halus.
