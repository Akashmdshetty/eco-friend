// frontend/auth.js (improved, safer, more robust)

(function () {
  const API_BASE = window.API_BASE || "http://localhost:4000/api";

  const STORAGE = {
    TOKEN: "ecowise.token",
    USERNAME: "ecowise.username",
  };

  // Namespace global
  window.ECOWISE = window.ECOWISE || {
    apiBase: API_BASE,
    token: null,
    username: null,
    isAuthenticated: false,
  };

  const getToken = () => localStorage.getItem(STORAGE.TOKEN);
  const setToken = (token) => {
    if (token) localStorage.setItem(STORAGE.TOKEN, token);
    else localStorage.removeItem(STORAGE.TOKEN);
    window.ECOWISE.token = token;
    window.ECOWISE.isAuthenticated = !!token;
  };

  const getUsername = () => localStorage.getItem(STORAGE.USERNAME);
  const setUsername = (u) => {
    if (u) localStorage.setItem(STORAGE.USERNAME, u);
    else localStorage.removeItem(STORAGE.USERNAME);
    window.ECOWISE.username = u;
  };

  // --- API calls ---
  async function fetchMe(token) {
    if (!token) return null;

    try {
      const res = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) return null;

      const json = await res.json();
      return json.user || null;
    } catch (err) {
      console.error("auth.js fetchMe error:", err);
      return null;
    }
  }

  // --- UI Handling Helpers ---
  function showGuestUI() {
    const welcomeLine = document.getElementById("welcomeLine");
    const authLinks = document.getElementById("authLinks");
    const logoutBtn = document.getElementById("logoutBtn");

    if (welcomeLine)
      welcomeLine.textContent =
        "Signed in as Guest — analyze to create an account";

    if (authLinks) authLinks.style.display = "";
    if (logoutBtn) logoutBtn.style.display = "none";

    setUsername(null);
    window.ECOWISE.isAuthenticated = false;
  }

  function showUserUI(username) {
    const welcomeLine = document.getElementById("welcomeLine");
    const authLinks = document.getElementById("authLinks");
    const logoutBtn = document.getElementById("logoutBtn");

    if (welcomeLine)
      welcomeLine.textContent = `Welcome back, ${username}`;

    if (authLinks) authLinks.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "";

    setUsername(username);
    window.ECOWISE.isAuthenticated = true;
  }

  // --- Logout Handler ---
  function setupLogout() {
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn) return;

    logoutBtn.onclick = (e) => {
      e.preventDefault();
      setToken(null);
      setUsername(null);
      window.location.href = "login.html";
    };
  }

  // --- Initialization ---
  async function init() {
    setupLogout();

    const token = getToken();
    const storedUser = getUsername();

    window.ECOWISE.token = token;
    window.ECOWISE.username = storedUser;

    if (!token) {
      showGuestUI();
      return;
    }

    const user = await fetchMe(token);

    if (!user) {
      // Token invalid or expired
      setToken(null);
      showGuestUI();
      return;
    }

    // Valid user
    showUserUI(user.username);
  }

  // Run when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
