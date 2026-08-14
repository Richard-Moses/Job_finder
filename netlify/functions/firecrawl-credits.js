/**
 * GET /.netlify/functions/firecrawl-credits
 * Small auth-gated proxy so the dashboard can show the shared Firecrawl
 * credit balance without exposing FIRECRAWL_API_KEY to the browser.
 */

const { requireAuth } = require("./_auth");

exports.handler = async (event) => {
  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "FIRECRAWL_API_KEY is not configured." }) };
  }

  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.error || `Firecrawl returned HTTP ${resp.status}`);
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        remaining: data.data.remaining_credits,
        plan: data.data.plan_credits,
      }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
