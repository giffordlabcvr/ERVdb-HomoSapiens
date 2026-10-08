#!/usr/bin/env python3

import argparse
import csv


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Convert a four-column HERV-quant BED file to the TSV format "
            "expected by legacyLocusImporter."
        )
    )
    parser.add_argument(
        "input",
        help="Input HERV-quant BED file"
    )
    parser.add_argument(
        "output",
        help="Output TSV file"
    )

    args = parser.parse_args()

    count = 0

    with open(args.input, "r", newline="") as infile, \
            open(args.output, "w", newline="") as outfile:

        writer = csv.writer(outfile, delimiter="\t")

        writer.writerow([
            "chrom",
            "start",
            "end",
            "legacy_name"
        ])

        for line_number, line in enumerate(infile, start=1):

            line = line.strip()

            # Ignore blank lines and comments.
            if not line or line.startswith("#"):
                continue

            fields = line.split("\t")

            if len(fields) < 4:
                raise ValueError(
                    f"Line {line_number}: expected at least 4 BED columns, "
                    f"found {len(fields)}"
                )

            chrom = fields[0]
            bed_start = int(fields[1])
            bed_end = int(fields[2])
            legacy_name = fields[3]

            if bed_start < 0:
                raise ValueError(
                    f"Line {line_number}: BED start is negative: {bed_start}"
                )

            if bed_end <= bed_start:
                raise ValueError(
                    f"Line {line_number}: invalid BED interval "
                    f"{chrom}:{bed_start}-{bed_end}"
                )

            if not legacy_name:
                raise ValueError(
                    f"Line {line_number}: missing HERV-quant identifier"
                )

            # BED coordinates are 0-based, half-open:
            #
            #     [bed_start, bed_end)
            #
            # ERVdb coordinates are 1-based, inclusive:
            #
            #     [start, end]
            #
            # Therefore only the start coordinate changes.
            start = bed_start + 1
            end = bed_end

            writer.writerow([
                chrom,
                start,
                end,
                legacy_name
            ])

            count += 1

    print(f"Wrote {count} HERV-quant loci to {args.output}")


if __name__ == "__main__":
    main()