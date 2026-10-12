# ERVdb-HomoSapiens (HERVdb) 
*A GLUE-based reference and locus resource for human endogenous retroviruses (HERVs)*  

**ERVdb-HomoSapiens** extends the [ERVdb](https://github.com/giffordlabcvr/ERVdb) reference scaffold to incorporate **all classified human endogenous retrovirus (HERV) loci**.

It anchors these loci to the **reconstructed ancestral reference genomes** and **phylogenetic alignments** defined in ERVdb, creating a reproducible framework for studying retroviral diversity within the *Homo sapiens* genome.

* * * * *

## Purpose and scope  

HERVdb aims to:  
- **Integrate all known human ERV loci** into the ERVdb phylogenetic and taxonomic framework;  
- **Map each locus** to the most appropriate ERV lineage, at the highest assignable taxonomic level;  
- **Anchor loci** in **reference-constrained alignments** to enable projection of genome features (e.g. *gag*, *pol*, *env*, LTRs);  
- **Preserve and assign locus identifiers**, linking legacy names to new standardized IDs;  
- and **Provide a foundation** for comparative ERV genomics, population studies, and locus-level annotation.

> In essence, HERVdb represents the **human instantiation** of the ERVdb scaffold — turning reconstructed viral lineages into a detailed, locus-resolved catalogue of the HERV complement in the human genome.

* * * * *

## Scientific background  

Human endogenous retroviruses (HERVs) are the relics of ancient germline infections by retroviruses that once circulated in primate ancestors.  
While most loci are fragmentary, their relationships to extant or reconstructed retroviral lineages can be recovered through sequence similarity and phylogenetic context.  

HERVdb organizes these relationships explicitly:  
- Each locus is linked to its **ERVdb lineage reference** through curated alignments;  
- **Feature coordinates** (from ERVdb references) are automatically **projected** onto each locus via GLUE’s constrained alignment mechanism;  
- Loci that are **mosaic**, **unresolved**, or **MaLR-related** are flagged and routed to dedicated holding alignments for future curation.  

This layered design enables direct comparison of ERV diversity across species and lineages while preserving the unique genomic context of human loci.

* * * * *


## Relationship to ERV Navigator

ERV Navigator is an interactive, publicly accessible resource for exploring human endogenous retroviruses (HERVs) within a unified evolutionary and genomic framework.

It addresses a longstanding problem in HERV research: existing annotation resources use different approaches to identify, classify and name ERV-derived sequences, making it difficult to compare results across studies.

ERV Navigator brings these resources together by connecting three principal types of information:

1.  **Evolutionary classification**: ERV lineages are organised according to their phylogenetic relationships, including relationships to exogenous retroviruses and non-human ERVs.

2.  **Reference sequences**: Curated sequences provide models of ancestral proviral genome organisation and common coordinates for comparing related insertions.

3.  **Genomic loci**: Individual HERV insertions are assigned standardised identifiers and linked to evolutionary classifications, genomic coordinates, structural annotations and historical nomenclatures.

The resource allows researchers to browse evolutionary classifications, examine phylogenetic trees, explore individual ERV lineages and genomic loci, compare annotations from existing resources, and access reference sequences and alignments.

### ERV Navigator data contract

Scripts in the [FredHutch/hervdbex](https:/github.com/FredHutch/hervdbex) repository obtain ERV Navigator data from the files listed below. These files constitute the exported ERVdb data interface used by the web application.

The export is organised around three principal entities: **ERV lineages**, **ERV lineage reference sequences**, and **ERV loci**.

### How the principal entities are related

The core relationship is:

**ERV locus → ERV lineage → ERV lineage reference sequence**

Each ERV locus is assigned to an ERV lineage. Multiple loci may therefore be assigned to the same lineage. Each lineage has a single designated reference sequence, which provides the reference sequence and feature annotation used to represent that lineage.

These relationships can be followed between the principal export tables as follows:

- `hg19_loci_ervdb.tsv` contains one row per human ERV locus. The `missillac_id` field identifies the ERV lineage to which the locus is assigned.
- `erv_lineage_data.tsv` contains one row per ERV lineage or sublineage, identified by the corresponding lineage ID.
- `erv_lineage_references.tsv` associates each ERV lineage with its designated reference sequence.

Thus, to obtain the reference sequence associated with a human ERV locus, first use the locus `missillac_id` to identify its lineage, then use the lineage-reference mapping to identify the reference sequence.

The current ERV Navigator dataset contains **one designated reference sequence per ERV lineage**. The underlying ERVdb schema can accommodate additional reference sequences if required in future, but this is not currently used by the exported dataset.

Other relationships that can genuinely be one-to-many or many-to-many - for example lineage names/aliases, lineage–LTR relationships, and locus–LTR relationships - are represented in separate association tables rather than encoded as multiple values within individual fields.

### ERV lineages

The principal lineage table contains one row per ERV lineage or sublineage:

- [`web-app/erv_lineage_data.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_lineage_data.tsv)

Associated lineage data are provided separately:

- [`web-app/erv_lineage_names.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_lineage_names.tsv)
- [`web-app/erv-ltr_relationships.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv-ltr_relationships.tsv)
- [`web-app/erv_age_calibrations.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_navigator_age_calibrations.tsv)

Profiles of clades, lineages, and loci as Markdown:

- [`md/profile/*.md`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/tree/main/md/profile)

### ERV lineage reference sequences

Metadata describing the designated reference sequence for each ERV lineage are exported separately from the lineage entities themselves:

- [`web-app/erv_lineage_references.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_lineage_references.tsv)

Annotations associated with reference sequences are exported as:

- [`web-app/ervdb_features.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_features.tsv)
- [`web-app/ervdb_feature_locations.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_feature_locations.tsv)

Reference nucleotide sequences are provided in FASTA format:

- [`web-app/ervdb_reference_nt.fasta`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_reference_seqs.fna)

Coding regions extracted from annotated references are provided as:

- [`web-app/ervdb_coding_nt.fasta`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_coding_nt.fasta)
- [`web-app/ervdb_coding_aa.fasta`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_coding_aa.fasta)

Reference reconstruction and curation notes may additionally be supplied as Markdown files.

### ERV loci

The principal human locus table contains one row per ERV locus in the specified human genome assembly:

- [`web-app/hg19_loci_ervdb.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/hg19_loci_ervdb.tsv)

The `missillac_id` field provides the primary assignment of each locus to an ERV lineage.

Additional relationships between loci and other ERVdb entities are exported separately:

- [`web-app/erv_locus_alias.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_locus_alias.tsv)
- [`web-app/hg19_locus_ltr_assoc.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/hg19_locus_ltr_assoc.tsv)
- `web-app/erv_locus_age_calibrations.tsv`

Alignment segment data map individual locus sequences to ERV and LTR reference sequences. Together with the reference feature annotations, these mappings support visualisation of locus structural composition. Because of their size, alignment segment files will be distributed separately from this GitHub repository.

### Supporting retrovirus taxonomy data

Additional data defining the wider retrovirus taxonomic framework used by ERVdb are exported separately:

- [`web-app/xrv_side_data.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/xrv_side_data.tsv)

Files shown without links above form part of the intended ERV Navigator export interface but do not yet have a completed export process.



* * * * *

