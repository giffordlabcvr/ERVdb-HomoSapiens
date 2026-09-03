/**
 * loadErvSublineages.js
 *
 * Load the curated ERV sublineage catalogue from:
 *
 *   tabular/sublineage/herv_sublineage_data.tsv
 *
 * For each row:
 *
 *   1. Create/find erv_lineage using lineage_id as the row ID
 *   2. Create applicable retroviral taxonomy rows
 *   3. Establish relationships between taxonomy ranks
 *   4. Populate ERV sublineage metadata
 *   5. Link the reference sequence identified by sequenceID
 *   6. Link the ERV sublineage to its taxonomy
 *
 * Important distinction:
 *
 *   lineage_id = authoritative ERVdb sublineage identifier
 *   sequenceID = representative sequence identifier / legacy name
 *
 * Presence of a sequence in source erv-sub does not by itself create an
 * ERV sublineage entity. The curated TSV is authoritative.
 */

var INPUT_PATH =
	"tabular/sublineage/herv_sublineage_data.tsv";

var ERV_SOURCE =
	"erv-sub";

// ============================================================================
// Helpers
// ============================================================================

function log(message) {
	glue.logInfo(message);
}

function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var stringValue =
		("" + value).trim();

	if(stringValue === "") {
		return null;
	}

	var lowerValue =
		stringValue.toLowerCase();

	if(
		lowerValue === "n/a" ||
		lowerValue === "na" ||
		lowerValue === "n/k" ||
		lowerValue === "nk" ||
		lowerValue === "unknown" ||
		lowerValue === "null" ||
		lowerValue === "none"
	) {
		return null;
	}

	return stringValue;
}

