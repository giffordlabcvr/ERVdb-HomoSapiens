/**
 * summariseErvSublineageLayer.js
 *
 * Produce an application-level summary of the ERV sublineage layer.
 *
 * The report covers:
 *
 *   - curated ERV sublineage counts
 *   - status, entity-type and curation-tier counts
 *   - agreement between expected canonical IDs and database links
 *   - representative ERV sequence coverage
 *   - aliases per ERV sublineage
 *   - parent-lineage assignments
 *   - ERV-sublineage-to-LTR associations
 *   - representative LTR sequence coverage
 *   - declared reference coverage
 *   - constrained alignment coverage for accepted sublineages
 *
 * This script is read-only.
 */

var INPUT_PATH =
	"tabular/sublineage/herv_sublineage_data.tsv";

var ERV_SOURCE =
	"erv-sub";

var LTR_SOURCE =
	"ltr-sub";

// ============================================================================
// General helpers
// ============================================================================

function log(message) {
	glue.logInfo(message);
}

function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var stringValue =
		("" + value).trim();

	if(stringValue === "" || stringValue === "-") {
		return null;
	}

	var lowerValue =
		stringValue.toLowerCase();

	if(
		lowerValue === "n/a" ||
		lowerValue === "na" ||
		lowerValue === "n/k" ||
		lowerValue === "nk" ||
		lowerValue === "unknown" ||
		lowerValue === "null" ||
		lowerValue === "none"
	) {
		return null;
	}

	return stringValue;
}

function loadTsv(path) {

	var rows;

	glue.inMode(
		"module/tabularUtility",
		function() {
			rows =
				glue.tableToObjects(
					glue.command([
						"load-tabular",
						path
					])
				);
		}
	);

	return rows;
}

function queryObjects(commandWords) {

	return glue.tableToObjects(
		glue.command(commandWords)
	);
}

function incrementCount(
	counts,
	value
) {

	value =
		norm(value);

	if(value === null) {
		value = "(not set)";
	}

	if(counts[value] === undefined) {
		counts[value] = 0;
	}

	counts[value]++;
}

function sortedKeys(object) {
	return Object.keys(object).sort();
}

function setSize(setObject) {
	return Object.keys(setObject).length;
}

function percentage(
	numerator,
	denominator
) {

	if(denominator === 0) {
		return "0.0";
	}

	return (
		100.0 *
		numerator /
		denominator
	).toFixed(1);
}

function sanitiseIdentifier(value) {

	value =
		norm(value);

	if(value === null) {
		return "";
	}

	return value.replace(
		/[^A-Za-z0-9]/g,
		""
	);
}

function expectedErvReferenceName(sequenceID) {

	return (
		"REF_" +
		sanitiseIdentifier(sequenceID)
	);
}

function expectedLtrReferenceName(sequenceID) {

	return (
		"LTR_REF_" +
		sanitiseIdentifier(sequenceID)
	);
}

function expectedLineageAlignmentName(sequenceID) {

	return (
		"AL_LINEAGE_" +
		sanitiseIdentifier(sequenceID)
	);
}

function displayValue(value) {

	value =
		norm(value);

	if(value === null) {
		return "(not set)";
	}

	return value;
}

function heading(title) {

	log("");
	log("============================================================");
	log(title);
	log("============================================================");
}

function subheading(title) {

	log("");
	log(title);
	log("------------------------------------------------------------");
}

function printCounts(counts) {

	_.each(
		sortedKeys(counts),
		function(key) {
			log(
				"  " +
				key +
				": " +
				counts[key]
			);
		}
	);
}

// ============================================================================
// Load the curated TSV
// ============================================================================

var curatedRows =
	loadTsv(INPUT_PATH);

var expectedByLineageId = {};
var expectedBySequenceId = {};

var duplicateCuratedLineageIds = [];
var duplicateCuratedSequenceIds = [];
var curatedRowsWithoutLineageId = [];
var curatedRowsWithoutSequenceId = [];

_.each(
	curatedRows,
	function(row) {

		var lineageId =
			norm(
				row["lineage_id"]
			);

		var sequenceID =
			norm(
				row["sequenceID"]
			);

		if(lineageId === null) {
			curatedRowsWithoutLineageId.push(row);
		} else {
			if(expectedByLineageId[lineageId]) {
				duplicateCuratedLineageIds.push(lineageId);
			}

			expectedByLineageId[lineageId] = row;
		}

		if(sequenceID === null) {
			curatedRowsWithoutSequenceId.push(row);
		} else {
			if(expectedBySequenceId[sequenceID]) {
				duplicateCuratedSequenceIds.push(sequenceID);
			}

			expectedBySequenceId[sequenceID] = row;
		}
	}
);

