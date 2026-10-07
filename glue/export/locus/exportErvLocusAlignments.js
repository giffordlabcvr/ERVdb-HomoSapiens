// glue/export/exportErvLocusAlignments.js
//
// Export all populated ERV lineage and LTR alignments as aligned FASTA.
//
// Included alignments:
//   AL_LINEAGE_%
//   AL_LTR_%
//
// Only alignments containing more than one member are exported.
//
// Output:
//   web-app/alignments/<alignment-name>.aln.fna
//
// The fastaAlignmentExporterLineage module is recreated from:
//
//   modules/export/fastaAlignmentExporterLineage.xml
//
// Assumes this script is run from within the ervdb project mode.


var DRY_RUN = false;

var EXPORTER_MODULE_NAME =
	"fastaAlignmentExporterLineage";

var EXPORTER_MODULE_FILE =
	"modules/export/fastaAlignmentExporterLineage.xml";

var OUTPUT_DIRECTORY =
	"web-app/alignments";


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function log(msg) {
	glue.log("INFO", msg);
}


function norm(value) {

	if(value === null ||
			value === undefined) {

		return null;
	}

	var s = ("" + value).trim();

	if(s === "") {
		return null;
	}

	return s;
}


function queryObjects(cmdWords) {

	return glue.tableToObjects(
		glue.command(cmdWords)
	);
}


function runCmd(cmdWords) {

	if(DRY_RUN) {

		log(
			"[DRY RUN] " +
			cmdWords.join(" ")
		);

		return null;
	}

	return glue.command(
		cmdWords
	);
}


// -----------------------------------------------------------------------------
// Count members in one alignment
//
// Equivalent console syntax:
//
//   alignment <alignmentName> list member
// -----------------------------------------------------------------------------

function countAlignmentMembers(
	alignmentName
) {

	var rows = [];

	glue.inMode(
		"/alignment/" + alignmentName,
		function() {

			rows = queryObjects([
				"list",
				"member"
			]);
		}
	);

	return rows.length;
}


// -----------------------------------------------------------------------------
// Recreate FASTA alignment exporter module
// -----------------------------------------------------------------------------

function recreateExporterModule() {

	runCmd([
		"delete",
		"module",
		EXPORTER_MODULE_NAME
	]);

	runCmd([
		"create",
		"module",
		"-f",
		EXPORTER_MODULE_FILE
	]);

	log(
		"Recreated module " +
		EXPORTER_MODULE_NAME +
		" from " +
		EXPORTER_MODULE_FILE
	);
}


// -----------------------------------------------------------------------------
// Load target alignments
// -----------------------------------------------------------------------------

function loadTargetAlignments() {

	return queryObjects([
		"list",
		"alignment",
		"name",
		"-w",
		"name like 'AL_LINEAGE_%' or name like 'AL_LTR_%'",
		"-s",
		"name"
	]);
}


// -----------------------------------------------------------------------------
// Export one alignment
// -----------------------------------------------------------------------------

function exportAlignment(
	alignmentName
) {

	var outputPath =
		OUTPUT_DIRECTORY +
		"/" +
		alignmentName +
		".aln.fna";

	glue.inMode(
		"/module/" +
			EXPORTER_MODULE_NAME,
		function() {

			runCmd([
				"export",
				alignmentName,
				"-a",
				"-o",
				outputPath
			]);
		}
	);

	log(
		"Exported " +
		alignmentName +
		" to " +
		outputPath
	);
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

recreateExporterModule();

var alignmentRows =
	loadTargetAlignments();

log(
	"Loaded " +
	alignmentRows.length +
	" AL_LINEAGE_% and AL_LTR_% alignments"
);

var lineageExportedCount = 0;
var ltrExportedCount = 0;

var lineageSkippedCount = 0;
var ltrSkippedCount = 0;

var unexpectedAlignmentCount = 0;


_.each(
	alignmentRows,
	function(row) {

		var alignmentName =
			norm(row.name);

		if(alignmentName === null) {

			unexpectedAlignmentCount++;

			log(
				"Skipping alignment row with no name"
			);

			return;
		}

		var alignmentType;

		if(alignmentName.indexOf(
				"AL_LINEAGE_"
			) === 0) {

			alignmentType =
				"LINEAGE";
		}
		else if(alignmentName.indexOf(
				"AL_LTR_"
			) === 0) {

			alignmentType =
				"LTR";
		}
		else {

			unexpectedAlignmentCount++;

			log(
				"Skipping unexpected alignment name: " +
				alignmentName
			);

			return;
		}


		var memberCount =
			countAlignmentMembers(
				alignmentName
			);

		if(memberCount <= 1) {

			if(alignmentType ===
					"LINEAGE") {

				lineageSkippedCount++;
			}
			else {

				ltrSkippedCount++;
			}

			log(
				"Skipping " +
				alignmentName +
				": only " +
				memberCount +
				" alignment member(s)"
			);

			return;
		}


		exportAlignment(
			alignmentName
		);

		if(alignmentType ===
				"LINEAGE") {

			lineageExportedCount++;
		}
		else {

			ltrExportedCount++;
		}
	}
);


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log(
	"ALIGNMENT EXPORT SUMMARY"
);

log(
	"ERV lineage alignments exported: " +
	lineageExportedCount
);

log(
	"LTR alignments exported: " +
	ltrExportedCount
);

log(
	"ERV lineage alignments skipped with <= 1 member: " +
	lineageSkippedCount
);

log(
	"LTR alignments skipped with <= 1 member: " +
	ltrSkippedCount
);

log(
	"Unexpected alignment rows: " +
	unexpectedAlignmentCount
);

log(
	"Finished exporting ERV lineage and LTR alignments."
);

