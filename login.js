const BASE_URL = "/api";
const SIKAP_URL = "https://sikap.oneesis.my.id";

const loginForm = document.getElementById("loginForm");
const passwordToggle = document.getElementById("passwordToggle");
const passwordInput = document.getElementById("password");
const errorMessage = document.getElementById("errorMessage");
const btnLogin = document.getElementById("btnLogin");

if (passwordToggle && passwordInput) {
  const showIcon = '<i class="fa-solid fa-eye"></i>';
  const hideIcon = '<i class="fa-solid fa-eye-slash"></i>';

  passwordToggle.addEventListener("click", function () {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    passwordToggle.innerHTML = isPassword ? hideIcon : showIcon;
    passwordToggle.setAttribute("aria-label", isPassword ? "Sembunyikan password" : "Tampilkan password");
  });
}

// Lupa Password — kirim link "Ganti Password" ke email karyawan. Pakai NIK yang
// sudah diketik di kolom atas. Kalau belum daftar email, server balas no_email
// dan user diarahkan menghubungi SHE PT EBL.
const forgotLink = document.querySelector(".forgot-link");
if (forgotLink) {
  forgotLink.addEventListener("click", async function (e) {
    e.preventDefault();
    const nik = document.getElementById("nik").value.trim().replace(/\s+/g, "");
    errorMessage.style.color = "";
    errorMessage.textContent = "";
    if (!nik) {
      errorMessage.style.color = "#b45309";
      errorMessage.textContent = "Isi NIK dulu di kolom di atas, lalu klik Lupa Password lagi.";
      document.getElementById("nik").focus();
      return;
    }
    const orig = forgotLink.textContent;
    forgotLink.textContent = "Mengirim...";
    forgotLink.style.pointerEvents = "none";
    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "requestPasswordReset", data: { nik } }),
      });
      const result = await res.json();
      errorMessage.style.color =
        result.status === "success" ? "#15803d" : result.status === "no_email" ? "#b45309" : "#dc2626";
      errorMessage.textContent = result.message || "Terjadi kesalahan.";
    } catch {
      errorMessage.style.color = "#dc2626";
      errorMessage.textContent = "Gagal menghubungi server. Coba lagi.";
    } finally {
      forgotLink.textContent = orig;
      forgotLink.style.pointerEvents = "";
    }
  });
}

if (loginForm) {
  let _submitting = false; // guard double-submit (iOS autofill + tap tombol)

  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (_submitting) return;
    _submitting = true;

    // Buang spasi saja (jangan buang huruf) — NIK bisa alfanumerik spt "ebl01".
    // Dulu strip semua non-digit → NIK ber-huruf gagal login (ebl01 → 01).
    const rawNik = document.getElementById("nik").value.trim();
    const nik = rawNik.replace(/\s+/g, '');
    const password = passwordInput ? passwordInput.value.trim() : "";

    errorMessage.textContent = "";
    document.getElementById("sikapCutiLink")?.remove();
    btnLogin.disabled = true;
    btnLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Memproses...</span>';

    try {
      if (!nik || !password) {
        throw new Error("Mohon lengkapi NIK dan password.");
      }

      // Kredensial dikirim via POST body — tidak pernah muncul di URL/log
      const res = await fetch(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", data: { nik, password } })
      });
      const result = await res.json();

      if (result.status !== "success") {
        throw Object.assign(new Error(result.message || "Login gagal."), { code: result.code });
      }

      saveUserSession(result.user, result.token);
      if (result.force_change_password) {
        _ssSet('onesap_force_pw', '1'); // _ssSet dari auth.js — aman di iOS private mode
      }
      // Wajib daftar+verifikasi email sebelum masuk beranda
      if (result.need_email) {
        window.location.href = "email-daftar.html";
        return;
      }
      window.location.href = "index-home.html";
    } catch (err) {
      errorMessage.textContent = err.message;
      if (err.code === "CUTI_BLOCKED") {
        const link = document.createElement("a");
        link.id = "sikapCutiLink";
        link.href = SIKAP_URL;
        link.className = "btn-masuk"; // reuse gaya tombol Masuk yang sudah ada
        link.style.marginTop = "10px";
        link.style.textDecoration = "none";
        link.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i><span>Kelola Cuti di SIKAP</span>';
        errorMessage.after(link);
      }
    } finally {
      _submitting = false;
      btnLogin.disabled = false;
      btnLogin.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>Masuk</span>';
    }
  });
}