// ============================================================================
// Load erv_lineage rows classified as sublineages
// ============================================================================

var ervLineageRows =
	queryObjects([
		"list",
		"custom-table-row",
		"erv_lineage",
		"id",
		"name",
		"full_name",
		"entity_type",
		"entity_level",
		"status",
		"parent_lineage",
		"curation_tier",
		"rv_clade.id",
		"rv_subfamily.id",
		"rv_genus.id",
		"rv_subgenus.id"
	]);

var sublineages = {};

var statusCounts = {};
var entityTypeCounts = {};
var curationTierCounts = {};
var parentLineageCounts = {};

_.each(
	ervLineageRows,
	function(row) {

		var entityLevel =
			norm(
				row["entity_level"]
			);

		if(
			entityLevel === null ||
			entityLevel.toLowerCase() !== "sublineage"
		) {
			return;
		}

		var lineageId =
			norm(
				row["id"]
			);

		if(lineageId === null) {
			return;
		}

		var sublineage = {
			id: lineageId,
			name: norm(row["name"]),
			fullName: norm(row["full_name"]),
			entityType: norm(row["entity_type"]),
			entityLevel: entityLevel,
			status: norm(row["status"]),
			parentLineage: norm(row["parent_lineage"]),
			curationTier: norm(row["curation_tier"]),
			clade: norm(row["rv_clade.id"]),
			subfamily: norm(row["rv_subfamily.id"]),
			genus: norm(row["rv_genus.id"]),
			subgenus: norm(row["rv_subgenus.id"]),
			aliasCount: 0,
			ltrIds: {},
			sequences: []
		};

		sublineages[lineageId] =
			sublineage;

		incrementCount(
			statusCounts,
			sublineage.status
		);

		incrementCount(
			entityTypeCounts,
			sublineage.entityType
		);

		incrementCount(
			curationTierCounts,
			sublineage.curationTier
		);

		incrementCount(
			parentLineageCounts,
			sublineage.parentLineage
		);
	}
);

// ============================================================================
// Compare curated IDs with database IDs
// ============================================================================

var expectedSublineagesMissingFromDatabase = [];
var unexpectedDatabaseSublineages = [];

_.each(
	sortedKeys(expectedByLineageId),
	function(lineageId) {

		if(!sublineages[lineageId]) {
			expectedSublineagesMissingFromDatabase.push(
				lineageId
			);
		}
	}
);

_.each(
	sortedKeys(sublineages),
	function(lineageId) {

		if(!expectedByLineageId[lineageId]) {
			unexpectedDatabaseSublineages.push(
				lineageId
			);
		}
	}
);

// ============================================================================
// Load representative ERV sequences
// ============================================================================

var ervSequenceRows =
	queryObjects([
		"list",
		"sequence",
		"sequenceID",
		"source.name",
		"erv_lineage.id",
		"-w",
		"source.name = '" +
			ERV_SOURCE +
			"'",
		"-s",
		"sequenceID"
	]);

var ervSequencesWithoutLineage = [];
var ervSequencesWithUnexpectedLineage = [];
var ervCanonicalLinkMismatches = [];

_.each(
	ervSequenceRows,
	function(row) {

		var sequenceID =
			norm(
				row["sequenceID"]
			);

		var linkedLineageId =
			norm(
				row["erv_lineage.id"]
			);

		if(sequenceID === null) {
			return;
		}

		if(linkedLineageId === null) {
			ervSequencesWithoutLineage.push(
				sequenceID
			);

			return;
		}

		if(!sublineages[linkedLineageId]) {
			ervSequencesWithUnexpectedLineage.push({
				sequenceID: sequenceID,
				linkedLineageId: linkedLineageId
			});
		} else {
			sublineages[
				linkedLineageId
			].sequences.push(sequenceID);
		}

		var expectedRow =
			expectedBySequenceId[sequenceID];

		if(
			expectedRow &&
			norm(expectedRow["lineage_id"]) !== linkedLineageId
		) {
			ervCanonicalLinkMismatches.push({
				sequenceID: sequenceID,
				expectedLineageId:
					norm(
						expectedRow["lineage_id"]
					),
				actualLineageId:
					linkedLineageId
			});
		}
	}
);

var sublineagesWithoutErvSequences = [];
var sublineagesWithMultipleErvSequences = [];

