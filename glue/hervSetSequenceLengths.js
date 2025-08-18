var sources = ["homo_sapiens_mosaic", "homo_sapiens_malr", "homo_sapiens_ltr", "homo_sapiens"];

_.each(sources, function(sourceName) {
	var seqIDs = glue.getTableColumn(
		glue.command(["list", "sequence", "-w", "source.name = '"+sourceName+"'"]),
		"sequenceID"
	);

	_.each(seqIDs, function(sequenceID) {
		glue.inMode("/sequence/"+sourceName+"/"+sequenceID, function() {
			var length = glue.command("show length").lengthResult.length;
			glue.command(["set", "field", "length", length]);
		});
	});
});
