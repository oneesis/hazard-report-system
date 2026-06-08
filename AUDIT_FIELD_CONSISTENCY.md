# Field Consistency Audit

## Summary
This document maps all form field IDs, backend field names, and HTML elements to identify mismatches.

## 1. SCRIPT.JS - Hazard Report Form

### getFormData() fields collected:
```
perusahaan, subcont1, nama, nik, jabatan, departemen, no_whatsapp (PELAPOR)
tanggal_kejadian, shift_kejadian, lokasi_bahaya, detail_lokasi_bahaya (DETAIL KEJADIAN)
jenis_bahaya, ketidaksesuaian_bahaya, sub_ketidaksesuaian, deskripsi_bahaya, tingkat_risiko, upload_foto_bahaya (IDENTIFIKASI BAHAYA)
tindakan_langsung, tindakan_usulan_pic (TINDAKAN PERBAIKAN)
perusahaan_pic, subcont2, nama_pic, jabatan_pic, departemen_pic, no_whatsapp_pic, batas_waktu (DATA PIC)
pernyataan, tanda_tangan (VERIFIKASI/TANDA TANGAN)
```

### Backend field names expected (submitHazardReport):
- Exact same names in lowercase_underscore format ✓

### Master Data Column Names (from getSheetData):
**masterKaryawan columns accessed:**
- "PERUSAHAAN"
- "SUBCONT" (CRITICAL: NOT "SUBCONT1" or "SUBCONT2")
- "NAMA"
- "NIK"
- "JABATAN"
- "DEPARTEMEN"
- "NO WHATSAPP" (with space)

**masterTemuan columns accessed:**
- "KETIDAKSESUAIAN" OR "KETIDAKSESUAIAN BAHAYA" (fallback)
- "SUB KETIDAKSESUAIAN" (with space)
- "RESIKO" OR "TINGKAT RESIKO" (with space) - fallback

**masterLokasi columns:**
- Uses first column (generic approach) - no specific column name

---

## 2. INSPECTION-FORM.JS - Inspection Form

### getFormData() fields:
```
inspection_code, jenis_inspeksi (TYPE)
perusahaan, subcont1, nama, nik, jabatan, departemen, no_whatsapp (PELAPOR)
tanggal_inspeksi, shift_inspeksi, lokasi_inspeksi, detail_lokasi_inspeksi (DETAIL)
temuan_inspeksi, upload_foto_inspeksi (FINDINGS)
tindakan_usulan_pic (ACTION)
perusahaan_pic, subcont2, nama_pic, jabatan_pic, departemen_pic, no_whatsapp_pic, nik_pic, batas_waktu (PIC)
pernyataan, tanda_tangan (SIGNATURE)
```

### Backend field names expected (submitInspectionReport):
- Inspection sheets: INS_CB, INS_JA, INS_MD, INS_KG, INS_SP, INS_T, INS_TB, INS_WS
- Same field structure with inspection_ prefix instead of bahaya/kejadian

### Master Data Access:
- Same as script.js (masterKaryawan, masterTemuan)

---

## 3. POTENTIAL ISSUES IDENTIFIED

### 🔴 CRITICAL: SUBCONT Column Name
**Issue:** Code references item["SUBCONT"] but sends to backend as "subcont1"/"subcont2"

**Master Data:**
- masterKaryawan.map(item => item["SUBCONT"]) - expects column "SUBCONT"

**Form Output:**
- getFormData() returns `subcont1: document.getElementById("subcont1").value`

**Fallback in loadMasterKaryawan:**
```javascript
'SUBCONT': user.subcont || ''
```

**Action Required:**
- Check Google Sheet Master_Karyawan: Is column named "SUBCONT" or "SUBCONT1" or "PERUSAHAAN SUBCONT(1)"?
- If named differently, autocomplete will fail
- Frontend code currently expects "SUBCONT" exactly

### 🔴 CRITICAL: NO WHATSAPP Column
**Issue:** Column accessed as "NO WHATSAPP" (with space) but possible typos exist

