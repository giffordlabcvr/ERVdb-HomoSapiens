#!/usr/bin/env python3

"""
csvToBed.py

Convert ERV locus coordinates from CSV to BED4
for UCSC liftOver (hg38 -> hg19).

Usage:
    python3 csvToBed.py erv_loci_hg38.csv

Output:
    erv_loci_hg38.bed

BED fields:
    chromosome
    start (0-based)
    end (half-open)
    locus ID

Assumption:
    CSV coordinates are 1-based inclusive.
"""

import csv
import sys
from pathlib import Path


def main():

    if len(sys.argv) != 2:
        sys.exit(
            "Usage: python3 csvToBed.py <input.csv>"
        )

    input_path = Path(sys.argv[1])

    if not input_path.exists():
        sys.exit(f"ERROR: File not found: {input_path}")

    output_path = input_path.with_suffix(".bed")

    processed = 0
    skipped = 0

    with open(input_path, newline="") as infile, \
         open(output_path, "w") as outfile:

        reader = csv.DictReader(infile)

        required_fields = {
            "id",
            "sequence",
            "sequenceBegin",
            "sequenceEnd"
        }

        missing = required_fields - set(reader.fieldnames or [])

        if missing:
            sys.exit(
                f"ERROR: Missing CSV columns: {sorted(missing)}"
            )

        for line_number, row in enumerate(reader, start=2):

            try:
                locus_id = row["id"]
                chrom = row["sequence"]
                start = int(row["sequenceBegin"])
                end = int(row["sequenceEnd"])

                if not locus_id or not chrom:
                    raise ValueError("Missing locus ID or chromosome")

                if start < 1 or end < start:
                    raise ValueError("Invalid coordinates")

                # Convert 1-based inclusive to
                # 0-based half-open BED coordinates.
                bed_start = start - 1
                bed_end = end

                outfile.write(
                    f"{chrom}\t"
                    f"{bed_start}\t"
                    f"{bed_end}\t"
                    f"{locus_id}\n"
                )

                processed += 1

            except (ValueError, TypeError) as error:

                print(
                    f"WARNING: Skipping CSV line "
                    f"{line_number}: {error}",
                    file=sys.stderr
                )

                skipped += 1

    print(f"Input:     {input_path}")
    print(f"Output:    {output_path}")
    print(f"Converted: {processed}")
    print(f"Skipped:   {skipped}")


if __name__ == "__main__":
    main()