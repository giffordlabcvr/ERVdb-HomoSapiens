/**
 * Update `length` and `sequence_kind` for reference sequences.
 *
 * Rules:
 * - sources matching ^erv-refseqs-...$ get sequence_kind = 'erv_ref'
 * - sources matching ^ltr-refseqs-([A-Za-z0-9._-]+)$ get
 *     sequence_kind = 'ltr_' + suffix + '_ref'
 *
 * Examples:
 * - ltr-refseqs-erranti -> ltr_erranti_ref
 * - ltr-refseqs-erv     -> ltr_erv_ref
 * - ltr-refseqs-malr    -> ltr_malr_ref
 * - ltr-refseqs-orphan  -> ltr_orphan_ref
 *
 * Any other sources are ignored.
 */

// Step 1: Get all sources in the project
var sourceObjs = glue.tableToObjects(glue.command(["list", "source"]));

function getSequenceKindForSource(sourceName) {
	var ltrMatch = sourceName.match(/^ltr-refseqs-([A-Za-z0-9._-]+)$/);
	if(ltrMatch) {
		return "ltr_" + ltrMatch[1] + "_ref";
	}
	if(/^erv-refseqs-[A-Za-z0-9._-]+$/.test(sourceName)) {
		return "erv_ref";
	}
	return null;
}

// Step 2: Process matching sources
_.each(_.sortBy(sourceObjs, "name"), function(source) {

	var sourceName = source.name;
	var sequenceKind = getSequenceKindForSource(sourceName);

	if(sequenceKind == null) {
		return;
	}

	var escapedSourceName = sourceName.replace(/'/g, "\\'");

	var seqObjs = glue.tableToObjects(glue.command([
		"list", "sequence", "-w", "source.name = '" + escapedSourceName + "'"
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