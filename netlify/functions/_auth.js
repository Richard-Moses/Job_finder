/**
 * Shared auth helpers for Netlify Functions.
 *
 * There's no server session store here (stateless serverless functions), so
 * identity lives in a signed, httpOnly JWT cookie instead -- the direct
 * serverless equivalent of a Flask @login_required session check. Every
 * protected function calls requireAuth(event) first and bails out if it
 * fails; nothing does real work before that check passes.
 *
 * IMPORTANT: ALLOWED_EMAILS (not Google's own "Test users" list) is the real
 * access-control gate. Google's consent-screen test-user list only governs
 * who can reach the OAuth screen while the app is unverified/"Testing" --
 * it's capped at 100 users and disappears entirely if the app is ever
 * published. Don't rely on it for authorization.
 */

const jwt = require("jsonwebtoken");

const COOKIE_NAME = "jf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getAllowedEmails() {
  return (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function signSession(email) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return jwt.sign({ email }, secret, { expiresIn: SESSION_TTL_SECONDS });
}

function parseCookies(event) {
  const header = event.headers.cookie || event.headers.Cookie || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function sessionCookieHeader(token) {
  const secure = process.env.NETLIFY_DEV ? "" : "Secure; ";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearCookieHeader() {
  const secure = process.env.NETLIFY_DEV ? "" : "Secure; ";
  return `${COOKIE_NAME}=; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Verifies the session cookie and checks the email against ALLOWED_EMAILS.
 * Returns { ok: true, email } or { ok: false, response } where response is
 * a ready-to-return Netlify function response object.
 */
function requireAuth(event) {
  const cookies = parseCookies(event);
  const token = cookies[COOKIE_NAME];
  if (!token) {
    return { ok: false, response: { statusCode: 401, body: JSON.stringify({ error: "Not signed in." }) } };
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return { ok: false, response: { statusCode: 401, body: JSON.stringify({ error: "Session expired or invalid." }) } };
  }

  const email = (payload.email || "").toLowerCase();
  const allowed = getAllowedEmails();
  if (!allowed.includes(email)) {
    return {
      ok: false,
      response: { statusCode: 403, body: JSON.stringify({ error: "This email is not authorized for JobFinder." }) },
    };
  }

  return { ok: true, email };
}

module.exports = {
  COOKIE_NAME,
  getAllowedEmails,
  signSession,
  parseCookies,
  sessionCookieHeader,
  clearCookieHeader,
  requireAuth,
};
