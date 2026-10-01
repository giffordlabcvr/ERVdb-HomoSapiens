# ERVdb–ERV Navigator Data Interface

This document is intended to help define the data interface between **ERVdb**, which acts as the underlying curated data resource, and **ERV Navigator**, which provides the user-facing representation of these data.

ERVdb is a relational database, and the data can be exported in whatever structure is most convenient for Navigator. The immediate aim is therefore not to prescribe a particular export file format, but to identify the information held in ERVdb that could be useful to expose through the web application. From this we can agree:

* which information should be displayed in Navigator;
* how ERVdb concepts and fields map onto elements of the application; and
* the structure and format of the export(s) used to transfer these data.

For this purpose, it is useful to distinguish three main types of information:

1. **ERV lineage**: information describing an ERV lineage as a biological and evolutionary entity.
2. **Lineage reference sequence**: information describing the curated sequence used by ERVdb to represent that lineage.
3. **ERV locus**: information describing an individual ERV occurrence in a host genome.

This distinction is particularly important for lineage pages: properties of the lineage itself should be kept conceptually separate from properties of the particular reference sequence used to represent it.

The tables below identify fields that are potentially useful for Navigator. They are intended as a basis for discussion rather than a final specification. Once we have agreed which fields Navigator should consume and how they should be represented, this can be formalised as an **export/data contract** and ERVdb exports can be configured accordingly.

For definitions of the underlying ERVdb fields and tables, see **[ERVdb Tables](https://github.com/giffordlabcvr/ERVdb/blob/master/md/blurb/ERVdb_Tables.md)**.

### 1\. ERV lineage

This is information about the **biological/evolutionary entity**, independent of whichever sequence we use to represent it.

Potentially useful Navigator fields:

| Information | ERVdb source | Likely use |
| --- | --- | --- |
| Lineage ID | `erv_lineage` ID | Essential |
| Display name | `legacy_name` / naming logic | Essential |
| Full name | `legacy_full_name` | Useful |
| Aliases | `erv_lineage_alias` | Essential/searchable |
| Entity type | `entity_type` | Useful internally / possibly display |
| Entity level | `entity_level` | Useful |
| Status | `status` | Useful |
| Parent lineage | `parent_lineage` | Essential for sublineages |
| Human ERV | `human_erv` | Essential for taxonomy filtering |
| Description | `description` | Essential |
| Notes / point of interest | `notes` | Useful |
| Clade | linked `rv_clade` | Essential |
| Subfamily | linked `rv_subfamily` | Useful |
| Genus | linked `rv_genus` | Essential |
| Subgenus | linked `rv_subgenus` | Essential |
| Associated LTR lineage(s) | `erv_lineage_ltr_assoc` | Very useful |
| LTR association evidence | association table | Possibly useful |
| Age estimate/calibration | `erv_age_calibration` | Potentially very useful |

This is also where the **human/non-human distinction** belongs. 
That could drive the front-page toggle we've discussed.

### 2\. Lineage reference sequence

I think we should definitely clarify this as a separate conceptual object in Navigator.

A lineage is something like **HERV-E**. A lineage reference is **the curated sequence ERVdb uses to represent HERV-E**.

Potentially useful information includes:

| Information | ERVdb source | Likely use |
| --- | --- | --- |
| Sequence ID | linked `sequence` | Essential |
| Sequence length | `sequence.length` | Useful |
| Derivation method | `derivation_method` | Useful |
| Derivation source | `derivation_source` | Useful |
| Composite sequence? | `is_composite` | Useful |
| Number input sequences | `num_input_sequences` | Quite useful for consensus refs |
| Represented form | `represented_form` | Very useful |
| Completeness | `reference_completeness` | Very useful |
| Fragment extent | `fragment_extent` | Useful where relevant |
| Architecture level | `architecture_level` | **[New curation information](https://github.com/giffordlabcvr/ERVdb/blob/master/md/blurb/ERV%20Lineage%20Reference%20Curation%20Tiers.md)** |
| Coding level | `coding_level` | **[New curation information](https://github.com/giffordlabcvr/ERVdb/blob/master/md/blurb/ERV%20Lineage%20Reference%20Curation%20Tiers.md)** |
| Validation level | `validation_level` | **[New curation information](https://github.com/giffordlabcvr/ERVdb/blob/master/md/blurb/ERV%20Lineage%20Reference%20Curation%20Tiers.md)** |
| Accession | `accession` | Useful |
| PubMed ID | `pubmed_id` | Useful |
| Reconstruction notes | `reconstruction_notes` | Useful |
| Curation notes | `curation_notes` | Possibly display/download |
| Annotated features | GLUE feature locations | Very useful |
| Sequence itself | GLUE `sequence` | Download/display |

This makes the new curation scheme much easier to explain. We're **not giving HERV-E itself three curation scores**; we're describing how comprehensively its **reference sequence** has been reconstructed, annotated and validated.

I think that distinction should be visible on the lineage page, which could have two sections:

**About this lineage**\
**Reference sequence**

It doesn't require two pages.

### 3\. ERV locus

The previous specification we had maps partly onto the current schema, but quite a few things have changed.

For a locus I think the useful information now looks more like this:

| Information | Source |
| --- | --- |
| Locus ID | `erv_locus` ID / linked sequence ID |
| Missillac ID | `missillac_id` |
| Other aliases | `erv_locus_alias` |
| Host species | `host_species` |
| Genome build | `genome_build` |
| Chromosome/scaffold | `scaffold` |
| Start | `start_position` |
| End | `end_position` |
| Length | derived or sequence length |
| Strand | `orientation` |
| Locus type | `locus_type` |
| Structural profile | `structural_profile` |
| Mosaic? | `is_mosaic` |
| Taxonomic resolution | `taxonomic_resolution` |
| Curation tier | `curation_tier` |
| Orthology group | `orthology_group` |
| Assigned ERV lineage(s) | `erv_locus_lineage_assoc` |
| Association role | association table |
| Assignment evidence | association table |
| Assignment confidence | association table |
| Associated LTR lineage(s) | `erv_locus_ltr_assoc` |
| LTR assignment evidence/confidence | association table |
| Age estimate | `erv_age_calibration` where available |

* * * * *