_.each(
	sortedKeys(sublineages),
	function(lineageId) {

		var sequenceIDs =
			sublineages[lineageId].sequences;

		if(sequenceIDs.length === 0) {
			sublineagesWithoutErvSequences.push(
				lineageId
			);
		}

		if(sequenceIDs.length > 1) {
			sublineagesWithMultipleErvSequences.push({
				lineageId: lineageId,
				sequenceIDs: sequenceIDs
			});
		}
	}
);

// ============================================================================
// Load aliases
// ============================================================================

var aliasRows =
	queryObjects([
		"list",
		"custom-table-row",
		"erv_lineage_alias",
		"id",
		"alias_name",
		"alias_source",
		"erv_lineage.id"
	]);

var sublineageAliasCount = 0;
var orphanAliasRows = [];

_.each(
	aliasRows,
	function(row) {

		var aliasRowId =
			norm(
				row["id"]
			);

		var aliasName =
			norm(
				row["alias_name"]
			);

		var aliasSource =
			norm(
				row["alias_source"]
			);

		var lineageId =
			norm(
				row["erv_lineage.id"]
			);

		if(
			lineageId !== null &&
			sublineages[lineageId]
		) {
			sublineages[lineageId].aliasCount++;
			sublineageAliasCount++;
			return;
		}

		/*
		 * Base-layer aliases are not orphans merely because they do not
		 * target a sublineage. Only rows with no erv_lineage target are
		 * considered orphaned.
		 */

		if(lineageId === null) {
			orphanAliasRows.push({
				id: aliasRowId,
				aliasName: aliasName,
				aliasSource: aliasSource
			});
		}
	}
);

// ============================================================================
// Load LTR-lineage rows
// ============================================================================

var ltrLineageRows =
	queryObjects([
		"list",
		"custom-table-row",
		"ltr_lineage",
		"id",
		"original_name",
		"linked_element"
	]);

var ltrLineages = {};

_.each(
	ltrLineageRows,
	function(row) {

		var ltrLineageId =
			norm(
				row["id"]
			);

		if(ltrLineageId === null) {
			return;
		}

		ltrLineages[ltrLineageId] = {
			id: ltrLineageId,
			originalName:
				norm(
					row["original_name"]
				),
			linkedElement:
				norm(
					row["linked_element"]
				),
			associatedSublineageIds: {},
			sequences: []
		};
	}
);

// ============================================================================
// Load ERV-LTR associations
// ============================================================================

var associationRows =
	queryObjects([
		"list",
		"custom-table-row",
		"erv_lineage_ltr_assoc",
		"id",
		"erv_lineage.id",
		"erv_lineage.entity_level",
		"ltr_lineage.id",
		"association_type",
		"evidence"
	]);

var sublineageAssociationCount = 0;
var incompleteAssociationRows = [];
var associationsWithUnknownSublineage = [];
var associationsWithUnknownLtrLineage = [];

_.each(
	associationRows,
	function(row) {

		var associationId =
			norm(
				row["id"]
			);

		var ervLineageId =
			norm(
				row["erv_lineage.id"]
			);

		var ervEntityLevel =
			norm(
				row["erv_lineage.entity_level"]
			);

		var ltrLineageId =
			norm(
				row["ltr_lineage.id"]
			);

		/*
		 * Ignore complete associations belonging to the base layer.
		 */

		if(
			ervEntityLevel !== null &&
			ervEntityLevel.toLowerCase() !== "sublineage"
		) {
			return;
		}

		if(
			ervLineageId === null ||
			ltrLineageId === null
		) {
			incompleteAssociationRows.push({
				id: associationId,
				ervLineageId: ervLineageId,
				ltrLineageId: ltrLineageId
			});

			return;
		}

		if(!sublineages[ervLineageId]) {
			associationsWithUnknownSublineage.push({
				id: associationId,
				ervLineageId: ervLineageId,
				ltrLineageId: ltrLineageId
			});

			return;
		}

		if(!ltrLineages[ltrLineageId]) {
			associationsWithUnknownLtrLineage.push({
				id: associationId,
				ervLineageId: ervLineageId,
				ltrLineageId: ltrLineageId
			});

			return;
		}

		sublineageAssociationCount++;

		sublineages[
			ervLineageId
		].ltrIds[
			ltrLineageId
		] = true;

		ltrLineages[
			ltrLineageId
		].associatedSublineageIds[
			ervLineageId
		] = true;
	}
);

// ============================================================================
// Load sequences in source ltr-sub
// ============================================================================

