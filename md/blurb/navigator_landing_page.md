ERV Navigator
=============

Exploring the evolutionary history of human endogenous retroviruses
-------------------------------------------------------------------

ERV Navigator is an interactive resource for exploring endogenous retroviruses (ERVs) through an evolutionary framework.

Rather than treating ERVs simply as repetitive genomic elements, HERV Navigator approaches them as remnants of ancient retroviruses that colonised the germlines of vertebrate ancestors and became inherited components of their genomes.

This initial release focuses on ERVs in the human genome, sometimes referred to as human endogenous retroviruses (HERVs).

What are endogenous retroviruses?
---------------------------------

Retroviruses are viruses that replicate through integration into host DNA. During infection, a DNA copy of the viral genome becomes inserted into the chromosomes of the infected cell, forming a structure known as a provirus.

When this process occurs in germline cells, the integrated viral sequence can be inherited across generations as a permanent component of the host genome. These inherited proviruses are known as endogenous retroviruses (ERVs).

Over millions of years, ERVs have accumulated throughout vertebrate genomes, preserving a fragmented record of ancient retrovirus infections and long-term virus-host evolution.

Although most ERVs no longer behave as infectious viruses, some have remained biologically active within host genomes, including through transcription, intracellular retrotransposition, or co-option into host biological functions.

Core concepts
=============

ERV loci
--------

An ERV locus represents a defined genomic region containing endogenous retrovirus-derived sequence within a host genome assembly.

Most ERV-derived sequences are highly degraded due to mutation, deletion, recombination, and genomic rearrangement accumulated over millions of years of evolution. Many survive only as isolated fragments or long terminal repeat (LTR) sequences, while others preserve relatively intact proviral structures.

As a result, ERV loci exist along a continuum of structural integrity, ranging from near-complete proviruses to highly fragmented remnants retaining only limited evolutionary signal.

ERV Navigator aims to accommodate this full spectrum of ERV-derived sequence while grounding evolutionary interpretation in loci that preserve recognisable proviral organisation.

These more structurally intact loci provide important reference points for reconstructing ancestral viral genome structures, defining ERV lineages, and relating fragmented elements back to broader evolutionary contexts.

Some loci preserve evidence of complex or composite evolutionary histories. Different regions within a single locus may derive from distinct retroviral lineages due to recombination, rearrangement, secondary insertion events, or partial replacement of genomic components.

Accordingly, ERVdb supports hierarchical, partial, and region-specific evolutionary annotation rather than assuming that all loci correspond cleanly to single ancestral entities.

* * * * *

ERV lineages
------------

An ERV lineage represents the descendants of an ancestral retrovirus lineage associated with an independent germline colonisation event in an ancestral host population.

A lineage therefore reflects an evolutionary relationship between loci rather than simply a shared sequence similarity.

Lineages vary greatly in age, diversity, genomic integrity, and phylogenetic resolution. Some are represented by large numbers of related loci, while others survive only as sparse or highly degraded remnants.

ERVdb supports hierarchical evolutionary classification, allowing loci and lineages to be linked to broader retrovirus groups including clades, subfamilies, genera, and subgenera.

* * * * *

Reference sequences
-------------------

Reference sequences in ERVdb are reconstructed representatives of ancestral ERV lineages.

These references are derived through comparative analysis of related loci and are intended to approximate the ancestral viral genome structure that gave rise to the observed descendants.

Reference sequences should not be interpreted as exact historical viral genomes. Instead, they represent current evolutionary models that may be refined as additional loci, assemblies, alignments, and phylogenetic analyses become available.

Different reference reconstruction strategies may be used depending on the available data, including:

-   representative proviral loci,
-   majority-rule consensus sequences,
-   ancestral sequence reconstruction,
-   or manually curated composite references.



* * * * *

Constrained alignments
----------------------

ERVdb uses constrained evolutionary alignments to relate fragmented genomic loci back to reconstructed ancestral genome structures.

Within this framework, each lineage reference sequence acts as a coordinate system for comparative analysis. Genomic features such as genes, protein domains, and regulatory regions are annotated on the reference and projected across aligned loci through inferred homology relationships.

This approach allows homologous regions to be compared even when loci are fragmented, rearranged, partially deleted, or independently degraded.

Constrained alignments also support:

-   phylogenetic reconstruction,
-   comparative genome analysis,
-   orthology assessment,
-   ancestral state inference,
-   and evolutionary classification workflows.

* * * * *

Classification and evolutionary interpretation
==============================================

ERVdb distinguishes between genomic entities and evolutionary interpretations.

A locus is a genomic object located within a host assembly.\
A lineage assignment represents an evolutionary hypothesis regarding the origin and relationships of that sequence.

Some loci can be confidently assigned to well-defined ERV lineages, while others preserve only partial or ambiguous evolutionary signal. In some cases, different regions within the same locus may be associated with different retroviral groups.

To accommodate this complexity, ERVdb supports:

-   hierarchical classification,
-   partial assignments,
-   region-specific annotation,
-   and unresolved or mosaic evolutionary states.


* * * * *
