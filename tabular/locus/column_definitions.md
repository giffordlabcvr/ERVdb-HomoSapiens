# Column definitions

## idx
ID beginning with "RBRT" (relates to order of steps in pipeline: RB for DIGS "R"-Repbase "B" overlap, then RBRT for RB-Retrotector "RT").

## chrom
Chromosome.

## strand
Strand.

## start
Overlapped element start.

## end
Overlapped element end.

## names
Original names given by different naming systems from DIGS, Repbase and/or Retrotector, separated by commas and ordered by start appearance of each element.

## genes
Genes reported by DIGS, Repbase and/or Retrotector, separated by commas and ordered by start appearance of each element.

## idxRBT
IDs from starting databases (R: DIGS, B: Repbase, T: Retrotector). Used to map which HERV elements from which databases were joined into one sole RBRT HERV element; separated by commas and ordered by start appearance of each element.

## names_re
Names after going through corresponding regular expression functions to match RT4-phylo.

## names_re_unique
Same as before, but unique names only.

## case
Classification pipeline main result. Here, "fully resolved" is for cases where name decision resulted in choosing one sole name corresponding to one sole row in the RT4phylo table. "Resolved" refers to the mosaic cases.

## names_decision
Name decision that matches RT4-phylo.

## phylo_level_diff
Phylogeny level (name, subgroup, group, or clade) at which at least two overlapped elements differed, making the case mosaic.

## composition
Whether each overlapped element was an "int" or just an "ltr", in start-ascending order.

## composition_simple
Same as before, but with collapsed information while retaining repetition.

## has_int
Whether the case contains an int.

## ltr_within
Whether composition has "int-ltr-int".

## ints_diff_phylo_level
TRUE if at least two ints came from two different phylogeny levels, thus making it mosaic.

## ltr_makes_mosaic
TRUE if ints_diff_phylo_level and ltr_na_makes_mosaic; a case in which LTRs from different phylogeny levels make it mosaic.

## ltr_na_makes_mosaic
TRUE if what makes the case mosaic is the presence of "LTR-only" or "Unclassified" LTRs.

## mosaic_level
Mosaic level.