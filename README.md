# Job Finder — DailyRemote Scraper

Scrapes remote job listings from [dailyremote.com](https://dailyremote.com) and exports them to a clean, formatted Excel workbook (title, company, location, salary, job type, experience level, category, skill tags, dates, full description, and a link back to the posting).

See [LEARNING_NOTES.md](LEARNING_NOTES.md) for a walkthrough of how this was built and why it's put together this way.

## Usage

```bash
pip install requests beautifulsoup4 openpyxl
python scrape_dailyremote.py --target 622
```

Options:

- `--target N` — how many of the newest listings to pull (default 622)
- `--search "keyword"` — filter by a DailyRemote search term
- `--out path.xlsx` — output file path (default `dailyremote_jobs.xlsx`)

The script is resumable: it checkpoints every scraped job to `jobs_checkpoint.csv` as it goes, so if it's interrupted (network error, crash, closed terminal), re-running the same command picks up where it left off instead of starting over.

## Output

`dailyremote_jobs.xlsx` — one row per job, with a bold frozen header row and column filters, ready to sort/filter in Excel or Google Sheets.