function escapeQuotes(value) {
	return value.replace(/'/g, "\\'");
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

function customRowExists(
	tableName,
	rowId
) {

	rowId =
		norm(rowId);

	if(rowId === null) {
		return false;
	}

	var result =
		glue.command([
			"list",
			"custom-table-row",
			tableName,
			"-w",
			"id = '" +
				escapeQuotes(rowId) +
				"'"
		]);

	var rows =
		glue.tableToObjects(result);

	return rows.length > 0;
}

function ensureCustomRow(
	tableName,
	rowId
) {

	rowId =
		norm(rowId);

	if(rowId === null) {
		return false;
	}

	if(
		!customRowExists(
			tableName,
			rowId
		)
	) {
		glue.command([
			"create",
			"custom-table-row",
			tableName,
			rowId
		]);

		log(
			"Created " +
			tableName +
			"/" +
			rowId
		);

		return true;
	}

	return false;
}

function sequenceExists(
	sourceName,
	sequenceID
) {

	sourceName =
		norm(sourceName);

	sequenceID =
		norm(sequenceID);

	if(
		sourceName === null ||
		sequenceID === null
	) {
		return false;
	}

	var result =
		glue.command([
			"list",
			"sequence",
			"-w",
			"source.name = '" +
				escapeQuotes(sourceName) +
				"' and sequenceID = '" +
				escapeQuotes(sequenceID) +
				"'"
		]);

	var rows =
		glue.tableToObjects(result);

	return rows.length > 0;
}

function loadTsv(path) {

	var rows;

	glue.inMode(
		"module/tabularUtility",
		function() {
			rows =
				glue.tableToObjects(
					glue.command([
						"load-tabular",
						path
					])
				);
		}
	);

	return rows;
}

// ============================================================================
// Field setters
// ============================================================================

function setStringFieldIfPresent(
	fieldName,
	value
) {

	value =
		norm(value);

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

function setIntegerFieldIfPresent(
	fieldName,
	value
) {

	value =
		norm(value);

	if(value === null) {
		return;
	}

	var integerValue =
		parseInt(
			value,
			10
		);

	if(isNaN(integerValue)) {
		throw (
			"Invalid integer value '" +
			value +
			"' for field " +
			fieldName
		);
	}

	glue.command([
		"set",
		"field",
		fieldName,
		"" + integerValue
	]);
}

/*
 * The sublineage table contains several historical representations of
 * Boolean inclusion fields.
 *
 * Values such as "no RT" and "no pol" mean that the entity was not included.
 * "partial" means that partial sequence was included and is therefore true
 * for the purpose of an in_*_phylogeny Boolean field.
 */

function parseBoolean(value) {

	value =
		norm(value);

	if(value === null) {
		return null;
	}

	var lowerValue =
		value.toLowerCase();

	if(
		lowerValue === "true" ||
		lowerValue === "yes" ||
		lowerValue === "y" ||
		lowerValue === "1" ||
		lowerValue === "partial"
	) {
		return true;
	}

	if(
		lowerValue === "false" ||
		lowerValue === "no" ||
		lowerValue === "n" ||
		lowerValue === "0" ||
		/^no[\s_-]/.test(lowerValue)
	) {
		return false;
	}

	throw (
		"Invalid Boolean value '" +
		value +
		"'; expected TRUE/FALSE, YES/NO or PARTIAL"
	);
}

function setBooleanFieldIfPresent(
	fieldName,
	value
) {

	var booleanValue =
		parseBoolean(value);

	if(booleanValue === null) {
		return;
	}

	glue.command([
		"set",
		"field",
		fieldName,
		booleanValue ? "true" : "false"
	]);
}

function setLinkIfPresent(
	linkName,
	tableName,
	rowId
) {

	rowId =
		norm(rowId);

	if(rowId === null) {
		return;
	}

	glue.command([
		"set",
		"link-target",
		linkName,
		customRowPath(
			tableName,
			rowId
		)
	]);
}

// ============================================================================
// Load input
// ============================================================================

var rows =
	loadTsv(INPUT_PATH);

log(
	"Loaded " +
	rows.length +
	" ERV sublineage rows from " +
	INPUT_PATH
);

// ============================================================================
// Pass 1
//
// Create all ERV sublineage and taxonomy rows.
//
// Doing this first ensures that every target exists before links are created.
// ============================================================================

var ervSublineageRowsCreated = 0;
var cladeRowsCreated = 0;
var subfamilyRowsCreated = 0;
var genusRowsCreated = 0;
var subgenusRowsCreated = 0;

_.each(
	rows,
	function(row) {

		var lineageId =
			norm(
				row["lineage_id"]
			);

		if(lineageId === null) {
			throw (
				"Missing lineage_id in row: " +
				JSON.stringify(row)
			);
		}

		if(
			ensureCustomRow(
				"erv_lineage",
				lineageId
			)
		) {
			ervSublineageRowsCreated++;
		}

		if(
			ensureCustomRow(
				"rv_clade",
				row["clade"]
			)
		) {
			cladeRowsCreated++;
		}

		if(
			ensureCustomRow(
				"rv_subfamily",
				row["subfamily"]
			)
		) {
			subfamilyRowsCreated++;
		}

		if(
			ensureCustomRow(
				"rv_genus",
				row["genus"]
			)
		) {
			genusRowsCreated++;
		}

		if(
			ensureCustomRow(
				"rv_subgenus",
				row["subgenus"]
			)
		) {
			subgenusRowsCreated++;
		}
	}
);

log(
	"Created/verified ERV sublineage and taxonomy rows"
);

// ============================================================================
// Pass 2
//
// Establish relationships between taxonomy ranks.
// ============================================================================

_.each(
	rows,
	function(row) {

		var cladeId =
			norm(
				row["clade"]
			);

		var subfamilyId =
			norm(
				row["subfamily"]
			);

		var genusId =
			norm(
				row["genus"]
			);

		var subgenusId =
			norm(
				row["subgenus"]
			);

		// --------------------------------------------------------------------
		// subgenus -> genus
		// --------------------------------------------------------------------

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
						"rv_genus",
						genusId
					);
				}
			);
		}

		// --------------------------------------------------------------------
		// genus -> subfamily
		// --------------------------------------------------------------------

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
						"rv_subfamily",
						subfamilyId
					);
				}
			);
		}

		// --------------------------------------------------------------------
		// subfamily -> clade
		// --------------------------------------------------------------------

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
						"rv_clade",
						cladeId
					);
				}
			);
		}
	}
);

log(
	"Established taxonomy-rank relationships"
);

// ============================================================================
// Pass 3
//
// Populate ERV sublineage metadata and taxonomy links.
// ============================================================================

