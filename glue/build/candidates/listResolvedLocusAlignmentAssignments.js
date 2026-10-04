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
// Compatible LTR subtype classifications may be collapsed to a shared
// parent LTR family:
//
//   LTR7,LTR7A      -> LTR7
//   LTR16C,LTR16E2  -> LTR16
//
// Genuinely conflicting classifications are reported as exceptions.
//
// This script does not modify the project.


// -------------------------------------------------------------------------
// Explicit LTR subtype-to-family mappings
// -------------------------------------------------------------------------

var ltrFamilyBySubtype = {

	// LTR5 family
	"LTR1":  "LTR1",
	"LTR1A": "LTR1",
	"LTR1B": "LTR1",
	"LTR1C": "LTR1",

	// LTR5 family
	"LTR5": "LTR5",
	"LTR5-Hs": "LTR5",
	"LTR5_Hs": "LTR5",
	"LTR5A": "LTR5",
	"LTR5B": "LTR5",

	// LTR7 family
	"LTR7":  "LTR7",
	"LTR7A": "LTR7",
	"LTR7B": "LTR7",
	"LTR7C": "LTR7",
	"LTR7Y": "LTR7",

	// LTR8 family
	"LTR8":  "LTR8",
	"LTR8A": "LTR8",
	"LTR8B": "LTR8",

	// LTR12 family
	"LTR12":  "LTR12",
	"LTR12_": "LTR12",
	"LTR12B": "LTR12",
	"LTR12C": "LTR12",
	"LTR12D": "LTR12",
	"LTR12E": "LTR12",

	// LTR13 family
	"LTR13": "LTR13",
	"LTR13A": "LTR13",
	"LTR13_": "LTR13",

	// MER66 family
	"MER66A": "MER66",
	"MER66B": "MER66",
	"MER66C": "MER66",

	// MER66 family
	"MER66A": "MER66",
	"MER66B": "MER66",
	"MER66C": "MER66",

	// MER83 family
	"MER83B": "MER83",
	"MER83C": "MER83",

	// MER70 family
	"MER70A": "MER70",
	"MER70B": "MER70",

	// MER83 family
	"MER83B": "MER83",
	"MER83C": "MER83",

	// MLT2A family
	"MLT2A1": "MLT2A",
	"MLT2A2": "MLT2A",

	// LTR16 family
	"LTR16A":        "LTR16",
	"LTR16A1":       "LTR16",
	"LTR16A2":       "LTR16",
	"LTR16B":        "LTR16",
	"LTR16B1":       "LTR16",
	"LTR16B2":       "LTR16",
	"LTR16C":        "LTR16",
	"LTR16D":        "LTR16",
	"LTR16D1":       "LTR16",
	"LTR16D2":       "LTR16",
	"LTR16E1":       "LTR16",
	"LTR16E2":       "LTR16",
	"ERV3-16A3_LTR": "LTR16"
};

var ervLineageTranslationByKey = {

	"ervle":       "ERV-L",
	"hervea":      "HERV-E",
	"hervip":      "HERV-I",

	"hervk(hml1)":  "HERV-K-HML1",
	"hervk(hml2)":  "HERV-K-HML2",
	"hervk(hml3)":  "HERV-K-HML3",
	"hervk(hml4)":  "HERV-K-HML4",
	"hervk(hml5)":  "HERV-K-HML5",
	"hervk(hml6)":  "HERV-K-HML6",
	"hervk(hml7)":  "HERV-K-HML7",
	"hervk(hml8)":  "HERV-K-HML8",
	"hervk(hml9)":  "HERV-K-HML9",
	"hervk(hml10)": "HERV-K-HML10",

	"hervlb1": "HERV-Lb",
	"hervlb2": "HERV-Lb",

	"hervrb1": "HERV-Rb",
	"hervrb2": "HERV-Rb",

	"huersp3b": "HERV-P",
	"rrhervi":  "HERV-15"
};

