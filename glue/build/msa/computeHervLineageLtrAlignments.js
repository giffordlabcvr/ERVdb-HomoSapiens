// glue/build/locus/msa/computeHervLineageLtrAlignments.js
//
// Compute LTR-lineage alignments after locus sequences have been added.
//
// Target alignments:
//
//   AL_LTR_*
//
// Every target alignment containing more than one member is computed using:
//
//   ltrMafftAligner
//
// ERV lineage and sublineage alignments are handled separately by:
//
//   computeHervLineageAlignments.js
//
// This script deliberately allows alignment computation errors to propagate,
// so a failed alignment stops the build rather than being silently skipped.

var DRY_RUN = false;

var ALIGNER_MODULE =
	"ltrMafftAligner";


// -------------------------------------------------------------------------
// General utilities
// -------------------------------------------------------------------------

function log(message) {
	glue.logInfo(message);
}


function norm(value) {

	if(value === null ||
		value === undefined) {

		return null;
	}

	var result =
		("" + value).trim();

	if(result === "") {
		return null;
	}

	var lower =
		result.toLowerCase();

	if(lower === "n/a" ||
		lower === "na" ||
		lower === "n/k" ||
		lower === "nk" ||
		lower === "unknown" ||
		lower === "null" ||
		lower === "none" ||
		result === "-") {

		return null;
	}

	return result;
}


function queryObjects(commandWords) {

	return glue.tableToObjects(
		glue.command(
			commandWords
		)
	);
}


function runCommand(commandWords) {

	if(DRY_RUN) {

		log(
			"[DRY RUN] " +
			commandWords.join(" ")
		);

		return null;
	}

	return glue.command(
		commandWords
	);
}


// -------------------------------------------------------------------------
// Count members of one alignment
// -------------------------------------------------------------------------

function countAlignmentMembers(
	alignmentName
) {

	var memberRows = [];

	glue.inMode(
		"/alignment/" +
		alignmentName,
		function() {

			memberRows =
				queryObjects([
					"list",
					"member"
				]);
		}
	);

	return memberRows.length;
}


// -------------------------------------------------------------------------
// Load LTR alignments
// -------------------------------------------------------------------------

log(
	"Loading LTR-lineage alignments"
);

var alignmentRows =
	queryObjects([
		"list",
		"alignment",
		"name",
		"parent.name",
		"refSequence.name",
		"-w",
		"name like 'AL_LTR_%'",
		"-s",
		"name"
	]);

log(
	"Loaded " +
	alignmentRows.length +
	" AL_LTR_* alignments"
);


// -------------------------------------------------------------------------
// Compute eligible LTR alignments
// -------------------------------------------------------------------------

var computed = [];
var skippedInsufficientMembers = [];
var skippedMissingNameCount = 0;

for(var i = 0;
	i < alignmentRows.length;
	i++) {

	var alignmentRow =
		alignmentRows[i];

	var alignmentName =
		norm(
			alignmentRow.name
		);

	var parentAlignmentName =
		norm(
			alignmentRow[
				"parent.name"
			]
		);

	var referenceName =
		norm(
			alignmentRow[
				"refSequence.name"
			]
		);

	if(alignmentName === null) {

		skippedMissingNameCount++;

		log(
			"Skipping alignment row with no name"
		);

		continue;
	}

	var memberCount =
		countAlignmentMembers(
			alignmentName
		);

	if(memberCount <= 1) {

		skippedInsufficientMembers.push({
			alignmentName:
				alignmentName,
			parentAlignmentName:
				parentAlignmentName,
			referenceName:
				referenceName,
			memberCount:
				memberCount
		});

		log(
			"Skipping " +
			alignmentName +
			": only " +
			memberCount +
			" alignment member(s)"
		);

		continue;
	}

	log(
		"Computing " +
		alignmentName +
		" using " +
		ALIGNER_MODULE +
		"; reference=" +
		(
			referenceName !== null
				? referenceName
				: "(none)"
		) +
		"; members=" +
		memberCount
	);

	runCommand([
		"compute",
		"alignment",
		alignmentName,
		ALIGNER_MODULE
	]);

	computed.push({
		alignmentName:
			alignmentName,
		parentAlignmentName:
			parentAlignmentName,
		referenceName:
			referenceName,
		memberCount:
			memberCount
	});

	log(
		"Computed " +
		alignmentName +
		" using " +
		ALIGNER_MODULE
	);
}


// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

log(
	"============================================================"
);

log(
	"LTR-lineage alignment computation summary"
);

log(
	"============================================================"
);

log(
	"LTR alignments examined: " +
	alignmentRows.length
);

log(
	"LTR alignments computed: " +
	computed.length
);

log(
	"LTR alignments skipped with <= 1 member: " +
	skippedInsufficientMembers.length
);

log(
	"Alignment rows skipped because the name was missing: " +
	skippedMissingNameCount
);


// -------------------------------------------------------------------------
// Detailed computed-alignment report
// -------------------------------------------------------------------------

for(var i = 0;
	i < computed.length;
	i++) {

	var computedRow =
		computed[i];

	log(
		"COMPUTED\t" +
		computedRow.alignmentName +
		"\t" +
		(
			computedRow.referenceName !== null
				? computedRow.referenceName
				: "(none)"
		) +
		"\t" +
		computedRow.memberCount +
		"\t" +
		ALIGNER_MODULE
	);
}


// -------------------------------------------------------------------------
// Detailed skipped-alignment report
// -------------------------------------------------------------------------

for(var i = 0;
	i < skippedInsufficientMembers.length;
	i++) {

	var skippedRow =
		skippedInsufficientMembers[i];

	log(
		"SKIPPED_INSUFFICIENT_MEMBERS\t" +
		skippedRow.alignmentName +
		"\t" +
		(
			skippedRow.referenceName !== null
				? skippedRow.referenceName
				: "(none)"
		) +
		"\t" +
		skippedRow.memberCount
	);
}


log(
	DRY_RUN
		? "Dry run finished; no LTR alignments were computed"
		: "Finished computing LTR-lineage alignments"
);
