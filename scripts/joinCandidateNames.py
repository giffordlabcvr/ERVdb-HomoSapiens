#!/usr/bin/env python3

import csv
import sys

if len(sys.argv) != 4:
    print(
        "Usage: python3 joinCandidateNames.py "
        "erv_locus_candidate.tsv "
        "erv_locus_candidate_names.tsv "
        "output.tsv"
    )
    sys.exit(1)

candidate_file = sys.argv[1]
names_file = sys.argv[2]
output_file = sys.argv[3]


# ------------------------------------------------------------
# Load candidate-name records, indexed by candidate ID.
#
# There may eventually be multiple name records for a candidate,
# so store them as lists rather than assuming one-to-one.
# ------------------------------------------------------------

names_by_candidate = {}

with open(names_file, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f, delimiter="\t")

    for row in reader:
        candidate_id = row["id"]

        if candidate_id not in names_by_candidate:
            names_by_candidate[candidate_id] = []

        names_by_candidate[candidate_id].append(row)


# ------------------------------------------------------------
# Read candidates and write joined output.
# ------------------------------------------------------------

with open(candidate_file, newline="", encoding="utf-8") as infile, \
     open(output_file, "w", newline="", encoding="utf-8") as outfile:

    reader = csv.DictReader(infile, delimiter="\t")

    extra_fields = [
        "missillac_id",
        "locus_number",
        "resolved_lineage_id",
        "raw_name",
        "resolution_status"
    ]

    fieldnames = reader.fieldnames + extra_fields

    writer = csv.DictWriter(
        outfile,
        fieldnames=fieldnames,
        delimiter="\t",
        extrasaction="ignore"
    )

    writer.writeheader()

    for candidate in reader:

        candidate_id = candidate["id"]
        name_records = names_by_candidate.get(candidate_id, [])

        # Collapse multiple associated name records with semicolons.
        for field in extra_fields:
            values = [
                row[field]
                for row in name_records
                if row.get(field) not in (None, "", "-")
            ]

            candidate[field] = ";".join(values) if values else "-"

        writer.writerow(candidate)


print(f"Wrote joined table to {output_file}")
