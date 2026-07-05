const BASE_URL = "/api";

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
    btnLogin.disabled = true;
    btnLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Memproses...</span>';

    try {
      if (!nik || !password) {
        throw new Error("Mohon lengkapi NIK dan password.");
      }

      const res = await fetch(`${BASE_URL}?action=login&nik=${encodeURIComponent(
        nik
      )}&password=${encodeURIComponent(password)}`);
      const result = await res.json();

      if (result.status !== "success") {
        throw new Error(result.message || "Login gagal.");
      }

      saveUserSession(result.user);
      window.location.href = "index-home.html";
    } catch (err) {
      errorMessage.textContent = err.message;
    } finally {
      btnLogin.disabled = false;
      btnLogin.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>Masuk</span>';
    }
  });
}
