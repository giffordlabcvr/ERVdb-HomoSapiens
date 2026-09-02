// glue/build/sublineage/loadErvSublineageTaxonomy.js
//
// Load ERV sublineage taxonomy from:
//
//   tabular/sublineage/herv_sublineage_data.tsv
//
// Expected taxonomy columns:
//   lineage_id
//   clade
//   subfamily
//   genus
//   subgenus
//
// Main actions:
//   - create missing taxonomy rows
//   - establish relationships between taxonomy ranks
//   - link canonical erv_lineage rows to the applicable taxonomy ranks
//
// Notes:
//   - lineage_id, rather than sequenceID, identifies the erv_lineage row.
//   - rv_species is not used for ERV sublineages.

var INPUT_PATHS = [
	"tabular/sublineage/herv_sublineage_data.tsv"
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function loadTsv(path) {

	var rows;

	glue.inMode("module/tabularUtility", function() {
		rows = glue.tableToObjects(
			glue.command([
				"load-tabular",
				path
			])
		);
	});

	return rows;
}

function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var s = ("" + value).trim();

	if(s === "") {
		return null;
	}

	var low = s.toLowerCase();

	if(
		low === "n/a" ||
		low === "na" ||
		low === "n/k" ||
		low === "nk" ||
		low === "unknown" ||
		low === "null" ||
		low === "none"
	) {
		return null;
	}

	return s;
}

function escapeQuotes(value) {
	return value.replace(/'/g, "\\'");
}

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

function ensureRow(tableName, rowId) {

	rowId = norm(rowId);

	if(rowId === null) {
		return false;
	}

	if(customRowExists(tableName, rowId)) {
		return false;
	}

	glue.command([
		"create",
		"custom-table-row",
		tableName,
		rowId
	]);

	return true;
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

function customRowPath(tableName, rowId) {

	return (
		"custom-table-row/" +
		tableName +
		"/" +
		rowId
	);
}

// -----------------------------------------------------------------------------
// Load TSV rows
// -----------------------------------------------------------------------------

var taxRows = [];

_.each(INPUT_PATHS, function(path) {

	var rows = loadTsv(path);

	taxRows = taxRows.concat(rows);

	glue.logInfo(
		"Loaded " +
		rows.length +
		" rows from " +
		path
	);
});

// -----------------------------------------------------------------------------
// Pass 1: ensure taxonomy rows exist
// -----------------------------------------------------------------------------

var cladeRowsCreated = 0;
var subfamilyRowsCreated = 0;
var genusRowsCreated = 0;
var subgenusRowsCreated = 0;

_.each(taxRows, function(row) {

	if(ensureRow("rv_clade", row["clade"])) {
		cladeRowsCreated++;
	}

	if(ensureRow("rv_subfamily", row["subfamily"])) {
		subfamilyRowsCreated++;
	}

	if(ensureRow("rv_genus", row["genus"])) {
		genusRowsCreated++;
	}

	if(ensureRow("rv_subgenus", row["subgenus"])) {
		subgenusRowsCreated++;
	}
});

// -----------------------------------------------------------------------------
// Pass 2: establish relationships between taxonomy ranks
// -----------------------------------------------------------------------------

_.each(taxRows, function(row) {

	var cladeId = norm(row["clade"]);
	var subfamilyId = norm(row["subfamily"]);
	var genusId = norm(row["genus"]);
	var subgenusId = norm(row["subgenus"]);

	// subgenus -> genus
	if(
		subgenusId !== null &&
		genusId !== null
	) {
		glue.inMode(
			customRowPath(
				"rv_subgenus",
				subgenusId
			),
			function() {
				setLinkIfPresent(
					"rv_genus",
					customRowPath(
						"rv_genus",
						genusId
					)
				);
			}
		);
	}

	// genus -> subfamily
	if(
		genusId !== null &&
		subfamilyId !== null
	) {
		glue.inMode(
			customRowPath(
				"rv_genus",
				genusId
			),
			function() {
				setLinkIfPresent(
					"rv_subfamily",
					customRowPath(
						"rv_subfamily",
						subfamilyId
					)
				);
			}
		);
	}

	// subfamily -> clade
	if(
		subfamilyId !== null &&
		cladeId !== null
	) {
		glue.inMode(
			customRowPath(
				"rv_subfamily",
				subfamilyId
			),
			function() {
				setLinkIfPresent(
					"rv_clade",
					customRowPath(
						"rv_clade",
						cladeId
					)
				);
			}
		);
	}
});

// -----------------------------------------------------------------------------
// Pass 3: link erv_lineage rows directly to taxonomy
// -----------------------------------------------------------------------------

var lineageRowsLinked = 0;
var missingLineageIds = [];
var rowsWithoutLineageId = 0;

_.each(taxRows, function(row) {

	var lineageId = norm(row["lineage_id"]);
	var cladeId = norm(row["clade"]);
	var subfamilyId = norm(row["subfamily"]);
	var genusId = norm(row["genus"]);
	var subgenusId = norm(row["subgenus"]);

	if(lineageId === null) {
		rowsWithoutLineageId++;

		glue.logInfo(
			"Skipping row with missing lineage_id: " +
			JSON.stringify(row)
		);

		return;
	}

	if(!customRowExists("erv_lineage", lineageId)) {
		missingLineageIds.push(lineageId);

		glue.logInfo(
			"No erv_lineage row found for canonical ID '" +
			lineageId +
			"'"
		);

		return;
	}

	glue.inMode(
		customRowPath(
			"erv_lineage",
			lineageId
		),
		function() {

			if(subgenusId !== null) {
				setLinkIfPresent(
					"rv_subgenus",
					customRowPath(
						"rv_subgenus",
						subgenusId
					)
				);
			}

			if(genusId !== null) {
				setLinkIfPresent(
					"rv_genus",
					customRowPath(
						"rv_genus",
						genusId
					)
				);
			}

			if(subfamilyId !== null) {
				setLinkIfPresent(
					"rv_subfamily",
					customRowPath(
						"rv_subfamily",
						subfamilyId
					)
				);
			}

			if(cladeId !== null) {
				setLinkIfPresent(
					"rv_clade",
					customRowPath(
						"rv_clade",
						cladeId
					)
				);
			}
		}
	);

	lineageRowsLinked++;
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

glue.logInfo("----- SUMMARY -----");
glue.logInfo("Input rows: " + taxRows.length);
glue.logInfo("Clade rows created: " + cladeRowsCreated);
glue.logInfo("Subfamily rows created: " + subfamilyRowsCreated);
glue.logInfo("Genus rows created: " + genusRowsCreated);
glue.logInfo("Subgenus rows created: " + subgenusRowsCreated);
glue.logInfo("ERV sublineage rows linked to taxonomy: " + lineageRowsLinked);
glue.logInfo("Rows without lineage_id: " + rowsWithoutLineageId);
glue.logInfo("Missing canonical erv_lineage rows: " + missingLineageIds.length);

_.each(missingLineageIds.sort(), function(lineageId) {
	glue.logInfo("  " + lineageId);
});

glue.logInfo("ERV sublineage taxonomy loading complete");
