/**
 * selectErvLocusCandidates.js
 *
 * Stream-select ERV locus candidates from the full merged locus TSV.
 *
 * Selection rule:
 *   retain a locus if any comma-separated token in `names` matches either:
 *     1. an erv_lineage.id
 *     2. an ltr_lineage.id explicitly linked through erv_lineage_ltr_assoc
 *
 * `names_decision` is used only for summary/audit output.
 */

var INPUT_FILE =
    "/Users/rob/Sources/erv/HERVs-RBRT-name_new.tsv";

var OUTPUT_FILE =
	"tabular/locus/HERVs-RBRT-filtered.tsv";

var BUILD_DIR =
	"tabular/locus/build/";

var SUMMARY_FILE =
	BUILD_DIR + "candidate_selection_summary.tsv";

var RAW_NAME_SUMMARY_FILE =
	BUILD_DIR + "candidate_selection_by_raw_name.tsv";

var NAMES_DECISION_SUMMARY_FILE =
	BUILD_DIR + "candidate_selection_by_names_decision.tsv";

var RAW_NAME_VS_DECISION_FILE =
	BUILD_DIR + "candidate_selection_raw_name_vs_decision.tsv";

var NAME_SET_SUMMARY_FILE =
	BUILD_DIR + "candidate_selection_by_name_set.tsv";

var LTR_STATUS_FILE =
	BUILD_DIR + "candidate_selection_ltr_status.tsv";

var PROGRESS_INTERVAL = 50000;


// ============================================================================
// Java I/O
// ============================================================================

var FileReader =
	Java.type("java.io.FileReader");

var BufferedReader =
	Java.type("java.io.BufferedReader");

var FileWriter =
	Java.type("java.io.FileWriter");

var BufferedWriter =
	Java.type("java.io.BufferedWriter");


// ============================================================================
// Basic helpers
// ============================================================================

function log(msg) {
	glue.logInfo(msg);
}

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

function percentage(part, total) {

	if(total === 0) {
		return 0;
	}

	return 100.0 * part / total;
}


// ============================================================================
// GLUE table output helper
// ============================================================================

function objectsToTabularData(
	rows,
	columns,
	resultName
) {

	var resultRows = [];

	for(var i = 0; i < rows.length; i++) {

		var row =
			rows[i];

		var values = [];

		for(var j = 0; j < columns.length; j++) {

			var value =
				row[columns[j]];

			if(value === undefined) {
				value = null;
			}

			values.push(value);
		}

		resultRows.push({
			"value": values
		});
	}

	var tabularData = {};

	tabularData[resultName] = {
		"column": columns,
		"row": resultRows
	};

	return tabularData;
}

function saveTabular(
	path,
	rows,
	columns,
	resultName
) {

	var tabularData =
		objectsToTabularData(
			rows,
			columns,
			resultName
		);

	glue.inMode(
		"module/tabularUtility",
		function() {

			glue.command({
				"save-tabular": {
					"fileName": path,
					"tabularData": tabularData
				}
			});
		}
	);

	log(
		"Wrote " +
		path +
		" (" +
		rows.length +
		" rows)"
	);
}


// ============================================================================
// Curated ERV / LTR repertoire
// ============================================================================

function listCustomTableIds(tableName) {

	var rows =
		glue.tableToObjects(
			glue.command([
				"list",
				"custom-table-row",
				tableName,
				"id"
			])
		);

	var ids = [];

	_.each(
		rows,
		function(row) {

			var id =
				norm(row.id);

			if(id !== null) {
				ids.push(id);
			}
		}
	);

	return ids;
}

function listErvAssociatedLtrIds() {

	var rows =
		glue.tableToObjects(
			glue.command([
				"list",
				"custom-table-row",
				"erv_lineage_ltr_assoc",
				"erv_lineage.id",
				"ltr_lineage.id"
			])
		);

	var seen = {};
	var ids = [];

	_.each(
		rows,
		function(row) {

			var ervId =
				norm(
					row["erv_lineage.id"]
				);

			var ltrId =
				norm(
					row["ltr_lineage.id"]
				);

			if(
				ervId !== null &&
				ltrId !== null &&
				!seen[ltrId]
			) {

				seen[ltrId] = true;
				ids.push(ltrId);
			}
		}
	);

	return ids;
}

