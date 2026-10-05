// glue/build/locus/provenance/loadRetrotectorLocusProvenance.js
//
// Load RetroTector provenance records from:
//
//   tabular/provenance/retrotector.tsv
//
// Each RetroTector record is connected to the permanent ERV locus that
// references it through erv_locus_candidate.retrotector_ids.
//
// Field mappings:
//
//   idx          -> retrotector_locus.id
//   chrom        -> chrom
//   strand       -> strand
//   start        -> start_position
//   end          -> end_position
//   gene         -> gene_structure
//   name         -> name
//   ConsoGeneRT  -> conso_gene_rt
//
// Expected link:
//
//   retrotector_locus -> erv_locus
//
// Only records referenced by candidates with a permanent erv_locus row
// are created. If one RetroTector record is assigned to more than one
// permanent locus, it is reported and not linked.
//
// Existing records are updated. Stale records are not deleted.

var INPUT_FILE =
	"tabular/provenance/retrotector.tsv";

var CANDIDATE_TABLE =
	"erv_locus_candidate";

var LOCUS_TABLE =
	"erv_locus";

var RETROTECTOR_TABLE =
	"retrotector_locus";

var DRY_RUN =
	false;

var DETAIL_LIMIT =
	100;


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

	var result =
		("" + value).trim();

	if(result === "") {
		return null;
	}

	var lower =
		result.toLowerCase();

	if(
		lower === "n/a" ||
		lower === "na" ||
		lower === "n/k" ||
		lower === "nk" ||
		lower === "null" ||
		lower === "none" ||
		lower === "unknown" ||
		result === "-"
	) {
		return null;
	}

	return result;
}


function normInt(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	var result =
		parseInt(value, 10);

	return isNaN(result)
		? null
		: result;
}


function sortedKeys(object) {
	return Object.keys(object).sort();
}


function customRowPath(tableName, rowId) {

	return (
		"custom-table-row/" +
		tableName +
		"/" +
		rowId
	);
}


function splitIds(value) {

	value = norm(value);

	if(value === null) {
		return [];
	}

	var seen = {};
	var results = [];

	_.each(
		value.split(","),
		function(token) {

			token = norm(token);

			if(
				token !== null &&
				!seen[token]
			) {
				seen[token] = true;
				results.push(token);
			}
		}
	);

	return results;
}


function loadTabular(fileName) {

	var rows;

	glue.inMode(
		"module/tabularUtility",
		function() {
			rows = glue.tableToObjects(
				glue.command([
					"load-tabular",
					fileName
				])
			);
		}
	);

	return rows;
}


function listCustomRows(tableName, fields) {

	var command = [
		"list",
		"custom-table-row",
		tableName
	];

	_.each(
		fields,
		function(fieldName) {
			command.push(fieldName);
		}
	);

	return glue.tableToObjects(
		glue.command(command)
	);
}


