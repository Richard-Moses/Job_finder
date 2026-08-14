/**
 * GET /.netlify/functions/scrape-dailyremote-detail?url=<job detail url>
 *
 * Ports parse_detail_page() + html_to_text() from scrape_dailyremote.py.
 * The company name is free on a job's own detail page even though it's
 * paywalled on the listing card -- pulled from the embedded JSON-LD
 * JobPosting block, same as the Python version.
 */

const { requireAuth } = require("./_auth");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

function unescapeHtml(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (NAMED_ENTITIES[name] !== undefined ? NAMED_ENTITIES[name] : m));
}

function htmlToText(fragment) {
  if (!fragment) return "";
  let text = unescapeHtml(fragment);
  text = text.replace(/<\/(p|li|h[1-6]|div)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li>/gi, "• ");
  text = text.replace(/<[^>]+>/g, "");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function parseDetailPage(html) {
  const match = html.match(/<script type="application\/ld\+json">\s*(\{.*?"@type":"JobPosting".*?\})\s*<\/script>/s);
  if (!match) return {};

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (err) {
    return {};
  }

  const hidden = ["[hidden company]", "[unlock with premium]"];
  let company = "";
  const hiringOrg = data.hiringOrganization || {};
  if (hiringOrg && typeof hiringOrg === "object") company = hiringOrg.name || "";
  if (!company || hidden.includes(company.toLowerCase())) {
    const identifier = data.identifier || {};
    if (identifier && typeof identifier === "object") {
      const identName = identifier.name || "";
      if (identName && !hidden.includes(identName.toLowerCase())) company = identName;
    }
  }

  return {
    company,
    description: htmlToText(data.description || ""),
    datePosted: (data.datePosted || "").slice(0, 10),
    applicationDeadline: (data.validThrough || "").slice(0, 10),
  };
}

exports.handler = async (event) => {
  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing url parameter." }) };
  }

  let html;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: `Upstream returned HTTP ${resp.status}` }) };
    }
    html = await resp.text();
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }

  const detail = parseDetailPage(html);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(detail),
  };
};
