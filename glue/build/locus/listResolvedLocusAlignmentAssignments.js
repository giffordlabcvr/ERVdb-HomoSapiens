// glue/build/locus/listResolvedLocusAlignmentAssignments.js
//
// Dry-run script to identify alignment assignments for fully resolved
// ERV locus candidates.
//
// Inclusion criteria:
//   length >= 100
//   case_status = 'Fully resolved'
//
// Matching rules:
//   status = ERV -> names_decision -> AL_LINEAGE_*
//   status = LTR -> names          -> AL_LTR_*
//
// Matching is case-insensitive and ignores hyphens.
//
// Repeated identical classifications are collapsed:
//
//   MER57B1,MER57B1 -> MER57B1
//   ERV-L,ERVL      -> ERV-L
//
// Genuinely conflicting classifications are reported as exceptions.
//
// This script does not modify the project.


// -------------------------------------------------------------------------
// Normalise a lineage or LTR name for matching
// -------------------------------------------------------------------------

function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var s = ("" + value).trim();

	if(s === "") {
		return null;
	}

	return s
		.replace(/-/g, "")
		.toLowerCase();
}


// -------------------------------------------------------------------------
// Resolve a curated classification field
//
// Repeated equivalent names are collapsed.
//
// Examples:
//
//   MER57B1,MER57B1 -> MER57B1
//   ERV-L,ERVL      -> ERV-L
//
// If more than one distinct normalised name remains, the result is
// considered conflicting.
// -------------------------------------------------------------------------

function resolveClassification(value) {

	if(value === null || value === undefined) {
		return {
			status: "missing",
			classification: null,
			originalValue: value
		};
	}

	var originalValue = ("" + value).trim();

	if(originalValue === "") {
		return {
			status: "missing",
			classification: null,
			originalValue: originalValue
		};
	}

	var parts = originalValue.split(",");
	var nameByKey = {};
	var keys = [];

	for(var i = 0; i < parts.length; i++) {

		var name = parts[i].trim();
		var key = norm(name);

		if(key === null) {
			continue;
		}

		if(nameByKey[key] === undefined) {

			nameByKey[key] = name;
			keys.push(key);
		}
	}

	if(keys.length === 0) {

		return {
			status: "missing",
			classification: null,
			originalValue: originalValue
		};
	}

	if(keys.length > 1) {

		return {
			status: "conflicting",
			classification: null,
			originalValue: originalValue,
			keys: keys
		};
	}

	return {
		status: "resolved",
		classification: nameByKey[keys[0]],
		normalisedKey: keys[0],
		originalValue: originalValue
	};
}


// -------------------------------------------------------------------------
// Add an alignment to a lookup table
// -------------------------------------------------------------------------

function addAlignmentToLookup(
	lookup,
	key,
	alignmentName,
	alignmentType
) {

	if(key === null) {
		return;
	}

	if(lookup[key] !== undefined &&
			lookup[key] !== alignmentName) {

		throw new Error(
			"Normalised " +
			alignmentType +
			" alignment-name collision for key '" +
			key +
			"': " +
			lookup[key] +
			" and " +
			alignmentName
		);
	}

	lookup[key] = alignmentName;
}


// -------------------------------------------------------------------------
// Load lineage and LTR alignments
// -------------------------------------------------------------------------

var alignmentRows = glue.tableToObjects(
	glue.command([
		"list",
		"alignment",
		"name",
		"-w",
		"name like 'AL_LINEAGE%' or name like 'AL_LTR%'"
	])
);

glue.logInfo(
	"Alignment rows retrieved: " +
	alignmentRows.length
);

var lineageAlignmentByKey = {};
var ltrAlignmentByKey = {};

var lineageAlignmentCount = 0;
var ltrAlignmentCount = 0;
var unexpectedAlignmentCount = 0;

