"""
Enriches healthjobsuk_merged.json with a best-effort visa-sponsorship read.

There is no structured "sponsorship" field on healthjobsuk.com / trac.jobs --
it only ever shows up as free text buried in a job's full description, worded
differently by every employer (or, most often, not mentioned at all). So this
script visits each job's own detail page via the Firecrawl API (needed
because the site sits behind a Cloudflare challenge a plain request can't
pass), scans the description text for common sponsorship phrasing, and
classifies it as a best-effort read -- not a guaranteed-accurate flag.

Usage:
    python add_sponsorship.py
"""

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
INPUT_JSON = os.path.join(SCRIPT_DIR, "healthjobsuk_merged.json")
CHECKPOINT_CSV = os.path.join(SCRIPT_DIR, "sponsorship_checkpoint.csv")
OUTPUT_JSON = os.path.join(SCRIPT_DIR, "healthjobsuk_merged.json")


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
FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape"
DELAY = 0.5
RETRIES = 3

NO_PATTERNS = [
    r"not\s+(?:a\s+role\s+that\s+\w+\s+)?(?:be\s+)?able\s+to\s+(?:offer\s+)?(?:a\s+[\w\s]{0,20}?\s+)?sponsor",
    r"(?:will\s+not|does\s+not|is\s+not\s+able\s+to|cannot|can't|unable\s+to)\s+(?:offer\s+)?(?:a\s+[\w\s]{0,20}?\s+)?sponsor",
    r"no\s+sponsorship",
    r"not\s+eligible\s+for\s+(?:visa\s+)?sponsorship",
    r"not\s+sponsor\s+this\s+(?:role|post|position|vacancy)",
    r"this\s+(?:role|post|position|vacancy)\s+(?:is\s+)?not\s+(?:eligible\s+for\s+)?sponsor",
    r"unable\s+to\s+offer\s+a\s+certificate\s+of\s+sponsorship",
    r"currently\s+unable\s+to\s+offer\s+(?:a\s+)?(?:certificate\s+of\s+)?sponsorship",
    r"not\s+a\s+role\s+that\s+\w+\s+will\s+offer\s+sponsorship",
]

YES_PATTERNS = [
    r"(?:we\s+)?(?:are\s+able\s+to|can|will|do)\s+(?:offer|provide)\s+(?:visa\s+)?sponsorship",
    r"sponsorship\s+(?:is\s+)?available",
    r"eligible\s+for\s+(?:a\s+)?(?:visa\s+)?sponsorship",
    r"eligible\s+(?:for|under)\s+(?:the\s+)?(?:Health\s+and\s+Care\s+Worker|Skilled\s+Worker)\s+visa",
    r"welcome\s+applications\s+from\s+candidates\s+who\s+require\s+sponsorship",
    r"UKVI\s+approved\s+sponsor",
    r"we\s+(?:are\s+a\s+)?(?:licensed|approved)\s+sponsor",
]

MENTIONED_PATTERN = r"sponsor"

# The "Job summary" table at the top of every detail page runs its labels
# and values together with no separator (e.g. "...GradeNHS AfC: Band
# 2ContractPermanentHoursFull time - 37.5 hours per week Job ref..."), so
# contract hours are pulled with a targeted regex anchored on "Hours" and
# the "X hours per week" pattern that consistently follows it.
HOURS_PATTERN = r"Hours\s*(.*?\d+(?:\.\d+)?\s*hours? per week)"
CERTIFICATE_PATTERN = r"certificate\s+of\s+sponsorship"


def extract_hours(text):
    if not text:
        return ""
    m = re.search(HOURS_PATTERN, text, flags=re.I | re.S)
    return m.group(1).strip() if m else ""


def mentions_certificate_of_sponsorship(text):
    return bool(re.search(CERTIFICATE_PATTERN, text or "", flags=re.I))


def classify_sponsorship(text):
    if not text:
        return "Not mentioned", ""
    lowered = text.lower()
    for pat in NO_PATTERNS:
        m = re.search(pat, lowered)
        if m:
            start = max(0, m.start() - 60)
            end = min(len(text), m.end() + 60)
            return "No", text[start:end].strip().replace("\n", " ")
    for pat in YES_PATTERNS:
        m = re.search(pat, lowered)
        if m:
            start = max(0, m.start() - 60)
            end = min(len(text), m.end() + 60)
            return "Yes", text[start:end].strip().replace("\n", " ")
    if re.search(MENTIONED_PATTERN, lowered):
        idx = lowered.find("sponsor")
        start = max(0, idx - 60)
        end = min(len(text), idx + 100)
        return "Mentioned (unclear)", text[start:end].strip().replace("\n", " ")
    return "Not mentioned", ""


def fetch_markdown(url):
    payload = {
        "url": url,
        "formats": ["markdown"],
        "onlyMainContent": True,
        "proxy": "stealth",
    }
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json",
    }
    for attempt in range(1, RETRIES + 1):
        try:
            resp = requests.post(FIRECRAWL_URL, json=payload, headers=headers, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("success"):
                    return data.get("data", {}).get("markdown", "")
                print(f"  [warn] firecrawl error: {data}", file=sys.stderr)
            else:
                print(f"  [warn] HTTP {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
        except requests.RequestException as exc:
            print(f"  [warn] {exc}", file=sys.stderr)
        time.sleep(1.5 * attempt)
    return None


def load_checkpoint():
    done = {}
    if os.path.exists(CHECKPOINT_CSV):
        with open(CHECKPOINT_CSV, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                done[row["jobDetailUrl"]] = row
    return done


CHECKPOINT_FIELDS = [
    "jobDetailUrl",
    "sponsorship",
    "sponsorship_snippet",
    "hours",
    "certificate_of_sponsorship_mentioned",
]


def append_checkpoint(row, write_header):
    with open(CHECKPOINT_CSV, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CHECKPOINT_FIELDS)
        if write_header:
            writer.writeheader()
        writer.writerow(row)


def main():
    with open(INPUT_JSON, encoding="utf-8") as fh:
        jobs = json.load(fh)

    done = load_checkpoint()
    write_header = not os.path.exists(CHECKPOINT_CSV) or os.path.getsize(CHECKPOINT_CSV) == 0

    total = len(jobs)
    for i, job in enumerate(jobs, start=1):
        url = job["jobDetailUrl"]
        if url in done:
            for field in CHECKPOINT_FIELDS[1:]:
                job[field] = done[url].get(field, "")
            continue

        print(f"[{i}/{total}] {job['title'][:60]!r}")
        markdown = fetch_markdown(url) or ""
        sponsorship, snippet = classify_sponsorship(markdown)
        hours = extract_hours(markdown)
        cert_mentioned = mentions_certificate_of_sponsorship(markdown)
        print(f"  -> {sponsorship}" + (f"  ({snippet})" if snippet else ""))

        row = {
            "jobDetailUrl": url,
            "sponsorship": sponsorship,
            "sponsorship_snippet": snippet,
            "hours": hours,
            "certificate_of_sponsorship_mentioned": cert_mentioned,
        }
        for field in CHECKPOINT_FIELDS[1:]:
            job[field] = row[field]
        append_checkpoint(row, write_header)
        write_header = False
        time.sleep(DELAY)

    with open(OUTPUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(jobs, fh, ensure_ascii=False, indent=2)

    counts = {}
    for job in jobs:
        counts[job["sponsorship"]] = counts.get(job["sponsorship"], 0) + 1
    print("\n== Done ==")
    for k, v in counts.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