var ltrSequenceRows =
	queryObjects([
		"list",
		"sequence",
		"sequenceID",
		"source.name",
		"ltr_lineage.id",
		"-w",
		"source.name = '" +
			LTR_SOURCE +
			"'",
		"-s",
		"sequenceID"
	]);

var ltrSequencesWithoutLineage = [];
var ltrSequencesWithoutSublineageAssociation = [];
var sublineageAssociatedLtrIds = {};

_.each(
	ltrSequenceRows,
	function(row) {

		var sequenceID =
			norm(
				row["sequenceID"]
			);

		var ltrLineageId =
			norm(
				row["ltr_lineage.id"]
			);

		if(sequenceID === null) {
			return;
		}

		if(ltrLineageId === null) {
			ltrSequencesWithoutLineage.push(
				sequenceID
			);

			return;
		}

		if(ltrLineages[ltrLineageId]) {
			ltrLineages[
				ltrLineageId
			].sequences.push(sequenceID);
		}

		var associatedSublineages =
			ltrLineages[ltrLineageId] ?
				ltrLineages[
					ltrLineageId
				].associatedSublineageIds :
				null;

		if(
			associatedSublineages === null ||
			setSize(associatedSublineages) === 0
		) {
			ltrSequencesWithoutSublineageAssociation.push({
				sequenceID: sequenceID,
				ltrLineageId: ltrLineageId
			});
		} else {
			sublineageAssociatedLtrIds[
				ltrLineageId
			] = true;
		}
	}
);

var sublineagesWithoutLtrs = [];

_.each(
	sortedKeys(sublineages),
	function(lineageId) {

		if(
			setSize(
				sublineages[lineageId].ltrIds
			) === 0
		) {
			sublineagesWithoutLtrs.push(
				lineageId
			);
		}
	}
);

var associatedLtrsWithoutSequences = [];
var associatedLtrsWithMultipleSequences = [];

_.each(
	sortedKeys(ltrLineages),
	function(ltrLineageId) {

		var ltrLineage =
			ltrLineages[ltrLineageId];

		if(
			setSize(
				ltrLineage.associatedSublineageIds
			) === 0
		) {
			return;
		}

		if(ltrLineage.sequences.length === 0) {
			associatedLtrsWithoutSequences.push(
				ltrLineageId
			);
		}

		if(ltrLineage.sequences.length > 1) {
			associatedLtrsWithMultipleSequences.push({
				ltrLineageId: ltrLineageId,
				sequenceIDs: ltrLineage.sequences
			});
		}
	}
);

// ============================================================================
// Load declared references
// ============================================================================

var referenceRows =
	queryObjects([
		"list",
		"reference",
		"name",
		"sequence.source.name",
		"sequence.sequenceID"
	]);

var referencesBySequence = {};

_.each(
	referenceRows,
	function(row) {

		var referenceName =
			norm(
				row["name"]
			);

		var sourceName =
			norm(
				row["sequence.source.name"]
			);

		var sequenceID =
			norm(
				row["sequence.sequenceID"]
			);

		if(
			referenceName === null ||
			sourceName === null ||
			sequenceID === null
		) {
			return;
		}

		referencesBySequence[
			sourceName + "/" + sequenceID
		] = referenceName;
	}
);

var linkedErvSequencesWithoutReferences = [];
var linkedLtrSequencesWithoutReferences = [];
var unexpectedReferenceNames = [];

_.each(
	ervSequenceRows,
	function(row) {

		var sequenceID =
			norm(
				row["sequenceID"]
			);

		var lineageId =
			norm(
				row["erv_lineage.id"]
			);

		if(
			sequenceID === null ||
			lineageId === null
		) {
			return;
		}

		var sequenceKey =
			ERV_SOURCE +
			"/" +
			sequenceID;

		var referenceName =
			referencesBySequence[
				sequenceKey
			];

		if(!referenceName) {
			linkedErvSequencesWithoutReferences.push({
				sequenceID: sequenceID,
				lineageId: lineageId
			});

			return;
		}

		var expectedReferenceName =
			expectedErvReferenceName(
				sequenceID
			);

		if(referenceName !== expectedReferenceName) {
			unexpectedReferenceNames.push({
				sequence: sequenceKey,
				expected: expectedReferenceName,
				actual: referenceName
			});
		}
	}
);

