/**
 * GET /.netlify/functions/scrape-dailyremote-page?page=N&search=term
 *
 * Ports parse_listing_page() from scrape_dailyremote.py 1:1 -- same CSS
 * selectors, same emoji-prefix badge parsing (location/salary/experience),
 * same fields. Company name stays blank here on purpose: dailyremote.com
 * hides it on listing cards behind a "premium" paywall and only reveals it
 * on the job's own detail page -- see scrape-dailyremote-detail.js.
 */

const cheerio = require("cheerio");
const { requireAuth } = require("./_auth");
const { fetchHtmlViaFirecrawl } = require("./_fetch-html");

const BASE = "https://dailyremote.com";

function parseListingPage(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $("article.card.js-card").each((_, el) => {
    const art = $(el);
    const jobId = (art.attr("data-id") || "").trim();
    if (!jobId) return;

    const h2a = art.find("h2.job-position a").first();
    const title = h2a.text().trim();
    const href = h2a.attr("href") || "";
    const url = href.startsWith("/") ? BASE + href : href;

    let jobType = "";
    let postedRelative = "";
    const companyNameDiv = art.find("div.company-name").first();
    if (companyNameDiv.length) {
      companyNameDiv.find("span").each((__, sp) => {
        const spEl = $(sp);
        const style = spEl.attr("style") || "";
        const txt = spEl.text().trim();
        if (!txt || txt === "·") return;
        if (style.includes("margin-left")) postedRelative = txt;
        else if (style.includes("margin-right")) jobType = txt;
      });
    }

    let location = "";
    let salary = "";
    let experience = "";
    art.find("span.card-tag").each((__, tag) => {
      const txt = $(tag).text().replace(/\s+/g, " ").trim();
      if (txt.startsWith("\u{1F30E}")) location = txt.replace("\u{1F30E}", "").trim();
      else if (txt.startsWith("\u{1F4B5}")) salary = txt.replace("\u{1F4B5}", "").trim();
      else if (txt.startsWith("⭐")) experience = txt.replace("⭐", "").trim();
    });

    const catA = art.find("span.category-tag a").first();
    const category = catA.length ? catA.text().replace("\u{1F4BC}", "").trim() : "";

    const roleA = art.find("a.role-tag").first();
    const roleTag = roleA.length ? roleA.text().trim() : "";

    const summaryDiv = art.find("div.ai-responsibilities").first();
    const summary = summaryDiv.length ? summaryDiv.text().trim() : "";

    const skills = [];
    art.find("div.tags-container a").each((__, a) => {
      const aEl = $(a);
      const classes = (aEl.attr("class") || "").split(/\s+/);
      if (classes.includes("tags")) skills.push(aEl.text().trim());
    });

    jobs.push({
      jobId,
      title,
      company: "",
      location,
      jobType,
      salary,
      experienceLevel: experience,
      category,
      roleTag,
      skillTags: skills.join(", "),
      datePosted: "",
      postedRelative,
      applicationDeadline: "",
      summary,
      description: "",
      url,
    });
  });

  return jobs;
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
  const search = qs.search || "";
  const url = `${BASE}/remote-jobs?search=${encodeURIComponent(search)}&page=${page}`;

  let html;
  try {
    html = await fetchHtmlViaFirecrawl(url, apiKey);
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }

  const jobs = parseListingPage(html);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs }),
  };
};
