/**
 * GET /.netlify/functions/scrape-custom-page?url=<listing url>&page=N&pageParam=page
 *
 * Ports scrape_custom.py: generic Firecrawl jsonOptions extraction that
 * adapts to different site layouts (unlike the DailyRemote function, which
 * is hardcoded to that one site's HTML). Pagination is NOT auto-detected --
 * the caller supplies the query-param name their target site uses, same as
 * the Python version's --page-param flag.
 */

const { requireAuth } = require("./_auth");

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

const EXTRACTION_PROMPT =
  "Extract every individual job listing shown on this page (skip navigation, " +
  "footer, and any 'featured'/'sponsored' promo blocks that aren't real listings " +
  "unless they are). For each job return: title, company (the hiring " +
  "organisation/employer name, empty string if not shown), location, job_type " +
  "(e.g. Full-Time/Part-Time/Contract, empty string if not shown), salary " +
  "(empty string if not shown), and url (the absolute URL of the job's own " +
  "detail page).";

function withPageParam(rawUrl, param, page) {
  if (page <= 1) return rawUrl;
  const parsed = new URL(rawUrl);
  parsed.searchParams.set(param, String(page));
  return parsed.toString();
}

async function firecrawlJsonScrape(url, apiKey) {
  const resp = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["json"],
      onlyMainContent: true,
      proxy: "stealth",
      jsonOptions: { prompt: EXTRACTION_PROMPT },
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.success) {
    throw new Error(data.error || `Firecrawl returned HTTP ${resp.status}`);
  }
  const j = (data.data && data.data.json) || {};
  for (const key of ["jobListings", "jobs", "job_listings", "listings"]) {
    if (Array.isArray(j[key])) return j[key];
  }
  for (const value of Object.values(j)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

exports.handler = async (event) => {
  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "FIRECRAWL_API_KEY is not configured." }) };
  }

  const qs = event.queryStringParameters || {};
  const baseUrl = qs.url;
  const page = parseInt(qs.page || "1", 10) || 1;
  const pageParam = qs.pageParam || "page";
  if (!baseUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing url parameter." }) };
  }

  let pageUrl;
  try {
    pageUrl = withPageParam(baseUrl, pageParam, page);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: `Invalid URL: ${err.message}` }) };
  }

  try {
    const jobs = await firecrawlJsonScrape(pageUrl, apiKey);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
