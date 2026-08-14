# Job Finder

Scrapes job listings (dailyremote.com, healthjobsuk.com, or any arbitrary URL via Firecrawl) into clean, formatted Excel workbooks. Two ways to use it:

1. **Desktop tool** (Python, local, single-user) — CLI scripts plus a CustomTkinter GUI (`Run JobFinder.bat`). See below.
2. **Hosted dashboard** (JavaScript, Netlify, multi-user) — a small web app with Google sign-in for a handful of trusted people to run the same scrapers from a browser. See [Web app](#web-app) below.

See [LEARNING_NOTES.md](LEARNING_NOTES.md) for a walkthrough of how the desktop tool was built and why it's put together this way.

## Desktop tool: usage

```bash
pip install requests beautifulsoup4 openpyxl
python scrape_dailyremote.py --target 622
```

Options:

- `--target N` — how many of the newest listings to pull (default 622)
- `--search "keyword"` — filter by a DailyRemote search term
- `--out path.xlsx` — output file path (default `dailyremote_jobs.xlsx`)

The script is resumable: it checkpoints every scraped job to `jobs_checkpoint.csv` as it goes, so if it's interrupted (network error, crash, closed terminal), re-running the same command picks up where it left off instead of starting over.

### Output

`dailyremote_jobs.xlsx` — one row per job, with a bold frozen header row and column filters, ready to sort/filter in Excel or Google Sheets.

There's also a desktop GUI wrapping all the scripts (DailyRemote, HealthJobsUK, Sponsorship, Custom URL) behind buttons — double-click `Run JobFinder.bat`, or `python jobfinder_gui.py`.

## Web app

A stateless, serverless version of the same scrapers, hosted free on Netlify, gated behind Google sign-in restricted to specific email addresses (`ALLOWED_EMAILS`). Architecture note: Netlify only runs short-lived functions (~10-26s), so unlike the desktop tool there's no long background job — **the browser itself drives the scrape**, calling one function per page/job and building the Excel file client-side (ExcelJS) when done. This also means results aren't saved server-side: closing the tab mid-scrape loses that run's progress, and there's no shared history across sessions. That trade-off is intentional for a small trusted-user tool, not an oversight.

### Local development

```bash
npm install
cp .env.example .env   # fill in FIRECRAWL_API_KEY, GOOGLE_CLIENT_ID/SECRET, JWT_SECRET, ALLOWED_EMAILS
npm run dev             # netlify dev, serves the site + functions at http://localhost:8888
```

Google Cloud Console setup (OAuth consent screen, Web application credential, redirect URIs) is documented in `.env.example`.

### Deploying

Push to GitHub, connect the repo in Netlify (auto-detects `netlify.toml`), and set the same env vars in Site settings → Environment variables (production redirect URI becomes `https://<your-site>.netlify.app/auth/callback` — add it in Google Cloud Console too).

### What's shared vs. per-person

Everyone signed in shares the same Firecrawl credit pool — there's no per-user quota (deliberately, for a small trusted group). The Overview page shows the live remaining-credit balance so it stays visible rather than a surprise.