_.each(
	ltrSequenceRows,
	function(row) {

		var sequenceID =
			norm(
				row["sequenceID"]
			);

		var ltrLineageId =
			norm(
				row["ltr_lineage.id"]
			);

		if(
			sequenceID === null ||
			ltrLineageId === null
		) {
			return;
		}

		var sequenceKey =
			LTR_SOURCE +
			"/" +
			sequenceID;

		var referenceName =
			referencesBySequence[
				sequenceKey
			];

		if(!referenceName) {
			linkedLtrSequencesWithoutReferences.push({
				sequenceID: sequenceID,
				ltrLineageId: ltrLineageId
			});

			return;
		}

		var expectedReferenceName =
			expectedLtrReferenceName(
				sequenceID
			);

		if(referenceName !== expectedReferenceName) {
			unexpectedReferenceNames.push({
				sequence: sequenceKey,
				expected: expectedReferenceName,
				actual: referenceName
			});
		}
	}
);

// ============================================================================
// Load alignments
// ============================================================================

var alignmentRows =
	queryObjects([
		"list",
		"alignment",
		"name",
		"parent.name",
		"refSequence.name"
	]);

var alignmentsByName = {};

_.each(
	alignmentRows,
	function(row) {

		var alignmentName =
			norm(
				row["name"]
			);

		if(alignmentName === null) {
			return;
		}

		alignmentsByName[alignmentName] = {
			name: alignmentName,
			parentName:
				norm(
					row["parent.name"]
				),
			referenceName:
				norm(
					row["refSequence.name"]
				)
		};
	}
);

var acceptedSublineages = [];
var excludedSublineages = [];
var acceptedSublineagesWithoutAlignments = [];
var acceptedSublineagesWithoutOneSequence = [];
var alignmentReferenceMismatches = [];

_.each(
	sortedKeys(sublineages),
	function(lineageId) {

		var sublineage =
			sublineages[lineageId];

		var status =
			sublineage.status === null ?
				"" :
				sublineage.status.toLowerCase();

		if(status !== "accepted") {
			excludedSublineages.push(lineageId);
			return;
		}

		acceptedSublineages.push(lineageId);

		if(sublineage.sequences.length !== 1) {
			acceptedSublineagesWithoutOneSequence.push(
				lineageId
			);

			return;
		}

		var sequenceID =
			sublineage.sequences[0];

		var expectedAlignmentName =
			expectedLineageAlignmentName(
				sequenceID
			);

		var alignment =
			alignmentsByName[
				expectedAlignmentName
			];

		if(!alignment) {
			acceptedSublineagesWithoutAlignments.push({
				lineageId: lineageId,
				sequenceID: sequenceID,
				expectedAlignmentName:
					expectedAlignmentName
			});

			return;
		}

		var expectedReferenceName =
			expectedErvReferenceName(
				sequenceID
			);

		if(
			alignment.referenceName !==
			expectedReferenceName
		) {
			alignmentReferenceMismatches.push({
				lineageId: lineageId,
				alignmentName:
					expectedAlignmentName,
				expectedReferenceName:
					expectedReferenceName,
				actualReferenceName:
					alignment.referenceName
			});
		}
	}
);

// ============================================================================
// Parent-lineage checks
// ============================================================================

var selfParentRelationships = [];
var sublineagesWithoutParentValues = [];
var parentValuesMatchingErvRows = [];
var parentValuesNotMatchingErvRows = [];

var allErvLineageIds = {};

_.each(
	ervLineageRows,
	function(row) {

		var lineageId =
			norm(
				row["id"]
			);

		if(lineageId !== null) {
			allErvLineageIds[lineageId] = true;
		}
	}
);

_.each(
	sortedKeys(sublineages),
	function(lineageId) {

		var parentLineage =
			sublineages[
				lineageId
			].parentLineage;

		if(parentLineage === null) {
			sublineagesWithoutParentValues.push(
				lineageId
			);

			return;
		}

		if(parentLineage === lineageId) {
			selfParentRelationships.push(
				lineageId
			);
		}

		if(allErvLineageIds[parentLineage]) {
			parentValuesMatchingErvRows.push({
				lineageId: lineageId,
				parentLineage: parentLineage
			});
		} else {
			/*
			 * This is not necessarily an error. Some parent_lineage values
			 * may denote higher taxonomic groupings rather than erv_lineage
			 * rows.
			 */
			parentValuesNotMatchingErvRows.push({
				lineageId: lineageId,
				parentLineage: parentLineage
			});
		}
	}
);

// ============================================================================
// Print report
// ============================================================================

heading("ERVdb sublineage-layer summary");

log(
	"Curated TSV rows: " +
	curatedRows.length
);

log(
	"Database ERV sublineage rows: " +
	setSize(sublineages)
);

