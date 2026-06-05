// glue/build/erv/loadErvLtrRelationships.js
//
// Load ERV <-> LTR associations from tabular/erv/erv-ltr_relationships.tsv
//
// For each row:
// 1. create/get ltr_lineage row
// 2. try to link matching LTR sequence from configured LTR sources
// 3. create/get erv_lineage_ltr_assoc row
// 4. link assoc row to erv_lineage and ltr_lineage
// 5. populate association metadata
//
// Assumes:
// - erv_lineage rows already exist
// - ltr_lineage custom table exists
// - erv_lineage_ltr_assoc custom table exists
// - sequence -> ltr_lineage link exists

var INPUT_FILE = "tabular/erv/erv-ltr_relationships.tsv";

// Search these sources in order.
// The first exact sequenceID match found will be used.
var LTR_SOURCES = [
	"ltr-refseqs-erv",
	"ltr-refseqs-erranti",
	"ltr-refseqs-malr",
	"ltr-refseqs-orphan"
];

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
	var low = s.toLowerCase();
	if(low === "n/a" || low === "na" || low === "n/k" || low === "nk") {
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

function findSequenceInSource(sourceName, sequenceId) {
	var result = glue.command([
		"list", "sequence",
		"source.name", "sequenceID",
		"-w", "source.name = '" + escapeQuotes(sourceName) +
			"' and sequenceID = '" + escapeQuotes(sequenceId) + "'"
	]);

	if(result.listResult &&
		result.listResult.row &&
		result.listResult.row.length > 0) {

		var firstRow = result.listResult.row[0];
		var values = firstRow.value;

		return {
			sourceName: values[0],
			sequenceID: values[1]
		};
	}
	return null;
}

function findLtrSequenceRef(sequenceId) {
	var seq = norm(sequenceId);
	if(seq == null) {
		return null;
	}

	var i;
	for(i = 0; i < LTR_SOURCES.length; i++) {
		var sourceName = LTR_SOURCES[i];
		var seqRef = findSequenceInSource(sourceName, seq);
		if(seqRef != null) {
			return seqRef;
		}
	}
	return null;
}

function setSequenceCustomLinkIfPresent(sequenceRef, linkName, targetTable, targetId) {
	if(sequenceRef == null || targetId == null) {
		return;
	}
	if(!DRY_RUN) {
		glue.inMode("sequence/" + sequenceRef.sourceName + "/" + sequenceRef.sequenceID, function() {
			glue.command([
				"set", "link-target", linkName,
				"custom-table-row/" + targetTable + "/" + targetId
			]);
		});
	}
}

var rows;
glue.inMode("module/tabularUtility", function() {
	rows = glue.tableToObjects(
		glue.command(["load-tabular", INPUT_FILE])
	);
});

log("Loaded " + rows.length + " rows from " + INPUT_FILE);
log("LTR sequence search sources: " + LTR_SOURCES.join(", "));

var assocRowCount = 0;
var ltrLineageCount = 0;
var assocCreatedOrUpdatedCount = 0;
var linkedLtrSeqCount = 0;
var missingLtrSeqCount = 0;
var missingErvLineageCount = 0;
var skippedRowCount = 0;

_.each(rows, function(row) {

	var assocId = norm(row["id"]);
	var ervLineageId = norm(row["erv_lineage.id"]);
	var ervLtrLineageId = norm(row["ltr_lineage.id"]);
	var associationType = norm(row["association_type"]);
	var evidence = norm(row["evidence"]);

	if(assocId == null || ervLineageId == null || ervLtrLineageId == null) {
		skippedRowCount++;
		log("Skipping incomplete row: id=" + assocId +
			", erv_lineage.id=" + ervLineageId +
			", ltr_lineage.id=" + ervLtrLineageId);
		return;
	}

	assocRowCount++;
	ltrLineageCount++;

	// 1. create/get ltr_lineage row
	createCustomRowIfMissing("ltr_lineage", ervLtrLineageId);

	// Optional default metadata
	setCustomFieldIfPresent("ltr_lineage", ervLtrLineageId, "reference_method", "repbase");

	// 2. try to find matching LTR sequence and link it
	var seqRef = findLtrSequenceRef(ervLtrLineageId);
	if(seqRef != null) {
		setSequenceCustomLinkIfPresent(seqRef, "ltr_lineage", "ltr_lineage", ervLtrLineageId);
		linkedLtrSeqCount++;
		log("Linked LTR sequence " + seqRef.sourceName + "/" + seqRef.sequenceID +
			" -> ltr_lineage/" + ervLtrLineageId);
	} else {
		missingLtrSeqCount++;
		log("Missing LTR sequence for ltr_lineage.id '" + ervLtrLineageId + "'");
	}

	// 3. only create association if erv_lineage row exists
	if(!customRowExists("erv_lineage", ervLineageId)) {
		missingErvLineageCount++;
		log("Missing erv_lineage row '" + ervLineageId +
			"' while processing assoc '" + assocId + "'");
		return;
	}

	// 4. create/get association row and link both sides
	createCustomRowIfMissing("erv_lineage_ltr_assoc", assocId);
	setCustomLinkIfPresent("erv_lineage_ltr_assoc", assocId, "erv_lineage", "erv_lineage", ervLineageId);
	setCustomLinkIfPresent("erv_lineage_ltr_assoc", assocId, "ltr_lineage", "ltr_lineage", ervLtrLineageId);

	// 5. metadata from input table
	setCustomFieldIfPresent("erv_lineage_ltr_assoc", assocId, "association_type", associationType);
	setCustomFieldIfPresent("erv_lineage_ltr_assoc", assocId, "evidence", evidence);

	assocCreatedOrUpdatedCount++;
});

log("----- SUMMARY -----");
log("Association rows processed: " + assocRowCount);
log("LTR lineage rows processed: " + ltrLineageCount);
log("Association rows created/updated: " + assocCreatedOrUpdatedCount);
log("Linked LTR sequences: " + linkedLtrSeqCount);
log("Missing LTR sequences: " + missingLtrSeqCount);
log("Missing erv_lineage rows: " + missingErvLineageCount);
log("Skipped incomplete rows: " + skippedRowCount);