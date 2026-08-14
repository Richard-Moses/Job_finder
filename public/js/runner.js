/**
 * Small shared helpers used by dashboard.js to drive the browser-side
 * scrape loops (call one function per page/job, log progress, stop early
 * on empty/duplicate results) -- the client-side equivalent of the
 * checkpointed while-loops in the Python CLI scripts.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logLine(logEl, text) {
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(badgeEl, state) {
  badgeEl.textContent = state;
  badgeEl.className = "status-badge " + state.toLowerCase();
}

/**
 * Firecrawl's stealth proxy (needed for Cloudflare-protected sites like
 * healthjobsuk.com) occasionally takes 20-30+ seconds, which can exceed a
 * single Netlify function's execution limit (~10-26s even on paid tiers) --
 * discovered by testing, not assumed. There's no safe way to retry *inside*
 * one function call without risking the same wall, so retries happen here,
 * client-side: each retry is a brand new function invocation with its own
 * fresh time budget, which is the correct fix for this architecture.
 */
async function fetchJSON(url, retries = 2) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const resp = await fetch(url, { credentials: "same-origin" }).catch((err) => {
      throw new Error(err.message);
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) return data;
    if (resp.status === 502 && attempt <= retries) {
      await sleep(1000 * attempt);
      continue;
    }
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
}

/**
 * Drives a paginated scrape: calls fetchPage(pageNumber) repeatedly,
 * accumulating whatever array it returns, until targetCount is reached,
 * a page comes back empty, or (from page 2 onward) a page adds nothing new
 * -- the same "wrong pagination param" early-stop heuristic used in
 * scrape_custom.py, so a bad guess doesn't burn credits looping forever.
 */
async function runPaginatedScrape({ fetchPage, keyOf, targetCount, maxPages, logEl, delayMs }) {
  const results = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages && results.length < targetCount; page++) {
    logLine(logEl, `[page ${page}] fetching...`);
    let pageJobs;
    try {
      pageJobs = await fetchPage(page);
    } catch (err) {
      logLine(logEl, `  [error] ${err.message}`);
      break;
    }
    if (!pageJobs || pageJobs.length === 0) {
      logLine(logEl, "  [info] no results on this page, stopping.");
      break;
    }

    let added = 0;
    for (const job of pageJobs) {
      const key = keyOf(job);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      results.push(job);
      added++;
      if (results.length >= targetCount) break;
    }
    logLine(logEl, `  [info] +${added} new (total ${results.length})`);

    if (page >= 2 && added === 0) {
      logLine(logEl, "  [warn] page 2+ added nothing new -- stopping (wrong pagination param?).");
      break;
    }
    if (delayMs) await sleep(delayMs);
  }

  return results.slice(0, targetCount);
}

/**
 * Drives a per-job enrichment loop (detail-page company lookups,
 * sponsorship classification): calls fetchDetail(job) for each job in turn,
 * merges the result into the job object, and logs progress.
 */
async function runPerJobEnrichment({ jobs, fetchDetail, mergeInto, logEl, delayMs }) {
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    logLine(logEl, `[${i + 1}/${jobs.length}] ${(job.title || "").slice(0, 60)}`);
    try {
      const detail = await fetchDetail(job);
      mergeInto(job, detail);
    } catch (err) {
      logLine(logEl, `  [warn] ${err.message}`);
    }
    if (delayMs) await sleep(delayMs);
  }
}