log(
	"ERV source sequences: " +
	ervSequenceRows.length
);

log(
	"LTR source sequences: " +
	ltrSequenceRows.length
);

log(
	"Aliases attached to ERV sublineages: " +
	sublineageAliasCount
);

log(
	"ERV-sublineage-to-LTR association rows: " +
	sublineageAssociationCount
);

log(
	"Accepted ERV sublineages: " +
	acceptedSublineages.length
);

log(
	"Non-accepted ERV sublineages: " +
	excludedSublineages.length
);

// ============================================================================
// Curated inventory
// ============================================================================

heading("Sublineage inventory");

subheading("Status");

printCounts(statusCounts);

subheading("Entity type");

printCounts(entityTypeCounts);

subheading("Curation tier");

printCounts(curationTierCounts);

// ============================================================================
// Canonical identity
// ============================================================================

heading("Canonical identity checks");

log(
	"Curated lineage IDs missing from database: " +
	expectedSublineagesMissingFromDatabase.length
);

_.each(
	expectedSublineagesMissingFromDatabase.sort(),
	function(lineageId) {
		log("  " + lineageId);
	}
);

log(
	"Database sublineages absent from curated TSV: " +
	unexpectedDatabaseSublineages.length
);

_.each(
	unexpectedDatabaseSublineages.sort(),
	function(lineageId) {
		log("  " + lineageId);
	}
);

log(
	"ERV sequence-to-lineage canonical mismatches: " +
	ervCanonicalLinkMismatches.length
);

_.each(
	ervCanonicalLinkMismatches,
	function(item) {
		log(
			"  " +
			item.sequenceID +
			": expected " +
			item.expectedLineageId +
			", found " +
			item.actualLineageId
		);
	}
);

log(
	"Duplicate lineage_id values in curated TSV: " +
	duplicateCuratedLineageIds.length
);

_.each(
	duplicateCuratedLineageIds.sort(),
	function(lineageId) {
		log("  " + lineageId);
	}
);

log(
	"Duplicate sequenceID values in curated TSV: " +
	duplicateCuratedSequenceIds.length
);

_.each(
	duplicateCuratedSequenceIds.sort(),
	function(sequenceID) {
		log("  " + sequenceID);
	}
);

log(
	"Curated rows without lineage_id: " +
	curatedRowsWithoutLineageId.length
);

log(
	"Curated rows without sequenceID: " +
	curatedRowsWithoutSequenceId.length
);

// ============================================================================
// ERV sequence coverage
// ============================================================================

heading("ERV sublineage sequence coverage");

log(
	"Sequences in source '" +
	ERV_SOURCE +
	"': " +
	ervSequenceRows.length
);

log(
	"Sequences without an erv_lineage link: " +
	ervSequencesWithoutLineage.length
);

_.each(
	ervSequencesWithoutLineage.sort(),
	function(sequenceID) {
		log("  " + sequenceID);
	}
);

log(
	"Sequences linked outside the curated sublineage set: " +
	ervSequencesWithUnexpectedLineage.length
);

_.each(
	ervSequencesWithUnexpectedLineage,
	function(item) {
		log(
			"  " +
			item.sequenceID +
			" -> " +
			item.linkedLineageId
		);
	}
);

log(
	"Sublineages without an ERV reference sequence: " +
	sublineagesWithoutErvSequences.length
);

_.each(
	sublineagesWithoutErvSequences.sort(),
	function(lineageId) {
		log("  " + lineageId);
	}
);

log(
	"Sublineages with multiple ERV reference sequences: " +
	sublineagesWithMultipleErvSequences.length
);

_.each(
	sublineagesWithMultipleErvSequences,
	function(item) {
		log(
			"  " +
			item.lineageId +
			": " +
			item.sequenceIDs.join(", ")
		);
	}
);

// ============================================================================
// Alias coverage
// ============================================================================

heading("ERV sublineage aliases");

_.each(
	sortedKeys(sublineages),
	function(lineageId) {

		var sublineage =
			sublineages[lineageId];

		var label =
			lineageId;

		if(sublineage.name !== null) {
			label +=
				" [" +
				sublineage.name +
				"]";
		}

		log(
			label +
			": " +
			sublineage.aliasCount +
			" alias" +
			(
				sublineage.aliasCount === 1 ?
					"" :
					"es"
			)
		);
	}
);

log("");
log(
	"Total aliases attached to sublineages: " +
	sublineageAliasCount
);

log(
	"Alias rows without any erv_lineage target: " +
	orphanAliasRows.length
);