var ltrTranslationByKey = {

	// Naming and punctuation differences
	"erv316a3_ltr": "ERV316A3LTR",
	"mer4d0":       "MER4D",

	// Available representative alignments
	"ltr5_hs": "LTR5",
	"ltr7":    "LTR7A",
	"mer34":   "MER34A1",
	"mer66":   "MER66A",
	"mer70":   "MER70A",
	"mlt2a":   "MLT2A1",
	"mlt2b1":  "MLT2B3",
	"mlt2c1":  "MLT2C2",
	"mer61e":  "MER61",
	"mer61d":  "MER61",
	"mlt2b5":  "MLT2B4",
	"mer61f":  "MER61A",

	// Underscore variants
	"ltr12_":     "LTR12",
	"mer4a1_":    "MER4A1",
	"pabl_a":     "PABLA",
	"pabl_b":     "PABLB",
	"prima4_ltr": "PRIMA4LTR",

	// HERV1 LTR variants use the master alignment
	"herv1_ltra": "HERV1LTR",
	"herv1_ltrb": "HERV1LTR",
	"herv1_ltrc": "HERV1LTR",
	"herv1_ltrd": "HERV1LTR",
	"herv1_ltre": "HERV1LTR",

};



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
// For LTR records, multiple distinct names may also be resolved when all
// names map explicitly to the same parent LTR family.
//
// If more than one distinct normalised name remains and no shared LTR
// family can be identified, the result is considered conflicting.
// -------------------------------------------------------------------------

function resolveClassification(value, status) {

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

		if(status === "LTR") {

			var family = null;
			var compatible = true;

			for(var i = 0; i < keys.length; i++) {

				var subtype =
					nameByKey[keys[i]];

				var mappedFamily =
					ltrFamilyBySubtype[subtype];

				if(mappedFamily === undefined) {

					compatible = false;
					break;
				}

				if(family === null) {

					family = mappedFamily;
				}
				else if(family !== mappedFamily) {

					compatible = false;
					break;
				}
			}

			if(compatible) {

				return {
					status: "resolved",
					classification: family,
					normalisedKey: norm(family),
					originalValue: originalValue,
					resolutionType:
						"ltr_family_collapse"
				};
			}
		}

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
		originalValue: originalValue,
		resolutionType: "direct"
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
var familyCollapsedAssignments = [];
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

	var classificationResult =
		resolveClassification(
			rawClassification,
			locusStatus
		);


	var classificationResult = resolveClassification(
		rawClassification,
		locusStatus
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
			classification:
				classificationResult.originalValue
		});

		continue;
	}

	var classificationName =
		classificationResult.classification;

	var classificationKey =
		classificationResult.normalisedKey;


	// Translate historical ERV names before alignment lookup

	if(locusStatus === "ERV") {

		var translated =
			ervLineageTranslationByKey[
				classificationKey
			];

		if(translated !== undefined) {

			classificationName =
				translated;

			classificationKey =
				norm(translated);
		}
	}


	// Translate LTR aliases before alignment lookup

	if(locusStatus === "LTR") {

		var translatedLtrName =
			ltrTranslationByKey[
				classificationKey
			];

		if(translatedLtrName !== undefined) {

			classificationName =
				translatedLtrName;

			classificationKey =
				norm(translatedLtrName);
		}
	}


	var alignmentName =
		alignmentLookup[classificationKey];












	// Translate historical ERV classifications to current lineage names
	// before attempting the alignment lookup.

	if(locusStatus === "ERV") {

		var translatedLineageName =
			ervLineageTranslationByKey[
				classificationKey
			];

		if(translatedLineageName !== undefined) {

			classificationName =
				translatedLineageName;

			classificationKey =
				norm(translatedLineageName);
		}
	}


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
			key: classificationKey,
			resolutionType:
				classificationResult.resolutionType
		});

		continue;
	}

	var assignment = {
		id: locusID,
		status: locusStatus,
		classification: classificationName,
		originalClassification:
			classificationResult.originalValue,
		alignmentName: alignmentName,
		length: row.length,
		chrom: row.chrom,
		start_position: row.start_position,
		resolutionType:
			classificationResult.resolutionType
	};

	assignments.push(
		assignment
	);

	if(classificationResult.resolutionType ===
			"ltr_family_collapse") {

		familyCollapsedAssignments.push(
			assignment
		);
	}
}


