/**
 * Runs on every dashboard page load: confirms the visitor has a valid
 * session (checked server-side against ALLOWED_EMAILS on every call, not
 * just at login), otherwise bounces to /login.html.
 */
(async function () {
  try {
    const resp = await fetch("/api/auth-me", { credentials: "same-origin" });
    if (!resp.ok) {
      window.location.href = "/login.html";
      return;
    }
    const data = await resp.json();
    const el = document.getElementById("user-email");
    if (el) el.textContent = data.email;
  } catch (err) {
    window.location.href = "/login.html";
  }
})();
