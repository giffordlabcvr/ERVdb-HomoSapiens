var sources = [

    "filtered_2026_07",

    "fr_rt4_samerow",
    "fr_samename",
    "fr_only1id",
    "fr_harlequin",
    
    "r_rt4_phyloclade",
    "r_rt4_phylosubgroup",
    "r_rt4_phylogroup",
    "r_rt4_phyloname"
];

_.each(sources, function(sourceName) {
	var seqIDs = glue.getTableColumn(
		glue.command(["list", "sequence", "-w", "source.name = '"+sourceName+"'"]),
		"sequenceID"
	);

	_.each(seqIDs, function(sequenceID) {
		glue.inMode("/sequence/"+sourceName+"/"+sequenceID, function() {
			var length = glue.command("show length").lengthResult.length;
			glue.command(["set", "field", "length", length]);
            glue.command(["set", "field", "sequence_kind", 'erv_locus']);

		});
	});
});