_.each(
	rows,
	function(row) {

		var lineageId =
			norm(
				row["lineage_id"]
			);

		var cladeId =
			norm(
				row["clade"]
			);

		var subfamilyId =
			norm(
				row["subfamily"]
			);

		var genusId =
			norm(
				row["genus"]
			);

		var subgenusId =
			norm(
				row["subgenus"]
			);

		glue.inMode(
			customRowPath(
				"erv_lineage",
				lineageId
			),
			function() {

				// Identity and display
				setStringFieldIfPresent(
					"name",
					row["name"]
				);

				setStringFieldIfPresent(
					"full_name",
					row["full_name"]
				);

				// Entity properties
				setStringFieldIfPresent(
					"entity_type",
					row["entity_type"]
				);

				setStringFieldIfPresent(
					"entity_level",
					row["entity_level"]
				);

				setStringFieldIfPresent(
					"status",
					row["status"]
				);

				setStringFieldIfPresent(
					"parent_lineage",
					row["parent_lineage"]
				);

				// Reference and provenance
				setStringFieldIfPresent(
					"reference_type",
					row["reference_type"]
				);

				setStringFieldIfPresent(
					"reference_method",
					row["reference_method"]
				);

				setIntegerFieldIfPresent(
					"num_seqs",
					row["num_seqs"]
				);

				setStringFieldIfPresent(
					"accession",
					row["accession"]
				);

				setStringFieldIfPresent(
					"pubmed_id",
					row["pubmed_id"]
				);

				setIntegerFieldIfPresent(
					"curation_tier",
					row["curation_tier"]
				);

				// Phylogenetic inclusion
				setBooleanFieldIfPresent(
					"in_rt_phylogeny",
					row["in_rt_phylogeny"]
				);

				setBooleanFieldIfPresent(
					"in_tm_phylogeny",
					row["in_tm_phylogeny"]
				);

				// Human ERV status
				setBooleanFieldIfPresent(
					"human_erv",
					row["human_erv"]
				);

				// Taxonomy
				setLinkIfPresent(
					"rv_clade",
					"rv_clade",
					cladeId
				);

				setLinkIfPresent(
					"rv_subfamily",
					"rv_subfamily",
					subfamilyId
				);

				setLinkIfPresent(
					"rv_genus",
					"rv_genus",
					genusId
				);

				setLinkIfPresent(
					"rv_subgenus",
					"rv_subgenus",
					subgenusId
				);
			}
		);
	}
);

log(
	"Populated ERV sublineage metadata and taxonomy"
);

// ============================================================================
// Pass 4
//
// Link representative sequences.
//
// sequenceID is optional in principle. If supplied, the sequence must exist.
// ============================================================================

var sequenceLinks = 0;
var noSequence = 0;

_.each(
	rows,
	function(row) {

		var lineageId =
			norm(
				row["lineage_id"]
			);

		var sequenceID =
			norm(
				row["sequenceID"]
			);

		if(sequenceID === null) {
			noSequence++;
			return;
		}

		if(
			!sequenceExists(
				ERV_SOURCE,
				sequenceID
			)
		) {
			throw (
				"Reference sequence " +
				ERV_SOURCE +
				"/" +
				sequenceID +
				" not found for ERV sublineage " +
				lineageId
			);
		}

		glue.inMode(
			"sequence/" +
				ERV_SOURCE +
				"/" +
				sequenceID,
			function() {
				glue.command([
					"set",
					"link-target",
					"erv_lineage",
					customRowPath(
						"erv_lineage",
						lineageId
					)
				]);
			}
		);

		sequenceLinks++;

		log(
			"Linked sequence " +
			ERV_SOURCE +
			"/" +
			sequenceID +
			" -> erv_lineage/" +
			lineageId
		);
	}
);

// ============================================================================
// Summary
// ============================================================================

log("----- SUMMARY -----");

log(
	"Input ERV sublineage rows: " +
	rows.length
);

log(
	"ERV sublineage rows created: " +
	ervSublineageRowsCreated
);

log(
	"Clade rows created: " +
	cladeRowsCreated
);

log(
	"Subfamily rows created: " +
	subfamilyRowsCreated
);

log(
	"Genus rows created: " +
	genusRowsCreated
);

log(
	"Subgenus rows created: " +
	subgenusRowsCreated
);

log(
	"ERV sublineage reference sequences linked: " +
	sequenceLinks
);

log(
	"ERV sublineage rows without a reference sequence: " +
	noSequence
);

log(
	"ERV sublineage loading complete"
);