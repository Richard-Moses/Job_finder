/**
 * Shared helper for fetching a page's raw HTML through Firecrawl's cheapest
 * ("basic") proxy tier.
 *
 * dailyremote.com is a plain HTML site with no bot-check that a direct
 * `fetch()` normally handles fine (that's how scrape_dailyremote.py works
 * locally, and how it worked in local testing here) -- but it blocks
 * requests from datacenter/cloud IP ranges, which is exactly what Netlify
 * Functions run on. A direct fetch from Netlify gets a 403. Firecrawl's
 * basic proxy tier (not the more expensive "stealth" tier used for
 * Cloudflare-protected sites like healthjobsuk.com) gets through fine, at
 * only 1 credit per page -- confirmed by testing, not assumed.
 */

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

async function fetchHtmlViaFirecrawl(url, apiKey) {
  const resp = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["rawHtml"],
      onlyMainContent: false,
      proxy: "basic",
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.success) {
    throw new Error(data.error || `Firecrawl returned HTTP ${resp.status}`);
  }
  return data.data.rawHtml || "";
}

module.exports = { fetchHtmlViaFirecrawl };
