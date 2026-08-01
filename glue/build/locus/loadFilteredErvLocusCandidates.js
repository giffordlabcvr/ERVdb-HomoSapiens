// glue/build/locus/loadFilteredErvLocusCandidates.js
//
// Streaming loader for the complete filtered HERV RBRT/Missillac-style table.
//
// Input:
//   tabular/locus/HERVs-RBRT-filtered.tsv
//
// Behaviour:
//   - uses the TSV "id" column as the erv_locus_candidate custom-row identifier
//   - imports only fields explicitly defined on erv_locus_candidate
//   - skips empty / NA-like values rather than passing null to glue.command()
//   - creates no sequences and does not populate the sequence link
//
// Assumptions:
//   - every input row should be imported
//   - id is populated and unique
//   - erv_locus_candidate is empty before this script is run

var INPUT_PATH = "tabular/locus/HERVs-RBRT-filtered.tsv";
var TABLE_NAME = "erv_locus_candidate";

var BufferedReader = Java.type("java.io.BufferedReader");
var FileReader = Java.type("java.io.FileReader");

// These are the fields actually defined on erv_locus_candidate.
// The TSV column "id" is deliberately excluded because it identifies
// the custom table row rather than representing a table field.
var FIELD_NAMES = [
	"chrom",
	"strand",
	"start_position",
	"end_position",
	"length",

	"names",
	"genes",
	"genes_order",
	"genes_simplified",

	"case_status",
	"names_decision",
	"status",
	"clade_out",
	"group_out",
	"subgroup_out",
	"phylogeny_name",
	"makes_mosaic",

	"curatedns",
	"digs_ids",
	"repbase_ids",
	"retrotector_ids"
];

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
		low === "null" ||
		low === "none"
	) {
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

function contains(array, value) {
	for(var i = 0; i < array.length; i++) {
		if(array[i] === value) {
			return true;
		}
	}

	return false;
}

function validateHeaders(headers) {
	if(!contains(headers, "id")) {
		throw "Required TSV column is missing: id";
	}

	for(var i = 0; i < FIELD_NAMES.length; i++) {
		var fieldName = FIELD_NAMES[i];

		if(!contains(headers, fieldName)) {
			throw "Required TSV column is missing: " + fieldName;
		}
	}
}

function setField(fieldName, value) {
	value = norm(value);

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

function loadRow(row, lineNumber) {
	var rowId = norm(row["id"]);

	if(rowId === null) {
		throw "Missing id at input line " + lineNumber;
	}

	try {
		glue.inMode(
			customRowPath(TABLE_NAME, rowId),
			function() {
				for(var i = 0; i < FIELD_NAMES.length; i++) {
					var fieldName = FIELD_NAMES[i];

					setField(
						fieldName,
						row[fieldName]
					);
				}
			}
		);

	} catch(error) {
		throw "Failed to populate existing row '" +
			rowId +
			"' at input line " +
			lineNumber +
			": " +
			error;
	}
}

// --------------------------------------------------
// Stream input file
// --------------------------------------------------

var reader = new BufferedReader(
	new FileReader(INPUT_PATH)
);

try {
	var headerLine = reader.readLine();

	if(headerLine === null) {
		throw "Input file is empty: " + INPUT_PATH;
	}

	var headers = splitTsvLine(headerLine);

	validateHeaders(headers);

	var line;
	var lineNumber = 1;
	var loaded = 0;

	while((line = reader.readLine()) !== null) {
		lineNumber++;

		if(("" + line).trim() === "") {
			continue;
		}

		var values = splitTsvLine(line);

		if(values.length > headers.length) {
			throw "Input line " +
				lineNumber +
				" contains " +
				values.length +
				" columns, but the header contains " +
				headers.length;
		}

		var row = makeRow(
			headers,
			values
		);

		loadRow(
			row,
			lineNumber
		);

		loaded++;

		if(loaded % 10000 === 0) {
			glue.logInfo(
				"Loaded " +
				loaded +
				" erv_locus_candidate rows"
			);
		}
	}

	glue.logInfo(
		"ERV locus candidate import complete"
	);

	glue.logInfo(
		"Rows loaded: " + loaded
	);

} finally {
	reader.close();
}