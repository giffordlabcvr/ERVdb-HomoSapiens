// glue/build/sublineage/ervExtendAlignmentTreeSublineage.js
//
// Add selected ERV sublineage reference sequences to the constrained alignment tree.
//
// Inclusion rule:
//   - entity_type = sublineage
//   - status = accepted
//
// Input:
//   tabular/reference/herv_sublineage_data.tsv
//
// Assumptions:
// - sublineage rows are stored in erv_lineage
// - references have already been declared using:
//     REF_<sequenceID sanitized>
// - parent constrained alignments already exist for the relevant genus/subgenus context
// - alignment naming follows:
//     AL_<sanitized standardised lineage name>
//   for the new sublineage alignment
//
// NOTE:
// Adjust parentAlignmentNameForRow() if your alignment naming convention differs.

var INPUT_FILE = "tabular/reference/herv_sublineage_data.tsv";
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
	if(low === "n/a" || low === "na" || low === "null" || low === "none") {
		return null;
	}
	return s;
}

function yes(value) {
	var v = norm(value);
	if(v == null) {
		return false;
	}
	return v.toLowerCase() === "yes";
}

function sanitize(value) {
	return ("" + value).replace(/[^A-Za-z0-9]/g, "");
}

function escapeQuotes(value) {
	return ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function runCmd(cmdWords) {
	if(DRY_RUN) {
		log("[DRY RUN] " + cmdWords.join(" "));
		return null;
	}
	return glue.command(cmdWords);
}

function customRowExists(tableName, rowId) {
	var rows = glue.tableToObjects(glue.command([
		"list", "custom-table-row", tableName,
		"-w", "id = '" + escapeQuotes(rowId) + "'"
	]));
	return rows.length > 0;
}

function referenceExists(refName) {
	var rows = glue.tableToObjects(glue.command([
		"list", "reference",
		"-w", "name = '" + escapeQuotes(refName) + "'"
	]));
	return rows.length > 0;
}

function alignmentExists(alignmentName) {
	var rows = glue.tableToObjects(glue.command([
		"list", "alignment",
		"-w", "name = '" + escapeQuotes(alignmentName) + "'"
	]));
	return rows.length > 0;
}

function refNameForSequenceId(sequenceId) {
	var clean = sanitize(sequenceId);
	if(clean === "") {
		throw "Could not derive reference name from sequenceID: " + sequenceId;
	}
	return "REF_" + clean;
}

function alignmentNameForRow(row) {
	var standardId = norm(row["Standardised lineage name"]);
	var sequenceId = norm(row["sequenceID"]);
	var id = standardId || sequenceId;

	var clean = sanitize(id);
	if(clean === "") {
		throw "Could not derive alignment name for row: " + JSON.stringify(row);
	}
	return "AL_" + clean;
}

function parentAlignmentNameForRow(row) {

	// Preferred: place under subgenus-level constrained alignment if present.
	var subgenus = norm(row["subgenus"]);
	if(subgenus != null) {
		return "AL_" + sanitize(subgenus);
	}

	// Fallback: genus-level alignment.
	var genus = norm(row["genus"]);
	if(genus != null) {
		return "AL_" + sanitize(genus);
	}

	// Final fallback: clade-level alignment.
	var clade = norm(row["clade"]);
	if(clade != null) {
		return "AL_CLADE_" + sanitize(clade);
	}

	return null;
}

function shouldInclude(row) {
	var entityType = norm(row["entity_type"]);
	var status = norm(row["status"]);

	if(entityType !== "sublineage") {
		return false;
	}
	if(status !== "accepted") {
		return false;
	}
	return true;
}

function loadRows() {
	var rows;
	glue.inMode("module/tabularUtility", function() {
		rows = glue.tableToObjects(
			glue.command(["load-tabular", INPUT_FILE])
		);
	});
	return rows;
}

var rows = loadRows();

log("Loaded " + rows.length + " rows from " + INPUT_FILE);

var includedCount = 0;
var skippedCount = 0;
var missingLineageCount = 0;
var missingReferenceCount = 0;
var missingParentAlignmentCount = 0;
var createdAlignmentCount = 0;
var existingAlignmentCount = 0;

_.each(rows, function(row) {

	var sequenceId = norm(row["sequenceID"]);

	if(sequenceId == null) {
		skippedCount++;
		log("Skipping row with missing sequenceID: " + JSON.stringify(row));
		return;
	}

	if(!shouldInclude(row)) {
		skippedCount++;
		log("Skipping " + sequenceId +
			" because entity_type=" + norm(row["entity_type"]) +
			", status=" + norm(row["status"]));
		return;
	}

	includedCount++;

	if(!customRowExists("erv_lineage", sequenceId)) {
		missingLineageCount++;
		log("Skipping " + sequenceId + " because erv_lineage row is missing");
		return;
	}

	var refName = refNameForSequenceId(sequenceId);
	if(!referenceExists(refName)) {
		missingReferenceCount++;
		log("Skipping " + sequenceId + " because reference is missing: " + refName);
		return;
	}

	var alignmentName = alignmentNameForRow(row);
	var parentAlignmentName = parentAlignmentNameForRow(row);

	if(parentAlignmentName == null || !alignmentExists(parentAlignmentName)) {
		missingParentAlignmentCount++;
		log("Skipping " + sequenceId +
			" because parent alignment is missing: " + parentAlignmentName);
		return;
	}

	if(alignmentExists(alignmentName)) {
		existingAlignmentCount++;
		log("Alignment already exists: " + alignmentName);
		return;
	}

	runCmd([
		"create", "alignment",
		alignmentName,
		"-p", parentAlignmentName,
		"-r", refName,
		"--constrained"
	]);

	createdAlignmentCount++;
	log("Created constrained alignment " + alignmentName +
		" under " + parentAlignmentName +
		" with reference " + refName);
});

log("----- SUMMARY -----");
log("Rows loaded: " + rows.length);
log("Rows included by filter: " + includedCount);
log("Rows skipped by filter/incomplete: " + skippedCount);
log("Missing erv_lineage rows: " + missingLineageCount);
log("Missing references: " + missingReferenceCount);
log("Missing parent alignments: " + missingParentAlignmentCount);
log("Existing alignments: " + existingAlignmentCount);
log("Created alignments: " + createdAlignmentCount);

