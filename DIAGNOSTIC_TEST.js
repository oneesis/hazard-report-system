// DIAGNOSTIC TEST SCRIPT
// Run this in browser console (F12 > Console) on index.html or inspection-form.html
// ⚠️ IMPORTANT: Wait 2-3 seconds for page to load master data BEFORE pasting this script!
// to diagnose data consistency issues

console.log("=== HAZARD REPORT SYSTEM DIAGNOSTICS ===\n");
console.log("ℹ️  If tests show 'not defined yet', the page is still loading. Wait a few seconds and try again.\n");

// Test 1: Check current user
console.log("TEST 1: Current User");
try {
  const user = getCurrentUser();
  console.log("✓ User logged in:", user);
} catch (e) {
  console.error("✗ Error getting user:", e.message);
}

// Test 2: Check masterKaryawan structure
console.log("\nTEST 2: masterKaryawan Structure");
try {
  if (typeof masterKaryawan === 'undefined') {
    console.warn("✗ masterKaryawan is not defined yet - still loading...");
  } else {
    console.log("Total records:", masterKaryawan.length);
    if (masterKaryawan.length > 0) {
      console.log("First record keys:", Object.keys(masterKaryawan[0]));
      console.log("First record:", masterKaryawan[0]);
      
      // Check for SUBCONT column variations
      const first = masterKaryawan[0];
      console.log("\n--- CRITICAL: SUBCONT Column Check ---");
      console.log("Has item['SUBCONT']?", 'SUBCONT' in first);
      console.log("Has item['SUBCONT1']?", 'SUBCONT1' in first);
      console.log("Has item['PERUSAHAAN SUBCONT(1)']?", 'PERUSAHAAN SUBCONT(1)' in first);
      console.log("Actual value of item['SUBCONT']:", first["SUBCONT"]);
      
      // Check for NO WHATSAPP spelling
      console.log("\n--- NO WHATSAPP Spelling Check ---");
      console.log("Has item['NO WHATSAPP']?", 'NO WHATSAPP' in first);
      console.log("Has item['NO WHATTSAPP']?", 'NO WHATTSAPP' in first);
      console.log("Actual keys with 'WHATS':", Object.keys(first).filter(k => k.includes('WHATS')));
    } else {
      console.warn("✗ masterKaryawan is empty!");
    }
  }
} catch (e) {
  console.error("✗ Error:", e.message);
}

// Test 3: Check masterLokasi
console.log("\nTEST 3: masterLokasi Structure");
try {
  if (typeof masterLokasi === 'undefined') {
    console.warn("✗ masterLokasi is not defined yet - still loading...");
  } else {
    console.log("Total records:", masterLokasi.length);
    if (masterLokasi.length > 0) {
      console.log("First record:", masterLokasi[0]);
      console.log("First record keys:", Object.keys(masterLokasi[0]));
      const key = Object.keys(masterLokasi[0])[0];
      console.log("First column name:", key);
      console.log("First column value:", masterLokasi[0][key]);
    } else {
      console.warn("✗ masterLokasi is empty!");
    }
  }
} catch (e) {
  console.error("✗ Error:", e.message);
}

// Test 4: Check masterTemuan
console.log("\nTEST 4: masterTemuan Structure");
try {
  if (typeof masterTemuan === 'undefined') {
    console.warn("✗ masterTemuan is not defined yet - still loading...");
  } else {
    console.log("Total records:", masterTemuan.length);
    if (masterTemuan.length > 0) {
      console.log("First record keys:", Object.keys(masterTemuan[0]));
      console.log("First record:", masterTemuan[0]);
      
      const first = masterTemuan[0];
      console.log("\n--- Ketidaksesuaian Column Check ---");
      console.log("Has item['KETIDAKSESUAIAN']?", 'KETIDAKSESUAIAN' in first);
      console.log("Has item['KETIDAKSESUAIAN BAHAYA']?", 'KETIDAKSESUAIAN BAHAYA' in first);
      console.log("Has item['SUB KETIDAKSESUAIAN']?", 'SUB KETIDAKSESUAIAN' in first);
    } else {
      console.warn("✗ masterTemuan is empty!");
    }
  }
} catch (e) {
  console.error("✗ Error:", e.message);
}

// Test 5: Test autofill logic
console.log("\nTEST 5: Autofill Matching Logic");
try {
  const user = getCurrentUser();
  if (!user) {
    console.warn("✗ No user logged in");
  } else {
    console.log("Looking for user NIK:", user.nik);
    
    if (typeof masterKaryawan === 'undefined' || masterKaryawan.length === 0) {
      console.warn("✗ masterKaryawan not loaded yet - cannot test autofill");
    } else {
      const found = masterKaryawan.find(item => {
        const itemNik = String(item["NIK"] || "").trim();
        const itemNama = String(item["NAMA"] || "").trim();
        const userNik = String(user.nik || "").trim();
        const userNama = String(user.nama || "").trim();
        
        return (userNik && itemNik.toUpperCase() === userNik.toUpperCase()) ||
               (userNama && itemNama.toUpperCase() === userNama.toUpperCase());
      });
      
      if (found) {
        console.log("✓ User found in masterKaryawan:", found);
      } else {
        console.warn("✗ User NOT found in masterKaryawan");
        console.log("Available NIKs:", masterKaryawan.map(i => i["NIK"]));
        console.log("Available NAMAs:", masterKaryawan.map(i => i["NAMA"]));
      }
    }
  }
} catch (e) {
  console.error("✗ Error:", e.message);
}

// Test 6: Test API endpoints
console.log("\nTEST 6: API Endpoints Health");

async function testAPI() {
  try {
    console.log("Testing masterKaryawan endpoint...");
    const resp1 = await fetch(`${BASE_URL}?action=masterKaryawan`);
    const data1 = await resp1.json();
    console.log("masterKaryawan response:", data1.length, "records");
    if (data1.length > 0) {
      console.log("First record keys:", Object.keys(data1[0]));
    }
  } catch (e) {
    console.error("✗ masterKaryawan error:", e.message);
  }
  
  try {
    console.log("\nTesting getAllReports endpoint...");
    const resp2 = await fetch(`${BASE_URL}?action=getAllReports`);
    const data2 = await resp2.json();
    console.log("getAllReports response status:", data2.status);
    console.log("getAllReports response records:", data2.data.length);
    if (data2.data.length > 0) {
      console.log("First report keys:", Object.keys(data2.data[0]));
      console.log("First report sample:", {
        id: data2.data[0].id,
        nama: data2.data[0].nama,
        status: data2.data[0].status_perbaikan
      });
    }
  } catch (e) {
    console.error("✗ getAllReports error:", e.message);
  }
}

testAPI();

console.log("\n=== END DIAGNOSTICS ===");
console.log("Check the output above for ✓ (pass) or ✗ (fail) indicators.");
console.log("CRITICAL ISSUES:");
console.log("1. If masterKaryawan shows empty - API fetch failed");
console.log("2. If SUBCONT column doesn't exist - autofill will fail");
console.log("3. If NO WHATSAPP has typo - field won't populate");
