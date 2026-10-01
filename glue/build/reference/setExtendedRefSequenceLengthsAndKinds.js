/**
 * Update `length` and `sequence_kind` for reference sequences.
 *
 * Rules:
 * - source 'erv' gets sequence_kind = 'erv_ref'
 * - source 'ltr' gets sequence_kind = 'ltr_ref'
 * - source 'erv-sub' gets sequence_kind = 'erv_sub_ref'
 * - source 'ltr-sub' gets sequence_kind = 'ltr_sub_ref'
 * - source 'ervr' gets sequence_kind = 'ervr_ref'
 * - source 'repeat' gets sequence_kind = 'repeat_ref'
 *
 * Any other sources are ignored.
 */
 
var sourceObjs = glue.tableToObjects(glue.command(["list", "source"]));

function getSequenceKindForSource(sourceName) {

	if(sourceName === "erv") {
		return "erv_ref";
	}

	if(sourceName === "ltr") {
		return "ltr_ref";
	}

	if(sourceName === "erv-sub") {
		return "erv_sub_ref";
	}

	if(sourceName === "ltr-sub") {
		return "ltr_sub_ref";
	}

	if(sourceName === "ervr") {
		return "ervr_ref";
	}

	if(sourceName === "repeat") {
		return "repeat_ref";
	}

	return null;
}

_.each(_.sortBy(sourceObjs, "name"), function(source) {

	var sourceName = source.name;
	var sequenceKind = getSequenceKindForSource(sourceName);

	if(sequenceKind == null) {
		return;
	}

	var escapedSourceName = sourceName.replace(/'/g, "\\'");

	var seqObjs = glue.tableToObjects(glue.command([
		"list", "sequence",
		"-w", "source.name = '" + escapedSourceName + "'"
	]));

	glue.log("INFO", "Processing source: " + sourceName +
		" (" + seqObjs.length + " sequences, sequence_kind=" + sequenceKind + ")");

	_.each(seqObjs, function(seq) {

		var seqID = seq.sequenceID;

		glue.inMode("/sequence/" + sourceName + "/" + seqID, function() {
			var length = glue.command("show length").lengthResult.length;
			glue.command(["set", "field", "length", length]);
			glue.command(["set", "field", "sequence_kind", sequenceKind]);
		});
	});
});
