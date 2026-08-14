/**
 * GET /.netlify/functions/auth-login (aliased to /auth/login)
 * Builds the Google OAuth consent-screen URL and redirects the browser to it.
 */

exports.handler = async (event) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return { statusCode: 500, body: "GOOGLE_CLIENT_ID is not configured." };
  }

  const siteUrl = process.env.URL || `http://${event.headers.host}`;
  const redirectUri = `${siteUrl}/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
  });

  return {
    statusCode: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
    body: "",
  };
};
