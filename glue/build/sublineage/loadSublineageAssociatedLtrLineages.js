// glue/build/sublineage/loadSublineageAssociatedLtrLineages.js
//
// Create LTR lineage rows associated with ERV sublineages,
// link their representative sequences from source "ltr-sub",
// and create ERV-lineage-to-LTR-lineage association rows.
//
// Input:
//   tabular/sublineage/herv_sublineage_ltr_data_all.tsv
//
// Required columns:
//   LTR_name
//   linked_lineage_id
//
// Optional columns:
//   original_name
//   linked_element_name
//   linked_element_status
//   assoc_category
//   flag
//
// Identifier semantics:
//
//   LTR_name
//       Canonical ltr_lineage.id and expected sequenceID in source ltr-sub.
//
//   linked_lineage_id
//       Canonical erv_lineage.id. This must identify an ERV sublineage
//       row already created by loadErvSublineages.js.
//
//   linked_element_name
//       Original or source-specific name for the linked ERV element.
//       This is metadata only and is never used as a database key.
//
// This script deliberately describes these records as LTR lineages
// associated with ERV sublineages. It does not imply that they are
// sublineages of base-layer LTR families.

var INPUT_FILE =
	"tabular/sublineage/herv_sublineage_ltr_data_all.tsv";

var LTR_SOURCE = "ltr-sub";

var DRY_RUN = false;


// -----------------------------------------------------------------------------
// General utilities
// -----------------------------------------------------------------------------

function log(message) {
	glue.logInfo(message);
}

function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var stringValue = ("" + value).trim();

	if(stringValue === "") {
		return null;
	}

	var lowerValue = stringValue.toLowerCase();

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

function escapeQuotes(value) {

	return ("" + value)
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'");
}

function customRowPath(tableName, rowId) {

	return (
		"custom-table-row/" +
		tableName + "/" +
		rowId
	);
}


// -----------------------------------------------------------------------------
// Custom-table helpers
// -----------------------------------------------------------------------------

function customRowExists(tableName, rowId) {

	rowId = norm(rowId);

	if(rowId === null) {
		return false;
	}

	var result = glue.command([
		"list",
		"custom-table-row",
		tableName,
		"-w",
		"id = '" + escapeQuotes(rowId) + "'"
	]);

	return (
		result.listResult &&
		result.listResult.row &&
		result.listResult.row.length > 0
	);
}

function createCustomRowIfMissing(tableName, rowId) {

	rowId = norm(rowId);

	if(rowId === null) {
		return false;
	}

	if(customRowExists(tableName, rowId)) {
		return false;
	}

	if(DRY_RUN) {
		log(
			"[DRY RUN] Would create " +
			tableName + "/" + rowId
		);
		return true;
	}

	glue.command([
		"create",
		"custom-table-row",
		tableName,
		rowId
	]);

	log(
		"Created " +
		tableName + "/" + rowId
	);

	return true;
}

function setFieldIfPresent(fieldName, value) {

	value = norm(value);

	if(value !== null) {
		glue.command([
			"set",
			"field",
			fieldName,
			value
		]);
	}
}

function setLinkIfPresent(linkName, targetPath) {

	if(targetPath !== null) {
		glue.command([
			"set",
			"link-target",
			linkName,
			targetPath
		]);
	}
}


// -----------------------------------------------------------------------------
// Sequence helpers
// -----------------------------------------------------------------------------

function findSequenceInSource(sourceName, sequenceId) {

	sourceName = norm(sourceName);
	sequenceId = norm(sequenceId);

	if(
		sourceName === null ||
		sequenceId === null
	) {
		return null;
	}

	var result = glue.command([
		"list",
		"sequence",
		"source.name",
		"sequenceID",
		"-w",
		"source.name = '" +
			escapeQuotes(sourceName) +
			"' and sequenceID = '" +
			escapeQuotes(sequenceId) +
			"'"
	]);

	if(
		result.listResult &&
		result.listResult.row &&
		result.listResult.row.length > 0
	) {
		var values =
			result.listResult.row[0].value;

		return {
			sourceName: values[0],
			sequenceID: values[1]
		};
	}

	return null;
}

function findLtrSequence(
	ltrLineageId,
	originalName
) {

	var sequenceRef =
		findSequenceInSource(
			LTR_SOURCE,
			ltrLineageId
		);

	if(
		sequenceRef === null &&
		originalName !== null &&
		originalName !== ltrLineageId
	) {
		sequenceRef =
			findSequenceInSource(
				LTR_SOURCE,
				originalName
			);
	}

	return sequenceRef;
}


