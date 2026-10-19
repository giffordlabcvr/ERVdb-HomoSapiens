# Supplementary ERV locus importer

GLUE ECMA function invoker matching the supplied 19 October 2026 schema.

## Installation and invocation

Place `ervLocusSupplementImporter.xml` and `ervLocusSupplementImporter.js` together (for example, in `modules/build/`). This follows the attached curator module's relative script filename convention. Run from your project mode and the normal project load/save path.

```text
create module -f modules/build/ervLocusSupplementImporter.xml
module ervLocusSupplementImporter invoke-function previewLoci tabular/curation/erv_locus_supplements.tsv Homo_sapiens hg19
module ervLocusSupplementImporter invoke-function importLoci tabular/curation/erv_locus_supplements.tsv Homo_sapiens hg19
```

Arguments are positional: TSV path, host species, genome build. Do not insert parameter names. Use the exact host/build labels stored in the existing locus table.

## Input

UTF-8 TSV with a header. Copy the supplied header-only template, or use just the required columns below. Each row represents one genomic locus. Supply your chosen **new locus table ID**, not a Missillac ID. No identifier allocator is assumed.

| Required column | Meaning |
|---|---|
| locus_id | New unique locus table ID; letters, digits, dot, underscore and hyphen; first character alphanumeric |
| scaffold | Exact existing scaffold convention, e.g. chrX |
| start_position | 1-based inclusive start; positive integer |
| end_position | 1-based inclusive end; >= start, including on the minus strand |
| orientation | +, -, positive or negative; stored as supplied to match your existing convention |
| locus_type | Your existing controlled vocabulary for structure |
| lineage_id | Exact existing erv_lineage.id; aliases are not resolved |
| evidence | Association evidence, e.g. manual_curation (maximum 50 characters) |
| confidence | Your existing confidence vocabulary, e.g. high (maximum 30 characters) |

Optional columns are `structural_profile`, `is_mosaic`, `taxonomic_resolution`, `is_high_support`, `curation_tier`. Blank optional cells remain unset; Boolean values must be `true` or `false`. Curation tiers, taxonomic resolution, confidence and locus structure labels are supplied by the curator; the module does not infer them. Use the existing project's vocabulary. Unknown columns and duplicate headers are rejected to catch spelling errors. Comments beginning with # and blank data lines are ignored. Every data row must have exactly the header's column count, including trailing blank cells.

The shared host/build arguments apply to all rows. Coordinates must already be in that build: there is no liftover. Chromosome aliases (e.g. 7 versus chr7), host aliases, and build aliases are not automatically normalized. Check those conventions before import: mismatched labels can hide genuine overlaps.

Example layout (replace NEW_LOCUS_ID and EXACT_LINEAGE_ID with real IDs; the coordinate example comes from the Fc2 hit and is still subject to boundary review):

```tsv
locus_id	scaffold	start_position	end_position	orientation	locus_type	lineage_id	evidence	confidence
NEW_LOCUS_ID	chrX	97096480	97104422	positive	provirus	EXACT_LINEAGE_ID	manual_curation	high
```

## Matching and changes

Any overlap of at least one base on the same host, build and scaffold causes `SKIP_OVERLAP`. Strand and lineage do not restrict matching. The report includes one row per existing overlapping locus, with coordinates, orientation, overlap length and all current lineage associations (formatted lineage:role). It does not automatically classify a skipped locus as the same biological insertion: nested elements and partial overlaps need review.

`READY` means no existing overlap. `ERROR` means invalid lineage, reused locus ID at a different location/host/build, association ID collision, or overlap between input candidates. Both overlapping input candidates are errors; neither is arbitrarily preferred. Distinct genomic copies, including duplicated loci on chromosome Y, remain distinct coordinates.

The entire input is validated before any database writes. Target entity types `lineage`, `sublineage` and `erv_derived_repeat` are accepted; `uncertain` and unknown types are rejected. Duplicate input IDs and malformed TSV/coordinates cause immediate errors. Invalid existing coordinates on the requested host/build/scaffolds also stop matching rather than silently hiding a possible overlap.

For each `READY` candidate, import creates:

1. One `erv_locus` row with the supplied fields and common host/build.
2. One `erv_locus_lineage_assoc` row with ID `<locus_id>__<lineage_id>`, links to both entities, `association_role=primary`, and supplied evidence/confidence.

No existing row or association is modified. There is no FASTA import, sequence link, LTR association, inferred association region, orthology group or Missillac ID assignment. These can be added by their respective downstream workflows.

Import rebuilds the plan against current database state. A repeat import normally skips the loci created previously. It does not repair pre-existing incomplete rows: review these using the overlap report.

## Failure handling and validation

A runtime creation failure triggers best-effort deletion of rows created for that candidate. Earlier successfully created candidates remain; the batch is not atomic. Cleanup failures are included in the error. Run preview again before continuing after any failure. Avoid other locus writers during an import; this module does not implement concurrent transaction locking.

Tested with a Node mock of the GLUE command interface for matching, creation/linking, reruns, full preflight, ID conflicts, host/build isolation, multiple overlaps and injected failure cleanup. No live GLUE runtime/database was available for integration testing. Run preview first in your project.
