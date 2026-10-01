# ERVdb-HomoSapiens (HERVdb) 
*A GLUE-based reference and locus resource for human endogenous retroviruses (HERVs)*  

**ERVdb-HomoSapiens** extends the [ERVdb](https://github.com/giffordlabcvr/ervdb) reference scaffold to incorporate **all classified human endogenous retrovirus (HERV) loci**.

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


 ## Data for ERV Navigator

Scripts in the [FredHutch/hervdbex](https://github.com/FredHutch/hervdbex) repository obtain ERV Navigator data from the files listed below. These files constitute the exported ERVdb data interface used by the web application.

The export is organised around three principal entities: **ERV lineages**, **ERV lineage reference sequences**, and **ERV loci**. Information representing one-to-many or many-to-many relationships is provided in separate association tables rather than encoded as multiple values within individual fields.

### ERV lineages

The principal lineage table contains one row per ERV lineage or sublineage:

- [`web-app//erv_lineage_data.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_lineage_data.tsv)

Associated lineage data are provided separately:

- [`web-app/erv_lineage_alias.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_lineage_alias.tsv)
- [`web-app/erv-ltr_relationships.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv-ltr_relationships.tsv)
- [`web-app/erv_age_calibrations.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_navigator_age_calibrations.tsv)

Profiles of clades, lineages, and loci as Markdown:

- [`md/profile/*.md`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/tree/main/md/profile)

### ERV lineage reference sequences

Metadata describing ERV lineage reference sequences are exported separately from the lineage entities themselves:

- [`web-app/erv_lineage_references.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/erv_lineage_references.tsv)

Annotations associated with reference sequences are exported as:

- [`web-app/ervdb_features.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_features.tsv)
- [`web-app/ervdb_feature_locations.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_feature_locations.tsv)

Reference nucleotide sequences are provided in FASTA format:

- [`web-app/ervdb_reference_nt.fasta`]()

Coding regions extracted from annotated references are provided as:

- [`web-app/ervdb_coding_nt.fasta`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_coding_nt.fasta)
- [`web-app/ervdb_coding_aa.fasta`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_coding_aa.fasta)

Reference reconstruction and curation notes may additionally be supplied as Markdown files.

### ERV loci

The principal human locus table contains one row per ERV locus in the specified human genome assembly:

- [`web-app/hg19_loci_ervdb.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/tabular/locus/hg19_loci_ervdb.tsv)

Information representing relationships between loci and other ERVdb entities is exported separately:

- `web-app/locus/hg19_locus_lineage_assoc.tsv`
- `web-app/erv_locus_alias.tsv`
- `web-app/erv_locus_age_calibrations.tsv`
- `web-app/hg19_locus_ltr_assoc.tsv`

Feature coverage information used to display the structural composition of loci is provided separately for the three major retroviral clades:

- `tabular/locus/locus-feature-coverage-clade-I.tsv`
- `tabular/locus/locus-feature-coverage-clade-II.tsv`
- `tabular/locus/locus-feature-coverage-clade-III.tsv`

### Supporting retrovirus taxonomy data

Additional data defining the wider retrovirus taxonomic framework used by ERVdb are exported separately:

- [`web-app/xrv_side_data.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/xrv_side_data.tsv)

Files shown without links above form part of the intended ERV Navigator export interface but do not yet have a completed export process.


* * * * *

