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

## Project design  

HERVdb is implemented as a **species-level GLUE project layer** that operates within the same database schema as ERVdb.  
It introduces no new schema objects, but populates existing tables with *Homo sapiens*-specific data.

**Build sequence:**

1. **Import classified HERV loci** (`hervImportSources.glue`)  
   - Reads FASTA sources under `sources/homo_sapiens*/`  
   - Imports loci grouped by classification (`HERV`, `MALR`, `LTR-only`, `mosaic`)  

2. **Set sequence lengths** (`hervSetSequenceLengths.js`)  

3. **Link sequences to locus metadata** (`hervLinkSeqsToLocusTable.js`)  
   - Creates and populates `locus_data` records (coordinates, strand, aliases, status)  

4. **Import side data** (`hervImportSideData.glue`)  
   - Loads metadata such as classification notes, orthology groups, and publication references  

5. **Link to ERVdb taxonomy** (`hervLinkSeqsToRvTaxTable.js`)  
   - Associates each locus with the appropriate ERV lineage (`rv_species` or higher rank)  

6. **Add locus sequences to alignments** (`hervAddLocusSeqsToAlignments.glue`)  
   - Anchors loci into ERVdb’s tip-level constrained alignments for feature projection  
   - Handles special cases:  
     - **LTR-only** loci routed to `*.LTR.holding` alignments  
     - **MALR** loci routed to `MALR.*.holding`  
     - **Mosaic/unresolved** loci quarantined in `MOSAIC.holding` or `UNRESOLVED.holding`  

7. **Assign locus identifiers**  
   - `hervLegacyLocusAssign.js` preserves known IDs  
   - `hervAssignIdsToNonLegacyLoci.js` assigns stable new IDs following a standardized pattern  

8. **Validate** project integrity (`validate`)  

* * * * *

## Repository layout  

```
HERVdb/
├── buildHervProject.glue # Top-level orchestrator
├── glue/
│ ├── hervImportSources.glue
│ ├── hervImportSideData.glue
│ ├── hervAddLocusSeqsToAlignments.glue
│ ├── hervLinkSeqsToLocusTable.js
│ ├── hervLinkSeqsToRvTaxTable.js
│ ├── hervSetSequenceLengths.js
│ ├── hervLegacyLocusAssign.js
│ └── hervAssignIdsToNonLegacyLoci.js
├── modules/ # GLUE module configurations
├── sources/
│ ├── homo_sapiens/ # Full or near-complete HERV loci
│ ├── homo_sapiens_ltr/ # Solo-LTR and partial LTR elements
│ ├── homo_sapiens_malr/ # MaLR-class elements
│ └── homo_sapiens_mosaic/ # Mosaic or ambiguous loci
└── tabular/
├── herv_locus_lineage.tsv # Locus → lineage classification
├── herv_lineage_to_alignment.tsv # Lineage → alignment mapping
└── herv_side_data.tsv # Additional locus metadata
```



* * * * *

