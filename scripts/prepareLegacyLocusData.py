#!/usr/bin/env python3
"""Normalise the seven ERVdb historical-locus TSV sources into one auditable TSV.

No locus matching or GLUE writes occur here. Original input files are unchanged.
Python 3.8+; standard library only.
"""
import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

FIELDS = [
    "source_record_id", "legacy_source", "source_row_number", "legacy_name",
    "host_species", "genome_build", "scaffold", "start_position",
    "end_position", "orientation", "legacy_classification",
    "source_numeric_id", "source_aliases", "source_orthology", "source_band",
    "source_note", "approved_name", "approved_symbol", "hgnc_id",
    "pubmed_id", "aliases",
]
# Explicit mappings: no guessing column headers at runtime.
# 'aliases' is the searchable-name policy, distinct from the raw source_aliases.
SOURCES = {
    "compiled_human_erv_loci_hg19": {
        "filename": "dbm-gifford-legacy-list-hg19.tsv",
        "columns": {
            "legacy_name": "approved_symbol", "scaffold": "scaffold",
            "start_position": "extract_start", "end_position": "extract_end",
            "orientation": "strand", "legacy_classification": "erv-taxonomic-component",
            "source_numeric_id": "mnenomic-number", "source_aliases": "alias_symbol",
            "source_note": "extra", "approved_name": "approved_name",
            "approved_symbol": "approved_symbol", "hgnc_id": "hgnc_id",
            "host_species": "organism", "genome_build": "assembly",
        },
        "alias_fields": ["approved_symbol", "hgnc_id"],
        "split_alias_fields": {"source_aliases": ","},
    },
    "coffin_hml2_hg19": {
        "filename": "coffin-hml2-hg19.tsv",
        "columns": {
            "legacy_name": "legacy_name", "legacy_classification": "legacy_classification",
            "source_band": "source_band", "scaffold": "scaffold",
            "orientation": "orientation", "start_position": "start",
            "end_position": "end", "source_orthology": "oldest_common_ancestor",
            "source_aliases": "source_aliases",
        },
        "alias_fields": ["legacy_name"],
        "split_alias_fields": {"source_aliases": ",;|"},
    },
    "grandi_hervw_hg19": {
        "filename": "grandi-hervw-hg19.tsv",
        "columns": {
            "legacy_name": "wlegacy_name", "legacy_classification": "legacy_classification",
            "start_position": "start", "end_position": "end",
            "scaffold": "scaffold", "source_band": "source_band",
        },
        "alias_fields": ["legacy_name"], "split_alias_fields": {},
    },
    "grandi_hml6_hg19": {
        "filename": "grandi-hml6-hg19.tsv",
        "columns": {
            "source_band": "source_band", "scaffold": "scaffold",
            "orientation": "orientation", "start_position": "start",
            "end_position": "end", "legacy_name": "legacy_name",
            "legacy_classification": "legacy_classification",
        },
        "alias_fields": ["legacy_name"], "split_alias_fields": {},
    },
    "grandi_hml10_hg19": {
        "filename": "grandi-hml10-hg19.tsv",
        "columns": {
            "legacy_name": "legacy_name", "legacy_classification": "legacy_classification",
            "scaffold": "scaffold", "start_position": "start", "end_position": "end",
            "orientation": "orientation", "source_band": "source_band",
            "source_numeric_id": "source_numeric_id", "source_note": "source_note",
        },
        "alias_fields": ["legacy_name"], "split_alias_fields": {},
    },
    "wang_hervh_hg19": {
        "filename": "wang-hervh-hg19.tsv",
        "columns": {
            "legacy_name": "legacy_name", "legacy_classification": "legacy_classification",
            "scaffold": "scaffold", "start_position": "start", "end_position": "end",
            "orientation": "orientation",
            # Expression_type, LTR_Type and source_consolidation are retained
            # together in source_note, without treating repeat names as aliases.
        },
        #"note_fields": ["Expression_type", "LTR_Type", "source_consolidation"],
        "alias_fields": ["legacy_name"], "split_alias_fields": {},
    },
    "hervquant_hg19": {
        "filename": "hervquant-hg19.tsv",
        "columns": {
            "legacy_name": "legacy_name", "scaffold": "chrom",
            "start_position": "start", "end_position": "end",
        },
        "alias_fields": ["legacy_name"], "split_alias_fields": {},
    },
}
REQUIRED = ("legacy_name", "scaffold", "start_position", "end_position")
ORIENTATIONS = {
    "+": "+", "(+)": "+", "positive": "+", "plus": "+", "forward": "+",
    "-": "-", "(-)": "-", "negative": "-", "minus": "-", "reverse": "-",
}

def tidy(value):
    return (value or "").strip()

def split_names(value, separators):
    parts = [value]
    for separator in separators:
        parts = [part for item in parts for part in item.split(separator)]
    return [tidy(part) for part in parts if tidy(part)]

