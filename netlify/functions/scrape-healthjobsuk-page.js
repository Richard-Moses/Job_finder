/**
 * GET /.netlify/functions/scrape-healthjobsuk-page?page=N&category=Nursing_and_Midwifery
 *
 * healthjobsuk.com (Trac.jobs) sits behind a Cloudflare bot-check a plain
 * fetch can't pass, so pages are fetched through Firecrawl's rendering
 * proxy. This originally used Firecrawl's jsonOptions (LLM-based)
 * extraction for convenience -- but a live production 502 investigation
 * found that pass alone takes 30-60+ seconds against a ~50-job page,
 * comfortably past Netlify's function time limit every time (confirmed:
 * a plain rawHtml fetch of the same page took ~11s uncached; the same
 * fetch with jsonOptions on top took 56s). The page's own markup turns
 * out to be clean and semantic (`li.hj-job`, `.hj-jobtitle`, `.hj-grade`,
 * etc.), so this parses it directly with cheerio instead -- faster,
 * cheaper (no LLM pass), and reliable, mirroring the fix already applied
 * to the DailyRemote scraper for a similar reason.
 */

const cheerio = require("cheerio");
const { requireAuth } = require("./_auth");

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const BASE = "https://www.healthjobsuk.com";

function listingUrl(category, sector, page) {
  if (page <= 1) return `${BASE}/job_list/${category}/${sector}?_ts=1`;
  return `${BASE}/job_list/${category}/${sector}?_ts=1&_pg=${page}&_pgid=`;
}

function textWithoutCaption($, el) {
  const clone = el.clone();
  clone.find(".hj-field-caption").remove();
  return clone.text().trim();
}

function parseListingPage(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  // "Featured jobs" (paid/promoted listings) live in a separate
  // <aside id="hj-featured-jobs"> block, not in this <li> list, so this
  // selector naturally excludes them -- confirmed against a real page.
  $("li.hj-job").each((_, el) => {
    const li = $(el);
    const a = li.children("a").first();
    const jobDetailUrl = a.attr("href") || "";
    const title = li.find(".hj-jobtitle").first().text().trim();
    const grade = li.find(".hj-grade").first().text().trim();
    const employer = li.find(".hj-employername").first().text().trim();
    const location = li.find(".hj-locationtown").first().text().trim();
    const speciality = textWithoutCaption($, li.find(".hj-primaryspeciality").first());
    const salary = textWithoutCaption($, li.find(".hj-salary").first());

    if (!title || !jobDetailUrl) return;
    jobs.push({ title, grade, employer, location, speciality, salary, jobDetailUrl });
  });

  return jobs;
}

async function fetchRawHtml(url, apiKey) {
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
      proxy: "stealth",
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.success) {
    throw new Error(data.error || `Firecrawl returned HTTP ${resp.status}`);
  }
  return (data.data && data.data.rawHtml) || "";
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
    const html = await fetchRawHtml(url, apiKey);
    const jobs = parseListingPage(html);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