for(var i = 0; i < alignmentRows.length; i++) {

	var alignmentRow = alignmentRows[i];
	var alignmentName = alignmentRow.name;

	if(alignmentName === null ||
			alignmentName === undefined ||
			("" + alignmentName).trim() === "") {

		glue.logInfo(
			"WARNING: Alignment row has no name"
		);

		continue;
	}

	alignmentName = "" + alignmentName;

	if(alignmentName.indexOf("AL_LINEAGE_") === 0) {

		var lineageName = alignmentName.substring(
			"AL_LINEAGE_".length
		);

		var lineageKey = norm(lineageName);

		addAlignmentToLookup(
			lineageAlignmentByKey,
			lineageKey,
			alignmentName,
			"lineage"
		);

		lineageAlignmentCount++;
	}
	else if(alignmentName.indexOf("AL_LTR_") === 0) {

		var ltrName = alignmentName.substring(
			"AL_LTR_".length
		);

		var ltrKey = norm(ltrName);

		addAlignmentToLookup(
			ltrAlignmentByKey,
			ltrKey,
			alignmentName,
			"LTR"
		);

		ltrAlignmentCount++;
	}
	else {

		unexpectedAlignmentCount++;

		glue.logInfo(
			"WARNING: Unexpected alignment name: " +
			alignmentName
		);
	}
}

glue.logInfo(
	"Lineage alignments indexed: " +
	lineageAlignmentCount
);

glue.logInfo(
	"LTR alignments indexed: " +
	ltrAlignmentCount
);

glue.logInfo(
	"Unexpected alignment names: " +
	unexpectedAlignmentCount
);


// -------------------------------------------------------------------------
// Load fully resolved locus candidates
// -------------------------------------------------------------------------

var candidateRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		"erv_locus_candidate",
		"id",
		"status",
		"length",
		"case_status",
		"chrom",
		"start_position",
		"names_decision",
		"phylogeny_name",
		"names",
		"-w",
		"length >= 100 and case_status = 'Fully resolved'",
		"-s",
		"status,names_decision,id"
	])
);

glue.logInfo(
	"Candidate rows retrieved: " +
	candidateRows.length
);


// -------------------------------------------------------------------------
// Resolve each locus candidate to an alignment
// -------------------------------------------------------------------------

var assignments = [];
var unmatched = [];
var conflictingClassifications = [];
var missingClassifications = [];
var unsupportedStatuses = [];

for(var i = 0; i < candidateRows.length; i++) {

	var row = candidateRows[i];

	var locusID = row.id;
	var locusStatus = row.status;

	if(locusID === null ||
			locusID === undefined ||
			("" + locusID).trim() === "") {

		glue.logInfo(
			"WARNING: Candidate row has no id"
		);

		continue;
	}

	locusID = "" + locusID;

	var rawClassification;
	var alignmentLookup;

	if(locusStatus === "ERV") {

		rawClassification = row.names_decision;
		alignmentLookup = lineageAlignmentByKey;
	}
	else if(locusStatus === "LTR") {

		rawClassification = row.names;
		alignmentLookup = ltrAlignmentByKey;
	}
	else {

		unsupportedStatuses.push({
			id: locusID,
			status: locusStatus
		});

		continue;
	}

	var classificationResult = resolveClassification(
		rawClassification
	);

	if(classificationResult.status === "missing") {

		missingClassifications.push({
			id: locusID,
			status: locusStatus,
			value: rawClassification
		});

		continue;
	}

	if(classificationResult.status === "conflicting") {

		conflictingClassifications.push({
			id: locusID,
			status: locusStatus,
			classification: classificationResult.originalValue
		});

		continue;
	}

	var classificationName =
		classificationResult.classification;

	var classificationKey =
		classificationResult.normalisedKey;

	var alignmentName =
		alignmentLookup[classificationKey];

	if(alignmentName === null ||
		alignmentName === undefined) {

		unmatched.push({
			id: locusID,
			status: locusStatus,
			classification: classificationName,
			originalClassification:
				classificationResult.originalValue,
			key: classificationKey
		});

		continue;
	}

	assignments.push({
		id: locusID,
		status: locusStatus,
		classification: classificationName,
		originalClassification:
			classificationResult.originalValue,
		alignmentName: alignmentName,
		length: row.length,
		chrom: row.chrom,
		start_position: row.start_position
	});
}


// -------------------------------------------------------------------------
// Report summary
// -------------------------------------------------------------------------

glue.logInfo(
	"Resolved assignments: " +
	assignments.length
);

glue.logInfo(
	"Unmatched classifications: " +
	unmatched.length
);

glue.logInfo(
	"Conflicting fully resolved classifications: " +
	conflictingClassifications.length
);

