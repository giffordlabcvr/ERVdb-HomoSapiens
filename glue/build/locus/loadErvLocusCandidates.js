// glue/build/locus/loadErvLocusCandidates.js
//
// Streaming loader for large HERV RBRT/Missillac-style table.
//
// Input:
//   tabular/locus/HERVs-RBRT-name.tsv
//
// Keeps rows if they match either:
//   - an existing erv_lineage id
//   - an existing ltr_lineage id
//
// Matching is against selected source fields:
//   names
//   names_decision
//   phylogeny_name
//   clade_out
//   group_out
//   subgroup_out
//
// No links or sequences are created.

var INPUT_PATH = "tabular/locus/HERVs-RBRT-name.tsv";

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

function normInt(value) {
	value = norm(value);
	if(value === null) {
		return null;
	}
	var n = parseInt(value, 10);
	return isNaN(n) ? null : n;
}

function splitTokens(value) {
	value = norm(value);
	if(value === null) {
		return [];
	}
	return ("" + value).split(",").map(function(x) {
		return norm(x);
	}).filter(function(x) {
		return x !== null;
	});
}

function addIdSet(tableName) {
	var idSet = {};
	var rows = glue.tableToObjects(glue.command(["list", "custom-table-row", tableName, "id"]));
	_.each(rows, function(row) {
		var id = norm(row["id"]);
		if(id !== null) {
			idSet[id] = true;
		}
	});
	return idSet;
}

function anyTokenInSet(tokens, idSet) {
	for(var i = 0; i < tokens.length; i++) {
		if(idSet[tokens[i]]) {
			return true;
		}
	}
	return false;
}

function rowMatchesIdSet(row, idSet) {
	var fields = [
		"names",
		"names_decision",
		"phylogeny_name",
		"clade_out",
		"group_out",
		"subgroup_out"
	];

	for(var i = 0; i < fields.length; i++) {
		if(anyTokenInSet(splitTokens(row[fields[i]]), idSet)) {
			return true;
		}
	}
	return false;
}

function shouldImport(row) {
	return rowMatchesIdSet(row, ervLineageIds) || rowMatchesIdSet(row, ltrLineageIds);
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

	var rowId = norm(row["locus_id"]);
	if(rowId === null) {
		return "skipped";
	}

	if(!shouldImport(row)) {
		return "filtered";
	}

	var wasCreated = ensureRow("erv_locus_candidate", rowId);

	glue.inMode(customRowPath("erv_locus_candidate", rowId), function() {

		setFieldIfPresent("chrom", row["chrom"]);
		setFieldIfPresent("strand", row["strand"]);
		setIntFieldIfPresent("start_position", row["start"]);
		setIntFieldIfPresent("end_position", row["end"]);
		setIntFieldIfPresent("length", row["length"]);

		setFieldIfPresent("names", row["names"]);
		setFieldIfPresent("genes", row["genes"]);
		setFieldIfPresent("genes_order", row["genes_order"]);
		setFieldIfPresent("genes_simplified", row["genes_simplified"]);

		setFieldIfPresent("case_status", row["case"]);
		setFieldIfPresent("names_decision", row["names_decision"]);
		setFieldIfPresent("status", row["status"]);

		setFieldIfPresent("clade_out", row["clade_out"]);
		setFieldIfPresent("group_out", row["group_out"]);
		setFieldIfPresent("subgroup_out", row["subgroup_out"]);
		setFieldIfPresent("phylogeny_name", row["phylogeny_name"]);
		setFieldIfPresent("makes_mosaic", row["makes_mosaic"]);

		setFieldIfPresent("curatedns", row["curatedNS"]);
		setFieldIfPresent("digs_ids", row["DIGS"]);
		setFieldIfPresent("repbase_ids", row["Repbase"]);
		setFieldIfPresent("retrotector_ids", row["Retrotector"]);
	});

	return wasCreated ? "created" : "updated";
}

// --------------------------------------------------
// Build allowlists from current ERVdb schema
// --------------------------------------------------

var ervLineageIds = addIdSet("erv_lineage");
var ltrLineageIds = addIdSet("ltr_lineage");

glue.logInfo("Loaded " + Object.keys(ervLineageIds).length + " erv_lineage IDs");
glue.logInfo("Loaded " + Object.keys(ltrLineageIds).length + " ltr_lineage IDs");

// --------------------------------------------------
// Stream input file
// --------------------------------------------------

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
var filtered = 0;

while((line = reader.readLine()) !== null) {
	lineNumber++;

	var values = splitTsvLine(line);
	var row = makeRow(headers, values);

	var result = loadRow(row);

	if(result === "created") {
		created++;
	} else if(result === "updated") {
		updated++;
	} else if(result === "filtered") {
		filtered++;
	} else {
		skipped++;
	}

	if(lineNumber % 10000 === 0) {
		glue.logInfo(
			"Processed " + lineNumber +
			" lines; created=" + created +
			", updated=" + updated +
			", filtered=" + filtered +
			", skipped=" + skipped
		);
	}
}

reader.close();

glue.logInfo("ERV locus candidate streaming import complete");
glue.logInfo("Created rows: " + created);
glue.logInfo("Updated rows: " + updated);
glue.logInfo("Filtered rows: " + filtered);
glue.logInfo("Skipped rows: " + skipped);