// -----------------------------------------------------------------------------
// Association helpers
// -----------------------------------------------------------------------------

function makeAssocId(
	ervLineageId,
	ltrLineageId
) {

	return (
		ervLineageId +
		"__" +
		ltrLineageId
	);
}

function isSublineageRelationship(
	linkedElementStatus
) {

	linkedElementStatus =
		norm(linkedElementStatus);

	/*
	 * A blank value is accepted because the input file itself is
	 * specifically for sublineage-associated LTR lineages.
	 */

	if(linkedElementStatus === null) {
		return true;
	}

	return (
		linkedElementStatus.toLowerCase() ===
		"sublineage"
	);
}


// -----------------------------------------------------------------------------
// Load input rows
// -----------------------------------------------------------------------------

var rows;

glue.inMode(
	"module/tabularUtility",
	function() {
		rows = glue.tableToObjects(
			glue.command([
				"load-tabular",
				INPUT_FILE
			])
		);
	}
);

log(
	"Loaded " +
	rows.length +
	" rows from " +
	INPUT_FILE
);

log(
	"LTR sequence search source: " +
	LTR_SOURCE
);


// -----------------------------------------------------------------------------
// Summary counters
// -----------------------------------------------------------------------------

var rowsProcessed = 0;
var skippedNonSublineageRows = 0;
var skippedIncompleteRows = 0;

var ltrRowsCreated = 0;
var ltrRowsExisting = 0;

var ltrSequencesLinked = 0;
var ltrSequencesMissing = 0;

var associationsCreated = 0;
var associationsExisting = 0;
var associationsUpdated = 0;

var missingErvLineages = 0;
var unlinkedLtrRows = 0;

var distinctLtrLineages = {};
var distinctErvLineages = {};


// -----------------------------------------------------------------------------
// Process rows
// -----------------------------------------------------------------------------