glue.logInfo(
	"Missing classifications: " +
	missingClassifications.length
);

glue.logInfo(
	"Unsupported statuses: " +
	unsupportedStatuses.length
);


// -------------------------------------------------------------------------
// Report resolved assignments
// -------------------------------------------------------------------------

for(var i = 0; i < assignments.length; i++) {

	var assignment = assignments[i];

	glue.logInfo(
		"ASSIGN\t" +
		assignment.id + "\t" +
		assignment.status + "\t" +
		assignment.classification + "\t" +
		assignment.alignmentName
	);
}


// -------------------------------------------------------------------------
// Report conflicting classifications
// -------------------------------------------------------------------------

for(var i = 0;
		i < conflictingClassifications.length;
		i++) {

	var conflictingRow =
		conflictingClassifications[i];

	glue.logInfo(
		"CONFLICTING_CLASSIFICATION\t" +
		conflictingRow.id + "\t" +
		conflictingRow.status + "\t" +
		conflictingRow.classification
	);
}


// -------------------------------------------------------------------------
// Report missing classifications
// -------------------------------------------------------------------------

for(var i = 0;
		i < missingClassifications.length;
		i++) {

	var missingRow = missingClassifications[i];

	glue.logInfo(
		"MISSING_CLASSIFICATION\t" +
		missingRow.id + "\t" +
		missingRow.status
	);
}


// -------------------------------------------------------------------------
// Report unsupported status values
// -------------------------------------------------------------------------

for(var i = 0;
		i < unsupportedStatuses.length;
		i++) {

	var unsupportedRow = unsupportedStatuses[i];

	glue.logInfo(
		"UNSUPPORTED_STATUS\t" +
		unsupportedRow.id + "\t" +
		unsupportedRow.status
	);
}


// -------------------------------------------------------------------------
// Build unmatched-classification summary
// -------------------------------------------------------------------------

var unmatchedSummaryByKey = {};

for(var i = 0; i < unmatched.length; i++) {

	var unmatchedRow = unmatched[i];

	var summaryKey =
		unmatchedRow.status + "\t" +
		unmatchedRow.key;

	var summaryRow =
		unmatchedSummaryByKey[summaryKey];

	if(summaryRow === undefined) {

		summaryRow = {
			status: unmatchedRow.status,
			classification:
				unmatchedRow.classification,
			normalisedKey: unmatchedRow.key,
			count: 0,
			exampleLocus: unmatchedRow.id
		};

		unmatchedSummaryByKey[summaryKey] =
			summaryRow;
	}

	summaryRow.count++;
}

var unmatchedSummary = [];
var unmatchedSummaryKeys = Object.keys(
	unmatchedSummaryByKey
);

for(var i = 0;
		i < unmatchedSummaryKeys.length;
		i++) {

	var summaryKey = unmatchedSummaryKeys[i];

	unmatchedSummary.push(
		unmatchedSummaryByKey[summaryKey]
	);
}


// -------------------------------------------------------------------------
// Sort unmatched summary
//
// Sort order:
//   1. status
//   2. descending locus count
//   3. classification
// -------------------------------------------------------------------------

unmatchedSummary.sort(function(a, b) {

	if(a.status < b.status) {
		return -1;
	}

	if(a.status > b.status) {
		return 1;
	}

	if(a.count !== b.count) {
		return b.count - a.count;
	}

	if(a.classification < b.classification) {
		return -1;
	}

	if(a.classification > b.classification) {
		return 1;
	}

	return 0;
});


// -------------------------------------------------------------------------
// Print unmatched-classification summary table
// -------------------------------------------------------------------------

glue.logInfo(
	"UNMATCHED CLASSIFICATION SUMMARY"
);

glue.logInfo(
	"STATUS\tCLASSIFICATION\tNORMALISED_KEY\tLOCUS_COUNT\tEXAMPLE_LOCUS"
);

for(var i = 0; i < unmatchedSummary.length; i++) {

	var unmatchedSummaryRow =
		unmatchedSummary[i];

	glue.logInfo(
		unmatchedSummaryRow.status + "\t" +
		unmatchedSummaryRow.classification + "\t" +
		unmatchedSummaryRow.normalisedKey + "\t" +
		unmatchedSummaryRow.count + "\t" +
		unmatchedSummaryRow.exampleLocus
	);
}