_.each(
	orphanAliasRows,
	function(alias) {
		log(
			"  " +
			alias.id +
			": " +
			displayValue(alias.aliasName) +
			" [" +
			displayValue(alias.aliasSource) +
			"]"
		);
	}
);

// ============================================================================
// Parent-lineage assignments
// ============================================================================

heading("Parent-lineage assignments");

subheading("Sublineage counts by parent_lineage");

printCounts(parentLineageCounts);

log("");
log(
	"Sublineages without parent_lineage: " +
	sublineagesWithoutParentValues.length
);

_.each(
	sublineagesWithoutParentValues.sort(),
	function(lineageId) {
		log("  " + lineageId);
	}
);

log(
	"Self-parent relationships: " +
	selfParentRelationships.length
);

_.each(
	selfParentRelationships.sort(),
	function(lineageId) {
		log("  " + lineageId);
	}
);

log(
	"Parent values matching erv_lineage rows: " +
	parentValuesMatchingErvRows.length
);

log(
	"Parent values not matching erv_lineage rows: " +
	parentValuesNotMatchingErvRows.length
);

log(
	"Note: a non-matching parent value is not necessarily erroneous; " +
	"it may identify a higher taxonomic grouping."
);

_.each(
	parentValuesNotMatchingErvRows,
	function(item) {
		log(
			"  " +
			item.lineageId +
			" -> " +
			item.parentLineage
		);
	}
);

// ============================================================================
// LTR association coverage
// ============================================================================

heading("ERV sublineage to LTR coverage");

var sublineagesWithLtrs =
	setSize(sublineages) -
	sublineagesWithoutLtrs.length;

log(
	"ERV sublineages linked to one or more LTR lineages: " +
	sublineagesWithLtrs +
	" / " +
	setSize(sublineages) +
	" (" +
	percentage(
		sublineagesWithLtrs,
		setSize(sublineages)
	) +
	"%)"
);

log(
	"ERV sublineages without an LTR association: " +
	sublineagesWithoutLtrs.length
);

_.each(
	sublineagesWithoutLtrs.sort(),
	function(lineageId) {

		var sublineage =
			sublineages[lineageId];

		var label =
			lineageId;

		if(sublineage.name !== null) {
			label +=
				" [" +
				sublineage.name +
				"]";
		}

		log("  " + label);
	}
);

subheading("LTR associations per ERV sublineage");

_.each(
	sortedKeys(sublineages),
	function(lineageId) {

		var sublineage =
			sublineages[lineageId];

		log(
			"  " +
			lineageId +
			": " +
			setSize(
				sublineage.ltrIds
			)
		);
	}
);

log("");
log(
	"Distinct LTR lineages associated with ERV sublineages: " +
	setSize(sublineageAssociatedLtrIds)
);

log(
	"Incomplete sublineage association rows: " +
	incompleteAssociationRows.length
);

_.each(
	incompleteAssociationRows,
	function(item) {
		log(
			"  " +
			item.id +
			": ERV=" +
			displayValue(item.ervLineageId) +
			", LTR=" +
			displayValue(item.ltrLineageId)
		);
	}
);

log(
	"Associations with unknown ERV sublineages: " +
	associationsWithUnknownSublineage.length
);

_.each(
	associationsWithUnknownSublineage,
	function(item) {
		log(
			"  " +
			item.id +
			": " +
			item.ervLineageId +
			" -> " +
			item.ltrLineageId
		);
	}
);

log(
	"Associations with unknown LTR lineages: " +
	associationsWithUnknownLtrLineage.length
);

_.each(
	associationsWithUnknownLtrLineage,
	function(item) {
		log(
			"  " +
			item.id +
			": " +
			item.ervLineageId +
			" -> " +
			item.ltrLineageId
		);
	}
);

// ============================================================================
// LTR sequence coverage
// ============================================================================

heading("Sublineage-associated LTR sequence coverage");

log(
	"Sequences in source '" +
	LTR_SOURCE +
	"': " +
	ltrSequenceRows.length
);

log(
	"LTR source sequences without an ltr_lineage link: " +
	ltrSequencesWithoutLineage.length
);

_.each(
	ltrSequencesWithoutLineage.sort(),
	function(sequenceID) {
		log("  " + sequenceID);
	}
);

log(
	"LTR source sequences whose lineage has no ERV-sublineage association: " +
	ltrSequencesWithoutSublineageAssociation.length
);

