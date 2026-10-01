# ERVdb / ERV Navigator: Outstanding Work

### Core work

1.  **Lock down the ERV sublineage concept and refactor the sublineage layer**
    -   Define precisely what constitutes an ERV sublineage.
    -   Establish the evidence required to recognise one and its relationship to ERV lineages and LTR lineages.
    -   Review the existing accepted sublineages against those criteria.
    -   Refactor the existing implementation to be consistent with the current ERVdb schema, reference-sequence model and alignment hierarchy.
2.  **Finalise lineage nomenclature and higher-level taxonomy**
    -   Perform a final review of the names assigned to ERV lineages and other evolutionary groups before they become effectively fixed through ERVdb, Navigator and publications.
    -   Review newly introduced group names for consistency, clarity and compatibility with historical terminology.
    -   Review how the phylogenetic hierarchy maps onto taxonomic ranks.
    -   In particular, resolve the problematic representation of the large **Clade II alpha--beta assemblage**.
    -   Consider whether HERV-K and other major groups within this radiation need to be represented as distinct genus-level entities rather than being forced into *Alpharetrovirus* or *Betaretrovirus*.
3.  **Establish stable Missillac ID assignment**
    -   Define an explicit persistent-ID policy.
    -   Lock accepted locus → Missillac ID mappings so they remain stable between builds.
    -   Assign new IDs only to genuinely new loci.
    -   Do not recycle identifiers belonging to loci that disappear or are retired.
    -   Implement routines for importing/preserving the locked mappings before assigning IDs to remaining loci.
    -   Produce checks for collisions, unexpected reassignment and other ID instability.
4.  **Recover loci lost through overly cautious/misguided reconciliation**
    -   Continue the existing `curator_decision` work.
    -   Focus specifically on loci that should have confident lineage assignments but were pushed to genus/subgenus/clade level by the merge/reconciliation procedure.
    -   Investigate the evidence underlying each curator decision and consolidate or reject it.
    -   Where possible, determine *why* the reconciliation logic lost otherwise valid assignments so recurrent failure modes can be corrected.
    -   Do **not** make resolution of genuinely complex or ambiguous loci the objective of this exercise.
5.  **Define the treatment of mosaic loci**
    -   Explicitly distinguish **mosaic** from **under-resolved** loci.
    -   Decide what constitutes a mosaic locus in the final ERVdb data model.
    -   Determine what its primary classification/identity should be when no single ERV lineage describes it.
    -   Decide how component ERV-lineage and LTR-lineage associations should be represented.
    -   Determine whether component coordinates/feature information need to be exported.
    -   Define how mosaic loci should appear in ERV Navigator.

### LTR and dating work

1.  **Add proviral LTRs to the LTR alignments**
    -   Extract 5′ and 3′ LTR regions using the constrained proviral alignments.
    -   Develop/use an **LTR recogniser** against the curated LTR alignment framework to classify them.
    -   Use existing provenance annotations as supporting/cross-check evidence where useful, rather than allowing provenance complexity to dictate classification.
    -   Allow the two LTRs of a provirus to have different LTR-lineage assignments where supported.
    -   Add classified proviral LTRs to the existing alignments containing solo LTRs.
2.  **Apply the solo-LTR dating approach**
    -   Run the dating procedure systematically across suitable LTR alignments.
    -   Use the existing consensus/divergence/coverage methodology and age-calibration framework.
    -   Examine lineage-level distributions and identify anomalous estimates/outliers.
    -   Establish appropriate QC/flagging rules.
    -   Write acceptable estimates and their supporting information into ERVdb.

### Public identities and phylogenies

1.  **Cross-match legacy and notable loci**
    -   Identify historically important, commonly named or otherwise notable HERV loci.
    -   Cross-reference them against their canonical Missillac IDs.
    -   Preserve historical/common names as aliases.
    -   Associate appropriate descriptions, blurbs and points of interest with those loci.
    -   Ensure users searching familiar HERV terminology can reach the corresponding canonical Navigator locus.
