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

if (loginForm) {
  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const nik = document.getElementById("nik").value.trim();
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
        sessionStorage.setItem('onesap_force_pw', '1');
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
      btnLogin.disabled = false;
      btnLogin.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>Masuk</span>';
    }
  });
}
