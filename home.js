const BASE_URL="https://script.google.com/macros/s/AKfycbxyxWUQuFddbDxsqq3TNB_K6SBzdDbAFPgrf0DZr38niuOy0dgkqTkfFUeZevudvS8c/exec";
document.addEventListener("DOMContentLoaded",loadDashboard);
async function loadDashboard(){
 try{
  const response=await fetch(`${BASE_URL}?action=getHazardReports`);
  const result=await response.json();
  if(result.status!=="success") throw new Error(result.message||"Gagal memuat data");
  const data=result.data||[];
  document.getElementById("kpiTotal").textContent=data.length;
  document.getElementById("kpiOpen").textContent=data.filter(r=>(r.status_perbaikan||"OPEN")==="OPEN").length;
  document.getElementById("kpiProgress").textContent=data.filter(r=>r.status_perbaikan==="PROGRESS").length;
  document.getElementById("kpiClosed").textContent=data.filter(r=>r.status_perbaikan==="CLOSED").length;
  const list=document.getElementById("highRiskList");
  if(!list) return;
  const highRisk=data.filter(r=>{
    const risk=(r.tingkat_risiko||r.tingkat_resiko||"").toUpperCase();
    return risk.includes("HIGH")||risk.includes("EXTREME");
  }).slice(0,5);
  list.innerHTML=highRisk.length
    ? highRisk.map(r=>`<li><strong>${r.id||"-"}</strong> - ${r.deskripsi_bahaya||"-"} (${r.nama_pic||"-"})</li>`).join("")
    : "<li>Tidak ada hazard High/Extreme.</li>";
 }catch(error){
  console.error(error);
  document.getElementById("highRiskList").innerHTML="<li>Gagal memuat data.</li>";
 }
}
