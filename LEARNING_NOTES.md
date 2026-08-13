# How this scraper was built (and why)

A walkthrough of the decisions behind `scrape_dailyremote.py`, written up for learning purposes.

## 1. The original ask didn't match the URL

The request was "scrape all ~622 jobs from this URL." But the URL
(`dailyremote.com/remote-jobs?search=&page=1`) had no actual filter applied —
checking the page's own pagination links showed a **last page of 7,399**, at
~29 jobs/page. That's ~214,000 jobs, not 622. Scraping "all of it" would have
meant hitting a third-party server 200,000+ times.

**Lesson:** before writing a single line of scraping code, sanity-check the
*scope* against what the target site actually contains. A number a user
remembers ("622 jobs") is often a filtered or partial view, not the whole
dataset behind a raw URL. When the two disagree by 300x, that's worth
surfacing before doing any work, not after.

We settled on: scrape the newest 622 listings from the unfiltered feed —
faithful to the original ask, but bounded to a sane, statable number instead
of silently interpreting "all."

## 2. Reading the page before writing any code

Before deciding *how* to scrape, the page was fetched with plain `curl` (no
JavaScript, no login) and inspected by hand:

- The listing page HTML contains a `<script type="application/ld+json">`
  block — [JSON-LD](https://json-ld.org/), a structured-data format sites
  embed for search engines. It listed every job's title, but the company name
  was replaced with the literal string `"[Unlock with Premium]"`.
- Each job's own detail page (`/remote-job/<slug>`) has its *own* JSON-LD
  block, and there the real company name was present — fetched with a plain,
  logged-out request. No login, no paywall bypass, just checking what's
  already public on that specific page.
- The listing page's rendered HTML (not the JSON-LD, the actual card markup)
  turned out to have *more* fields than the JSON-LD: salary, experience
  level, and location badges, each marked with a distinct emoji prefix
  (🌎 location, 💵 salary, ⭐ experience) — reliable to parse regardless of
  which badges are present on a given card.
- `robots.txt` was checked too: it only disallows `/apply/` (the redirect
  used when actually applying), which this script never touches. `/remote-jobs`
  and `/remote-job/` are both allowed.

**Lesson:** *read the raw HTML before choosing a scraping strategy.* A lot of
sites embed clean structured data (JSON-LD, `<script type="application/json">`
blobs, etc.) that's far more reliable to parse than scraping visible text —
but you only find it by looking.

## 3. Two passes, because the data is split across two page types

| Field | Where it lives |
|---|---|
| Title, location, salary, job type, experience, category, skill tags | Listing page (free) |
| Company name, full description | Detail page only (free, but one request per job) |

So the script:

1. Crawls listing pages (`?page=1`, `?page=2`, ...) until it has 622 unique
   job IDs, pulling every field available there.
2. Visits each of those 622 job detail pages once, to fill in company name
   and the full description.

This is why the run takes several minutes: step 2 alone is 622 individual
HTTP requests, each with a small delay between them (see next section).

## 4. Being a polite guest on someone else's server

- A realistic browser `User-Agent` header, so requests don't look like a bot
  probe.
- A `0.4` second delay between every request — 622 rapid-fire requests in a
  few seconds would look like an attack; spread over several minutes it's
  indistinguishable from a slow human clicking around.
- Retries with backoff on network hiccups instead of giving up on the first
  failure.

None of this is about hiding — it's the same "don't hammer a server that
isn't yours" courtesy you'd want extended to your own site.

## 5. Resumability: checkpointing every row as it's scraped

With 622 sequential network requests, *something* eventually goes wrong —
a timeout, a Wi-Fi hiccup, a crash. The script writes each completed job to
`jobs_checkpoint.csv` immediately after scraping it (not batched at the end),
and on startup it loads that file and skips any job ID already present.

This paid off during the actual run: a crash partway through (see next
section) lost zero completed work — re-running the same command picked up
exactly where it left off.

**Lesson:** for any long-running, multi-step job talking to the network,
write progress to disk incrementally. The alternative — holding everything
in memory and writing once at the end — means a crash at 95% loses 100% of
the work.

## 6. Bug #1: Windows console encoding crash

The script died partway through with:

```
UnicodeEncodeError: 'charmap' codec can't encode characters in position 18-25
```

Cause: a job title contained a non-ASCII character (e.g. "Geschäftsführung"),
and the terminal it was printing to defaults to Windows' legacy `cp1252`
encoding, which can't represent most non-English characters.

Fix: force UTF-8 on stdout/stderr at startup —

```python
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")
```

**Lesson:** any script that prints scraped internet text (job titles, names,
descriptions — inherently multilingual) on Windows will eventually hit this.
Setting UTF-8 explicitly at startup is cheap insurance.

## 7. Bug #2: Excel rows blowing out to huge heights

After the first successful run, the spreadsheet looked broken — enormous
gaps between rows. Cause: the "Full Description" column holds the entire job
posting text (avg ~5,000 characters, up to ~13,700), and the cells had
`wrap_text=True` set. Excel auto-expands a wrapped cell's row height to fit
*all* of its text — so a 13,700-character cell became a row tens of lines
tall, and there are 622 rows like that.

Fix: turn wrapping off and give every row a fixed, uniform height (18pt —
one line). The full text is still in the cell (click it and it shows in
Excel's formula bar, or widen/wrap that column yourself if you want to read
one inline) — it just no longer forces the row taller.

**Lesson:** wrap_text + long free-text fields is a common Excel export trap.
Either keep long text unwrapped with a fixed row height (what we did here),
or truncate it in the sheet and link out to the source for the full text.

## 8. Extending this

- Different search/category: `python scrape_dailyremote.py --search "python"`
- More or fewer jobs: `--target 1500`
- Different site entirely: steps 2–4 above (find the structured data, split
  fields across page types, add politeness + checkpointing) generalize to
  almost any job board or listing site.
