### ERV Lineage Table: field definitions

| Field | Definition | Values / interpretation |
| --- | --- | --- |
| **Lineage ID** | Stable ERVdb identifier for the ERV lineage or sublineage entity. | Primary identifier; e.g. `ERV-1.Eta.E`. |
| **Legacy name** | Legacy short name used to identify the lineage to users. | Currently represented by `legacy_name`; e.g. HERV-E. |
| **Full name** | Longer descriptive name for the lineage where one exists. | `legacy_full_name`. |
| **Aliases** | Alternative names that have been used for the same lineage. | One-to-many records in `erv_lineage_alias`; alias source can also be retained. |
| **Entity type** | Indicates the kind of ERV entity represented by the record. | Controlled ERVdb vocabulary. We should document the actual allowed values. |
| **Entity level** | Indicates the hierarchical level represented by the entity. | Distinguishes lineage/sublineage-level entities etc.; controlled vocabulary to document. |
| **Status** | Curation/status of the ERV lineage entity within ERVdb. | Controlled vocabulary to document. |
| **Parent lineage** | Parent ERV lineage for an entity defined below lineage level. | Primarily relevant to sublineages. |
| **Human ERV** | Indicates whether the lineage is represented among human ERVs. | Boolean. Importantly, this is not the same thing as saying the lineage occurs *only* in humans. |
| **Description** | Short general description of the lineage. | Intended for user-facing summary text. |
| **Notes / point of interest** | Additional notable biological or historical information about the lineage. | Optional user-facing text. |
| **Clade** | Placement within the high-level ERV/retrovirus clade framework. | Linked `rv_clade` entity. |
| **Genus** | Retroviral genus-level placement. | Linked `rv_genus` entity. |
| **Subgenus** | Retroviral subgenus-level placement where defined. | Linked `rv_subgenus` entity. |
| **Associated LTR lineage(s)** | LTR lineage(s) known to be associated with the ERV internal lineage. | Many-to-many relationship via `erv_lineage_ltr_assoc`. |
| **LTR association evidence** | Basis for associating a particular LTR lineage with the ERV lineage. | `erv_lineage_ltr_assoc.evidence`; optional comment also exists. |
| **Age estimate/calibration** | Evidence constraining the evolutionary age of the lineage. | Can include point estimates, younger/older bounds and different dating methods; potentially multiple records rather than a single "age". |

That last definition is important: we shouldn't define a flat `age` field in ERV Navigator. The ERVdb age schema explicitly supports **multiple calibrations and different kinds of age statements**, so Navigator should avoid flattening that into one authoritative number.

### ERV Lineage Reference Sequence Table: field definitions