function buildRecognisedNames() {

	var recognisedNames = {};
	var recognisedTypes = {};

	var ervIds =
		listCustomTableIds(
			"erv_lineage"
		);

	var allLtrIds =
		listCustomTableIds(
			"ltr_lineage"
		);

	var associatedLtrIds =
		listErvAssociatedLtrIds();


	_.each(
		ervIds,
		function(id) {
			recognisedNames[id] = true;
			recognisedTypes[id] = "ERV";
		}
	);

	_.each(
		associatedLtrIds,
		function(id) {
			recognisedNames[id] = true;
			recognisedTypes[id] = "ERV-associated LTR";
		}
	);


	var associatedSet = {};

	_.each(
		associatedLtrIds,
		function(id) {
			associatedSet[id] = true;
		}
	);

	var unassociatedLtrIds =
		_.filter(
			allLtrIds,
			function(id) {
				return !associatedSet[id];
			}
		);

	return {
		recognisedNames: recognisedNames,
		recognisedTypes: recognisedTypes,
		ervIds: ervIds,
		allLtrIds: allLtrIds,
		associatedLtrIds: associatedLtrIds,
		unassociatedLtrIds: unassociatedLtrIds
	};
}


// ============================================================================
// Name parsing
// ============================================================================

function splitRawNames(value) {

	var s =
		norm(value);

	if(s === null) {
		return [];
	}

	var seen = {};
	var names = [];

	_.each(
		s.split(","),
		function(token) {

			var name =
				norm(token);

			if(
				name !== null &&
				!seen[name]
			) {

				seen[name] = true;
				names.push(name);
			}
		}
	);

	return names;
}

function makeNameSet(names) {

	if(names.length === 0) {
		return "(none)";
	}

	var sorted =
		names.slice();

	sorted.sort();

	return sorted.join(" + ");
}


// ============================================================================
// Summary counters
// ============================================================================

function newStatusCounter() {
	return {
		included: 0,
		excluded: 0
	};
}

function incrementStatusCounter(
	map,
	key,
	included
) {

	if(map[key] === undefined) {
		map[key] = newStatusCounter();
	}

	if(included) {
		map[key].included++;
	} else {
		map[key].excluded++;
	}
}

function incrementPairCounter(
	map,
	key1,
	key2,
	included
) {

	var compoundKey =
		key1 + "\t" + key2;

	if(map[compoundKey] === undefined) {

		map[compoundKey] = {
			raw_name: key1,
			names_decision: key2,
			included: 0,
			excluded: 0
		};
	}

	if(included) {
		map[compoundKey].included++;
	} else {
		map[compoundKey].excluded++;
	}
}


// ============================================================================
// Build recognised repertoire
// ============================================================================

var repertoire =
	buildRecognisedNames();

var recognisedNames =
	repertoire.recognisedNames;

var recognisedTypes =
	repertoire.recognisedTypes;


log(
	"Loaded " +
	repertoire.ervIds.length +
	" ERV lineage/sublineage names"
);

log(
	"Loaded " +
	repertoire.allLtrIds.length +
	" total LTR lineage names"
);

log(
	"Of these, " +
	repertoire.associatedLtrIds.length +
	" LTRs are explicitly associated with ERV lineages"
);

log(
	repertoire.unassociatedLtrIds.length +
	" LTRs are currently unassociated and will NOT trigger locus inclusion"
);

log(
	"Loaded " +
	_.keys(recognisedNames).length +
	" unique recognised ERV/ERV-associated-LTR names"
);


// ============================================================================
// LTR association-status audit
// ============================================================================

var associatedLtrSet = {};

_.each(
	repertoire.associatedLtrIds,
	function(id) {
		associatedLtrSet[id] = true;
	}
);

var ltrStatusRows = [];

var sortedAllLtrIds =
	repertoire.allLtrIds.slice();

sortedAllLtrIds.sort();

_.each(
	sortedAllLtrIds,
	function(ltrId) {

		var associated =
			associatedLtrSet[ltrId] === true;

		ltrStatusRows.push({
			ltr_lineage_id: ltrId,
			erv_associated:
				associated ? "yes" : "no",
			eligible_for_locus_selection:
				associated ? "yes" : "no"
		});
	}
);

saveTabular(
	LTR_STATUS_FILE,
	ltrStatusRows,
	[
		"ltr_lineage_id",
		"erv_associated",
		"eligible_for_locus_selection"
	],
	"candidateSelectionLtrStatus"
);


// ============================================================================
// Streaming locus selection
// ============================================================================