**Access Pattern:**
- `item["NO WHATSAPP"]` - with space

**Fallback:**
- `'NO WHATSAPP': user.no_whatsapp || ''`

**Action Required:**
- Verify Google Sheet column is exactly "NO WHATSAPP" (not "NO WHATTSAPP" or similar)

### 🟠 MODERATE: KETIDAKSESUAIAN Column Variations
**Issue:** Code tries fallback between multiple column names

**Patterns:**
- `item["KETIDAKSESUAIAN"]` OR `item["KETIDAKSESUAIAN BAHAYA"]`
- `selected["RESIKO"]` OR `selected["TINGKAT RESIKO"]`

**Risk:** If column naming inconsistent, lookups will fail

### 🟡 MINOR: masterLokasi Generic Access
**Issue:** Code uses `Object.keys(item)[0]` to get first column

**Risk:** If multiple columns, unpredictable behavior
**Recommendation:** Clarify expected column structure

---

## 4. Required Google Sheet Verification

### Master_Karyawan columns (must be exactly these):
- [ ] "NIK" - exact case and spelling
- [ ] "NAMA" - exact case and spelling
- [ ] "PERUSAHAAN" - exact case and spelling
- [ ] "SUBCONT" - exact case (verify if "SUBCONT", "SUBCONT1", or "PERUSAHAAN SUBCONT(1)")
- [ ] "JABATAN" - exact case and spelling
- [ ] "DEPARTEMEN" - exact case and spelling
- [ ] "NO WHATSAPP" - exact spacing and spelling (not "NO WHATTSAPP")

### Master_Lokasi columns (verify structure):
- [ ] First column name (will be used by form)
- [ ] Whether it contains actual lokasi values or something else

### Master_Temuan columns (for inspection types):
- [ ] "KETIDAKSESUAIAN" (or "KETIDAKSESUAIAN BAHAYA")
- [ ] "SUB KETIDAKSESUAIAN"
- [ ] "RESIKO" (or "TINGKAT RESIKO")

### Hazard_Report sheet columns (in exact order from submitHazardReport):
```
ID, TIMESTAMP, PERUSAHAAN, SUBCONT1, NAMA, NIK, JABATAN, DEPARTEMEN, 
NO_WHATSAPP, TANGGAL_KEJADIAN, SHIFT_KEJADIAN, LOKASI_BAHAYA, 
DETAIL_LOKASI_BAHAYA, JENIS_BAHAYA, KETIDAKSESUAIAN_BAHAYA, 
SUB_KETIDAKSESUAIAN, DESKRIPSI_BAHAYA, TINGKAT_RISIKO, UPLOAD_FOTO_BAHAYA,
TINDAKAN_LANGSUNG, TINDAKAN_USULAN_PIC, PERUSAHAAN_PIC, SUBCONT2, 
DEPARTEMEN_PIC, JABATAN_PIC, NAMA_PIC, NO_WHATSAPP_PIC, BATAS_WAKTU,
(empty), STATUS_PERBAIKAN, PERNYATAAN, TANDA_TANGAN
```

---

## 5. API Response Field Names

### getAllReports() returns (normalized):
- All headers passed through normalizeHeader()
- Result: lowercase_underscore format
- Example: "NAMA" → "nama", "NO WHATSAPP" → "no_whatsapp"

### Field names dashboard.js expects:
- report.id, report.nama, report.nama_pic
- report.status_perbaikan, report.timestamp
- report.inspection_sheet (for inspection types)

---

## Next Steps

1. **Verify Master_Karyawan sheet** column names exactly
2. **Check for typos** in column naming (especially "SUBCONT" vs variations)
3. **Verify "NO WHATSAPP"** exact spelling/spacing
4. **Test API endpoint** for masterKaryawan to see actual column names returned
5. **Check HTML form field IDs** all match JavaScript selectors
6. **Run browser console tests** to verify data flow
