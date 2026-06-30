/**
 * Update `length` and `sequence_kind` for reference sequences.
 *
 * Rules:
 * - sources matching ^erv-refseqs-...-sub$ get sequence_kind = 'erv_sub_ref'
 * - sources matching ^erv-refseqs-...$ get sequence_kind = 'erv_ref'
 * - sources matching ^ltr_refseqs_erv[123]_sublineage$ get
 *     sequence_kind = 'ltr_erv<N>_sub_ref'
 * - sources matching ^ltr-refseqs-([A-Za-z0-9._-]+)$ get
 *     sequence_kind = 'ltr_' + suffix + '_ref'
 */

var sourceObjs = glue.tableToObjects(glue.command(["list", "source"]));

function getSequenceKindForSource(sourceName) {

	var ltrSubMatch = sourceName.match(/^ltr_refseqs_erv([123])_sublineage$/);
	if(ltrSubMatch) {
		return "ltr_erv" + ltrSubMatch[1] + "_sub_ref";
	}

	if(/^erv-refseqs-[A-Za-z0-9._-]+-sub$/.test(sourceName)) {
		return "erv_sub_ref";
	}

	var ltrMatch = sourceName.match(/^ltr-refseqs-([A-Za-z0-9._-]+)$/);
	if(ltrMatch) {
		return "ltr_" + ltrMatch[1].replace(/-/g, "_") + "_ref";
	}

	if(/^erv-refseqs-[A-Za-z0-9._-]+$/.test(sourceName)) {
		return "erv_ref";
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
