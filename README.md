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

