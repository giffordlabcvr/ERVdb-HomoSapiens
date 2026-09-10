/**
 * glue/build/sublineage/loadErvSublineages.js
 *
 * Load the curated ERV sublineage catalogue from:
 *
 *   tabular/sublineage/herv_sublineage_data.tsv
 *
 * For each row:
 *
 *   1. Validate that the standard ID is not already used at another
 *      entity level.
 *   2. Create/find the erv_lineage row using lineage_id as its row ID.
 *   3. Create applicable retroviral taxonomy rows.
 *   4. Establish relationships between taxonomy ranks.
 *   5. Populate ERV sublineage metadata.
 *   6. Link the representative sequence identified by sequenceID.
 *   7. Link the ERV sublineage to its taxonomy.
 *
 * Important distinction:
 *
 *   lineage_id = authoritative ERVdb sublineage identifier
 *   sequenceID = representative sequence identifier / legacy name
 *
 * Presence of a sequence in source erv-sub does not by itself create an
 * ERV sublineage entity. The curated TSV is authoritative.
 *
 * Standard ERV identifiers must be unique across entity levels. In
 * particular, this loader must never overwrite a base-layer lineage row
 * with sublineage metadata.
 */

var INPUT_PATH =
	"tabular/sublineage/herv_sublineage_data.tsv";

var ERV_SOURCE =
	"erv-sub";

var EXPECTED_ENTITY_LEVEL =
	"sublineage";


// ============================================================================
// Generic helpers
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
	return ("" + value)
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'");
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
// Custom-table helpers
// ============================================================================

function customRowExists(
	tableName,
	rowId
) {
	rowId =
		norm(rowId);

	if(rowId === null) {
		return false;
	}

	var rows =
		glue.tableToObjects(
			glue.command([
				"list",
				"custom-table-row",
				tableName,
				"id",
				"-w",
				"id = '" +
					escapeQuotes(rowId) +
					"'"
			])
		);

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
		customRowExists(
			tableName,
			rowId
		)
	) {
		return false;
	}

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

function getExistingErvLineage(lineageId) {
	lineageId =
		norm(lineageId);

	if(lineageId === null) {
		return null;
	}

	var rows =
		glue.tableToObjects(
			glue.command([
				"list",
				"custom-table-row",
				"erv_lineage",
				"id",
				"name",
				"entity_level",
				"-w",
				"id = '" +
					escapeQuotes(lineageId) +
					"'"
			])
		);

	if(rows.length === 0) {
		return null;
	}

	if(rows.length > 1) {
		throw new Error(
			"Multiple erv_lineage rows returned for ID '" +
				lineageId +
				"'"
		);
	}

	return rows[0];
}


