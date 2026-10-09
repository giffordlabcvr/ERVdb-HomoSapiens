### Curation Tier A: genome architecture and non-coding annotation

| Level | Definition |
| --- | --- |
| `A0` | No formal architectural annotation beyond `whole_genome`. |
| `A1` | Both `5LTR` and `3LTR` boundaries annotated. |
| `A2` | A1 plus both `PBS` and `PPT` annotated. |
| `A3` | A2 plus U3, R and U5 subdivisions annotated in both LTRs. |

`internal_region` is not required because it is implicitly defined by the LTR boundaries.

### Curation Tier C: coding annotation

| Level | Definition |
| --- | --- |
| `C0` | No major coding regions annotated. |
| `C1` | One or more major coding regions annotated, but coding-frame completeness has not been demonstrated. |
| `C2` | Some, but not all, expected core coding regions have usable translations. |
| `C3` | All expected core coding regions---normally `gag`, `pol` and `env`---have usable translations. |
| `C4` | C3 plus partial higher-resolution annotation: major protein subdivisions and/or accessory or regulatory genes. |
| `C5` | C3 plus comprehensive annotation of the canonical major protein subdivisions: `MA`, `CA`, `NC`; `RT`, `RNaseH`, `IN`; and `SU`, `TM`, where applicable. Accessory and regulatory genes are also recorded where present. |

An in-frame stop does not automatically reduce the C level: C measures the completeness and resolution of the annotation, not whether an endogenous sequence retains an intact ORF.

### Curation Tier V: comparative validation and sequence refinement

| Level | Definition |
| --- | --- |
| `V0` | No comparative validation recorded. |
| `V1` | Coding frames and provisional indel corrections reviewed against related ERVs, XRVs and/or lineage-level alignments. |
| `V2` | V1 plus evidence-based treatment of disrupted ORFs, including justified reversion of internal in-frame stop codons where appropriate. |
| `V3` | V2 plus phylogeny-guided ancestral reconstruction, including justified CpG-associated reversions where applicable. |

* * * * * 

Unlike A and C, V should normally be assigned by a curator. GLUE can provide supporting evidence---translation failures, internal stops, ambiguous codons and comparative alignment information---but cannot reliably decide whether a particular reversion is justified.

* * * * *
