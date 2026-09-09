// glue/build/locus/msa/addResolvedLociToAlignments.js
//
// Add permanent ERV locus sequences to their resolved ERV lineage,
// ERV sublineage, or LTR alignments.
//
// ERV alignment names are derived directly from the standard
// erv_lineage.id:
//
//   ERV-1.Eta.1       -> AL_LINEAGE_1_Eta_1
//   ERV-1.Zeta.19     -> AL_SUBLINEAGE_1_Zeta_19
//   ERVR-1.Theta.101  -> AL_SUBLINEAGE_1R_Theta_101
//
// LTR alignments are matched by normalising the suffix of existing
// AL_LTR_* alignment names and comparing it with ltr_lineage.id.
//
// This script deliberately uses permanent locus associations rather than
// the original staging classifications:
//
//   sequence -> erv_locus
//   erv_locus <- erv_locus_lineage_assoc -> erv_lineage
//   erv_locus <- erv_locus_ltr_assoc     -> ltr_lineage
//
// A locus is assigned only when:
//
//   1. exactly one sequence is linked to the erv_locus row;
//   2. exactly one distinct target lineage is identified;
//   3. the expected alignment exists.
//
// Loci with conflicting lineage associations are reported and skipped.

var DRY_RUN = false;
var BATCH_SIZE = 250;


// -------------------------------------------------------------------------
// General utilities
// -------------------------------------------------------------------------

function log(message) {
	glue.logInfo(message);
}


function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var result = ("" + value).trim();

	if(result === "") {
		return null;
	}

	var lower = result.toLowerCase();

	if(lower === "n/a" ||
		lower === "na" ||
		lower === "n/k" ||
		lower === "nk" ||
		lower === "unknown" ||
		lower === "null" ||
		lower === "none") {

		return null;
	}

	return result;
}


function escapeQuotes(value) {

	return ("" + value)
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'");
}


function runCommand(commandWords) {

	if(DRY_RUN) {

		log(
			"[DRY RUN] " +
			commandWords.join(" ")
		);

		return null;
	}

	return glue.command(commandWords);
}


function addUniqueValue(map, key, value) {

	if(map[key] === undefined) {
		map[key] = [];
	}

	for(var i = 0; i < map[key].length; i++) {

		if(map[key][i] === value) {
			return;
		}
	}

	map[key].push(value);
}


function sortedKeys(map) {

	var keys = Object.keys(map);
	keys.sort();

	return keys;
}


// -------------------------------------------------------------------------
// ERV alignment naming
// -------------------------------------------------------------------------

function standardErvAlignmentSuffix(lineageId) {

	lineageId = norm(lineageId);

	if(lineageId === null) {
		return null;
	}

	var suffix = lineageId

		// ERVR-1.Theta.101 -> 1R.Theta.101
		.replace(
			/^ERVR-([A-Za-z0-9]+)(?=\.|$)/i,
			"$1R"
		)

		// ERV-1.Eta.1 -> 1.Eta.1
		.replace(
			/^ERV-/i,
			""
		)

		// Replace dots, hyphens and other separators with underscores.
		.replace(
			/[^A-Za-z0-9]+/g,
			"_"
		)

		.replace(
			/^_+/,
			""
		)

		.replace(
			/_+$/,
			""
		);

	if(suffix === "") {
		return null;
	}

	return suffix;
}


function expectedErvAlignmentName(
	lineageId,
	entityLevel
) {

	var suffix =
		standardErvAlignmentSuffix(
			lineageId
		);

	if(suffix === null) {
		return null;
	}

	entityLevel = norm(entityLevel);

	if(entityLevel === null) {
		return null;
	}

	var lowerLevel =
		entityLevel.toLowerCase();

	if(lowerLevel === "lineage") {

		return (
			"AL_LINEAGE_" +
			suffix
		);
	}

	if(lowerLevel === "sublineage") {

		return (
			"AL_SUBLINEAGE_" +
			suffix
		);
	}

	return null;
}