// ============================================================================
// Sequence helpers
// ============================================================================

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

	var rows =
		glue.tableToObjects(
			glue.command([
				"list",
				"sequence",
				"source.name",
				"sequenceID",
				"-w",
				"source.name = '" +
					escapeQuotes(sourceName) +
					"' and sequenceID = '" +
					escapeQuotes(sequenceID) +
					"'"
			])
		);

	return rows.length > 0;
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
		throw new Error(
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

	throw new Error(
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
// Preflight validation
//
// This complete pass runs before any database rows are created or modified.
// It prevents a sublineage input row from silently overwriting a base-layer
// lineage or another taxonomic entity.
// ============================================================================

log(
	"Preflight: validating ERV sublineage identifiers and entity levels"
);

var seenInputIds = {};

var newSublineageCount = 0;
var existingSublineageCount = 0;

_.each(rows, function(row) {
	var lineageId =
		norm(
			row["lineage_id"]
		);

	var sublineageName =
		norm(
			row["name"]
		);

	var requestedEntityLevel =
		norm(
			row["entity_level"]
		);

	if(lineageId === null) {
		throw new Error(
			"Missing lineage_id in input row: " +
				JSON.stringify(row)
		);
	}

	if(seenInputIds[lineageId]) {
		throw new Error(
			"Duplicate lineage_id '" +
				lineageId +
				"' in " +
				INPUT_PATH
		);
	}

	seenInputIds[lineageId] = true;

	if(requestedEntityLevel === null) {
		throw new Error(
			"Missing entity_level for ERV sublineage '" +
				lineageId +
				"' [" +
				(sublineageName || "unnamed") +
				"]"
		);
	}

	if(
		requestedEntityLevel.toLowerCase() !==
			EXPECTED_ENTITY_LEVEL
	) {
		throw new Error(
			"Invalid entity_level '" +
				requestedEntityLevel +
				"' for '" +
				lineageId +
				"' [" +
				(sublineageName || "unnamed") +
				"]. " +
				"This loader accepts only entity_level='" +
				EXPECTED_ENTITY_LEVEL +
				"'."
		);
	}

	var existingRow =
		getExistingErvLineage(
			lineageId
		);

	if(existingRow === null) {
		newSublineageCount++;
		return;
	}

	var existingEntityLevel =
		norm(
			existingRow.entity_level
		);

	var existingName =
		norm(
			existingRow.name
		);

	/*
	 * This is the critical collision check.
	 *
	 * If the ID already belongs to a lineage, genus-level entity or any
	 * other non-sublineage entity, stop before modifying anything.
	 */

	if(
		existingEntityLevel === null ||
		existingEntityLevel.toLowerCase() !==
			EXPECTED_ENTITY_LEVEL
	) {
		throw new Error(
			"Cannot load ERV sublineage '" +
				lineageId +
				"' [" +
				(sublineageName || "unnamed") +
				"]: an erv_lineage row with this ID already exists " +
				"at entity level '" +
				(existingEntityLevel || "unset") +
				"' [" +
				(existingName || "unnamed") +
				"]. Standard ERV IDs must be unique across entity levels."
		);
	}

	/*
	 * An existing sublineage row is acceptable during an idempotent rerun,
	 * but a different name probably indicates another identifier collision.
	 */

	if(
		existingName !== null &&
		sublineageName !== null &&
		existingName !== sublineageName
	) {
		throw new Error(
			"Conflicting names for existing ERV sublineage '" +
				lineageId +
				"': database name is '" +
				existingName +
				"', but input name is '" +
				sublineageName +
				"'"
		);
	}

	existingSublineageCount++;
});

log(
	"Preflight successful: " +
		newSublineageCount +
	" new sublineage ID(s), " +
		existingSublineageCount +
	" existing sublineage ID(s)"
);


// ============================================================================
// Pass 1
//
// Create all ERV sublineage and taxonomy rows.
//
// The preflight above has established that every existing erv_lineage row
// referenced here is already a sublineage.
// ============================================================================

var ervSublineageRowsCreated = 0;
var cladeRowsCreated = 0;
var subfamilyRowsCreated = 0;
var genusRowsCreated = 0;
var subgenusRowsCreated = 0;

_.each(rows, function(row) {
	var lineageId =
		norm(
			row["lineage_id"]
		);

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
});

log(
	"Created/verified ERV sublineage and taxonomy rows"
);


// ============================================================================
// Pass 2
//
// Establish relationships between taxonomy ranks.
// ============================================================================

_.each(rows, function(row) {
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
});

log(
	"Established taxonomy-rank relationships"
);


// ============================================================================
// Pass 3
//
// Populate ERV sublineage metadata and taxonomy links.
// ============================================================================

_.each(rows, function(row) {
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

			/*
			 * Use the validated canonical value rather than copying an
			 * arbitrary representation from the input row.
			 */

			setStringFieldIfPresent(
				"entity_level",
				EXPECTED_ENTITY_LEVEL
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
});

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

_.each(rows, function(row) {
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
		throw new Error(
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
});


// ============================================================================
// Summary
// ============================================================================

log("============================================================");
log("ERV sublineage loading summary");
log("============================================================");

log(
	"Input ERV sublineage rows: " +
		rows.length
);

log(
	"New sublineage IDs identified during preflight: " +
		newSublineageCount
);

log(
	"Existing sublineage IDs verified during preflight: " +
		existingSublineageCount
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

