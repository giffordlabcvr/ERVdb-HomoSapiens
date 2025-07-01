var seqIDs = glue.getTableColumn(glue.command(["list", "sequence", "-w", "source.name = 'homo_sapiens'"]), "sequenceID");

_.each(seqIDs, function(sequenceID) {
	glue.inMode("/sequence/homo_sapiens/"+sequenceID, function() {
		var length = glue.command("show length").lengthResult.length;
		glue.command(["set", "field", "length", length]);
	});
});