// -------------------------------------------------------------------------
// LTR alignment-name matching
//
// Existing LTR alignment names are retained. We normalise both the
// ltr_lineage.id and the suffix of AL_LTR_* so that punctuation differences
// do not prevent a match.
// -------------------------------------------------------------------------

function normalisedLtrKey(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	return value
		.replace(/[^A-Za-z0-9]/g, "")
		.toLowerCase();
}


// -------------------------------------------------------------------------
// Load existing alignments
// -------------------------------------------------------------------------

log("Loading existing alignments");

var alignmentRows =
	glue.tableToObjects(
		glue.command([
			"list",
			"alignment",
			"name"
		])
	);

var alignmentExists = {};
var ltrAlignmentByKey = {};
var duplicateLtrAlignmentKeys = {};

for(var i = 0; i < alignmentRows.length; i++) {

	var alignmentName =
		norm(alignmentRows[i].name);

	if(alignmentName === null) {
		continue;
	}

	alignmentExists[alignmentName] = true;

	if(alignmentName.indexOf("AL_LTR_") === 0) {

		var ltrSuffix =
			alignmentName.substring(
				"AL_LTR_".length
			);

		var ltrKey =
			normalisedLtrKey(
				ltrSuffix
			);

		if(ltrKey === null) {
			continue;
		}

		if(ltrAlignmentByKey[ltrKey] !== undefined &&
			ltrAlignmentByKey[ltrKey] !== alignmentName) {

			duplicateLtrAlignmentKeys[ltrKey] = true;
		}
		else {
			ltrAlignmentByKey[ltrKey] = alignmentName;
		}
	}
}

log(
	"Existing alignments loaded: " +
	alignmentRows.length
);

log(
	"Ambiguous normalised LTR alignment keys: " +
	Object.keys(duplicateLtrAlignmentKeys).length
);


// -------------------------------------------------------------------------
// Load permanent ERV loci
// -------------------------------------------------------------------------

log("Loading permanent erv_locus rows");

var locusRows =
	glue.tableToObjects(
		glue.command([
			"list",
			"custom-table-row",
			"erv_locus",
			"id",
			"locus_type",
			"taxonomic_resolution",
			"structural_profile"
		])
	);

var locusById = {};

for(var i = 0; i < locusRows.length; i++) {

	var locusId =
		norm(locusRows[i].id);

	if(locusId !== null) {
		locusById[locusId] = locusRows[i];
	}
}

log(
	"Permanent ERV loci loaded: " +
	locusRows.length
);


// -------------------------------------------------------------------------
// Load locus sequences
// -------------------------------------------------------------------------

log("Loading sequences linked to permanent ERV loci");

var sequenceRows =
	glue.tableToObjects(
		glue.command([
			"list",
			"sequence",
			"source.name",
			"sequenceID",
			"erv_locus.id",
			"-w",
			"erv_locus.id != null"
		])
	);

var sequencesByLocus = {};

for(var i = 0; i < sequenceRows.length; i++) {

	var sequenceRow =
		sequenceRows[i];

	var sequenceLocusId =
		norm(
			sequenceRow["erv_locus.id"]
		);

	var sourceName =
		norm(
			sequenceRow["source.name"]
		);

	var sequenceId =
		norm(
			sequenceRow.sequenceID
		);

	if(sequenceLocusId === null ||
		sourceName === null ||
		sequenceId === null) {

		continue;
	}

	if(sequencesByLocus[sequenceLocusId] === undefined) {
		sequencesByLocus[sequenceLocusId] = [];
	}

	sequencesByLocus[sequenceLocusId].push({
		sourceName: sourceName,
		sequenceId: sequenceId
	});
}

log(
	"Linked locus sequences loaded: " +
	sequenceRows.length
);


// -------------------------------------------------------------------------
// Load locus-to-ERV-lineage associations
// -------------------------------------------------------------------------

log("Loading ERV locus-to-lineage associations");

