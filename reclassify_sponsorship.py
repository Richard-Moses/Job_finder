"""Re-runs the (now improved) sponsorship regex against the snippets already
saved in the checkpoint, without re-fetching anything. Only rows currently
classified as 'Mentioned (unclear)' are worth re-checking (a 'Not mentioned'
row has no snippet to re-check, and 'Yes'/'No' were already confident)."""
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_sponsorship import classify_sponsorship, CHECKPOINT_CSV, OUTPUT_JSON

with open(CHECKPOINT_CSV, newline="", encoding="utf-8") as fh:
    rows = list(csv.DictReader(fh))

changed = 0
for row in rows:
    if row["sponsorship"] == "Mentioned (unclear)" and row["sponsorship_snippet"]:
        new_class, new_snippet = classify_sponsorship(row["sponsorship_snippet"])
        if new_class != "Mentioned (unclear)" and new_class != "Not mentioned":
            row["sponsorship"] = new_class
            row["sponsorship_snippet"] = new_snippet or row["sponsorship_snippet"]
            changed += 1

with open(CHECKPOINT_CSV, "w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["jobDetailUrl", "sponsorship", "sponsorship_snippet"])
    writer.writeheader()
    writer.writerows(rows)

by_url = {r["jobDetailUrl"]: r for r in rows}
with open(OUTPUT_JSON, encoding="utf-8") as fh:
    jobs = json.load(fh)
for job in jobs:
    r = by_url.get(job["jobDetailUrl"])
    if r:
        job["sponsorship"] = r["sponsorship"]
        job["sponsorship_snippet"] = r["sponsorship_snippet"]
with open(OUTPUT_JSON, "w", encoding="utf-8") as fh:
    json.dump(jobs, fh, ensure_ascii=False, indent=2)

counts = {}
for r in rows:
    counts[r["sponsorship"]] = counts.get(r["sponsorship"], 0) + 1

print(f"Reclassified {changed} rows from snippets alone.")
for k, v in counts.items():
    print(f"  {k}: {v}")
