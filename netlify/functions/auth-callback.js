/**
 * GET /.netlify/functions/auth-callback (aliased to /auth/callback)
 * Exchanges the OAuth code for tokens, verifies the Google ID token's
 * signature (never trust it unverified), checks the email against
 * ALLOWED_EMAILS, and issues our own signed JWT session cookie.
 */

const { OAuth2Client } = require("google-auth-library");
const { signSession, sessionCookieHeader, getAllowedEmails } = require("./_auth");

exports.handler = async (event) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { statusCode: 500, body: "Google OAuth is not configured." };
  }

  const code = event.queryStringParameters && event.queryStringParameters.code;
  if (!code) {
    return { statusCode: 400, body: "Missing authorization code." };
  }

  const siteUrl = process.env.URL || `http://${event.headers.host}`;
  const redirectUri = `${siteUrl}/auth/callback`;
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);

  let idToken;
  try {
    const { tokens } = await client.getToken(code);
    idToken = tokens.id_token;
  } catch (err) {
    return { statusCode: 401, body: `Google sign-in failed: ${err.message}` };
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    payload = ticket.getPayload();
  } catch (err) {
    return { statusCode: 401, body: `Could not verify Google identity: ${err.message}` };
  }

  const email = (payload.email || "").toLowerCase();
  if (!payload.email_verified) {
    return { statusCode: 403, body: "Your Google email is not verified." };
  }

  const allowed = getAllowedEmails();
  if (!allowed.includes(email)) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "text/html" },
      body: `<p>The Google account <strong>${email}</strong> is not authorized for JobFinder.</p>
             <p>Ask the site owner to add this email to ALLOWED_EMAILS.</p>
             <p><a href="/login.html">Try a different account</a></p>`,
    };
  }

  const token = signSession(email);

  return {
    statusCode: 302,
    headers: {
      Location: "/",
      "Set-Cookie": sessionCookieHeader(token),
    },
    body: "",
  };
};