var ervAssociationRows =
	glue.tableToObjects(
		glue.command([
			"list",
			"custom-table-row",
			"erv_locus_lineage_assoc",
			"id",
			"erv_locus.id",
			"erv_lineage.id",
			"erv_lineage.entity_level",
			"association_role",
			"evidence",
			"confidence"
		])
	);

var ervTargetsByLocus = {};
var ervTargetDetailsByKey = {};

for(var i = 0; i < ervAssociationRows.length; i++) {

	var associationRow =
		ervAssociationRows[i];

	var associatedLocusId =
		norm(
			associationRow["erv_locus.id"]
		);

	var ervLineageId =
		norm(
			associationRow["erv_lineage.id"]
		);

	var entityLevel =
		norm(
			associationRow[
				"erv_lineage.entity_level"
			]
		);

	if(associatedLocusId === null ||
		ervLineageId === null ||
		entityLevel === null) {

		continue;
	}

	var lowerEntityLevel =
		entityLevel.toLowerCase();

	if(lowerEntityLevel !== "lineage" &&
		lowerEntityLevel !== "sublineage") {

		continue;
	}

	var targetKey =
		lowerEntityLevel +
		"\t" +
		ervLineageId;

	addUniqueValue(
		ervTargetsByLocus,
		associatedLocusId,
		targetKey
	);

	ervTargetDetailsByKey[targetKey] = {
		lineageId: ervLineageId,
		entityLevel: lowerEntityLevel
	};
}

log(
	"ERV locus-lineage association rows loaded: " +
	ervAssociationRows.length
);


// -------------------------------------------------------------------------
// Load locus-to-LTR associations
// -------------------------------------------------------------------------

log("Loading ERV locus-to-LTR associations");

var ltrAssociationRows =
	glue.tableToObjects(
		glue.command([
			"list",
			"custom-table-row",
			"erv_locus_ltr_assoc",
			"id",
			"erv_locus.id",
			"ltr_lineage.id",
			"association_role",
			"evidence",
			"confidence"
		])
	);

var ltrTargetsByLocus = {};

for(var i = 0; i < ltrAssociationRows.length; i++) {

	var ltrAssociationRow =
		ltrAssociationRows[i];

	var ltrLocusId =
		norm(
			ltrAssociationRow["erv_locus.id"]
		);

	var ltrLineageId =
		norm(
			ltrAssociationRow["ltr_lineage.id"]
		);

	if(ltrLocusId === null ||
		ltrLineageId === null) {

		continue;
	}

	addUniqueValue(
		ltrTargetsByLocus,
		ltrLocusId,
		ltrLineageId
	);
}

log(
	"ERV locus-LTR association rows loaded: " +
	ltrAssociationRows.length
);


// -------------------------------------------------------------------------
// Resolve locus assignments
// -------------------------------------------------------------------------

var assignments = [];

var lociWithoutSequence = [];
var lociWithMultipleSequences = [];
var lociWithoutTarget = [];
var lociWithMultipleTargets = [];
var lociWithMissingAlignment = [];
var lociWithUnsupportedType = [];

var locusIds =
	sortedKeys(
		locusById
	);

