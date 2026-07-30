// glue/build/locus/loadErvLocusCandidates.js
//
// Streaming loader for the complete HERV RBRT/Missillac-style table.
//
// Input:
//   tabular/locus/HERVs-RBRT-name.tsv
//
// Assumptions:
//   - every input row should be imported
//   - locus_id is populated and unique
//   - erv_locus_candidate is empty before this script is run
//
// No sequences or links are created.

var INPUT_PATH = "tabular/locus/HERVs-RBRT-name.tsv";
var TABLE_NAME = "erv_locus_candidate";

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

	if(low === "n/a" || low === "na" || low === "null" || low === "none") {
		return null;
	}

	return s;
}

function splitTsvLine(line) {
	return ("" + line).split("\t");
}

function makeRow(headers, values) {
	var row = {};

	for(var i = 0; i < headers.length; i++) {
		row[headers[i]] = i < values.length ? values[i] : null;
	}

	return row;
}

function customRowPath(tableName, rowId) {
	return "custom-table-row/" + tableName + "/" + rowId;
}

function setField(fieldName, value) {
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

function loadRow(row) {

	var rowId = norm(row["locus_id"]);

	glue.command([
		"create",
		"custom-table-row",
		TABLE_NAME,
		rowId
	]);

	glue.inMode(customRowPath(TABLE_NAME, rowId), function() {

		setField("chrom", row["chrom"]);
		setField("strand", row["strand"]);
		setField("start_position", row["start"]);
		setField("end_position", row["end"]);
		setField("length", row["length"]);

		setField("names", row["names"]);
		setField("genes", row["genes"]);
		setField("genes_order", row["genes_order"]);
		setField("genes_simplified", row["genes_simplified"]);

		setField("case_status", row["case"]);
		setField("names_decision", row["names_decision"]);
		setField("status", row["status"]);

		setField("clade_out", row["clade_out"]);
		setField("group_out", row["group_out"]);
		setField("subgroup_out", row["subgroup_out"]);
		setField("phylogeny_name", row["phylogeny_name"]);
		setField("makes_mosaic", row["makes_mosaic"]);

		setField("curatedns", row["curatedNS"]);
		setField("digs_ids", row["DIGS"]);
		setField("repbase_ids", row["Repbase"]);
		setField("retrotector_ids", row["Retrotector"]);
	});
}

// --------------------------------------------------
// Stream input file
// --------------------------------------------------

var reader = new BufferedReader(new FileReader(INPUT_PATH));

var headerLine = reader.readLine();

if(headerLine === null) {
	reader.close();
	throw "Input file is empty: " + INPUT_PATH;
}

var headers = splitTsvLine(headerLine);

var line;
var lineNumber = 1;
var loaded = 0;

while((line = reader.readLine()) !== null) {

	lineNumber++;

	var values = splitTsvLine(line);
	var row = makeRow(headers, values);

	loadRow(row);
	loaded++;

	if(loaded % 10000 === 0) {
		glue.logInfo("Loaded " + loaded + " erv_locus_candidate rows");
	}
}

reader.close();

glue.logInfo("ERV locus candidate import complete");
glue.logInfo("Rows loaded: " + loaded);