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

---

# Part 2: Turning it into a hosted, multi-user web app

The project didn't stop at one script. It grew a desktop GUI
(`jobfinder_gui.py`), a second scraper for healthjobsuk.com, a
visa-sponsorship classifier, a generic "paste any URL" scraper — and then,
at the request "make me an admin dashboard with OAuth," a full pivot into a
hosted web app several people can log into. That last step is where most of
the interesting decisions (and bugs) were.

## 9. "Admin dashboard with OAuth" wasn't actually the requirement

The literal request was OAuth and an admin dashboard. But OAuth exists to
verify *who someone is across a network* — it protects nothing on a
single-user desktop app that only the one person using the machine can even
open. Building it anyway would have meant solving a problem that didn't
exist yet, while missing whatever the *real* need was.

So before writing any code, the questions were: who else actually needs to
use this, where does it need to run, does everyone need the same access
level, which login provider. The answers reshaped the ask entirely — a
small trusted group of family/friends, hosted for free, everyone equal
access, Google sign-in. "Admin dashboard" turned out to mean "a
professional-looking hosted dashboard," not literal admin/user role
separation.

**Lesson:** a feature request phrased in technical terms ("add OAuth", "add
caching", "add a queue") is often standing in for a plainer need the
requester hasn't fully articulated yet. Ask what problem it's solving before
building the technical thing by name.

## 10. The hosting platform picked determined the whole architecture

The first plan (Flask + subprocess workers + Server-Sent Events + a small
paid host like Render) was sound — for a platform that runs long-lived
server processes. The user wanted free hosting via Netlify specifically.
Netlify only runs short-lived serverless functions (~10-26 second execution
limit) and static files. That's not a pricing-tier limitation to negotiate
around — a scrape that takes minutes structurally cannot run inside one
Netlify function call, at any price.

The fix was to stop trying to fit the old design onto the new platform and
instead design *for* what Netlify actually does well: the **browser drives
the scrape**, calling one small serverless function per page/job (each call
is one HTTP or Firecrawl request — a few seconds), accumulating results in
memory client-side, and building the Excel file **in the browser** with a
JS library when done. No server-side job queue, no database, no persistent
disk — the trade-off is no shared history across browser sessions, which
was fine for this project's scale.

**Lesson:** a hosting platform isn't a neutral place to put an
architecture — its constraints (execution time limits, statelessness,
storage model) should shape the design, not get discovered as blockers
after the design is already fixed. Ask "what does this platform actually
run well?" before picking one, or be ready to redesign once you learn.

## 11. Porting the same logic from Python to JavaScript

Netlify Functions run Node.js, not Python, so the scraping logic was
re-implemented in JavaScript rather than just redeployed:

- `BeautifulSoup` → `cheerio` (a near 1:1 jQuery-style API for parsing HTML
  server-side in Node — the CSS selectors barely changed).
- `openpyxl` → `ExcelJS`, chosen specifically over the more popular
  `xlsx`/SheetJS package because SheetJS's free tier has weak cell-styling
  support, and this project already depends on real styling (bold header
  fill, frozen panes, hyperlinks, and critically the fixed-row-height fix
  from Bug #2 above) — a library swap that *looked* equivalent on paper
  would have silently dropped formatting quality.
- Regex patterns (the sponsorship-language classifier, the emoji-prefixed
  badge parsing) were ported **verbatim**, character for character, rather
  than "improved while I'm at it" — keeping the ported version's behavior
  identical to the tested original was the goal, not a rewrite.

**Lesson:** when porting logic between languages, preserve behavior
first, improve second — and pick each replacement library on the specific
feature you actually rely on (styling fidelity, here), not general
popularity.

## 12. Auth for a stateless app: JWT cookies, and a two-lists gotcha

Serverless functions don't share memory between requests, so there's no
server-side session store to check against (no Flask `session`
equivalent). Identity instead lives in a **signed, httpOnly JWT cookie**,
verified fresh on every request — the function never "remembers" a login,
it re-proves the cookie is valid and re-checks the email every single time.

The easy mistake to make here: assuming Google's OAuth consent-screen
**"Test users"** list *is* your access control. It isn't — it only governs
who can reach Google's consent screen while an app is unverified, caps at
100 users, and stops being enforced at all if the app is ever published.
The real gate is `ALLOWED_EMAILS`, checked in application code on every
request. Both lists have to be kept in sync by hand; forgetting one after
adding an 11th friend produces a confusing Google-side error before the
app's own clearer error message is ever reached.

**Lesson:** a third-party platform's own access list (Google's test users,
a cloud provider's IAM group, etc.) is rarely a substitute for your
application checking authorization itself — treat it as an outer,
best-effort gate, not the real one.

## 13. Bug found by testing, not by reading the code back: a false-positive classifier

The sponsorship classifier (regex patterns matching phrases like "we offer
visa sponsorship" or "unable to sponsor") was ported verbatim from the
already-shipped Python version. Live-testing the ported JS function against
a real job page — not just reading the code — surfaced a real bug: a job
that explicitly said *"this is **not** a role that MFT **will offer**
sponsorship for"* (i.e. **No**) got classified **Yes**, because a
loosely-written YES pattern matched the substring "will offer sponsorship"
without checking whether a negation like "not...that" appeared just before
it. That's worse than the classifier's known "unclear" bucket — it's
confidently wrong, not honestly uncertain.

Since the regex had been ported unchanged, this exact bug was already
present in the original Python script too — the port didn't introduce it,
testing just *found* it. Fixed in both files, so the two stayed in parity.

**Lesson:** porting code faithfully is about preserving *intended*
behavior, not literally freezing bugs in place. Live-testing a port against
real inputs (not just diffing it against the source) is what catches this
kind of thing — a code review alone would likely have waved this regex
through, since it reads as reasonable at a glance.

## 14. Bug found by testing: a platform-limit collision

A live test of the HealthJobsUK function returned a Firecrawl timeout
error. Firecrawl's stealth-proxy rendering (needed to get past a
Cloudflare bot-check) can occasionally take 20-30+ seconds — longer than a
single Netlify function is allowed to run, even on paid tiers (~26s cap).
Retrying *inside* that same function call would only risk hitting the exact
same wall a second time. The fix instead retries from the **browser**: each
retry is a brand-new function invocation with its own fresh time budget,
which is the only place in this architecture where a retry is actually
safe.

**Lesson:** where you put retry logic matters as much as having it. A retry
loop inside a resource that itself has a hard time limit doesn't add
resilience — it just delays the same failure. Retry at the layer *outside*
the constrained resource.

## 15. Debugging a production deploy without needing the user's browser

Two real deployment issues came up — a Google OAuth `redirect_uri_mismatch`
error, and a dashboard KPI silently showing `--` instead of a number. Both
were diagnosed the same way: instead of asking "what does your browser
show," the exact HTTP request in question was reproduced directly with
`curl`.

- For the redirect mismatch: the function's own redirect `Location` header
  was fetched directly, decoded, and compared byte-for-byte against what
  was registered in Google Cloud Console — which showed the value being
  *sent* was already correct, narrowing the problem down to "not yet
  registered on Google's side" rather than a code bug.
- For the missing KPI: the protected endpoint was called once
  unauthenticated (confirming the function was deployed and responding,
  not crashing) and once with a **hand-crafted JWT**, signed locally with
  the same `JWT_SECRET` value that had been pasted into the production
  environment — simulating a fully logged-in request without touching a
  browser at all. That isolated the failure to one specific missing
  environment variable (`FIRECRAWL_API_KEY` hadn't survived a bulk
  `.env`-paste import) in about two commands.

**Lesson:** most "it's broken in production" reports can be reproduced
directly against the deployed URL with `curl`, often faster and more
precisely than walking someone through their own browser's dev tools. If
you know the signing secret, you can even simulate "as a logged-in user"
requests yourself — a fast way to separate "auth is broken" from
"something downstream of auth is broken."

## 16. What was deliberately left out

Matched to "a handful of trusted family and friends," not scaled up
speculatively:

- No database, no server-side run history — every scrape session lives and
  dies with the browser tab.
- No per-user rate limits or Firecrawl credit quotas — one shared pool,
  visible on the dashboard so it's not a silent surprise, trusted to a
  small group rather than engineered around.
- No role-based permissions — every allowlisted email has identical access.
- No automated test suite — the live-testing done during the build (Bugs
  #13 and #14 above) stood in for it at this stage.

None of these are hard to add later if the audience or usage pattern
changes — they just weren't worth building for a problem that doesn't
exist yet.

---

# Part 3: What broke after going live (and what that teaches)

Everything in Part 2 was verified before shipping — live-tested against
real sites, real bugs found and fixed. It still wasn't enough. A few more
things only showed up once an actual person, on an actual phone, started
actually using the deployed app. That gap is worth its own notes.

## 17. A bug only a real user could find: dailyremote.com blocking Netlify's IP

DailyRemote's scraper was live-tested extensively before shipping — and it
worked. It broke the first time it was clicked from the actual deployed
site. The difference wasn't the code, it was *where the request came
from*: local testing (even calling the deployed function's own code
directly) still ran from a home internet connection. Once real traffic hit
the function running on Netlify's actual infrastructure, dailyremote.com
started returning 403 — it blocks requests from datacenter/cloud IP
ranges, a common anti-bot measure that has nothing to do with the request's
content or headers.

**Lesson:** testing a serverless function by importing and calling its
handler locally verifies the *logic*, not the *environment* it will
actually run in. Some classes of bug (IP-based blocking, geographic
restrictions, egress firewall rules) only exist at the network layer and
are invisible until traffic actually originates from the real deployment
target.

The fix — routing the fetch through Firecrawl's cheap "basic" proxy tier
instead of a direct request — also had a side effect worth noting: it
silently turned DailyRemote from "free" into "costs ~1 credit/page." A
constraint discovered after shipping changed the cost model, not just the
code, and the UI's own cost messaging had to be corrected to match reality.

## 18. Renaming a live service is not one edit, it's three systems

A QR code pointing at the app's default `netlify.app` URL got flagged as a
"dangerous site" by a phone's security scanner. Cause: auto-generated
Netlify subdomains (random word pairs + a hash) look exactly like the
throwaway URLs phishing sites use on free hosting — some scanners flag
that *pattern* by itself, regardless of actual content. The fix — renaming
the project to something clear and readable — should have been a single
settings change. It touched three separate systems instead, each of which
failed independently before the whole thing worked again:

1. **The host's own DNS.** The instant the project was renamed, the old
   `netlify.app` URL stopped resolving (404) — no grace period.
2. **A third party's whitelist.** Google's OAuth "authorized redirect
   URIs" list rejected the *entire save* with a vague "domains don't
   comply" error — not because the *new* URL was wrong, but because two
   *other*, unrelated entries already in that list (the just-killed old
   URL, and an earlier placeholder that was never a real site) had gone
   dead, and Google's validation apparently checks that every listed
   domain is live. One stale entry blocked saving a good one.
3. **The app's own cached copy of its address.** Even after fixing the
   redirect URI list, the app kept generating login links to the *old*
   domain. Netlify auto-injects a `URL` environment variable with the
   site's own address — but it's set at *build* time, not read fresh per
   request. The rename didn't take effect inside the running app until a
   new deploy rebuilt it with the current value.

**Lesson:** "just rename it" actions are deceptive precisely because the
one thing you changed is rarely the only thing that referenced the old
value. Look for: things that cache their own identity (env vars baked in
at build time), external allowlists that don't get cleaned up as old
values die, and stale entries sitting unnoticed until an unrelated change
suddenly makes them load-bearing.

## 19. Firecrawl credits are account-level, not key-level

Rotating to a dedicated, individually-revocable API key (a security
practice — see Part 2's mention of the key having been pasted into chat
plaintext) did not reset or add to the credit balance. All keys under one
Firecrawl account draw from the same monthly pool; a key is a *credential*,
not a *quota*. Easy to assume otherwise for any API structured this way
(common pattern: named/scoped keys that are all just doors into one
underlying billing plan), and worth checking explicitly before relying on
"get a new key" as a way to get more usage.

## 20. Where this all lives

- **Code + all commit history:** github.com/Richard-Moses/Job_finder
  (public repo)
- **This file:** `LEARNING_NOTES.md`, same repo, tracks the project start
  to now across all three parts above
- **Live app:** the URL currently in `README.md`'s "Web app" section (kept
  current there rather than duplicated here, since it can change — see
  Part 3, #18, for exactly how disruptive an address change turned out to
  be)
