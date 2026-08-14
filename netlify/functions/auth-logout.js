/**
 * GET /.netlify/functions/auth-logout (aliased to /auth/logout)
 * Clears the session cookie and redirects to the login page.
 */

const { clearCookieHeader } = require("./_auth");

exports.handler = async () => {
  return {
    statusCode: 302,
    headers: {
      Location: "/login.html",
      "Set-Cookie": clearCookieHeader(),
    },
    body: "",
  };
};
