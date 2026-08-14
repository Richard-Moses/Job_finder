/**
 * Wires up the sidebar nav and the four scraper cards. All state lives in
 * memory for this browser session only (see the Overview page's note) --
 * closing the tab loses unsaved progress, same trade-off accepted when
 * choosing this architecture over a persistent backend.
 */

const state = {
  dailyremote: { jobs: [] },
  healthjobsuk: { jobs: [] },
  custom: { jobs: [] },
};

// ---- nav ----
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("page-" + btn.dataset.page).classList.add("active");
    if (btn.dataset.page === "overview") refreshKpis();
  });
});

// ---- overview KPIs + low-credit banner ----
// Firecrawl credits are shared across everyone using this app (one API
// key), and every scraper spends them now (including DailyRemote, since
// its Netlify-vs-dailyremote.com IP-blocking fix routes through Firecrawl
// too). This banner shows on every page, not just Overview, so it's
// visible right before someone clicks "Run" -- not just buried on a page
// they might not check first.
const CREDITS_WARNING_THRESHOLD = 100;
const CREDITS_CRITICAL_THRESHOLD = 20;

function updateCreditsBanner(remaining, plan) {
  const banner = document.getElementById("credits-banner");
  if (remaining === null || remaining === undefined) {
    banner.style.display = "none";
    return;
  }
  if (remaining <= CREDITS_CRITICAL_THRESHOLD) {
    banner.textContent = `⚠ Only ${remaining} Firecrawl credits left out of ${plan}. A HealthJobsUK or Custom URL scrape may not complete.`;
    banner.className = "credits-banner critical";
    banner.style.display = "block";
  } else if (remaining <= CREDITS_WARNING_THRESHOLD) {
    banner.textContent = `${remaining} Firecrawl credits left out of ${plan} — running low. Consider a smaller job count.`;
    banner.className = "credits-banner warning";
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
}

async function refreshKpis() {
  document.getElementById("kpi-hju-count").textContent = state.healthjobsuk.jobs.length;
  document.getElementById("kpi-dr-count").textContent = state.dailyremote.jobs.length;
  try {
    const data = await fetchJSON("/api/firecrawl-credits");
    document.getElementById("kpi-credits").textContent = `${data.remaining} / ${data.plan}`;
    updateCreditsBanner(data.remaining, data.plan);
  } catch (err) {
    document.getElementById("kpi-credits").textContent = "--";
    updateCreditsBanner(null, null);
  }
}
document.getElementById("refresh-kpis").addEventListener("click", refreshKpis);
refreshKpis();

// ---- DailyRemote ----
document.getElementById("dr-run").addEventListener("click", async () => {
  const target = parseInt(document.getElementById("dr-target").value, 10) || 50;
  const search = document.getElementById("dr-search").value.trim();
  const btn = document.getElementById("dr-run");
  const badge = document.getElementById("dr-status");
  const logEl = document.getElementById("dr-log");
  logEl.textContent = "";
  btn.disabled = true;
  setStatus(badge, "RUNNING");
  try {
    const listingJobs = await runPaginatedScrape({
      fetchPage: async (page) => {
        const qs = new URLSearchParams({ page: String(page), search });
        const data = await fetchJSON("/api/scrape-dailyremote-page?" + qs.toString());
        return data.jobs;
      },
      keyOf: (j) => j.jobId,
      targetCount: target,
      maxPages: 60,
      logEl,
      delayMs: 200,
    });
    logLine(logEl, `\nFetched ${listingJobs.length} listings. Fetching company/description details...`);
    await runPerJobEnrichment({
      jobs: listingJobs,
      fetchDetail: async (job) => {
        const qs = new URLSearchParams({ url: job.url });
        return fetchJSON("/api/scrape-dailyremote-detail?" + qs.toString());
      },
      mergeInto: (job, detail) => Object.assign(job, detail),
      logEl,
      delayMs: 150,
    });
    state.dailyremote.jobs = listingJobs;
    logLine(logEl, `\n== Done: ${listingJobs.length} jobs ==`);
    setStatus(badge, "DONE");
  } catch (err) {
    logLine(logEl, `\n[fatal] ${err.message}`);
    setStatus(badge, "FAILED");
  } finally {
    btn.disabled = false;
    refreshKpis();
  }
});

document.getElementById("dr-download").addEventListener("click", () => {
  if (!state.dailyremote.jobs.length) {
    alert("Run a scrape first.");
    return;
  }
  buildAndDownloadExcel(
    state.dailyremote.jobs,
    [
      { header: "Title", key: "title", width: 40 },
      { header: "Company", key: "company", width: 25 },
      { header: "Location", key: "location", width: 25 },
      { header: "Job Type", key: "jobType", width: 15 },
      { header: "Salary", key: "salary", width: 22 },
      { header: "Experience Level", key: "experienceLevel", width: 16 },
      { header: "Category", key: "category", width: 16 },
      { header: "Role Tag", key: "roleTag", width: 20 },
      { header: "Skill Tags", key: "skillTags", width: 30 },
      { header: "Date Posted", key: "datePosted", width: 13 },
      { header: "Posted", key: "postedRelative", width: 14 },
      { header: "Application Deadline", key: "applicationDeadline", width: 16 },
      { header: "Summary", key: "summary", width: 50 },
      { header: "Full Description", key: "description", width: 60 },
      { header: "Job URL", key: "url", width: 45 },
    ],
    "DailyRemote Jobs",
    "dailyremote_jobs.xlsx",
    "url"
  );
});

// ---- HealthJobsUK ----
document.getElementById("hju-run").addEventListener("click", async () => {
  const target = parseInt(document.getElementById("hju-target").value, 10) || 50;
  const category = document.getElementById("hju-category").value.trim() || "Nursing_and_Midwifery";
  const btn = document.getElementById("hju-run");
  const badge = document.getElementById("hju-status");
  const logEl = document.getElementById("hju-log");
  logEl.textContent = "";
  btn.disabled = true;
  setStatus(badge, "RUNNING");
  try {
    const jobs = await runPaginatedScrape({
      fetchPage: async (page) => {
        const qs = new URLSearchParams({ page: String(page), category });
        const data = await fetchJSON("/api/scrape-healthjobsuk-page?" + qs.toString());
        return data.jobs;
      },
      keyOf: (j) => j.jobDetailUrl,
      targetCount: target,
      maxPages: 60,
      logEl,
      delayMs: 300,
    });
    state.healthjobsuk.jobs = jobs;
    logLine(logEl, `\n== Done: ${jobs.length} jobs ==`);
    setStatus(badge, "DONE");
  } catch (err) {
    logLine(logEl, `\n[fatal] ${err.message}`);
    setStatus(badge, "FAILED");
  } finally {
    btn.disabled = false;
    refreshKpis();
  }
});

const HJU_COLUMNS = [
  { header: "Title", key: "title", width: 40 },
  { header: "Grade / Band", key: "grade", width: 18 },
  { header: "Employer", key: "employer", width: 32 },
  { header: "Location", key: "location", width: 24 },
  { header: "Speciality", key: "speciality", width: 35 },
  { header: "Salary", key: "salary", width: 30 },
  { header: "Hours", key: "hours", width: 28 },
  { header: "Sponsorship", key: "sponsorship", width: 18 },
  { header: "Cert. of Sponsorship Mentioned", key: "certificateOfSponsorshipMentioned", width: 14 },
  { header: "Sponsorship Snippet", key: "sponsorshipSnippet", width: 55 },
  { header: "Job URL", key: "jobDetailUrl", width: 50 },
];

document.getElementById("hju-download").addEventListener("click", () => {
  if (!state.healthjobsuk.jobs.length) {
    alert("Run a scrape first.");
    return;
  }
  buildAndDownloadExcel(state.healthjobsuk.jobs, HJU_COLUMNS, "HealthJobsUK Jobs", "healthjobsuk_jobs.xlsx", "jobDetailUrl");
});

// ---- Sponsorship (enriches the in-memory HealthJobsUK jobs) ----
document.getElementById("sponsor-run").addEventListener("click", async () => {
  const btn = document.getElementById("sponsor-run");
  const badge = document.getElementById("sponsor-status");
  const logEl = document.getElementById("sponsor-log");
  logEl.textContent = "";
  if (!state.healthjobsuk.jobs.length) {
    logLine(logEl, 'No HealthJobsUK jobs in this session yet. Run "HealthJobsUK" first.');
    return;
  }
  btn.disabled = true;
  setStatus(badge, "RUNNING");
  try {
    await runPerJobEnrichment({
      jobs: state.healthjobsuk.jobs,
      fetchDetail: async (job) => {
        const qs = new URLSearchParams({ url: job.jobDetailUrl });
        return fetchJSON("/api/scrape-healthjobsuk-sponsor?" + qs.toString());
      },
      mergeInto: (job, detail) => {
        job.sponsorship = detail.sponsorship;
        job.sponsorshipSnippet = detail.snippet;
        job.hours = detail.hours;
        job.certificateOfSponsorshipMentioned = detail.certificateOfSponsorshipMentioned;
      },
      logEl,
      delayMs: 200,
    });
    logLine(logEl, "\n== Done ==");
    setStatus(badge, "DONE");
  } catch (err) {
    logLine(logEl, `\n[fatal] ${err.message}`);
    setStatus(badge, "FAILED");
  } finally {
    btn.disabled = false;
    refreshKpis();
    updateFilteredCount();
  }
});

document.getElementById("sponsor-download").addEventListener("click", () => {
  if (!state.healthjobsuk.jobs.length) {
    alert("Run a HealthJobsUK scrape first.");
    return;
  }
  buildAndDownloadExcel(state.healthjobsuk.jobs, HJU_COLUMNS, "HealthJobsUK Jobs", "healthjobsuk_jobs.xlsx", "jobDetailUrl");
});

// ---- Filtered export: certificate-of-sponsorship + Full Time + Band 3/4/5 ----
// "Grade" comes back in varied forms ("NHS AfC: Band 6", "Band 5/6 dependant
// on experience", a bare "6", etc.) so every band number mentioned is
// extracted rather than assuming one fixed format -- a "Band 4/5" listing
// should still match on either number.
function bandNumbersIn(grade) {
  if (!grade) return [];
  const matches = [...grade.matchAll(/band\s*(\d+)/gi)];
  return matches.map((m) => parseInt(m[1], 10));
}

// Salary text is free-form ("£25,272 - £27,476 Per Annum, Pro Rata",
// "£112,782 - £129,783 p.a.", a single figure with no range, or an hourly
// rate like "£25.83 per hour"). Every £ figure gets pulled out and treated
// as a low/high range; hourly-rate listings are excluded rather than
// guessed at, since converting them to an annual figure would mean
// assuming hours/week that aren't reliably known.
const TARGET_SALARY_LOW = 30000;
const TARGET_SALARY_HIGH = 40000;

function parseSalaryRange(salaryText) {
  if (!salaryText) return null;
  if (/per\s*hour|hourly|\/\s*hr\b/i.test(salaryText)) return null;
  const numbers = [...salaryText.matchAll(/£\s*([\d,]+(?:\.\d+)?)/g)].map((m) =>
    parseFloat(m[1].replace(/,/g, ""))
  );
  if (numbers.length === 0) return null;
  return { low: Math.min(...numbers), high: Math.max(...numbers) };
}

function overlapsTargetSalary(salaryText) {
  const range = parseSalaryRange(salaryText);
  if (!range) return false;
  return range.low <= TARGET_SALARY_HIGH && range.high >= TARGET_SALARY_LOW;
}

function matchesSponsorshipFilter(job) {
  const hasCertificate = job.certificateOfSponsorshipMentioned === true;
  const isFullTime = /full[\s-]?time/i.test(job.hours || "");
  const bands = bandNumbersIn(job.grade);
  const isTargetBand = bands.some((n) => [3, 4, 5].includes(n));
  const isTargetSalary = overlapsTargetSalary(job.salary);
  return hasCertificate && isFullTime && isTargetBand && isTargetSalary;
}

function updateFilteredCount() {
  const countEl = document.getElementById("sponsor-filtered-count");
  if (!countEl) return;
  const enriched = state.healthjobsuk.jobs.filter((j) => j.sponsorship !== undefined);
  if (!enriched.length) {
    countEl.textContent = "";
    return;
  }
  const matchCount = state.healthjobsuk.jobs.filter(matchesSponsorshipFilter).length;
  countEl.textContent = `${matchCount} of ${state.healthjobsuk.jobs.length} jobs match: mentions "certificate of sponsorship", Full Time, Band 3/4/5, salary £${TARGET_SALARY_LOW.toLocaleString()}-£${TARGET_SALARY_HIGH.toLocaleString()}.`;
}

document.getElementById("sponsor-filtered-download").addEventListener("click", () => {
  const matches = state.healthjobsuk.jobs.filter(matchesSponsorshipFilter);
  if (!matches.length) {
    alert(
      'No jobs currently match all four filters (mentions "certificate of sponsorship", Full Time, Band 3/4/5, salary £30,000-£40,000). Run "Add Sponsorship Info" first if you haven\'t.'
    );
    return;
  }
  buildAndDownloadExcel(matches, HJU_COLUMNS, "Filtered NHS Jobs", "healthjobsuk_jobs_filtered.xlsx", "jobDetailUrl");
});

// ---- Custom URL ----
document.getElementById("custom-run").addEventListener("click", async () => {
  const url = document.getElementById("custom-url").value.trim();
  const pages = parseInt(document.getElementById("custom-pages").value, 10) || 1;
  const pageParam = document.getElementById("custom-pageparam").value.trim() || "page";
  const btn = document.getElementById("custom-run");
  const badge = document.getElementById("custom-status");
  const logEl = document.getElementById("custom-log");
  logEl.textContent = "";
  if (!url) {
    logLine(logEl, "Paste a URL first.");
    return;
  }
  btn.disabled = true;
  setStatus(badge, "RUNNING");
  try {
    const jobs = await runPaginatedScrape({
      fetchPage: async (page) => {
        const qs = new URLSearchParams({ url, page: String(page), pageParam });
        const data = await fetchJSON("/api/scrape-custom-page?" + qs.toString());
        return data.jobs;
      },
      keyOf: (j) => j.url || JSON.stringify(j),
      targetCount: Infinity,
      maxPages: pages,
      logEl,
      delayMs: 300,
    });
    state.custom.jobs = jobs;
    logLine(logEl, `\n== Done: ${jobs.length} jobs ==`);
    setStatus(badge, "DONE");
  } catch (err) {
    logLine(logEl, `\n[fatal] ${err.message}`);
    setStatus(badge, "FAILED");
  } finally {
    btn.disabled = false;
    refreshKpis();
  }
});

document.getElementById("custom-download").addEventListener("click", () => {
  if (!state.custom.jobs.length) {
    alert("Run a scrape first.");
    return;
  }
  buildAndDownloadExcel(
    state.custom.jobs,
    [
      { header: "Title", key: "title", width: 40 },
      { header: "Company", key: "company", width: 28 },
      { header: "Location", key: "location", width: 24 },
      { header: "Job Type", key: "job_type", width: 16 },
      { header: "Salary", key: "salary", width: 26 },
      { header: "Job URL", key: "url", width: 50 },
    ],
    "Custom Jobs",
    "custom_jobs.xlsx",
    "url"
  );
});
