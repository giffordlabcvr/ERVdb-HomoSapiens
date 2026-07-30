// glue/build/locus/deleteMissingErvLocusCandidates.js
//
// Delete erv_locus_candidate rows listed in:
//
//   tabular/locus/RBRT_513k_missing_ids.tsv
//
// Expected input column:
//
//   id
//
// For each non-empty ID, deletes:
//
//   custom-table-row/erv_locus_candidate/<id>

var INPUT_FILE = "tabular/locus/RBRT_513k_missing_ids.tsv";
var TABLE_NAME = "erv_locus_candidate";

var DRY_RUN = false;

function log(msg) {
	glue.logInfo(msg);
}

function norm(value) {
	if (value == null) {
		return null;
	}

	var s = ("" + value).trim();

	if (s === "") {
		return null;
	}

	return s;
}

function escapeQuotes(value) {
	return value.replace(/'/g, "\\'");
}

function customRowExists(tableName, rowId) {
	var result = glue.command([
		"list", "custom-table-row", tableName,
		"-w", "id = '" + escapeQuotes(rowId) + "'"
	]);

	return result.listResult &&
		result.listResult.row &&
		result.listResult.row.length > 0;
}

var rows;

glue.inMode("module/tabularUtility", function() {
	rows = glue.tableToObjects(
		glue.command([
			"load-tabular",
			INPUT_FILE
		])
	);
});

log("Loaded " + rows.length + " rows from " + INPUT_FILE);

var deletedCount = 0;
var missingCount = 0;
var skippedCount = 0;

_.each(rows, function(row) {

	var rowId = norm(row["id"]);

	if (rowId == null) {
		skippedCount++;
		log("Skipping row with no ID: " + JSON.stringify(row));
		return;
	}

	if (!customRowExists(TABLE_NAME, rowId)) {
		missingCount++;
		log("No " + TABLE_NAME + " row exists for ID: " + rowId);
		return;
	}

	if (!DRY_RUN) {
		glue.command([
			"delete",
			"custom-table-row",
			TABLE_NAME,
			rowId
		]);
	}

	deletedCount++;

	if (DRY_RUN) {
		log("Would delete " + TABLE_NAME + "/" + rowId);
	} else {
		log("Deleted " + TABLE_NAME + "/" + rowId);
	}
});

log("----- SUMMARY -----");

if (DRY_RUN) {
	log("Rows that would be deleted: " + deletedCount);
} else {
	log("Rows deleted: " + deletedCount);
}

log("IDs with no existing row: " + missingCount);
log("Input rows skipped because ID was empty: " + skippedCount);