function setStringFieldIfPresent(
	fieldName,
	value
) {

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


function setIntegerFieldIfPresent(
	fieldName,
	value
) {

	value = normInt(value);

	if(value !== null) {
		glue.command([
			"set",
			"field",
			fieldName,
			"" + value
		]);
	}
}


function addExample(array, value) {

	if(array.length < DETAIL_LIMIT) {
		array.push(value);
	}
}


function printAudit(title, count, examples) {

	log(title + ": " + count);

	_.each(
		examples,
		function(example) {
			log("  " + example);
		}
	);

	if(count > examples.length) {
		log(
			"  ... " +
			(count - examples.length) +
			" additional records not shown"
		);
	}
}


// ============================================================================
// Load and index RetroTector source rows
// ============================================================================

log(
	"Loading RetroTector provenance from " +
	INPUT_FILE
);

var sourceRows =
	loadTabular(
		INPUT_FILE
	);

var sourceById = {};

var sourceRowsWithoutIdCount = 0;
var duplicateSourceIdCount = 0;
var duplicateSourceIdExamples = [];

var invalidCoordinateCount = 0;
var invalidCoordinateExamples = [];

var unrecognisedStrandCount = 0;
var unrecognisedStrandExamples = [];


_.each(
	sourceRows,
	function(row) {

		var retrotectorId =
			norm(row["idx"]);

		if(retrotectorId === null) {
			sourceRowsWithoutIdCount++;
			return;
		}

		if(sourceById[retrotectorId] !== undefined) {

			duplicateSourceIdCount++;

			addExample(
				duplicateSourceIdExamples,
				retrotectorId
			);

			return;
		}

		var startPosition =
			normInt(row["start"]);

		var endPosition =
			normInt(row["end"]);

		if(
			startPosition === null ||
			endPosition === null ||
			endPosition < startPosition
		) {
			invalidCoordinateCount++;

			addExample(
				invalidCoordinateExamples,
				retrotectorId +
				": start=" +
				row["start"] +
				", end=" +
				row["end"]
			);
		}

		var strand =
			norm(row["strand"]);

		if(
			strand !== "+" &&
			strand !== "-"
		) {
			unrecognisedStrandCount++;

			addExample(
				unrecognisedStrandExamples,
				retrotectorId +
				": " +
				strand
			);
		}

		sourceById[retrotectorId] = row;
	}
);


log(
	"RetroTector source rows loaded: " +
	sourceRows.length
);

log(
	"Unique RetroTector source IDs indexed: " +
	sortedKeys(sourceById).length
);


// ============================================================================
// Load permanent ERV loci
// ============================================================================

var locusRows =
	listCustomRows(
		LOCUS_TABLE,
		[
			"id"
		]
	);

var locusById = {};


_.each(
	locusRows,
	function(row) {

		var locusId =
			norm(row["id"]);

		if(locusId !== null) {
			locusById[locusId] = true;
		}
	}
);


log(
	"Permanent ERV loci loaded: " +
	sortedKeys(locusById).length
);


// ============================================================================
// Resolve RetroTector record -> permanent locus assignments
// ============================================================================

var candidateRows =
	listCustomRows(
		CANDIDATE_TABLE,
		[
			"id",
			"retrotector_ids"
		]
	);

var locusIdsByRetrotectorId = {};
var lociWithRetrotectorSupport = {};

var candidatesWithRetrotectorIdsCount = 0;
var candidatesWithoutPermanentLocusCount = 0;
var candidatesWithoutPermanentLocusExamples = [];


_.each(
	candidateRows,
	function(row) {

		var candidateId =
			norm(row["id"]);

		var retrotectorIds =
			splitIds(
				row["retrotector_ids"]
			);

		if(
			candidateId === null ||
			retrotectorIds.length === 0
		) {
			return;
		}

		candidatesWithRetrotectorIdsCount++;

		if(!locusById[candidateId]) {

			candidatesWithoutPermanentLocusCount++;

			addExample(
				candidatesWithoutPermanentLocusExamples,
				candidateId +
				" [" +
				retrotectorIds.join(",") +
				"]"
			);

			return;
		}

		lociWithRetrotectorSupport[
			candidateId
		] = true;

		_.each(
			retrotectorIds,
			function(retrotectorId) {

				if(
					locusIdsByRetrotectorId[
						retrotectorId
					] === undefined
				) {
					locusIdsByRetrotectorId[
						retrotectorId
					] = {};
				}

				locusIdsByRetrotectorId[
					retrotectorId
				][candidateId] = true;
			}
		);
	}
);


// ============================================================================
// Load existing RetroTector provenance IDs
// ============================================================================

var existingRows =
	listCustomRows(
		RETROTECTOR_TABLE,
		[
			"id"
		]
	);

var existingIds = {};


_.each(
	existingRows,
	function(row) {

		var retrotectorId =
			norm(row["id"]);

		if(retrotectorId !== null) {
			existingIds[retrotectorId] = true;
		}
	}
);


// ============================================================================
// Create, populate and link provenance rows
// ============================================================================

var createdCount = 0;
var updatedCount = 0;
var linkedCount = 0;

var conflictingAssignmentCount = 0;
var conflictingAssignmentExamples = [];

var missingSourceCount = 0;
var missingSourceExamples = [];


_.each(
	sortedKeys(locusIdsByRetrotectorId),
	function(retrotectorId) {

		var assignedLocusIds =
			sortedKeys(
				locusIdsByRetrotectorId[
					retrotectorId
				]
			);

		/*
		 * A source provenance record must not be assigned
		 * arbitrarily to more than one permanent locus.
		 */

		if(assignedLocusIds.length !== 1) {

			conflictingAssignmentCount++;

			addExample(
				conflictingAssignmentExamples,
				retrotectorId +
				" -> " +
				assignedLocusIds.join(",")
			);

			return;
		}

		var locusId =
			assignedLocusIds[0];

		var sourceRow =
			sourceById[retrotectorId];

		if(sourceRow === undefined) {

			missingSourceCount++;

			addExample(
				missingSourceExamples,
				retrotectorId +
				" -> " +
				locusId
			);

			return;
		}

		var alreadyExists =
			existingIds[retrotectorId] === true;

		if(!alreadyExists) {

			if(DRY_RUN) {

				log(
					"[DRY RUN] Would create " +
					RETROTECTOR_TABLE +
					"/" +
					retrotectorId
				);

			} else {

				glue.command([
					"create",
					"custom-table-row",
					RETROTECTOR_TABLE,
					retrotectorId
				]);
			}

			existingIds[retrotectorId] = true;
			createdCount++;

		} else {

			updatedCount++;
		}

		if(!DRY_RUN) {

			glue.inMode(
				customRowPath(
					RETROTECTOR_TABLE,
					retrotectorId
				),
				function() {

					setStringFieldIfPresent(
						"chrom",
						sourceRow["chrom"]
					);

					setStringFieldIfPresent(
						"strand",
						sourceRow["strand"]
					);

					setIntegerFieldIfPresent(
						"start_position",
						sourceRow["start"]
					);

					setIntegerFieldIfPresent(
						"end_position",
						sourceRow["end"]
					);

					setStringFieldIfPresent(
						"gene_structure",
						sourceRow["gene"]
					);

					setStringFieldIfPresent(
						"name",
						sourceRow["name"]
					);

					setStringFieldIfPresent(
						"conso_gene_rt",
						sourceRow["ConsoGeneRT"]
					);

					glue.command([
						"set",
						"link-target",
						"erv_locus",
						customRowPath(
							LOCUS_TABLE,
							locusId
						)
					]);
				}
			);
		}

		linkedCount++;
	}
);


// ============================================================================
// Identify unused source rows
// ============================================================================

var unusedSourceCount = 0;
var unusedSourceExamples = [];


_.each(
	sortedKeys(sourceById),
	function(retrotectorId) {

		if(
			locusIdsByRetrotectorId[
				retrotectorId
			] === undefined
		) {
			unusedSourceCount++;

			addExample(
				unusedSourceExamples,
				retrotectorId
			);
		}
	}
);


// Unity: count permanent loci with no RetroTector support.

var lociWithoutRetrotectorSupportCount = 0;


_.each(
	sortedKeys(locusById),
	function(locusId) {

		if(
			!lociWithRetrotectorSupport[
				locusId
			]
		) {
			lociWithoutRetrotectorSupportCount++;
		}
	}
);


// ============================================================================
// Summary
// ============================================================================

log("============================================================");
log("RetroTector locus provenance summary");
log("============================================================");

log(
	"Source rows loaded: " +
	sourceRows.length
);

log(
	"Unique source IDs indexed: " +
	sortedKeys(sourceById).length
);

log(
	"Candidate rows examined: " +
	candidateRows.length
);

log(
	"Candidates containing RetroTector IDs: " +
	candidatesWithRetrotectorIdsCount
);

log(
	"Permanent loci with RetroTector support: " +
	sortedKeys(
		lociWithRetrotectorSupport
	).length
);

log(
	"Distinct RetroTector IDs referenced by permanent loci: " +
	sortedKeys(
		locusIdsByRetrotectorId
	).length
);

log(
	"Provenance rows created: " +
	createdCount
);

log(
	"Existing provenance rows updated: " +
	updatedCount
);

log(
	"Provenance rows linked to permanent loci: " +
	linkedCount
);

log(
	"Permanent loci without RetroTector support: " +
	lociWithoutRetrotectorSupportCount
);


printAudit(
	"Source rows without idx",
	sourceRowsWithoutIdCount,
	[]
);

printAudit(
	"Duplicate source idx values",
	duplicateSourceIdCount,
	duplicateSourceIdExamples
);

printAudit(
	"Source rows with invalid coordinates",
	invalidCoordinateCount,
	invalidCoordinateExamples
);

printAudit(
	"Source rows with unrecognised strand values",
	unrecognisedStrandCount,
	unrecognisedStrandExamples
);

printAudit(
	"Candidates with RetroTector IDs but no permanent locus",
	candidatesWithoutPermanentLocusCount,
	candidatesWithoutPermanentLocusExamples
);

printAudit(
	"RetroTector IDs assigned to multiple permanent loci",
	conflictingAssignmentCount,
	conflictingAssignmentExamples
);

printAudit(
	"Candidate RetroTector IDs missing from the source file",
	missingSourceCount,
	missingSourceExamples
);

printAudit(
	"Source rows not used by a permanent locus",
	unusedSourceCount,
	unusedSourceExamples
);


if(DRY_RUN) {
	log(
		"DRY_RUN was enabled; no project data were changed"
	);
}

log(
	"Finished loading RetroTector locus provenance"
);