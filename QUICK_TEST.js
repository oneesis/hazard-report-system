// SIMPLE TEST - Run this in browser console to check if master data loaded
console.log("=== QUICK MASTER DATA CHECK ===\n");

console.log("Is masterKaryawan defined?", typeof masterKaryawan !== 'undefined');
console.log("Is masterKaryawan an array?", Array.isArray(masterKaryawan));
console.log("masterKaryawan length:", masterKaryawan?.length || 'NOT DEFINED');

console.log("\nIs masterLokasi defined?", typeof masterLokasi !== 'undefined');
console.log("masterLokasi length:", masterLokasi?.length || 'NOT DEFINED');

console.log("\nIs masterTemuan defined?", typeof masterTemuan !== 'undefined');
console.log("masterTemuan length:", masterTemuan?.length || 'NOT DEFINED');

// If not loaded, try loading manually
if (!masterKaryawan || masterKaryawan.length === 0) {
  console.log("\n⚠️ Master data not loaded! Attempting manual load...");
  
  const BASE_URL = "https://script.google.com/macros/s/AKfycbyw_rFrWax6FBdlc0FYeJAvl511YT5MCXToXf-RYsFhds-gapAr0w8vkXNKc2zZ9h5X/exec";
  
  async function loadMaster() {
    try {
      const resp = await fetch(`${BASE_URL}?action=masterKaryawan`);
      const data = await resp.json();
      console.log("✓ Fetched", data.length, "employee records");
      console.log("First record:", data[0]);
      return data;
    } catch (e) {
      console.error("✗ Failed to load:", e);
    }
  }
  
  loadMaster();
}