var reader =
	new BufferedReader(
		new FileReader(
			INPUT_FILE
		)
	);

var writer =
	new BufferedWriter(
		new FileWriter(
			OUTPUT_FILE
		)
	);


var processedCount = 0;
var includedCount = 0;
var excludedCount = 0;

var rawNameCounts = {};
var decisionCounts = {};
var rawNameDecisionCounts = {};
var nameSetCounts = {};


try {

	// ---------------------------------------------------------------------
	// Header
	// ---------------------------------------------------------------------

	var headerLine =
		reader.readLine();

	if(headerLine === null) {
		throw "Input file is empty: " + INPUT_FILE;
	}

	writer.write(headerLine);
	writer.newLine();


	var columns =
		headerLine.split("\t");

	var namesIndex =
		columns.indexOf("names");

	var namesDecisionIndex =
		columns.indexOf("names_decision");


	if(namesIndex < 0) {
		throw "Required column 'names' not found in " + INPUT_FILE;
	}

	if(namesDecisionIndex < 0) {
		throw "Required column 'names_decision' not found in " + INPUT_FILE;
	}


	log(
		"Streaming loci from " +
		INPUT_FILE
	);


	// ---------------------------------------------------------------------
	// Rows
	// ---------------------------------------------------------------------

	var line;

	while(
		(line = reader.readLine()) !== null
	) {

		processedCount++;


		/*
		 * Preserve trailing empty fields.
		 *
		 * JavaScript's split with a simple "\t" works here
		 * for the pipeline-generated TSV structure.
		 */
		var values =
			line.split("\t");


		var rawNames =
			splitRawNames(
				values[namesIndex]
			);


		var matchingNames =
			_.filter(
				rawNames,
				function(name) {
					return recognisedNames[name] === true;
				}
			);


		var included =
			matchingNames.length > 0;


		if(included) {

			includedCount++;

			/*
			 * Write original line verbatim.
			 */
			writer.write(line);
			writer.newLine();

		} else {

			excludedCount++;
		}


		// -----------------------------------------------------------------
		// Summary by raw name
		// -----------------------------------------------------------------

		if(rawNames.length === 0) {

			incrementStatusCounter(
				rawNameCounts,
				"(none)",
				included
			);

		} else {

			_.each(
				rawNames,
				function(name) {

					incrementStatusCounter(
						rawNameCounts,
						name,
						included
					);
				}
			);
		}


		// -----------------------------------------------------------------
		// Summary by names_decision
		// -----------------------------------------------------------------

		var namesDecision =
			norm(
				values[namesDecisionIndex]
			);

		if(namesDecision === null) {
			namesDecision = "(none)";
		}


		incrementStatusCounter(
			decisionCounts,
			namesDecision,
			included
		);


		// -----------------------------------------------------------------
		// Raw-name versus names_decision
		// -----------------------------------------------------------------

		if(rawNames.length === 0) {

			incrementPairCounter(
				rawNameDecisionCounts,
				"(none)",
				namesDecision,
				included
			);

		} else {

			_.each(
				rawNames,
				function(name) {

					incrementPairCounter(
						rawNameDecisionCounts,
						name,
						namesDecision,
						included
					);
				}
			);
		}


		// -----------------------------------------------------------------
		// Name-set summary
		// -----------------------------------------------------------------

		var nameSet =
			makeNameSet(
				rawNames
			);

		incrementStatusCounter(
			nameSetCounts,
			nameSet,
			included
		);


		// -----------------------------------------------------------------
		// Progress logging
		// -----------------------------------------------------------------

		if(
			processedCount %
			PROGRESS_INTERVAL ===
			0
		) {

			log(
				"Processed " +
				processedCount +
				" loci: " +
				includedCount +
				" included, " +
				excludedCount +
				" excluded"
			);
		}
	}

} finally {

	reader.close();
	writer.close();
}


log(
	"Finished streaming " +
	processedCount +
	" loci"
);

log(
	"Wrote selected loci directly to " +
	OUTPUT_FILE
);


// ============================================================================
// Overall selection summary
// ============================================================================

var overallSummary = [

	{
		status: "included",
		count: includedCount,
		percent:
			percentage(
				includedCount,
				processedCount
			)
	},

	{
		status: "excluded",
		count: excludedCount,
		percent:
			percentage(
				excludedCount,
				processedCount
			)
	},

	{
		status: "total",
		count: processedCount,
		percent: 100.0
	}
];

