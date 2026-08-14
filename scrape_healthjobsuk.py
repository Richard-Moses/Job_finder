"""
Scrapes job listings from healthjobsuk.com (a Trac.jobs-powered site) via the
Firecrawl API and writes them to healthjobsuk_merged.json (the same file
add_sponsorship.py and export_healthjobsuk_excel.py already work with).

This site sits behind a Cloudflare bot-check that a plain HTTP request can't
pass, so unlike scrape_dailyremote.py this one needs a Firecrawl API key
(set FIRECRAWL_API_KEY in a .env file next to this script, or in the
environment) -- Firecrawl's rendering proxy solves the challenge for us.

Usage:
    python scrape_healthjobsuk.py --target 300
    python scrape_healthjobsuk.py --target 500 --category Nursing_and_Midwifery
"""

import argparse
import csv
import json
import os
import re
import sys
import time

import requests

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_dotenv(path):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


load_dotenv(os.path.join(SCRIPT_DIR, ".env"))

FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY")
if not FIRECRAWL_API_KEY:
    sys.exit("Set FIRECRAWL_API_KEY in JOBFINDER/.env or the environment before running this script.")

FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"
BASE = "https://www.healthjobsuk.com"
CHECKPOINT_CSV = os.path.join(SCRIPT_DIR, "hju_listing_checkpoint.csv")
OUTPUT_JSON = os.path.join(SCRIPT_DIR, "healthjobsuk_merged.json")
DELAY = 0.5
RETRIES = 3
FIELDNAMES = ["title", "grade", "employer", "location", "speciality", "salary", "jobDetailUrl"]

EXTRACTION_PROMPT = (
    "Extract every job vacancy card in the numbered list (not the 'Featured "
    "jobs' section at the bottom). For each: title, grade (the band/grade "
    "text, may be empty), employer, location, speciality, salary, and the "
    "job detail url."
)


def firecrawl_json_scrape(url):
    payload = {
        "url": url,
        "formats": ["json"],
        "onlyMainContent": True,
        "proxy": "stealth",
        "jsonOptions": {"prompt": EXTRACTION_PROMPT},
    }
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json",
    }
    for attempt in range(1, RETRIES + 1):
        try:
            resp = requests.post(FIRECRAWL_SCRAPE_URL, json=payload, headers=headers, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("success"):
                    return data.get("data", {}).get("json", {}).get("jobVacancies", [])
                print(f"  [warn] firecrawl error: {data}", file=sys.stderr)
            else:
                print(f"  [warn] HTTP {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
        except requests.RequestException as exc:
            print(f"  [warn] {exc}", file=sys.stderr)
        time.sleep(2 * attempt)
    return None


def listing_url(category, sector, page):
    if page == 1:
        return f"{BASE}/job_list/{category}/{sector}?_ts=1"
    return f"{BASE}/job_list/{category}/{sector}?_ts=1&_pg={page}&_pgid="


def load_checkpoint():
    seen = set()
    rows = []
    if os.path.exists(CHECKPOINT_CSV):
        with open(CHECKPOINT_CSV, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if row["jobDetailUrl"] not in seen:
                    seen.add(row["jobDetailUrl"])
                    rows.append(row)
    return rows, seen


def append_checkpoint(row, write_header):
    with open(CHECKPOINT_CSV, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDNAMES)
        if write_header:
            writer.writeheader()
        writer.writerow(row)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=300, help="number of jobs to collect")
    parser.add_argument("--category", default="Nursing_and_Midwifery")
    parser.add_argument("--sector", default="s1")
    parser.add_argument("--max-pages", type=int, default=60)
    args = parser.parse_args()

    jobs, seen_urls = load_checkpoint()
    write_header = not os.path.exists(CHECKPOINT_CSV) or os.path.getsize(CHECKPOINT_CSV) == 0
    print(f"== Resuming with {len(jobs)} jobs already checkpointed ==")

    page = 1
    while len(jobs) < args.target and page <= args.max_pages:
        url = listing_url(args.category, args.sector, page)
        print(f"[listing] page {page} -> {url}")
        vacancies = firecrawl_json_scrape(url)
        if vacancies is None:
            print(f"  [error] could not fetch page {page}, stopping")
            break
        if not vacancies:
            print("  [info] no more job cards found, stopping")
            break

        new_count = 0
        for job in vacancies:
            url_ = job.get("jobDetailUrl", "")
            if not url_ or url_ in seen_urls:
                continue
            seen_urls.add(url_)
            row = {k: job.get(k, "") for k in FIELDNAMES}
            jobs.append(row)
            append_checkpoint(row, write_header)
            write_header = False
            new_count += 1
        print(f"  [info] +{new_count} new jobs (total {len(jobs)})")
        page += 1
        time.sleep(DELAY)

    jobs = jobs[: args.target]
    with open(OUTPUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(jobs, fh, ensure_ascii=False, indent=2)
    print(f"== Done: {len(jobs)} jobs written to {OUTPUT_JSON} ==")


if __name__ == "__main__":
    main()
