/**
 * GET /.netlify/functions/scrape-healthjobsuk-page?page=N&category=Nursing_and_Midwifery
 *
 * healthjobsuk.com (Trac.jobs) sits behind a Cloudflare bot-check a plain
 * fetch can't pass, so -- same as scrape_healthjobsuk.py -- this proxies
 * through Firecrawl's rendering proxy with jsonOptions structured
 * extraction. FIRECRAWL_API_KEY stays server-side; the browser never sees it.
 */

const { requireAuth } = require("./_auth");

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const BASE = "https://www.healthjobsuk.com";

const EXTRACTION_PROMPT =
  "Extract every job vacancy card in the numbered list (not the 'Featured " +
  "jobs' section at the bottom). For each: title, grade (the band/grade " +
  "text, may be empty), employer, location, speciality, salary, and the " +
  "job detail url.";

function listingUrl(category, sector, page) {
  if (page <= 1) return `${BASE}/job_list/${category}/${sector}?_ts=1`;
  return `${BASE}/job_list/${category}/${sector}?_ts=1&_pg=${page}&_pgid=`;
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
  return (data.data && data.data.json && data.data.json.jobVacancies) || [];
}

exports.handler = async (event) => {
  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "FIRECRAWL_API_KEY is not configured." }) };
  }

  const qs = event.queryStringParameters || {};
  const page = parseInt(qs.page || "1", 10) || 1;
  const category = qs.category || "Nursing_and_Midwifery";
  const sector = qs.sector || "s1";
  const url = listingUrl(category, sector, page);

  try {
    const jobs = await firecrawlJsonScrape(url, apiKey);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
