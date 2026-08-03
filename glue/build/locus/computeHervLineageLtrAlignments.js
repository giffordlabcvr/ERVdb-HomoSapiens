// glue/computeErvLocusAlignments.js
//
// Compute all ERV lineage and LTR alignments.
//
// Rules:
//
// ERV lineage alignments:
//   - alignment name begins AL_LINEAGE_
//   - if erv_lineage.consensus_orfs = YES, use rvCompoundAligner
//   - otherwise use rvCompoundAlignerNoOrfs
//   - explicit lineage overrides may force a different aligner
//
// LTR alignments:
//   - alignment name begins AL_LTR_
//   - always use ltrMafftAligner
//
// General:
//   - only compute alignments containing more than one member
//
// Assumptions:
//   - lineage alignments are named:
//       AL_LINEAGE_<lineage ID with non-alphanumerics removed>
//   - LTR alignments are named:
//       AL_LTR_<LTR identifier with non-alphanumerics removed>
//   - alignment members have already been added
//
// This script computes every eligible alignment whose name begins
// AL_LINEAGE_ or AL_LTR_.

var DRY_RUN = false;


// -----------------------------------------------------------------------------
// Explicit module overrides
// -----------------------------------------------------------------------------

var alignerOverrideByLineageId = {
	"HERV-L": "rvCompoundAlignerNoEnv",
	"HERV-4": "rvCompoundAlignerNoEnv"
};


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function log(msg) {
	glue.log("INFO", msg);
}


function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var s = ("" + value).trim();

	if(s === "" ||
			s === "-" ||
			s.toLowerCase() === "n/a") {

		return null;
	}

	return s;
}


function sanitizeRefSuffix(name) {

	return ("" + name).replace(
		/[^A-Za-z0-9]/g,
		""
	);
}


function escapeQuotes(value) {

	return ("" + value)
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'");
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

	return glue.command(cmdWords);
}


// -----------------------------------------------------------------------------
// Count alignment members
// -----------------------------------------------------------------------------

