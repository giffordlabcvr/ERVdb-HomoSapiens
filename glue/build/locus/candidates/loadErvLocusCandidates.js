// glue/build/locus/candidates/loadErvLocusCandidates.js
//
// Streaming loader for the pre-selected ERV locus candidate table.
//
// Input:
//   tabular/locus/HERVs-RBRT-filtered.tsv
//
// This script does NOT perform biological filtering.
// Selection is handled upstream by:
//
//   selectErvLocusCandidates.js
//
// The job here is simply to populate/update erv_locus_candidate
// from the already-selected TSV.
//
// No links or sequences are created.

var INPUT_PATH =
	"tabular/locus/HERVs-RBRT-filtered.tsv";

var PROGRESS_INTERVAL = 10000;

var BufferedReader =
	Java.type("java.io.BufferedReader");

var FileReader =
	Java.type("java.io.FileReader");


// -----------------------------------------------------------------------------
// Basic helpers
// -----------------------------------------------------------------------------

function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var s =
		("" + value).trim();

	if(s === "") {
		return null;
	}

	var low =
		s.toLowerCase();

	if(low === "n/a" ||
	   low === "na" ||
	   low === "null" ||
	   low === "none") {

		return null;
	}

	return s;
}


function normInt(value) {

	value =
		norm(value);

	if(value === null) {
		return null;
	}

	var n =
		parseInt(
			value,
			10
		);

	return (
		isNaN(n)
			? null
			: n
	);
}


function splitTsvLine(line) {

	return (
		("" + line).split("\t")
	);
}


function makeRow(
	headers,
	values
) {

	var row = {};

	for(
		var i = 0;
		i < headers.length;
		i++
	) {

		row[
			headers[i]
		] =
			(
				i < values.length
					? values[i]
					: null
			);
	}

	return row;
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


/**
 * Create the row if absent.
 *
 * Returns:
 *   true  = created
 *   false = already existed
 */
function ensureRow(
	tableName,
	rowId
) {

	try {

		glue.command([
			"create",
			"custom-table-row",
			tableName,
			rowId
		]);

		return true;

	} catch(e) {

		return false;
	}
}


function setFieldIfPresent(
	fieldName,
	value
) {

	value =
		norm(value);

	if(value !== null) {

		glue.command([
			"set",
			"field",
			fieldName,
			value
		]);
	}
}


function setIntFieldIfPresent(
	fieldName,
	value
) {

	value =
		normInt(value);

	if(value !== null) {

		glue.command([
			"set",
			"field",
			fieldName,
			"" + value
		]);
	}
}


// -----------------------------------------------------------------------------
// Load one candidate row
// -----------------------------------------------------------------------------

function loadRow(row) {

	var rowId =
		norm(
			row["locus_id"]
		);

	if(rowId === null) {
		return "skipped";
	}


	var wasCreated =
		ensureRow(
			"erv_locus_candidate",
			rowId
		);


	glue.inMode(
		customRowPath(
			"erv_locus_candidate",
			rowId
		),
		function() {

			setFieldIfPresent(
				"chrom",
				row["chrom"]
			);

			setFieldIfPresent(
				"strand",
				row["strand"]
			);

			setIntFieldIfPresent(
				"start_position",
				row["start"]
			);

			setIntFieldIfPresent(
				"end_position",
				row["end"]
			);

			setIntFieldIfPresent(
				"length",
				row["length"]
			);


			setFieldIfPresent(
				"names",
				row["names"]
			);

			setFieldIfPresent(
				"genes",
				row["genes"]
			);

			setFieldIfPresent(
				"genes_order",
				row["genes_order"]
			);

			setFieldIfPresent(
				"genes_simplified",
				row["genes_simplified"]
			);


			setFieldIfPresent(
				"case_status",
				row["case"]
			);

			setFieldIfPresent(
				"names_decision",
				row["names_decision"]
			);

			setFieldIfPresent(
				"status",
				row["status"]
			);


			setFieldIfPresent(
				"clade_out",
				row["clade_out"]
			);

			setFieldIfPresent(
				"group_out",
				row["group_out"]
			);

			setFieldIfPresent(
				"subgroup_out",
				row["subgroup_out"]
			);

			setFieldIfPresent(
				"phylogeny_name",
				row["phylogeny_name"]
			);

			setFieldIfPresent(
				"makes_mosaic",
				row["makes_mosaic"]
			);


			setFieldIfPresent(
				"curatedns",
				row["curatedNS"]
			);

			setFieldIfPresent(
				"digs_ids",
				row["DIGS"]
			);

			setFieldIfPresent(
				"repbase_ids",
				row["Repbase"]
			);

			setFieldIfPresent(
				"retrotector_ids",
				row["Retrotector"]
			);
		}
	);


	return (
		wasCreated
			? "created"
			: "updated"
	);
}


// -----------------------------------------------------------------------------
// Stream input file
// -----------------------------------------------------------------------------

glue.logInfo(
	"Loading selected ERV locus candidates from " +
	INPUT_PATH
);


var reader =
	new BufferedReader(
		new FileReader(
			INPUT_PATH
		)
	);


var headerLine =
	reader.readLine();

if(headerLine === null) {

	reader.close();

	throw (
		"Input file is empty: " +
		INPUT_PATH
	);
}


var headers =
	splitTsvLine(
		headerLine
	);


var line;
var lineNumber = 1;

var created = 0;
var updated = 0;
var skipped = 0;


try {

	while(
		(line = reader.readLine()) !== null
	) {

		lineNumber++;


		var values =
			splitTsvLine(
				line
			);

		var row =
			makeRow(
				headers,
				values
			);


		var result =
			loadRow(
				row
			);


		if(
			result === "created"
		) {

			created++;

		} else if(
			result === "updated"
		) {

			updated++;

		} else {

			skipped++;
		}


		if(
			lineNumber %
			PROGRESS_INTERVAL ===
			0
		) {

			glue.logInfo(
				"Processed " +
				lineNumber +
				" lines; created=" +
				created +
				", updated=" +
				updated +
				", skipped=" +
				skipped
			);
		}
	}

} finally {

	reader.close();
}


// -----------------------------------------------------------------------------
// Final summary
// -----------------------------------------------------------------------------

glue.logInfo(
	"ERV locus candidate streaming import complete"
);

glue.logInfo(
	"Created rows: " +
	created
);

glue.logInfo(
	"Updated rows: " +
	updated
);

glue.logInfo(
	"Skipped rows: " +
	skipped
);