| Field | Definition | Values / interpretation |
| --- | --- | --- |
| **Sequence ID** | Stable identifier of the sequence used as a reference representation of the ERV lineage. | Links the reference metadata to a GLUE `sequence`. |
| **Sequence length** | Length of the reference nucleotide sequence. | Integer, nucleotides. |
| **Derivation method** | Method by which the reference sequence was obtained or constructed. | Controlled vocabulary; e.g. consensus/reconstruction/source sequence categories as defined by ERVdb. |
| **Derivation source** | Source data/resource from which the reference was derived. | Controlled vocabulary or source identifier. |
| **Composite sequence?** | Indicates whether the reference combines information from more than one source sequence. | Boolean. |
| **Number input sequences** | Number of sequences contributing to construction of the reference where applicable. | Integer; particularly informative for consensus-derived references. |
| **Represented form** | Biological form represented by the reference sequence. | Controlled vocabulary; intended to distinguish the type of ERV sequence represented (e.g. proviral_genome, env_less_genome.) |
| **Completeness** | Overall completeness of the reference relative to the biological form it represents. | `reference_completeness`; controlled vocabulary. |
| **Fragment extent** | Describes the extent represented when the reference is incomplete/fragmentary. | `fragment_extent`; controlled vocabulary. |
| **[Architecture level](https://github.com/giffordlabcvr/ERVdb/blob/master/md/blurb/ERV%20Lineage%20Reference%20Curation%20Tiers.md)** | Degree to which the structural organisation/features of the reference have been curated. | Integer curation level; requires the curation-level definitions alongside the export. |
| **[Coding level](https://github.com/giffordlabcvr/ERVdb/blob/master/md/blurb/ERV%20Lineage%20Reference%20Curation%20Tiers.md)** | Degree to which coding regions/ORFs have been curated. | Integer curation level. |
| **[Validation level](https://github.com/giffordlabcvr/ERVdb/blob/master/md/blurb/ERV%20Lineage%20Reference%20Curation%20Tiers.md)** | Degree to which the reference sequence and annotation have been independently checked/validated. | Integer curation level. |
| **Accession** | External accession associated with the reference where applicable. | Optional external identifier. |
| **PubMed ID** | Publication supporting or describing the reference. | PubMed identifier where applicable. |
| **Reconstruction notes** | Information about how a reconstructed/derived reference was generated. | Free text. |
| **Curation notes** | Additional information concerning manual curation of the reference. | Free text. |
| **Annotated features** | Coordinates and identities of biological features annotated on the reference. | GLUE feature locations; e.g. LTRs and retroviral genes/domains. |
| **Sequence** | Reference nucleotide sequence itself. | Available for display/download. |

For the three curation fields, We should probably use the **actual tier definitions separately** rather than stuffing them into this table. Those levels have enough meaning to warrant their own small reference table.

### ERV Locus Table: field definitions

| Field | Definition | Values / interpretation |
| --- | --- | --- |
| **Locus ID** | Stable ERVdb identifier for a particular genomic ERV occurrence. | Primary locus identifier / associated sequence identifier. |
| **Missillac ID** | Locus identifier following the Missillac nomenclature system. | Optional external/alternative nomenclature. |
| **Other aliases** | Other names or identifiers associated with the locus. | One-to-many `erv_locus_alias` records. |
| **Host species** | Species whose genome contains the locus. | Currently principally *Homo sapiens* in the Navigator locus layer. |
| **Genome build** | Genome assembly against which coordinates are defined. | E.g. hg19; essential context for coordinates. |
| **Chromosome/scaffold** | Genome sequence containing the locus. | `scaffold`. |
| **Start** | Start coordinate of the locus in the specified genome build. | Integer genomic coordinate. |
| **End** | End coordinate of the locus in the specified genome build. | Integer genomic coordinate. |
| **Length** | Genomic extent of the locus. | Derivable from coordinates or sequence metadata. |
| **Strand** | Orientation of the locus relative to the genome assembly. | `orientation`. |
| **Locus type** | Broad structural/category classification of the genomic ERV locus. | Controlled vocabulary; importantly includes distinctions such as ERV versus solo LTR where appropriate. |
| **Structural profile** | More detailed summary of the retroviral structural components represented at the locus. | Controlled/standardised representation of locus structure. |
| **Mosaic?** | Indicates that the locus contains sequence assigned to more than one ERV lineage/taxonomic component. | Boolean. |
| **Taxonomic resolution** | Finest taxonomic level to which the locus can currently be assigned with support. | Controlled vocabulary, e.g. lineage/sublineage/genus-level etc. |
| **Curation tier** | Level/status of locus curation. | Controlled ERVdb vocabulary; distinct from **reference-sequence** curation levels. |
| **Orthology group** | Identifier grouping orthologous occurrences of a locus where applicable. | Integer group identifier. |
| **Assigned ERV lineage(s)** | ERV lineage entity/entities to which the locus or portions of it are assigned. | Many-to-many via `erv_locus_lineage_assoc`. |
| **Association role** | Describes the role of a lineage assignment within the locus. | Particularly relevant where more than one association exists. |
| **Assignment evidence** | Evidence supporting the lineage assignment. | `erv_locus_lineage_assoc.evidence`. |
| **Assignment confidence** | Confidence associated with the lineage assignment. | `erv_locus_lineage_assoc.confidence`. |
| **Region represented by assignment** | Region of the locus to which a particular lineage assignment applies. | `region_start` / `region_end`; important for mosaics/multiple assignments. |
| **Associated LTR lineage(s)** | LTR lineage(s) assigned to LTR sequence at the locus. | Many-to-many via `erv_locus_ltr_assoc`. |
| **LTR assignment evidence/confidence** | Evidence and confidence supporting an LTR-lineage assignment. | Association-level metadata. |
| **Age estimate/calibration** | Evolutionary dating evidence associated with the locus. | Potentially multiple estimates/calibrations using different methods. |

* * * * *