function countAlignmentMembers(alignmentName) {

	var rows;

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
// Load lineage information
//
// Build a lookup keyed by the sanitised lineage ID.
//
// Example:
//
//   HERV-K-HML2 -> HERVKHML2
//
// This matches the suffix used in:
//
//   AL_LINEAGE_HERVKHML2
// -----------------------------------------------------------------------------

function loadLineageInfoByAlignmentSuffix() {

	var rows = queryObjects([
		"list",
		"custom-table-row",
		"erv_lineage",
		"id",
		"consensus_orfs",
		"-s",
		"id"
	]);

	var lineageInfoBySuffix = {};

	_.each(rows, function(row) {

		var lineageId =
			norm(row.id);

		if(lineageId === null) {
			return;
		}

		var alignmentSuffix =
			sanitizeRefSuffix(lineageId);

		if(lineageInfoBySuffix[
				alignmentSuffix
			] !== undefined) {

			throw new Error(
				"Sanitised lineage ID collision for '" +
				alignmentSuffix +
				"': " +
				lineageInfoBySuffix[
					alignmentSuffix
				].id +
				" and " +
				lineageId
			);
		}

		lineageInfoBySuffix[
			alignmentSuffix
		] = {
			id: lineageId,
			consensus_orfs:
				norm(row.consensus_orfs)
		};
	});

	return lineageInfoBySuffix;
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
// Aligner selection for ERV lineage alignments
// -----------------------------------------------------------------------------

function chooseLineageAlignerModule(
	lineageRow
) {

	var lineageId =
		lineageRow.id;

	if(alignerOverrideByLineageId
			.hasOwnProperty(lineageId)) {

		return alignerOverrideByLineageId[
			lineageId
		];
	}

	if(lineageRow.consensus_orfs ===
			"YES") {

		return "rvCompoundAligner";
	}

	return "rvCompoundAlignerNoOrfs";
}


// -----------------------------------------------------------------------------
// Compute one ERV lineage alignment
// -----------------------------------------------------------------------------

function computeLineageAlignment(
	alignmentName,
	lineageInfoBySuffix
) {

	var alignmentSuffix =
		alignmentName.substring(
			"AL_LINEAGE_".length
		);

	var lineageRow =
		lineageInfoBySuffix[
			alignmentSuffix
		];

	if(lineageRow === undefined) {

		log(
			"Skipping lineage alignment " +
			alignmentName +
			": no matching erv_lineage row for suffix '" +
			alignmentSuffix +
			"'"
		);

		return {
			status: "skipped",
			type: "LINEAGE",
			alignmentName: alignmentName,
			reason: "NO_LINEAGE_ROW"
		};
	}

	var moduleName =
		chooseLineageAlignerModule(
			lineageRow
		);

	runCmd([
		"compute",
		"alignment",
		alignmentName,
		moduleName
	]);

	log(
		"Computed " +
		alignmentName +
		" using " +
		moduleName +
		" for lineage " +
		lineageRow.id
	);

	return {
		status: "computed",
		type: "LINEAGE",
		alignmentName: alignmentName,
		moduleName: moduleName,
		lineageId: lineageRow.id
	};
}


// -----------------------------------------------------------------------------
// Compute one LTR alignment
// -----------------------------------------------------------------------------

function computeLtrAlignment(
	alignmentName
) {

	var moduleName =
		"ltrMafftAligner";

	runCmd([
		"compute",
		"alignment",
		alignmentName,
		moduleName
	]);

	log(
		"Computed " +
		alignmentName +
		" using " +
		moduleName
	);

	return {
		status: "computed",
		type: "LTR",
		alignmentName: alignmentName,
		moduleName: moduleName
	};
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

var lineageInfoBySuffix =
	loadLineageInfoByAlignmentSuffix();

var alignmentRows =
	loadTargetAlignments();

log(
	"Loaded " +
	alignmentRows.length +
	" AL_LINEAGE_* and AL_LTR_* alignments"
);

var lineageComputedCount = 0;
var ltrComputedCount = 0;
var skippedLineageCount = 0;
var skippedInsufficientMembersCount = 0;
var unexpectedAlignmentCount = 0;

_.each(alignmentRows, function(row) {

	var alignmentName =
		norm(row.name);

	if(alignmentName === null) {

		unexpectedAlignmentCount++;

		log(
			"Skipping alignment row with no name"
		);

		return;
	}

	var memberCount =
		countAlignmentMembers(
			alignmentName
		);

	if(memberCount <= 1) {

		skippedInsufficientMembersCount++;

		log(
			"Skipping " +
			alignmentName +
			": only " +
			memberCount +
			" alignment member(s)"
		);

		return;
	}

	if(alignmentName.indexOf(
			"AL_LINEAGE_"
		) === 0) {

		var lineageResult =
			computeLineageAlignment(
				alignmentName,
				lineageInfoBySuffix
			);

		if(lineageResult.status ===
				"computed") {

			lineageComputedCount++;
		}
		else {

			skippedLineageCount++;
		}

		return;
	}

	if(alignmentName.indexOf(
			"AL_LTR_"
		) === 0) {

		computeLtrAlignment(
			alignmentName
		);

		ltrComputedCount++;

		return;
	}

	unexpectedAlignmentCount++;

	log(
		"Skipping unexpected alignment name: " +
		alignmentName
	);
});


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log(
	"ALIGNMENT COMPUTATION SUMMARY"
);

log(
	"ERV lineage alignments computed: " +
	lineageComputedCount
);

log(
	"LTR alignments computed: " +
	ltrComputedCount
);

log(
	"ERV lineage alignments skipped because no lineage row was found: " +
	skippedLineageCount
);

log(
	"Alignments skipped with <= 1 member: " +
	skippedInsufficientMembersCount
);

log(
	"Unexpected alignment rows: " +
	unexpectedAlignmentCount
);

log(
	"Finished computing ERV lineage and LTR alignments."
);

