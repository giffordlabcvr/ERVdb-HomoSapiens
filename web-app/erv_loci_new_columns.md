# ERV locus export: column descriptions

## Overview

This file contains human endogenous retrovirus (HERV) loci from the hg19
genome assembly and their associated ERV lineage classifications.

The export is generated from the `erv_locus_lineage_assoc` table in ERVdb.
Each row therefore represents an association between an ERV locus and an ERV
lineage.

Loci classified as mosaics are excluded from this export.

Although the export is expected to contain one principal lineage association\
for each non-mosaic locus, the row represents an association rather than the\
locus alone. A locus may therefore occur more than once if it has multiple\
lineage-association records.

Missing or inapplicable values are represented by an empty field.

Columns
-------

| Column | Description |
| --- | --- |
| `erv_locus.id` | Stable ERVdb identifier for the genomic ERV locus. |
| `erv_locus.missillac_id` | Locus identifier assigned under the Missillac HERV nomenclature system. Empty where no Missillac identifier has been assigned. |
| `erv_lineage.id` | Stable ERVdb identifier for the ERV lineage associated with the locus. |
| `erv_locus.scaffold` | Genome assembly sequence on which the locus occurs, normally an hg19 chromosome identifier. |
| `erv_locus.start_position` | Start coordinate of the locus on the indicated hg19 scaffold. Coordinates use the convention stored by ERVdb. |
| `erv_locus.end_position` | End coordinate of the locus on the indicated hg19 scaffold. Coordinates use the convention stored by ERVdb. |
| `erv_locus.orientation` | Orientation of the ERV locus relative to the reference genome assembly. |
| `erv_locus.locus_type` | Structural category of the locus, such as an ERV-derived internal element or solo LTR. |
| `erv_locus.taxonomic_resolution` | Lowest taxonomic level at which the locus classification was resolved, such as `lineage`, `subgenus`, `genus`, `clade`, or `unresolved`. |
| `erv_lineage.rv_clade.id` | ERVdb identifier for the broad retroviral clade containing the associated ERV lineage. |
| `erv_lineage.rv_genus.id` | ERVdb identifier for the retroviral genus containing the associated ERV lineage. Empty where genus-level placement is not assigned. |
| `erv_lineage.rv_subgenus.id` | ERVdb identifier for the retroviral subgenus containing the associated ERV lineage. Empty where subgenus-level placement is not assigned. |
| `erv_locus.host_species` | Host species in whose genome the locus was annotated. For this export, the expected value is `Homo sapiens`. |
| `erv_locus.genome_build` | Reference genome assembly used to define the locus coordinates. For this export, the expected value is `hg19`. |

Interpretation of taxonomic fields
----------------------------------

The value in `erv_locus.taxonomic_resolution` indicates the precision of the
classification, while the lineage and higher-taxonomic columns record the
available placement.

For example:

-   `lineage` indicates assignment to a specific ERV lineage.
-   `subgenus` indicates that the locus could not be assigned confidently below
    the subgenus level.
-   `genus` indicates resolution at genus level only.
-   `clade` indicates resolution at the broader ERV clade level.
-   `unresolved` indicates that no supported placement was obtained at the
    represented taxonomic levels.

A populated `erv_lineage.id` identifies the lineage record through which the
classification is represented. It should not necessarily be interpreted as a
fully resolved lineage-level assignment unless
`erv_locus.taxonomic_resolution` is `lineage`.

Scope and limitations
---------------------

This export excludes loci marked as mosaic. Mosaic loci can have distinct
lineage assignments for different parts of the locus and require a separate
association-level representation.

The file describes taxonomic assignments and genomic locations. It does not include nucleotide sequences, feature annotations, LTR-lineage associations, phylogenetic alignments, or the underlying evidence used to establish each classification.

