# HERVdb  
*A GLUE-based reference and locus resource for human endogenous retroviruses (HERVs)*  

**HERVdb** extends the [ERVdb](https://github.com/giffordlabcvr/ervdb) reference scaffold to incorporate **all classified human endogenous retrovirus (HERV) loci**.

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


## Data for the HERVdb app

Scripts in the [FredHutch/hervdbex](https://github.com/FredHutch/hervdbex) repository pull data directly from the following files here:

- [`ERVdb/md/profiles/*.md`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/tree/main/md/profiles)
- [`ERVdb/web-app/ervdb_features.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_features.tsv)
- [`ERVdb/web-app/ervdb_feature_locations.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_feature_locations.tsv)
- [`ERVdb/web-app/ervdb_coding_nt.fasta`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_noncoding_nt.fasta)
- [`ERVdb/web-app/ervdb_coding_aa.fasta`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/web-app/ervdb_coding_aa.fasta)
- `ERVdb/tabular/erv/erv_lineage_data.tsv`
- `ERVdb/tabular/erv/erv-ltr_relationships.tsv`
- `ERVdb/tabular/erv/erv_lineage_alias.tsv`
- `ERVdb/tabular/xrv/xrv_side_data.tsv`

Locus-specific data for the human genome are obtained from the *Homo sapiens* **[extension layer](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/)**. Specifically:

- [`ERVdb-HomoSapiens/tabular/locus/hg19_loci_ervdb.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/tabular/locus/hg19_loci_ervdb.tsv)
- [`ERVdb-HomoSapiens/tabular/locus/hg19_locus_lineage_assoc.tsv`](https://github.com/giffordlabcvr/ERVdb-HomoSapiens/blob/main/tabular/locus/hg19_locus_lineage_assoc.tsv)
- `ERVdb-HomoSapiens/tabular/locus/locus-feature-coverage-clade-I.tsv`
- `ERVdb-HomoSapiens/tabular/locus/locus-feature-coverage-clade-II.tsv`
- `ERVdb-HomoSapiens/tabular/locus/locus-feature-coverage-clade-III.tsv`


* * * * *

