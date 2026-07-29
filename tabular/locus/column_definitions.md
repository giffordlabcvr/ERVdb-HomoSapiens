# Column definitions

## locus_id
ID beginning with "RBRT" (relates to order of steps in pipeline: RB for DIGS "R"-Repbase "B" overlap, then RBRT for RB-Retrotector "RT").

## curatedNS
1 indicating one of the 8,617 high-support HERVs

## DIGS
If containing elements from DIGS, the R### value corresponding to DIGS Consolidated idx

## Repbase
If containing elements from Repbase, the B### value corresponding to the Repbase idx

## Retrotector
If containing elements from Retrotector, the T### value corresponding to Retrotector idx

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

## genes_order
Shows the order of the genes in the element based on start coordinate of the individual hits' genes that form the merged element. Where (int) means there is an unspecified Repbase internal region/gene present. Consecutive duplicate genes are collapsed. Example: LTR-gag-pol-pro-RT-pol-env-TM-LTR(int)

## genes_simplified
A simplified version of genes_order that collapses all internal genes as 'int'. Example: LTR-int-LTR. Elements with only (int) and an LTR are simplified to LTR-int order. 

## case
Classification pipeline main result. Here, "fully resolved" is for cases where name decision resulted in choosing one sole name corresponding to one sole row in the RT4phylo table. "Resolved" refers to the mosaic cases.

## names_decision
Name decision that matches RT4-phylo.

## status
ERV if merged element contains any internal genes or contains a DIGS LTR-LTR hit, else LTR (Solo LTRs)

## clade out
Clade of each hit in the element based on RT4-phylo, separated by commas

## group out
Group of each hit in the element based on RT4-phylo, separated by commas

## subgroup out
Subgroup of each hit in the element based on RT4-phylo, separated by commas

## phylogeny_name
Phylogeny_name of each hit in the element based on RT4-phylo, separated by commas. Replaced by name if no phylogeny_name exists for that hit

## makes_mosaic
For elements with case 'mosaic' this indicates whether LTRs or internal regions make the element mosaic. 'LTR' if an LTR in the element is a different RT4-phylo row than another LTR or an internal region. 'int' if two internal regions have different RT4-phylo rows

* * * * *
