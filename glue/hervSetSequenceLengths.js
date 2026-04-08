var sources = ["fr_rt4_samerow", "fr_samename"];

_.each(sources, function(sourceName) {
	var seqIDs = glue.getTableColumn(
		glue.command(["list", "sequence", "-w", "source.name = '"+sourceName+"'"]),
		"sequenceID"
	);

	_.each(seqIDs, function(sequenceID) {
		glue.inMode("/sequence/"+sourceName+"/"+sequenceID, function() {
			var length = glue.command("show length").lengthResult.length;
			glue.command(["set", "field", "length", length]);
            glue.command(["set", "field", "sequence_kind", '[proviral_locus']);

		});
	});
});
