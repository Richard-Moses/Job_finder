/**
 * GET /.netlify/functions/scrape-healthjobsuk-sponsor?url=<job detail url>
 *
 * Ports classify_sponsorship() from add_sponsorship.py verbatim (same
 * NO_PATTERNS / YES_PATTERNS regex, same "not mentioned / mentioned unclear
 * / yes / no" logic). There's no structured sponsorship field on the site --
 * this is a best-effort read of free text, not a guaranteed-accurate flag,
 * same caveat as the Python version.
 */

const { requireAuth } = require("./_auth");

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

const NO_PATTERNS = [
  /not\s+(?:a\s+role\s+that\s+\w+\s+)?(?:be\s+)?able\s+to\s+(?:offer\s+)?(?:a\s+[\w\s]{0,20}?\s+)?sponsor/,
  /(?:will\s+not|does\s+not|is\s+not\s+able\s+to|cannot|can't|unable\s+to)\s+(?:offer\s+)?(?:a\s+[\w\s]{0,20}?\s+)?sponsor/,
  /no\s+sponsorship/,
  /not\s+eligible\s+for\s+(?:visa\s+)?sponsorship/,
  /not\s+sponsor\s+this\s+(?:role|post|position|vacancy)/,
  /this\s+(?:role|post|position|vacancy)\s+(?:is\s+)?not\s+(?:eligible\s+for\s+)?sponsor/,
  /unable\s+to\s+offer\s+a\s+certificate\s+of\s+sponsorship/,
  /currently\s+unable\s+to\s+offer\s+(?:a\s+)?(?:certificate\s+of\s+)?sponsorship/,
  /not\s+a\s+role\s+that\s+\w+\s+will\s+offer\s+sponsorship/,
];

const YES_PATTERNS = [
  /(?:we\s+)?(?:are\s+able\s+to|can|will|do)\s+(?:offer|provide)\s+(?:visa\s+)?sponsorship/,
  /sponsorship\s+(?:is\s+)?available/,
  /eligible\s+for\s+(?:a\s+)?(?:visa\s+)?sponsorship/,
  /eligible\s+(?:for|under)\s+(?:the\s+)?(?:Health\s+and\s+Care\s+Worker|Skilled\s+Worker)\s+visa/i,
  /welcome\s+applications\s+from\s+candidates\s+who\s+require\s+sponsorship/,
  /UKVI\s+approved\s+sponsor/i,
  /we\s+(?:are\s+a\s+)?(?:licensed|approved)\s+sponsor/,
];

function classifySponsorship(text) {
  if (!text) return { sponsorship: "Not mentioned", snippet: "" };
  const lowered = text.toLowerCase();

  for (const pat of NO_PATTERNS) {
    const m = lowered.match(pat);
    if (m) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(text.length, m.index + m[0].length + 60);
      return { sponsorship: "No", snippet: text.slice(start, end).replace(/\n/g, " ").trim() };
    }
  }
  for (const pat of YES_PATTERNS) {
    const m = lowered.match(pat);
    if (m) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(text.length, m.index + m[0].length + 60);
      return { sponsorship: "Yes", snippet: text.slice(start, end).replace(/\n/g, " ").trim() };
    }
  }
  const idx = lowered.indexOf("sponsor");
  if (idx !== -1) {
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + 100);
    return { sponsorship: "Mentioned (unclear)", snippet: text.slice(start, end).replace(/\n/g, " ").trim() };
  }
  return { sponsorship: "Not mentioned", snippet: "" };
}

async function firecrawlMarkdown(url, apiKey) {
  const resp = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, proxy: "stealth" }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.success) {
    throw new Error(data.error || `Firecrawl returned HTTP ${resp.status}`);
  }
  return (data.data && data.data.markdown) || "";
}

exports.handler = async (event) => {
  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "FIRECRAWL_API_KEY is not configured." }) };
  }

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing url parameter." }) };
  }

  try {
    const markdown = await firecrawlMarkdown(url, apiKey);
    const result = classifySponsorship(markdown);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