// -------------------------------------------------------------------------
// Report summary
// -------------------------------------------------------------------------

glue.logInfo(
	"Resolved assignments: " +
	assignments.length
);

glue.logInfo(
	"LTR family-collapsed assignments: " +
	familyCollapsedAssignments.length
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
// Report LTR assignments resolved through family collapse
// -------------------------------------------------------------------------

for(var i = 0;
		i < familyCollapsedAssignments.length;
		i++) {

	var collapsedAssignment =
		familyCollapsedAssignments[i];

	glue.logInfo(
		"ASSIGN_LTR_FAMILY_COLLAPSE\t" +
		collapsedAssignment.id + "\t" +
		collapsedAssignment.status + "\t" +
		collapsedAssignment.originalClassification +
		"\t" +
		collapsedAssignment.classification + "\t" +
		collapsedAssignment.alignmentName
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

	var missingRow =
		missingClassifications[i];

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

	var unsupportedRow =
		unsupportedStatuses[i];

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

	var unmatchedRow =
		unmatched[i];

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
			normalisedKey:
				unmatchedRow.key,
			count: 0,
			exampleLocus:
				unmatchedRow.id
		};

		unmatchedSummaryByKey[summaryKey] =
			summaryRow;
	}

	summaryRow.count++;
}

var unmatchedSummary = [];

var unmatchedSummaryKeys =
	Object.keys(
		unmatchedSummaryByKey
	);

for(var i = 0;
		i < unmatchedSummaryKeys.length;
		i++) {

	var summaryKey =
		unmatchedSummaryKeys[i];

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

for(var i = 0;
		i < unmatchedSummary.length;
		i++) {

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


// -------------------------------------------------------------------------
// Count rows by locus status
// -------------------------------------------------------------------------

function countRowsByStatus(
	rows,
	status
) {

	var count = 0;

	for(var i = 0; i < rows.length; i++) {

		if(rows[i].status === status) {
			count++;
		}
	}

	return count;
}


// -------------------------------------------------------------------------
// Print one compact outcome-summary row
// -------------------------------------------------------------------------

function printOutcomeSummaryRow(
	outcome,
	rows
) {

	var ervCount =
		countRowsByStatus(
			rows,
			"ERV"
		);

	var ltrCount =
		countRowsByStatus(
			rows,
			"LTR"
		);

	var otherCount =
		rows.length -
		ervCount -
		ltrCount;

	glue.logInfo(
		outcome + "\t" +
		ervCount + "\t" +
		ltrCount + "\t" +
		otherCount + "\t" +
		rows.length
	);
}


// -------------------------------------------------------------------------
// Print compact outcome summary
//
// ASSIGN_LTR_FAMILY_COLLAPSE is a subset of ASSIGN.
// It must not be added to ASSIGN when calculating totals.
// -------------------------------------------------------------------------

glue.logInfo(
	"OUTCOME SUMMARY"
);

glue.logInfo(
	"OUTCOME\tERV\tLTR\tOTHER\tTOTAL"
);

printOutcomeSummaryRow(
	"ASSIGN",
	assignments
);

printOutcomeSummaryRow(
	"ASSIGN_LTR_FAMILY_COLLAPSE",
	familyCollapsedAssignments
);

printOutcomeSummaryRow(
	"UNMATCHED_CLASSIFICATION",
	unmatched
);

printOutcomeSummaryRow(
	"CONFLICTING_CLASSIFICATION",
	conflictingClassifications
);

printOutcomeSummaryRow(
	"MISSING_CLASSIFICATION",
	missingClassifications
);

printOutcomeSummaryRow(
	"UNSUPPORTED_STATUS",
	unsupportedStatuses
);