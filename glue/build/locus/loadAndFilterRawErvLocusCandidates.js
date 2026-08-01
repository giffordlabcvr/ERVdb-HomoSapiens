// glue/build/locus/loadFilteredErvLocusCandidates.js
//
// Load filtered ERV/LTR candidate loci from:
//   tabular/locus/HERVs-RBRT-filtered.tsv
//
// This loads directly into custom table erv_locus_candidate.
// It does not require sequences and does not create links.

var INPUT_PATH = "tabular/locus/HERVs-RBRT-filtered.tsv";

var BufferedReader = Java.type("java.io.BufferedReader");
var FileReader = Java.type("java.io.FileReader");

function norm(value) {
	if(value === null || value === undefined) {
		return null;
	}
	var s = ("" + value).trim();
	if(s === "") {
		return null;
	}
	var low = s.toLowerCase();
	if(low === "n/a" || low === "na" || low === "null" || low === "none" || s === "-") {
		return null;
	}
	return s;
}

function normInt(value) {
	value = norm(value);
	if(value === null) {
		return null;
	}
	var n = parseInt(value, 10);
	return isNaN(n) ? null : n;
}

function splitTsvLine(line) {
	return ("" + line).split("\t");
}

function makeRow(headers, values) {
	var row = {};
	for(var i = 0; i < headers.length; i++) {
		row[headers[i]] = (i < values.length ? values[i] : null);
	}
	return row;
}

function customRowPath(tableName, rowId) {
	return "custom-table-row/" + tableName + "/" + rowId;
}

function ensureRow(tableName, rowId) {
	try {
		glue.command(["create", "custom-table-row", tableName, rowId]);
		return true;
	} catch(e) {
		return false;
	}
}

function setFieldIfPresent(fieldName, value) {
	value = norm(value);
	if(value !== null) {
		glue.command(["set", "field", fieldName, value]);
	}
}

function setIntFieldIfPresent(fieldName, value) {
	value = normInt(value);
	if(value !== null) {
		glue.command(["set", "field", fieldName, "" + value]);
	}
}

function loadRow(row) {

	var rowId = norm(row["id"]);
	if(rowId === null) {
		return "skipped";
	}

	var wasCreated = ensureRow("erv_locus_candidate", rowId);

	glue.inMode(customRowPath("erv_locus_candidate", rowId), function() {

		setFieldIfPresent("case_status", row["case_status"]);
		setFieldIfPresent("chrom", row["chrom"]);
		setFieldIfPresent("clade_out", row["clade_out"]);
		setFieldIfPresent("curatedns", row["curatedns"]);
		setFieldIfPresent("digs_ids", row["digs_ids"]);
		setIntFieldIfPresent("end_position", row["end_position"]);

		setFieldIfPresent("genes", row["genes"]);
		setFieldIfPresent("genes_order", row["genes_order"]);
		setFieldIfPresent("genes_simplified", row["genes_simplified"]);
		setFieldIfPresent("group_out", row["group_out"]);
		setIntFieldIfPresent("length", row["length"]);
		setFieldIfPresent("makes_mosaic", row["makes_mosaic"]);

		setFieldIfPresent("names", row["names"]);
		setFieldIfPresent("names_decision", row["names_decision"]);
		setFieldIfPresent("phylogeny_name", row["phylogeny_name"]);
		setFieldIfPresent("repbase_ids", row["repbase_ids"]);
		setFieldIfPresent("retrotector_ids", row["retrotector_ids"]);
		setIntFieldIfPresent("start_position", row["start_position"]);

		setFieldIfPresent("status", row["status"]);
		setFieldIfPresent("strand", row["strand"]);
		setFieldIfPresent("subgroup_out", row["subgroup_out"]);
	});

	return wasCreated ? "created" : "updated";
}

var reader = new BufferedReader(new FileReader(INPUT_PATH));

var headerLine = reader.readLine();
if(headerLine === null) {
	throw "Input file is empty: " + INPUT_PATH;
}

var headers = splitTsvLine(headerLine);

var line;
var lineNumber = 1;
var created = 0;
var updated = 0;
var skipped = 0;

while((line = reader.readLine()) !== null) {
	lineNumber++;

	var values = splitTsvLine(line);
	var row = makeRow(headers, values);

	var result = loadRow(row);

	if(result === "created") {
		created++;
	} else if(result === "updated") {
		updated++;
	} else {
		skipped++;
	}

	if(lineNumber % 10000 === 0) {
		glue.logInfo(
			"Processed " + lineNumber +
			" lines; created=" + created +
			", updated=" + updated +
			", skipped=" + skipped
		);
	}
}

reader.close();

glue.logInfo("Filtered ERV locus candidate import complete");
glue.logInfo("Created rows: " + created);
glue.logInfo("Updated rows: " + updated);
glue.logInfo("Skipped rows: " + skipped);