saveTabular(
	SUMMARY_FILE,
	overallSummary,
	[
		"status",
		"count",
		"percent"
	],
	"candidateSelectionSummary"
);


// ============================================================================
// Raw-name summary
// ============================================================================

var rawNameSummary = [];

_.each(
	_.keys(rawNameCounts),
	function(name) {

		var counts =
			rawNameCounts[name];

		rawNameSummary.push({
			raw_name: name,
			recognised_type:
				recognisedTypes[name] !== undefined
					? recognisedTypes[name]
					: "",
			included_loci: counts.included,
			excluded_loci: counts.excluded,
			total_loci:
				counts.included +
				counts.excluded
		});
	}
);

rawNameSummary.sort(
	function(a, b) {

		if(b.total_loci !== a.total_loci) {
			return b.total_loci - a.total_loci;
		}

		return a.raw_name.localeCompare(
			b.raw_name
		);
	}
);

saveTabular(
	RAW_NAME_SUMMARY_FILE,
	rawNameSummary,
	[
		"raw_name",
		"recognised_type",
		"included_loci",
		"excluded_loci",
		"total_loci"
	],
	"candidateSelectionByRawName"
);


// ============================================================================
// names_decision summary
// ============================================================================

var decisionSummary = [];

_.each(
	_.keys(decisionCounts),
	function(decision) {

		var counts =
			decisionCounts[decision];

		decisionSummary.push({
			names_decision: decision,
			included_loci: counts.included,
			excluded_loci: counts.excluded,
			total_loci:
				counts.included +
				counts.excluded
		});
	}
);

decisionSummary.sort(
	function(a, b) {

		if(b.total_loci !== a.total_loci) {
			return b.total_loci - a.total_loci;
		}

		return a.names_decision.localeCompare(
			b.names_decision
		);
	}
);

saveTabular(
	NAMES_DECISION_SUMMARY_FILE,
	decisionSummary,
	[
		"names_decision",
		"included_loci",
		"excluded_loci",
		"total_loci"
	],
	"candidateSelectionByNamesDecision"
);


// ============================================================================
// Raw-name vs names_decision summary
// ============================================================================

var rawNameDecisionSummary = [];

_.each(
	_.keys(rawNameDecisionCounts),
	function(key) {

		var item =
			rawNameDecisionCounts[key];

		rawNameDecisionSummary.push({
			raw_name:
				item.raw_name,
			names_decision:
				item.names_decision,
			included_loci:
				item.included,
			excluded_loci:
				item.excluded,
			total_loci:
				item.included +
				item.excluded
		});
	}
);

rawNameDecisionSummary.sort(
	function(a, b) {

		if(b.total_loci !== a.total_loci) {
			return b.total_loci - a.total_loci;
		}

		var nameCmp =
			a.raw_name.localeCompare(
				b.raw_name
			);

		if(nameCmp !== 0) {
			return nameCmp;
		}

		return a.names_decision.localeCompare(
			b.names_decision
		);
	}
);

saveTabular(
	RAW_NAME_VS_DECISION_FILE,
	rawNameDecisionSummary,
	[
		"raw_name",
		"names_decision",
		"included_loci",
		"excluded_loci",
		"total_loci"
	],
	"candidateSelectionRawNameVsDecision"
);


// ============================================================================
// Name-set summary
// ============================================================================

var nameSetSummary = [];

_.each(
	_.keys(nameSetCounts),
	function(nameSet) {

		var counts =
			nameSetCounts[nameSet];

		nameSetSummary.push({
			name_set: nameSet,
			included_loci:
				counts.included,
			excluded_loci:
				counts.excluded,
			total_loci:
				counts.included +
				counts.excluded
		});
	}
);

nameSetSummary.sort(
	function(a, b) {

		if(b.total_loci !== a.total_loci) {
			return b.total_loci - a.total_loci;
		}

		return a.name_set.localeCompare(
			b.name_set
		);
	}
);

saveTabular(
	NAME_SET_SUMMARY_FILE,
	nameSetSummary,
	[
		"name_set",
		"included_loci",
		"excluded_loci",
		"total_loci"
	],
	"candidateSelectionByNameSet"
);


// ============================================================================
// Final logging
// ============================================================================

log(
	"Selection complete: " +
	includedCount +
	" included, " +
	excludedCount +
	" excluded, " +
	processedCount +
	" total"
);