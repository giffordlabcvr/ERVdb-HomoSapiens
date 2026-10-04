// glue/build/locus/provenance/loadDigsLocusProvenance.js
//
// Load DIGS provenance records from the two DIGS merge-database tables:
//
//   tabular/merge/digs_consolidated.tsv
//   tabular/locus/digs-name-decision.tsv
//
// The files are joined on `idx`. Each DIGS record is linked to the
// permanent erv_locus referenced through erv_locus_candidate.digs_ids.
//
// Expected digs_locus fields:
//
//   chrom, strand, start_position, end_position,
//   names, genes, digs_ids,
//   resolved_name, resolution_score, ltr_check
//
// Expected link:
//
//   digs_locus -> erv_locus

var CONSOLIDATED_FILE =
	"tabular/locus/digs_consolidated.tsv";

var NAME_DECISION_FILE =
	"tabular/locus/digs-name-decision.tsv";

var CANDIDATE_TABLE =
	"erv_locus_candidate";

var LOCUS_TABLE =
	"erv_locus";

var DIGS_TABLE =
	"digs_locus";

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

	var result = parseInt(value, 10);

	return isNaN(result)
		? null
		: result;
}


function normDouble(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	var result = parseFloat(value);

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


function setDoubleFieldIfPresent(
	fieldName,
	value
) {

	value = normDouble(value);

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
// Index a tabular file by idx
// ============================================================================

function indexRowsById(rows, label) {

	var byId = {};
	var duplicateCount = 0;
	var duplicateExamples = [];
	var missingIdCount = 0;

	_.each(
		rows,
		function(row) {

			var rowId =
				norm(row["idx"]);

			if(rowId === null) {
				missingIdCount++;
				return;
			}

			if(byId[rowId] !== undefined) {

				duplicateCount++;

				addExample(
					duplicateExamples,
					rowId
				);

				return;
			}

			byId[rowId] = row;
		}
	);

	log(
		label +
		" rows indexed: " +
		sortedKeys(byId).length
	);

	printAudit(
		label + " rows without idx",
		missingIdCount,
		[]
	);

	printAudit(
		label + " duplicate idx values",
		duplicateCount,
		duplicateExamples
	);

	return byId;
}


// ============================================================================
// Load DIGS source tables
// ============================================================================

log(
	"Loading DIGS consolidated data from " +
	CONSOLIDATED_FILE
);

var consolidatedRows =
	loadTabular(
		CONSOLIDATED_FILE
	);

var consolidatedById =
	indexRowsById(
		consolidatedRows,
		"DIGS consolidated"
	);


log(
	"Loading DIGS name-decision data from " +
	NAME_DECISION_FILE
);

var decisionRows =
	loadTabular(
		NAME_DECISION_FILE
	);

var decisionById =
	indexRowsById(
		decisionRows,
		"DIGS name-decision"
	);


// ============================================================================
// Validate the join between the DIGS files
// ============================================================================

var consolidatedWithoutDecisionCount = 0;
var consolidatedWithoutDecisionExamples = [];

var decisionWithoutConsolidatedCount = 0;
var decisionWithoutConsolidatedExamples = [];

var namesDisagreementCount = 0;
var namesDisagreementExamples = [];

var genesDisagreementCount = 0;
var genesDisagreementExamples = [];


_.each(
	sortedKeys(consolidatedById),
	function(digsId) {

		var consolidated =
			consolidatedById[digsId];

		var decision =
			decisionById[digsId];

		if(decision === undefined) {

			consolidatedWithoutDecisionCount++;

			addExample(
				consolidatedWithoutDecisionExamples,
				digsId
			);

			return;
		}

		if(
			norm(consolidated["names"]) !==
			norm(decision["names"])
		) {
			namesDisagreementCount++;

			addExample(
				namesDisagreementExamples,
				digsId
			);
		}

		if(
			norm(consolidated["genes"]) !==
			norm(decision["genes"])
		) {
			genesDisagreementCount++;

			addExample(
				genesDisagreementExamples,
				digsId
			);
		}
	}
);


_.each(
	sortedKeys(decisionById),
	function(digsId) {

		if(
			consolidatedById[digsId] ===
			undefined
		) {
			decisionWithoutConsolidatedCount++;

			addExample(
				decisionWithoutConsolidatedExamples,
				digsId
			);
		}
	}
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
// Resolve DIGS record -> permanent locus assignments
// ============================================================================

var candidateRows =
	listCustomRows(
		CANDIDATE_TABLE,
		[
			"id",
			"digs_ids"
		]
	);

var locusIdsByDigsId = {};
var lociWithDigsSupport = {};

var candidatesWithDigsIdsCount = 0;
var candidatesWithoutPermanentLocusCount = 0;
var candidatesWithoutPermanentLocusExamples = [];


_.each(
	candidateRows,
	function(row) {

		var candidateId =
			norm(row["id"]);

		var digsIds =
			splitIds(
				row["digs_ids"]
			);

		if(
			candidateId === null ||
			digsIds.length === 0
		) {
			return;
		}

		candidatesWithDigsIdsCount++;

		if(!locusById[candidateId]) {

			candidatesWithoutPermanentLocusCount++;

			addExample(
				candidatesWithoutPermanentLocusExamples,
				candidateId +
				" [" +
				digsIds.join(",") +
				"]"
			);

			return;
		}

		lociWithDigsSupport[candidateId] = true;

		_.each(
			digsIds,
			function(digsId) {

				if(
					locusIdsByDigsId[digsId] ===
					undefined
				) {
					locusIdsByDigsId[digsId] = {};
				}

				locusIdsByDigsId[
					digsId
				][candidateId] = true;
			}
		);
	}
);


// ============================================================================
// Load existing DIGS provenance IDs
// ============================================================================

var existingRows =
	listCustomRows(
		DIGS_TABLE,
		[
			"id"
		]
	);

var existingDigsIds = {};


_.each(
	existingRows,
	function(row) {

		var digsId =
			norm(row["id"]);

		if(digsId !== null) {
			existingDigsIds[digsId] = true;
		}
	}
);


// ============================================================================
// Create, populate and link DIGS provenance rows
// ============================================================================

var createdCount = 0;
var updatedCount = 0;
var linkedCount = 0;

var conflictingAssignmentCount = 0;
var conflictingAssignmentExamples = [];

var missingConsolidatedCount = 0;
var missingConsolidatedExamples = [];

var missingDecisionCount = 0;
var missingDecisionExamples = [];

var invalidScoreCount = 0;
var invalidScoreExamples = [];


_.each(
	sortedKeys(locusIdsByDigsId),
	function(digsId) {

		var locusIds =
			sortedKeys(
				locusIdsByDigsId[digsId]
			);

		if(locusIds.length !== 1) {

			conflictingAssignmentCount++;

			addExample(
				conflictingAssignmentExamples,
				digsId +
				" -> " +
				locusIds.join(",")
			);

			return;
		}

		var locusId =
			locusIds[0];

		var consolidated =
			consolidatedById[digsId];

		if(consolidated === undefined) {

			missingConsolidatedCount++;

			addExample(
				missingConsolidatedExamples,
				digsId +
				" -> " +
				locusId
			);

			return;
		}

		var decision =
			decisionById[digsId];

		if(decision === undefined) {

			missingDecisionCount++;

			addExample(
				missingDecisionExamples,
				digsId
			);
		}

		if(
			decision !== undefined &&
			norm(decision["score"]) !== null &&
			normDouble(decision["score"]) === null
		) {
			invalidScoreCount++;

			addExample(
				invalidScoreExamples,
				digsId +
				": " +
				decision["score"]
			);
		}

		var alreadyExists =
			existingDigsIds[digsId] === true;

		if(!alreadyExists) {

			if(DRY_RUN) {

				log(
					"[DRY RUN] Would create " +
					DIGS_TABLE +
					"/" +
					digsId
				);

			} else {

				glue.command([
					"create",
					"custom-table-row",
					DIGS_TABLE,
					digsId
				]);
			}

			existingDigsIds[digsId] = true;
			createdCount++;

		} else {

			updatedCount++;
		}

		if(!DRY_RUN) {

			glue.inMode(
				customRowPath(
					DIGS_TABLE,
					digsId
				),
				function() {

					setStringFieldIfPresent(
						"chrom",
						consolidated["chrom"]
					);

					setStringFieldIfPresent(
						"strand",
						consolidated["strand"]
					);

					setIntegerFieldIfPresent(
						"start_position",
						consolidated["start"]
					);

					setIntegerFieldIfPresent(
						"end_position",
						consolidated["end"]
					);

					setStringFieldIfPresent(
						"names",
						consolidated["names"]
					);

					setStringFieldIfPresent(
						"genes",
						consolidated["genes"]
					);

					setStringFieldIfPresent(
						"digs_ids",
						consolidated["ids"]
					);

					if(decision !== undefined) {

						setStringFieldIfPresent(
							"resolved_name",
							decision["summarised"]
						);

						setDoubleFieldIfPresent(
							"resolution_score",
							decision["score"]
						);

						setStringFieldIfPresent(
							"ltr_check",
							decision["ltr_check"]
						);
					}

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
// Identify unused DIGS source rows and unsupported permanent loci
// ============================================================================

var unusedConsolidatedCount = 0;
var unusedConsolidatedExamples = [];


_.each(
	sortedKeys(consolidatedById),
	function(digsId) {

		if(
			locusIdsByDigsId[digsId] ===
			undefined
		) {
			unusedConsolidatedCount++;

			addExample(
				unusedConsolidatedExamples,
				digsId
			);
		}
	}
);


var permanentLociWithoutDigsCount = 0;


_.each(
	sortedKeys(locusById),
	function(locusId) {

		if(!lociWithDigsSupport[locusId]) {
			permanentLociWithoutDigsCount++;
		}
	}
);


// ============================================================================
// Summary
// ============================================================================

log("============================================================");
log("DIGS locus provenance summary");
log("============================================================");

log(
	"DIGS consolidated rows loaded: " +
	consolidatedRows.length
);

log(
	"DIGS name-decision rows loaded: " +
	decisionRows.length
);

log(
	"Candidate rows loaded: " +
	candidateRows.length
);

log(
	"Candidates containing DIGS IDs: " +
	candidatesWithDigsIdsCount
);

log(
	"Permanent loci containing DIGS support: " +
	sortedKeys(lociWithDigsSupport).length
);

log(
	"Distinct DIGS IDs referenced by permanent loci: " +
	sortedKeys(locusIdsByDigsId).length
);

log(
	"DIGS provenance rows created: " +
	createdCount
);

log(
	"Existing DIGS provenance rows updated: " +
	updatedCount
);

log(
	"DIGS provenance rows linked to permanent loci: " +
	linkedCount
);

log(
	"Permanent loci without DIGS support: " +
	permanentLociWithoutDigsCount
);


printAudit(
	"Consolidated rows without a name-decision row",
	consolidatedWithoutDecisionCount,
	consolidatedWithoutDecisionExamples
);

printAudit(
	"Name-decision rows without a consolidated row",
	decisionWithoutConsolidatedCount,
	decisionWithoutConsolidatedExamples
);

printAudit(
	"DIGS rows whose names differ between input files",
	namesDisagreementCount,
	namesDisagreementExamples
);

printAudit(
	"DIGS rows whose genes differ between input files",
	genesDisagreementCount,
	genesDisagreementExamples
);

printAudit(
	"Candidates with DIGS IDs but without a permanent locus",
	candidatesWithoutPermanentLocusCount,
	candidatesWithoutPermanentLocusExamples
);

printAudit(
	"DIGS IDs assigned to multiple permanent loci",
	conflictingAssignmentCount,
	conflictingAssignmentExamples
);

printAudit(
	"Referenced DIGS IDs missing from digs_consolidated.tsv",
	missingConsolidatedCount,
	missingConsolidatedExamples
);

printAudit(
	"Referenced DIGS IDs missing from digs-name-decision.tsv",
	missingDecisionCount,
	missingDecisionExamples
);

printAudit(
	"DIGS name-decision rows with an invalid score",
	invalidScoreCount,
	invalidScoreExamples
);

printAudit(
	"Consolidated DIGS records unused by permanent loci",
	unusedConsolidatedCount,
	unusedConsolidatedExamples
);


if(DRY_RUN) {
	log(
		"DRY_RUN was enabled; no project data were changed"
	);
}

log(
	"Finished loading DIGS locus provenance"
);