_.each(
	ltrSequencesWithoutSublineageAssociation,
	function(item) {
		log(
			"  " +
			item.sequenceID +
			" -> " +
			item.ltrLineageId
		);
	}
);

log(
	"Associated LTR lineages without a sequence in source '" +
	LTR_SOURCE +
	"': " +
	associatedLtrsWithoutSequences.length
);

_.each(
	associatedLtrsWithoutSequences.sort(),
	function(ltrLineageId) {
		log("  " + ltrLineageId);
	}
);

log(
	"Associated LTR lineages with multiple source sequences: " +
	associatedLtrsWithMultipleSequences.length
);

_.each(
	associatedLtrsWithMultipleSequences,
	function(item) {
		log(
			"  " +
			item.ltrLineageId +
			": " +
			item.sequenceIDs.join(", ")
		);
	}
);

// ============================================================================
// Reference coverage
// ============================================================================

heading("Reference coverage");

log(
	"Linked ERV sublineage sequences without references: " +
	linkedErvSequencesWithoutReferences.length
);

_.each(
	linkedErvSequencesWithoutReferences,
	function(item) {
		log(
			"  " +
			item.sequenceID +
			" -> " +
			item.lineageId
		);
	}
);

log(
	"Linked LTR sequences without references: " +
	linkedLtrSequencesWithoutReferences.length
);

_.each(
	linkedLtrSequencesWithoutReferences,
	function(item) {
		log(
			"  " +
			item.sequenceID +
			" -> " +
			item.ltrLineageId
		);
	}
);

log(
	"Unexpected reference names: " +
	unexpectedReferenceNames.length
);

_.each(
	unexpectedReferenceNames,
	function(item) {
		log(
			"  " +
			item.sequence +
			": expected " +
			item.expected +
			", found " +
			item.actual
		);
	}
);

// ============================================================================
// Alignment-tree coverage
// ============================================================================

heading("Accepted sublineage alignment coverage");

log(
	"Accepted ERV sublineages: " +
	acceptedSublineages.length
);

log(
	"Accepted sublineages without exactly one representative sequence: " +
	acceptedSublineagesWithoutOneSequence.length
);

_.each(
	acceptedSublineagesWithoutOneSequence.sort(),
	function(lineageId) {
		log("  " + lineageId);
	}
);

log(
	"Accepted sublineages without an expected lineage alignment: " +
	acceptedSublineagesWithoutAlignments.length
);

_.each(
	acceptedSublineagesWithoutAlignments,
	function(item) {
		log(
			"  " +
			item.lineageId +
			" [" +
			item.sequenceID +
			"]: expected " +
			item.expectedAlignmentName
		);
	}
);

log(
	"Lineage alignments using an unexpected reference: " +
	alignmentReferenceMismatches.length
);

_.each(
	alignmentReferenceMismatches,
	function(item) {
		log(
			"  " +
			item.alignmentName +
			": expected " +
			item.expectedReferenceName +
			", found " +
			displayValue(
				item.actualReferenceName
			)
		);
	}
);

// ============================================================================
// Final integrity summary
// ============================================================================

heading("Integrity summary");

var issueCount =
	expectedSublineagesMissingFromDatabase.length +
	unexpectedDatabaseSublineages.length +
	ervCanonicalLinkMismatches.length +
	duplicateCuratedLineageIds.length +
	duplicateCuratedSequenceIds.length +
	curatedRowsWithoutLineageId.length +
	ervSequencesWithoutLineage.length +
	ervSequencesWithUnexpectedLineage.length +
	sublineagesWithoutErvSequences.length +
	sublineagesWithMultipleErvSequences.length +
	orphanAliasRows.length +
	selfParentRelationships.length +
	incompleteAssociationRows.length +
	associationsWithUnknownSublineage.length +
	associationsWithUnknownLtrLineage.length +
	ltrSequencesWithoutLineage.length +
	associatedLtrsWithoutSequences.length +
	associatedLtrsWithMultipleSequences.length +
	linkedErvSequencesWithoutReferences.length +
	linkedLtrSequencesWithoutReferences.length +
	unexpectedReferenceNames.length +
	acceptedSublineagesWithoutOneSequence.length +
	acceptedSublineagesWithoutAlignments.length +
	alignmentReferenceMismatches.length;

log(
	"Potential integrity issues detected: " +
	issueCount
);

log(
	"Note: ERV sublineages without associated LTRs and LTR source " +
	"sequences without ERV-sublineage associations are reported for " +
	"curation but are not automatically counted as integrity failures."
);

log(
	"ERVdb sublineage-layer summary complete"
);