for(var i = 0; i < locusIds.length; i++) {

	var locusId =
		locusIds[i];

	var locusRow =
		locusById[locusId];

	var locusType =
		norm(
			locusRow.locus_type
		);

	var locusSequences =
		sequencesByLocus[locusId];

	if(locusSequences === undefined ||
		locusSequences.length === 0) {

		lociWithoutSequence.push(
			locusId
		);

		continue;
	}

	if(locusSequences.length !== 1) {

		lociWithMultipleSequences.push({
			locusId: locusId,
			count: locusSequences.length
		});

		continue;
	}

	var sequenceRef =
		locusSequences[0];

	var alignmentName = null;
	var targetDescription = null;

	if(locusType !== null &&
		locusType.toLowerCase() === "erv") {

		var ervTargets =
			ervTargetsByLocus[locusId];

		if(ervTargets === undefined ||
			ervTargets.length === 0) {

			lociWithoutTarget.push({
				locusId: locusId,
				locusType: locusType
			});

			continue;
		}

		if(ervTargets.length !== 1) {

			lociWithMultipleTargets.push({
				locusId: locusId,
				locusType: locusType,
				targets: ervTargets.join(",")
			});

			continue;
		}

		var ervTarget =
			ervTargetDetailsByKey[
				ervTargets[0]
			];

		alignmentName =
			expectedErvAlignmentName(
				ervTarget.lineageId,
				ervTarget.entityLevel
			);

		targetDescription =
			ervTarget.entityLevel +
			":" +
			ervTarget.lineageId;
	}
	else if(locusType !== null &&
		locusType.toLowerCase() === "solo_ltr") {

		var ltrTargets =
			ltrTargetsByLocus[locusId];

		if(ltrTargets === undefined ||
			ltrTargets.length === 0) {

			lociWithoutTarget.push({
				locusId: locusId,
				locusType: locusType
			});

			continue;
		}

		if(ltrTargets.length !== 1) {

			lociWithMultipleTargets.push({
				locusId: locusId,
				locusType: locusType,
				targets: ltrTargets.join(",")
			});

			continue;
		}

		var ltrLineageId =
			ltrTargets[0];

		var ltrKey =
			normalisedLtrKey(
				ltrLineageId
			);

		if(duplicateLtrAlignmentKeys[ltrKey] === true) {

			lociWithMultipleTargets.push({
				locusId: locusId,
				locusType: locusType,
				targets:
					"ambiguous AL_LTR key " +
					ltrKey
			});

			continue;
		}

		alignmentName =
			ltrAlignmentByKey[ltrKey];

		targetDescription =
			"ltr_lineage:" +
			ltrLineageId;
	}
	else {

		lociWithUnsupportedType.push({
			locusId: locusId,
			locusType: locusType
		});

		continue;
	}

	if(alignmentName === null ||
		alignmentName === undefined ||
		alignmentExists[alignmentName] !== true) {

		lociWithMissingAlignment.push({
			locusId: locusId,
			target: targetDescription,
			expectedAlignment: alignmentName
		});

		continue;
	}

	assignments.push({
		locusId: locusId,
		sourceName: sequenceRef.sourceName,
		sequenceId: sequenceRef.sequenceId,
		alignmentName: alignmentName,
		target: targetDescription
	});
}


// -------------------------------------------------------------------------
// Group assignments by target alignment
// -------------------------------------------------------------------------

var assignmentsByAlignment = {};

for(var i = 0; i < assignments.length; i++) {

	var assignment =
		assignments[i];

	if(assignmentsByAlignment[
		assignment.alignmentName
	] === undefined) {

		assignmentsByAlignment[
			assignment.alignmentName
		] = [];
	}

	assignmentsByAlignment[
		assignment.alignmentName
	].push(
		assignment
	);
}


// -------------------------------------------------------------------------
// Build sequence where clause
// -------------------------------------------------------------------------

function buildSequenceWhereClause(
	alignmentAssignments,
	startIndex,
	endIndex
) {

	var conditions = [];

	for(var i = startIndex; i < endIndex; i++) {

		var assignment =
			alignmentAssignments[i];

		conditions.push(
			"(" +
			"source.name = '" +
			escapeQuotes(
				assignment.sourceName
			) +
			"' and sequenceID = '" +
			escapeQuotes(
				assignment.sequenceId
			) +
			"'" +
			")"
		);
	}

	return conditions.join(" or ");
}


// -------------------------------------------------------------------------
// Add sequence assignments
// -------------------------------------------------------------------------

var targetAlignmentNames =
	sortedKeys(
		assignmentsByAlignment
	);

var addedAssignmentCount = 0;

