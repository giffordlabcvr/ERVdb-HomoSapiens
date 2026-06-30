// glue/build/erv/loadErvSublineageAliases.js
//
// Load ERV sublineage aliases from TSV into erv_lineage_alias.
//
// Input columns:
//   erv_lineage.id
//   category
//   alias_name
//   alias_source
//
// Assumes:
// - sublineage rows already exist in erv_lineage
// - erv_lineage_alias custom table exists
// - link erv_lineage_alias -> erv_lineage exists

var INPUT_FILE = "tabular/reference/herv_sublineage_alias.tsv";
var DRY_RUN = false;

function log(msg) {
	glue.logInfo(msg);
}

function norm(value) {
	if(value == null) {
		return null;
	}
	var s = ("" + value).trim();
	if(s === "") {
		return null;
	}
	return s;
}

function safeId(value) {
	if(value == null) {
		return null;
	}
	return value.trim()
		.replace(/[()]/g, "")
		.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function aliasSourceCode(aliasSource) {
	if(aliasSource === "other") {
		return "OT";
	}
	if(aliasSource === "retrotector") {
		return "RT";
	}
	if(aliasSource === "repbase") {
		return "RB";
	}
	return "XX";
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

function createCustomRowIfMissing(tableName, rowId) {
	if(!customRowExists(tableName, rowId)) {
		if(!DRY_RUN) {
			glue.command(["create", "custom-table-row", tableName, rowId]);
		}
		log("Created " + tableName + "/" + rowId);
	}
}

function setCustomFieldIfPresent(tableName, rowId, fieldName, value) {
	if(value == null) {
		return;
	}
	if(!DRY_RUN) {
		glue.inMode("custom-table-row/" + tableName + "/" + rowId, function() {
			glue.command(["set", "field", fieldName, value]);
		});
	}
}

function setCustomLinkIfPresent(tableName, rowId, linkName, targetTable, targetId) {
	if(targetId == null) {
		return;
	}
	if(!DRY_RUN) {
		glue.inMode("custom-table-row/" + tableName + "/" + rowId, function() {
			glue.command([
				"set", "link-target", linkName,
				"custom-table-row/" + targetTable + "/" + targetId
			]);
		});
	}
}

function aliasRowId(lineageId, aliasSource, aliasName) {
	return safeId(lineageId + "__" + aliasSourceCode(aliasSource) + "__" + aliasName);
}

var rows;
glue.inMode("module/tabularUtility", function() {
	rows = glue.tableToObjects(
		glue.command(["load-tabular", INPUT_FILE])
	);
});

log("Loaded " + rows.length + " rows from " + INPUT_FILE);

var aliasCount = 0;
var skippedMissingLineageCount = 0;
var skippedWrongCategoryCount = 0;

_.each(rows, function(row) {

	var lineageId = norm(row["erv_lineage.id"]);
	var category = norm(row["category"]);
	var aliasName = norm(row["alias_name"]);
	var aliasSource = norm(row["alias_source"]);

	if(lineageId == null || aliasName == null || aliasSource == null) {
		log("Skipping incomplete row: " + JSON.stringify(row));
		return;
	}

	if(category !== null && category !== "sublineage") {
		skippedWrongCategoryCount++;
		log("Skipping alias '" + aliasName + "' because category is '" + category + "'");
		return;
	}

	if(!customRowExists("erv_lineage", lineageId)) {
		skippedMissingLineageCount++;
		log("Skipping alias '" + aliasName + "' because erv_lineage row '" + lineageId + "' is missing");
		return;
	}

	var rowId = aliasRowId(lineageId, aliasSource, aliasName);

	createCustomRowIfMissing("erv_lineage_alias", rowId);
	setCustomFieldIfPresent("erv_lineage_alias", rowId, "alias_name", aliasName);
	setCustomFieldIfPresent("erv_lineage_alias", rowId, "alias_source", aliasSource);
	setCustomLinkIfPresent("erv_lineage_alias", rowId, "erv_lineage", "erv_lineage", lineageId);

	aliasCount++;
	log("Linked alias '" + aliasName + "' (" + aliasSource + ") -> " + lineageId);
});

log("----- SUMMARY -----");
log("Alias rows created/updated: " + aliasCount);
log("Skipped due to missing erv_lineage row: " + skippedMissingLineageCount);
log("Skipped due to non-sublineage category: " + skippedWrongCategoryCount);