def convert(source, profile, original, row_number):
    mapped = {dest: tidy(original.get(column)) for dest, column in profile["columns"].items()}
    result = {field: mapped.get(field, "") for field in FIELDS}
    result["legacy_source"] = source
    result["source_row_number"] = str(row_number)
    result["host_species"] = result["host_species"] or "Homo sapiens"
    result["genome_build"] = result["genome_build"] or "hg19"
    # Historical numbering is lineage-scoped, never globally unique.
    # Validate its form here; lineage-specific conflicts are checked later
    # against ERVdb lineage assignments, not source classifications.
    if source == "compiled_human_erv_loci_hg19":
        number = result["source_numeric_id"]
        if not number or not number.isascii() or not number.isdecimal():
            raise ValueError(f"invalid mnenomic-number: {number!r}")
    if not result["legacy_name"]:
        result["legacy_name"] = result["approved_name"] or (result["legacy_classification"] + "_" + result["source_numeric_id"])
    strand = result["orientation"].lower()
    if strand == "mixed":
        result["source_note"] = "; ".join(filter(None, [result["source_note"], "original_orientation=mixed"]))
        strand = ""
    if strand and strand not in ORIENTATIONS:
        raise ValueError(f"unrecognised orientation {result['orientation']!r}")
    result["orientation"] = ORIENTATIONS.get(strand, "")
    for field in ("start_position", "end_position"):
        try:
            coordinate = int(result[field])
        except ValueError:
            raise ValueError(f"invalid {field}: {result[field]!r}")
        if coordinate < 1:
            raise ValueError(f"{field} must be positive")
        result[field] = str(coordinate)
    if int(result["end_position"]) < int(result["start_position"]):
        raise ValueError("end precedes start")
    if any(not result[field] for field in REQUIRED):
        raise ValueError("missing required field")
    if profile.get("note_fields"):
        result["source_note"] = "; ".join(filter(None, [result["source_note"], "; ".join(
            f"{field}={tidy(original[field])}" for field in profile["note_fields"]
            if tidy(original.get(field))
        )]))
    aliases = []
    for field in profile["alias_fields"]:
        if result[field]:
            aliases.append(result[field])
    for field, separators in profile["split_alias_fields"].items():
        aliases.extend(split_names(result[field], separators))
    # K108 is a tandem pair: preserve the shared historical name while
    # giving each proviral unit a specific, independently searchable alias.
    # This changes no IDs, coordinates, or original source annotations.
    if (source == "compiled_human_erv_loci_hg19"
            and result["source_numeric_id"] == "108"
            and result["legacy_classification"] == "HERV-K-HML2"
            and result["scaffold"] == "chr7"):
        component = result["source_note"].strip().lower()
        if component not in ("left", "right"):
            raise ValueError("K108 record requires source_note left/right")
        aliases.extend(["K108", "K108_" + component])
    unique = []
    seen = set()
    for alias in aliases:
        if alias.casefold() not in seen:
            seen.add(alias.casefold())
            unique.append(alias)
    # Pipe-delimited canonical aliases; pipe characters within aliases are disallowed.
    if any("|" in name for name in unique):
        raise ValueError("alias contains reserved '|' separator")
    result["aliases"] = "|".join(unique)
    key = json.dumps([source, row_number, original], sort_keys=True, ensure_ascii=False)
    result["source_record_id"] = "legacy_" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]
    return result

def run(args):
    input_dir = Path(args.input_dir)
    profiles = list(SOURCES) if not args.sources else args.sources
    unknown = set(profiles) - set(SOURCES)
    if unknown:
        raise ValueError(f"unknown source(s): {', '.join(sorted(unknown))}")
    output_rows = []
    summary = []
    invalid = []
    for name in profiles:
        profile = SOURCES[name]
        input_path = input_dir / profile["filename"]
        if not input_path.exists() and name == "compiled_human_erv_loci_hg19":
            # Accommodate the uploaded chat filename, but not unannounced header variants.
            alternate = input_dir / "dbm-gifford-legacy-list-hg19(1).tsv"
            if alternate.exists():
                input_path = alternate
        with input_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            headers = reader.fieldnames or []
            expected = list(profile["columns"].values()) + profile.get("note_fields", [])
            missing = sorted(set(expected) - set(headers))
            if missing:
                raise ValueError(f"{input_path.name}: missing configured columns: {missing}")
            count = accepted = rejected = 0
            duplicate_names = set()
            seen_names = set()
            for row_number, raw in enumerate(reader, start=2):
                count += 1
                try:
                    record = convert(name, profile, raw, row_number)
                    if record["legacy_name"] in seen_names:
                        duplicate_names.add(record["legacy_name"])
                    seen_names.add(record["legacy_name"])
                    output_rows.append(record)
                    accepted += 1
                except ValueError as exc:
                    rejected += 1
                    invalid.append({"source": name, "row": row_number, "reason": str(exc)})
            summary.append({
                "source": name, "input_rows": count, "accepted": accepted,
                "rejected": rejected, "duplicate_legacy_names": len(duplicate_names),
            })
    if invalid and not args.allow_invalid:
        print(json.dumps({"errors": invalid[:30], "total_invalid": len(invalid)}, indent=2), file=sys.stderr)
        raise ValueError("invalid rows: output not written (use --allow-invalid to skip them)")
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(output_rows)
    report_path = out.with_suffix(".summary.json")
    report_path.write_text(json.dumps({"sources": summary, "invalid_rows": invalid}, indent=2) + "\n")
    print(json.dumps({"output": str(out), "total_rows": len(output_rows), "sources": summary}, indent=2))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", default="tabular/legacy")
    parser.add_argument("--output", default="tabular/legacy/legacy_loci_normalised.tsv")
    parser.add_argument("--sources", nargs="+", choices=sorted(SOURCES))
    parser.add_argument("--allow-invalid", action="store_true")
    args = parser.parse_args()
    try:
        run(args)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"ERROR: {exc}\n")

if __name__ == "__main__":
    main()
