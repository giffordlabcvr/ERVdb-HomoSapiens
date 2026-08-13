#!/usr/bin/env python3

import csv
import sys

if len(sys.argv) != 3:
    print("Usage: python3 makeSeanLociTable.py joined.tsv output.tsv")
    sys.exit(1)

input_file = sys.argv[1]
output_file = sys.argv[2]

output_fields = [
    "RBRT_ID",
    "Missillac_ID",
    "Lineage_ID",
    "Chromosome",
    "Start",
    "End",
    "Strand",
    "Length",
    "Category",
    "Taxonomic_Resolution",
    "Case_Status",
    "Supporting_Datasets",
    "DIGS_IDs",
    "Repbase_IDs",
    "Retrotector_IDs",
    "Clade",
    "Group",
    "Subgroup",
    "Host_Species",
    "Genome_Build"
]


def clean(value):
    if value is None:
        return ""
    value = value.strip()
    if value in ("-", "NA"):
        return ""
    return value


def unique_value(value):
    """
    Collapse values such as:
        Clade I,Clade I,Clade I
    to:
        Clade I

    If there is more than one distinct value, return blank.
    """
    values = [
        clean(x)
        for x in value.split(",")
        if clean(x)
    ]

    unique = list(dict.fromkeys(values))

    if len(unique) == 1:
        return unique[0]

    return ""


with open(input_file, newline="", encoding="utf-8") as infile, \
     open(output_file, "w", newline="", encoding="utf-8") as outfile:

    reader = csv.DictReader(infile, delimiter="\t")

    writer = csv.DictWriter(
        outfile,
        fieldnames=output_fields,
        delimiter="\t"
    )

    writer.writeheader()

    for row in reader:

        case_status = clean(row["case_status"])

        clade = ""
        group = ""
        subgroup = ""

        # ------------------------------------------------------
        # Populate taxonomy only down to the resolved level.
        # ------------------------------------------------------

        if case_status == "Fully resolved":

            clade = unique_value(row["clade_out"])
            group = unique_value(row["group_out"])
            subgroup = unique_value(row["subgroup_out"])

        elif "subgenus level" in case_status.lower():

            clade = unique_value(row["clade_out"])
            group = unique_value(row["group_out"])
            subgroup = unique_value(row["subgroup_out"])

        elif "genus level" in case_status.lower():

            clade = unique_value(row["clade_out"])
            group = unique_value(row["group_out"])

        elif "group level" in case_status.lower():

            clade = unique_value(row["clade_out"])
            group = unique_value(row["group_out"])

        elif "clade level" in case_status.lower():

            clade = unique_value(row["clade_out"])


        output_row = {
            "RBRT_ID": clean(row["id"]),
            "Missillac_ID": clean(row["missillac_id"]),
            "Lineage_ID": clean(row["resolved_lineage_id"]),
            "Chromosome": clean(row["chrom"]),
            "Start": clean(row["start_position"]),
            "End": clean(row["end_position"]),
            "Strand": row["strand"].strip() if row["strand"] else "",
            "Length": clean(row["length"]),
            "Category": clean(row["status"]),
            "Taxonomic_Resolution": clean(row["names_decision"]),
            "Case_Status": case_status,
            "Supporting_Datasets": "",
            "DIGS_IDs": clean(row["digs_ids"]),
            "Repbase_IDs": clean(row["repbase_ids"]),
            "Retrotector_IDs": clean(row["retrotector_ids"]),
            "Clade": clade,
            "Group": group,
            "Subgroup": subgroup,
            "Host_Species": "Homo sapiens",
            "Genome_Build": "hg19"
        }

        writer.writerow(output_row)

print(f"Wrote: {output_file}")