for(var i = 0;
		i < targetAlignmentNames.length;
		i++) {

	var targetAlignmentName =
		targetAlignmentNames[i];

	var alignmentAssignments =
		assignmentsByAlignment[
			targetAlignmentName
		];

	log(
		"Adding " +
		alignmentAssignments.length +
		" locus sequences to " +
		targetAlignmentName
	);

	for(var startIndex = 0;
		startIndex < alignmentAssignments.length;
		startIndex += BATCH_SIZE) {

		var endIndex =
			Math.min(
				startIndex + BATCH_SIZE,
				alignmentAssignments.length
			);

		var whereClause =
			buildSequenceWhereClause(
				alignmentAssignments,
				startIndex,
				endIndex
			);

		glue.inMode(
			"/alignment/" +
			targetAlignmentName,
			function() {

				runCommand([
					"add",
					"member",
					"--whereClause",
					whereClause
				]);
			}
		);

		addedAssignmentCount +=
			endIndex - startIndex;

		log(
			"Added batch " +
			(startIndex + 1) +
			"-" +
			endIndex +
			" to " +
			targetAlignmentName
		);
	}
}


// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

log("============================================================");
log("Resolved locus alignment assignment summary");
log("============================================================");

log(
	"Permanent ERV loci examined: " +
	locusIds.length
);

log(
	"Resolved assignments: " +
	assignments.length
);

log(
	"Assignments submitted: " +
	addedAssignmentCount
);

log(
	"Target alignments used: " +
	targetAlignmentNames.length
);

log(
	"Loci without a linked sequence: " +
	lociWithoutSequence.length
);

log(
	"Loci with multiple linked sequences: " +
	lociWithMultipleSequences.length
);

log(
	"Loci without a lineage/LTR target: " +
	lociWithoutTarget.length
);

log(
	"Loci with multiple targets: " +
	lociWithMultipleTargets.length
);

log(
	"Loci whose expected alignment is missing: " +
	lociWithMissingAlignment.length
);

log(
	"Loci with an unsupported locus_type: " +
	lociWithUnsupportedType.length
);


// -------------------------------------------------------------------------
// Detailed review output
// -------------------------------------------------------------------------

for(var i = 0; i < lociWithMultipleSequences.length; i++) {

	var multipleSequenceRow =
		lociWithMultipleSequences[i];

	log(
		"MULTIPLE_SEQUENCES\t" +
		multipleSequenceRow.locusId +
		"\t" +
		multipleSequenceRow.count
	);
}


for(var i = 0; i < lociWithoutTarget.length; i++) {

	var missingTargetRow =
		lociWithoutTarget[i];

	log(
		"NO_TARGET\t" +
		missingTargetRow.locusId +
		"\t" +
		missingTargetRow.locusType
	);
}


for(var i = 0; i < lociWithMultipleTargets.length; i++) {

	var multipleTargetRow =
		lociWithMultipleTargets[i];

	log(
		"MULTIPLE_TARGETS\t" +
		multipleTargetRow.locusId +
		"\t" +
		multipleTargetRow.locusType +
		"\t" +
		multipleTargetRow.targets
	);
}


for(var i = 0; i < lociWithMissingAlignment.length; i++) {

	var missingAlignmentRow =
		lociWithMissingAlignment[i];

	log(
		"MISSING_ALIGNMENT\t" +
		missingAlignmentRow.locusId +
		"\t" +
		missingAlignmentRow.target +
		"\t" +
		missingAlignmentRow.expectedAlignment
	);
}


for(var i = 0; i < lociWithUnsupportedType.length; i++) {

	var unsupportedTypeRow =
		lociWithUnsupportedType[i];

	log(
		"UNSUPPORTED_LOCUS_TYPE\t" +
		unsupportedTypeRow.locusId +
		"\t" +
		unsupportedTypeRow.locusType
	);
}


for(var i = 0; i < assignments.length; i++) {

	var resolvedAssignment =
		assignments[i];

	log(
		"ASSIGN\t" +
		resolvedAssignment.locusId +
		"\t" +
		resolvedAssignment.sourceName +
		"/" +
		resolvedAssignment.sequenceId +
		"\t" +
		resolvedAssignment.target +
		"\t" +
		resolvedAssignment.alignmentName
	);
}

log(
	DRY_RUN
		? "Dry run finished; no alignment members were added"
		: "Finished adding resolved locus sequences to alignments"
);