2.  **Implement the ERV Navigator phylogeny export**
    -   Start from the final midpoint-rooted proviral gene and LTR-lineage trees.
    -   Copy/export appropriate trees into a dedicated location under the `web-app` export.
    -   Use existing FigTree annotations to obtain the mapping between internal sequence IDs and Missillac IDs.
    -   Rewrite tree taxon labels using Missillac IDs while preserving topology and branch lengths.
    -   Generate corresponding rewritten FigTree annotation files whose taxon IDs match the reformatted trees.
    -   Validate mapping completeness and uniqueness and report missing/duplicate IDs explicitly.
    -   Keep these as Navigator-facing representations of the canonical analytical trees rather than changing the underlying ERVdb trees.
3.  **Regenerate the clade-level phylogenies for the Navigator front page**

    -   Reconstruct the high-level clade trees from the finalised evolutionary reference framework.
    -   Prepare appropriate annotations and labels.
    -   Decide which information is useful to expose at this level.
    -   Send Sonu concrete annotation/display recommendations for the front-page trees.

### Final Navigator export and integration

1.  **Finalise the ERV Navigator export design**

-   Define exactly what ERVdb supplies to Navigator once the underlying biological model is stable.
-   Cover lineages, sublineages, LTR lineages, loci, aliases, descriptions, references, associations, sequences, mosaic information, trees and tree annotations.
-   Use separate relational tables where concepts naturally have one-to-many relationships rather than unnecessarily flattening/"smushing" them into single tables.
-   Document the resulting interface/export contract.
-   Turn the complete export into a reproducible workflow.

1.  **Implement systematic export validation / QA**

-   Validate missing or duplicate Missillac IDs.
-   Detect dangling/missing associations.
-   Check required metadata.
-   Validate lineage/sublineage/LTR relationships.
-   Validate mosaic records.
-   Check that exported tree taxa correspond to exported database entities.
-   Check consistency between Newick trees and their annotation files.
-   Produce a concise machine-generated QA report for each export.
-   Use this to establish a clear boundary between **ERVdb/export problems** and **Navigator implementation/display problems**.

1.  **ERV Navigator integration and bug-fixing pass**

-   Load the finalised/reproducible export into Navigator.
-   Systematically review locus, lineage, LTR, phylogeny and other views.
-   Identify places where correct ERVdb information is being incorrectly interpreted or displayed.
-   Work through the current web-app bugs against a known-good export rather than simultaneously changing the database model, export and frontend.

* * * * *

Longer-term / non-blocking ERVdb enrichment
-------------------------------------------

1.  **Add an Env-type classification**

-   Introduce an `env type` category for suitable reference sequences.
-   Base classification primarily on phylogenies constructed from the Env transmembrane (TM) region.
-   Develop an appropriate controlled vocabulary/classification framework.
-   Define the evidence/completeness required before assigning an Env type.
-   Keep Env evolutionary classification conceptually distinct from the classification of the ERV as a whole.

1.  **Add additional retroviral structural/genomic annotations**

-   Introduce systematically derivable biological characteristics of reference sequences.
-   Initial example: **number of Gag/nucleocapsid zinc-knuckle motifs**.
-   Consider developing this into a broader structured collection of comparable retroviral genomic/protein characters rather than accumulating miscellaneous one-off fields.

1.  **Investigate batch ortholog identification using LiftOver**

-   Test whether LiftOver can provide a scalable first-pass approach to identifying orthologous ERV loci between appropriate genome assemblies/species.
-   Determine its reliability for repetitive ERV sequence.
-   Explore reciprocal LiftOver and sequence/structural validation to distinguish genuine orthology from merely successful coordinate mapping.
-   If sufficiently robust, develop a workflow for populating ERVdb orthology groups.

### Overall logical progression

The main path is approximately:

**finalise biological concepts/taxonomy → stabilise identifiers → correct locus assignments → define genuine complexity/mosaics → enrich LTR data → finalise public identities and phylogenies → freeze the Navigator export → validate → integrate/debug.**

The **LTR integration/dating work (6--7)** and much of the **tree work (9--10)** can proceed somewhat independently, while **14--16 are explicitly non-blocking future enhancements**.

* * * * *
