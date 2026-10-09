#!/usr/bin/env python3

import csv
from collections import defaultdict
from pathlib import Path

INPUT = Path("tabular/locus/test/erv_locus_candidate_names.tsv")
OUTPUT = Path("tabular/locus/test/erv_locus_name_mappings.tsv")

names = defaultdict(lambda: {"count": 0, "examples": []})

with INPUT.open(newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f, delimiter="\t")

    for row in reader:
        # Match the eligibility rules of the linking script
        if row["case_status"].strip() != "Fully resolved":
            continue

        if row["makes_mosaic"].strip().lower() in ("true", "yes", "1"):
            continue

        name = row["names_decision"].strip()

        if not name:
            continue

        entry = names[name]
        entry["count"] += 1

        if len(entry["examples"]) < 3:
            entry["examples"].append(row["id"])

OUTPUT.parent.mkdir(parents=True, exist_ok=True)

with OUTPUT.open("w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f, delimiter="\t")

    writer.writerow([
        "source_name",
        "candidate_count",
        "example_locus_ids",
        "erv_lineage_id"
    ])

    for name, entry in sorted(
        names.items(),
        key=lambda item: (-item[1]["count"], item[0])
    ):
        writer.writerow([
            name,
            entry["count"],
            ",".join(entry["examples"]),
            ""
        ])

print(f"Exported {len(names)} unique names to {OUTPUT}")
