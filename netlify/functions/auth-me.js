/**
 * GET /.netlify/functions/auth-me
 * Tells the frontend whether the current visitor is signed in, and as whom.
 * Used by public/js/auth.js on page load to decide login.html vs dashboard.
 */

const { requireAuth } = require("./_auth");

exports.handler = async (event) => {
  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: auth.email }),
  };
};
