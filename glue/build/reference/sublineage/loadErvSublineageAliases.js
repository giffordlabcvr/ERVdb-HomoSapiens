/**
 * loadErvSublineageAliases.js
 *
 * Load aliases for the curated ERV sublineages from:
 *
 *   tabular/reference/sublineage/herv_sublineage_alias.tsv
 *
 * Expected columns:
 *
 *   erv_lineage.id
 *   alias_name
 *   alias_source
 *
 * Additional descriptive columns are permitted and ignored.
 *
 * The erv_lineage.id column must contain the authoritative canonical
 * ERVdb identifier, not the representative sequence ID or familiar name.
 *
 * Example:
 *
 *   erv_lineage.id      = ERV-1.Rho.Rb.39
 *   erv_lineage.name    = HERV-39
 *   alias_name          = HERV39
 *   alias_source        = repbase
 */

var INPUT_PATH =
	"tabular/reference/sublineage/herv_sublineage_alias.tsv";

// ============================================================================
// Helpers
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

	if(stringValue === "") {
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

function escapeQuotes(value) {
	return value.replace(/'/g, "\\'");
}

function sanitiseId(value) {

	value =
		norm(value);

	if(value === null) {
		return null;
	}

	return value.replace(
		/[^A-Za-z0-9._-]/g,
		"_"
	);
}

function customRowPath(
	tableName,
	rowId
) {
	return (
		"custom-table-row/" +
		tableName +
		"/" +
		rowId
	);
}

function customRowExists(
	tableName,
	rowId
) {

	rowId =
		norm(rowId);

	if(rowId === null) {
		return false;
	}

	var result =
		glue.command([
			"list",
			"custom-table-row",
			tableName,
			"-w",
			"id = '" +
				escapeQuotes(rowId) +
				"'"
		]);

	var rows =
		glue.tableToObjects(result);

	return rows.length > 0;
}

function ensureCustomRow(
	tableName,
	rowId
) {

	rowId =
		norm(rowId);

	if(rowId === null) {
		return false;
	}

	if(
		!customRowExists(
			tableName,
			rowId
		)
	) {
		glue.command([
			"create",
			"custom-table-row",
			tableName,
			rowId
		]);

		log(
			"Created " +
			tableName +
			"/" +
			rowId
		);

		return true;
	}

	return false;
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

function setStringFieldIfPresent(
	fieldName,
	value
) {

	value =
		norm(value);

	if(value === null) {
		return;
	}

	glue.command([
		"set",
		"field",
		fieldName,
		value
	]);
}

function setLinkIfPresent(
	linkName,
	tableName,
	rowId
) {

	rowId =
		norm(rowId);

	if(rowId === null) {
		return;
	}

	glue.command([
		"set",
		"link-target",
		linkName,
		customRowPath(
			tableName,
			rowId
		)
	]);
}

function sourceCode(aliasSource) {

	aliasSource =
		norm(aliasSource);

	if(aliasSource === null) {
		return "NA";
	}

	var lowerSource =
		aliasSource.toLowerCase();

	if(lowerSource === "repbase") {
		return "RB";
	}

	if(lowerSource === "retrotector") {
		return "RT";
	}

	if(lowerSource === "other") {
		return "OT";
	}

	return sanitiseId(
		aliasSource.toUpperCase()
	);
}

function makeAliasRowId(
	lineageId,
	aliasSource,
	aliasName
) {
	return (
		sanitiseId(lineageId) +
		"__" +
		sourceCode(aliasSource) +
		"__" +
		sanitiseId(aliasName)
	);
}

// ============================================================================
// Load input
// ============================================================================

var rows =
	loadTsv(INPUT_PATH);

log(
	"Loaded " +
	rows.length +
	" rows from " +
	INPUT_PATH
);

// ============================================================================
// Process aliases
// ============================================================================

var aliasRowsCreated = 0;
var aliasRowsUpdated = 0;
var missingLineageRows = 0;
var incompleteRows = 0;

_.each(
	rows,
	function(row) {

		var lineageId =
			norm(
				row["erv_lineage.id"]
			);

		var aliasName =
			norm(
				row["alias_name"]
			);

		var aliasSource =
			norm(
				row["alias_source"]
			);

		// --------------------------------------------------------------------
		// Check required fields
		// --------------------------------------------------------------------

		if(
			lineageId === null ||
			aliasName === null ||
			aliasSource === null
		) {
			incompleteRows++;

			log(
				"Skipping incomplete alias row: " +
				JSON.stringify(row)
			);

			return;
		}

		// --------------------------------------------------------------------
		// Confirm that the canonical ERV sublineage exists
		// --------------------------------------------------------------------

		if(
			!customRowExists(
				"erv_lineage",
				lineageId
			)
		) {
			missingLineageRows++;

			log(
				"Skipping alias '" +
				aliasName +
				"' because canonical erv_lineage row '" +
				lineageId +
				"' is missing"
			);

			return;
		}

		// --------------------------------------------------------------------
		// Create or find the alias row
		// --------------------------------------------------------------------

		var aliasRowId =
			makeAliasRowId(
				lineageId,
				aliasSource,
				aliasName
			);

		var wasCreated =
			ensureCustomRow(
				"erv_lineage_alias",
				aliasRowId
			);

		if(wasCreated) {
			aliasRowsCreated++;
		} else {
			aliasRowsUpdated++;
		}

		// --------------------------------------------------------------------
		// Populate the alias and link it to the canonical ERV sublineage
		// --------------------------------------------------------------------

		glue.inMode(
			customRowPath(
				"erv_lineage_alias",
				aliasRowId
			),
			function() {

				setStringFieldIfPresent(
					"alias_name",
					aliasName
				);

				setStringFieldIfPresent(
					"alias_source",
					aliasSource
				);

				setLinkIfPresent(
					"erv_lineage",
					"erv_lineage",
					lineageId
				);
			}
		);

		log(
			"Linked alias '" +
				aliasName +
				"' (" +
				aliasSource +
				") -> " +
				lineageId
		);
	}
);

// ============================================================================
// Summary
// ============================================================================

log("----- SUMMARY -----");

log(
	"Input alias rows: " +
	rows.length
);

log(
	"Alias rows created: " +
	aliasRowsCreated
);

log(
	"Existing alias rows updated: " +
	aliasRowsUpdated
);

log(
	"Alias rows created/updated: " +
	(
		aliasRowsCreated +
		aliasRowsUpdated
	)
);

log(
	"Skipped due to missing canonical erv_lineage row: " +
	missingLineageRows
);

log(
	"Skipped incomplete rows: " +
	incompleteRows
);

log(
	"ERV sublineage alias loading complete"
);