_.each(rows, function(row) {

	var ltrLineageId =
		norm(row["LTR_name"]);

	var originalName =
		norm(row["original_name"]);

	var linkedLineageId =
		norm(row["linked_lineage_id"]);

	var linkedElementName =
		norm(row["linked_element_name"]);

	var linkedElementStatus =
		norm(row["linked_element_status"]);

	var sourceAssociationCategory =
		norm(row["assoc_category"]);

	var sourceFlag =
		norm(row["flag"]);


	/*
	 * Reject rows explicitly assigned to another relationship level.
	 */

	if(
		!isSublineageRelationship(
			linkedElementStatus
		)
	) {
		skippedNonSublineageRows++;

		log(
			"Skipping non-sublineage relationship: " +
			"LTR=" + ltrLineageId +
			", linked element=" +
			linkedElementName +
			", status=" +
			linkedElementStatus
		);

		return;
	}


	if(ltrLineageId === null) {
		skippedIncompleteRows++;

		log(
			"Skipping row with missing LTR_name: " +
			JSON.stringify(row)
		);

		return;
	}

	rowsProcessed++;
	distinctLtrLineages[ltrLineageId] = true;


	/*
	 * Create or find the LTR lineage.
	 */

	var ltrRowCreated =
		createCustomRowIfMissing(
			"ltr_lineage",
			ltrLineageId
		);

	if(ltrRowCreated) {
		ltrRowsCreated++;
	} else {
		ltrRowsExisting++;
	}


	/*
	 * Populate LTR metadata.
	 *
	 * linked_element records the original source-specific ERV name,
	 * not the canonical linked_lineage_id.
	 */

	if(!DRY_RUN) {
		glue.inMode(
			customRowPath(
				"ltr_lineage",
				ltrLineageId
			),
			function() {
				setFieldIfPresent(
					"original_name",
					originalName
				);

				setFieldIfPresent(
					"linked_element",
					linkedElementName
				);
			}
		);
	}


	/*
	 * Link the representative sequence from source ltr-sub.
	 */

	var sequenceRef =
		findLtrSequence(
			ltrLineageId,
			originalName
		);

	if(sequenceRef !== null) {

		if(!DRY_RUN) {
			glue.inMode(
				"sequence/" +
					sequenceRef.sourceName + "/" +
					sequenceRef.sequenceID,
				function() {
					setLinkIfPresent(
						"ltr_lineage",
						customRowPath(
							"ltr_lineage",
							ltrLineageId
						)
					);
				}
			);
		}

		ltrSequencesLinked++;

		log(
			"Linked LTR sequence " +
			sequenceRef.sourceName + "/" +
			sequenceRef.sequenceID +
			" -> ltr_lineage/" +
			ltrLineageId
		);

	} else {

		ltrSequencesMissing++;

		log(
			"No representative LTR sequence found for " +
			"ltr_lineage/" + ltrLineageId
		);
	}


	/*
	 * An LTR lineage may legitimately lack a current ERV assignment.
	 * In that case the LTR row and sequence link are retained, but no
	 * association row is created.
	 */

	if(linkedLineageId === null) {
		unlinkedLtrRows++;

		log(
			"No linked_lineage_id for LTR lineage " +
			ltrLineageId
		);

		return;
	}

	distinctErvLineages[linkedLineageId] = true;


	/*
	 * The canonical ERV sublineage row must already exist.
	 */

	if(
		!customRowExists(
			"erv_lineage",
			linkedLineageId
		)
	) {
		missingErvLineages++;

		log(
			"No erv_lineage row found for canonical ID " +
			linkedLineageId +
			" while processing LTR lineage " +
			ltrLineageId
		);

		return;
	}


	/*
	 * Create the ERV-LTR association.
	 */

	var assocId =
		makeAssocId(
			linkedLineageId,
			ltrLineageId
		);

	var assocCreated =
		createCustomRowIfMissing(
			"erv_lineage_ltr_assoc",
			assocId
		);

	if(assocCreated) {
		associationsCreated++;
	} else {
		associationsExisting++;
	}


	if(!DRY_RUN) {
		glue.inMode(
			customRowPath(
				"erv_lineage_ltr_assoc",
				assocId
			),
			function() {

				setFieldIfPresent(
					"association_type",
					"associated_ltr"
				);

				setFieldIfPresent(
					"evidence",
					"curated_sublineage_ltr_table"
				);

				var comment =
					"LTR lineage " +
					ltrLineageId +
					" associated with ERV sublineage " +
					linkedLineageId;

				if(linkedElementName !== null) {
					comment +=
						" (original linked element: " +
						linkedElementName +
						")";
				}

				if(sourceAssociationCategory !== null) {
					comment +=
						"; source category: " +
						sourceAssociationCategory;
				}

				if(sourceFlag !== null) {
					comment +=
						"; source flag: " +
						sourceFlag;
				}

				setFieldIfPresent(
					"comment",
					comment
				);

				setLinkIfPresent(
					"erv_lineage",
					customRowPath(
						"erv_lineage",
						linkedLineageId
					)
				);

				setLinkIfPresent(
					"ltr_lineage",
					customRowPath(
						"ltr_lineage",
						ltrLineageId
					)
				);
			}
		);
	}

	associationsUpdated++;

	log(
		"Created/updated ERV-sublineage-to-LTR association " +
		assocId
	);
});


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log("----- SUMMARY -----");

log(
	"Input rows: " +
	rows.length
);

log(
	"Sublineage-associated rows processed: " +
	rowsProcessed
);

log(
	"Distinct LTR lineages encountered: " +
	Object.keys(distinctLtrLineages).length
);

log(
	"Distinct ERV sublineages encountered: " +
	Object.keys(distinctErvLineages).length
);

log(
	"LTR lineage rows created: " +
	ltrRowsCreated
);

log(
	"LTR lineage rows already present: " +
	ltrRowsExisting
);

log(
	"Representative LTR sequences linked: " +
	ltrSequencesLinked
);

log(
	"Representative LTR sequences missing: " +
	ltrSequencesMissing
);

log(
	"Association rows created: " +
	associationsCreated
);

log(
	"Association rows already present: " +
	associationsExisting
);

log(
	"Association rows created/updated: " +
	associationsUpdated
);

log(
	"Rows without linked_lineage_id: " +
	unlinkedLtrRows
);

log(
	"Canonical ERV sublineage rows missing: " +
	missingErvLineages
);

log(
	"Non-sublineage relationships skipped: " +
	skippedNonSublineageRows
);

log(
	"Incomplete rows skipped: " +
	skippedIncompleteRows
);

log(
	"Finished loading LTR lineages associated with ERV sublineages"
);
