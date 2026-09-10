// glue/analyse/reconstructLineageLevelPhylogenies.js
//
// Reconstruct nucleotide phylogenies for ERV lineage and sublineage
// alignments.
//
// This script is an orchestration layer. The reusable reconstruction logic
// is provided by the base-layer ECMA function-invoker module:
//
//   ervTreeBuilder
//
// Alignment naming:
//
//   AL_LINEAGE_1_Eta_1
//       -> selector msaSelector_1_Eta_1_pol_nucs
//       -> tree trees/lineage/1_Eta_1_pol_nucs.tree
//
//   AL_SUBLINEAGE_1R_Theta_101
//       -> selector msaSelector_1R_Theta_101_pol_nucs
//       -> tree trees/sublineage/1R_Theta_101_pol_nucs.tree
//
// Selector modules are created separately:
//
//   run script glue/analyse/createPhylogenyModules.js
//
// The ervTreeBuilder module:
//   - checks alignment membership;
//   - filters members by feature coverage;
//   - requires a sufficient number of eligible members;
//   - skips an existing output tree;
//   - runs the nucleotide phylogeny generator.
//
// This script:
//   - discovers lineage and sublineage alignments;
//   - derives standard-ID selector names;
//   - skips unavailable selectors;
//   - delegates each reconstruction to ervTreeBuilder;
//   - reports a summary.
//
// Assumes execution from within the ervdb project mode.


// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

var TREE_BUILDER_MODULE =
	"ervTreeBuilder";

var TREE_ROOT =
	"trees";

var DRY_RUN =
	false;


// Minimum reference-feature coverage required for an alignment member to
// be included in the corresponding tree.
//
// These values can be adjusted independently later if required.

var FEATURE_SETTINGS = [
	{
		featureName: "gag",
		minCoveragePct: 55
	},
	{
		featureName: "pol",
		minCoveragePct: 55
	},
	{
		featureName: "env",
		minCoveragePct: 55
	}
];


// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------

function log(message) {
	glue.logInfo(message);
}

function escapeQuotes(value) {
	return ("" + value)
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'");
}

function queryObjects(commandWords) {
	return glue.tableToObjects(
		glue.command(commandWords)
	);
}


// -----------------------------------------------------------------------------
// GLUE object checks
// -----------------------------------------------------------------------------

function moduleExists(moduleName) {
	var rows = queryObjects([
		"list",
		"module",
		"-w",
		"name = '" +
			escapeQuotes(moduleName) +
			"'"
	]);

	return rows.length > 0;
}


// -----------------------------------------------------------------------------
// Alignment discovery
// -----------------------------------------------------------------------------

function loadTargetAlignments() {
	var rows = queryObjects([
		"list",
		"alignment",
		"name",
		"refSequence.name",
		"-w",
		"name like 'AL_LINEAGE_%' or " +
			"name like 'AL_SUBLINEAGE_%'"
	]);

	rows.sort(function(rowA, rowB) {
		var nameA = "" + rowA.name;
		var nameB = "" + rowB.name;

		if(nameA < nameB) {
			return -1;
		}

		if(nameA > nameB) {
			return 1;
		}

		return 0;
	});

	return rows;
}


// -----------------------------------------------------------------------------
// Alignment-name parsing
// -----------------------------------------------------------------------------

function parseAlignmentName(alignmentName) {
	var lineagePrefix =
		"AL_LINEAGE_";

	var sublineagePrefix =
		"AL_SUBLINEAGE_";

	if(alignmentName.indexOf(lineagePrefix) === 0) {
		return {
			entityLevel: "lineage",
			standardStem: alignmentName.substring(
				lineagePrefix.length
			),
			treeDirectory: "lineage"
		};
	}

	if(alignmentName.indexOf(sublineagePrefix) === 0) {
		return {
			entityLevel: "sublineage",
			standardStem: alignmentName.substring(
				sublineagePrefix.length
			),
			treeDirectory: "sublineage"
		};
	}

	throw new Error(
		"Unsupported alignment name: " +
		alignmentName
	);
}


// -----------------------------------------------------------------------------
// Derived names
// -----------------------------------------------------------------------------

function makeSelectorModuleName(
	standardStem,
	featureName
) {
	return (
		"msaSelector_" +
		standardStem +
		"_" +
		featureName +
		"_nucs"
	);
}

function makeOutputFile(
	alignmentInfo,
	featureName
) {
	return (
		TREE_ROOT +
		"/" +
		alignmentInfo.treeDirectory +
		"/" +
		alignmentInfo.standardStem +
		"_" +
		featureName +
		"_nucs.tree"
	);
}


// -----------------------------------------------------------------------------
// Tree-builder invocation
// -----------------------------------------------------------------------------

function reconstructWithCoverage(
	alignmentName,
	selectorModuleName,
	featureName,
	minCoveragePct,
	outputFile
) {
	var commandWords = [
		"module",
		TREE_BUILDER_MODULE,
		"reconstructWithCoverage",
		alignmentName,
		selectorModuleName,
		featureName,
		"" + minCoveragePct,
		outputFile
	];

	if(DRY_RUN) {
		log(
			"[DRY RUN] " +
			commandWords.join(" ")
		);

		return [{
			alignmentName: alignmentName,
			selectorModuleName: selectorModuleName,
			featureName: featureName,
			minCoveragePct: minCoveragePct,
			outputFile: outputFile,
			status: "dry_run",
			reason: null
		}];
	}

	var result =
		glue.command(commandWords);

	return glue.tableToObjects(result);
}


// -----------------------------------------------------------------------------
// Summary helpers
// -----------------------------------------------------------------------------

function incrementCount(counts, key) {
	if(
		key === null ||
		key === undefined ||
		("" + key).trim() === ""
	) {
		key = "unknown";
	}

	key = "" + key;

	if(counts[key] === undefined) {
		counts[key] = 0;
	}

	counts[key]++;
}

function sortedKeys(object) {
	var keys = [];

	for(var key in object) {
		if(object.hasOwnProperty(key)) {
			keys.push(key);
		}
	}

	keys.sort();

	return keys;
}


// -----------------------------------------------------------------------------
// Validate required base-layer infrastructure
// -----------------------------------------------------------------------------

if(!moduleExists(TREE_BUILDER_MODULE)) {
	throw new Error(
		"Required base-layer module '" +
		TREE_BUILDER_MODULE +
		"' does not exist. " +
		"The ervTreeBuilder module must be declared by the ERVdb " +
		"base-layer build before this analysis is run."
	);
}

log(
	"Using base-layer tree builder module: " +
	TREE_BUILDER_MODULE
);


// -----------------------------------------------------------------------------
// Load alignments
// -----------------------------------------------------------------------------

log(
	"Loading ERV lineage and sublineage alignments"
);

var alignmentRows =
	loadTargetAlignments();

log(
	"Loaded " +
	alignmentRows.length +
	" ERV lineage/sublineage alignment(s)"
);


// -----------------------------------------------------------------------------
// Process alignments
// -----------------------------------------------------------------------------

var lineageAlignmentCount = 0;
var sublineageAlignmentCount = 0;

var reconstructionRequestedCount = 0;
var selectorMissingCount = 0;
var invocationErrorCount = 0;

var statusCounts = {};
var reasonCounts = {};

var featureRequestedCounts = {
	gag: 0,
	pol: 0,
	env: 0
};

var featureMissingSelectorCounts = {
	gag: 0,
	pol: 0,
	env: 0
};

var missingSelectors = [];
var invocationErrors = [];


_.each(alignmentRows, function(alignmentRow) {
	var alignmentName =
		alignmentRow.name;

	var referenceName =
		alignmentRow["refSequence.name"];

	var alignmentInfo =
		parseAlignmentName(alignmentName);

	if(alignmentInfo.entityLevel === "lineage") {
		lineageAlignmentCount++;
	} else {
		sublineageAlignmentCount++;
	}

	log(
		"Processing " +
		alignmentInfo.entityLevel +
		" alignment " +
		alignmentName +
		(
			referenceName !== null &&
			referenceName !== undefined
				? " constrained by " + referenceName
				: ""
		)
	);

	_.each(FEATURE_SETTINGS, function(featureSetting) {
		var featureName =
			featureSetting.featureName;

		var minCoveragePct =
			featureSetting.minCoveragePct;

		var selectorModuleName =
			makeSelectorModuleName(
				alignmentInfo.standardStem,
				featureName
			);

		var outputFile =
			makeOutputFile(
				alignmentInfo,
				featureName
			);

		// Selector availability represents whether an appropriate curated
		// feature region has been defined for this lineage/sublineage.

		if(!moduleExists(selectorModuleName)) {
			selectorMissingCount++;
			featureMissingSelectorCounts[featureName]++;

			missingSelectors.push({
				alignmentName: alignmentName,
				referenceName: referenceName,
				featureName: featureName,
				selectorModuleName: selectorModuleName
			});

			log(
				"Skipping " +
				alignmentName +
				" " +
				featureName +
				" tree: selector module does not exist: " +
				selectorModuleName
			);

			return;
		}

		log(
			"Requesting " +
			featureName +
			" tree for " +
			alignmentName +
			" using " +
			selectorModuleName +
			", minimum coverage " +
			minCoveragePct +
			"% -> " +
			outputFile
		);

		reconstructionRequestedCount++;
		featureRequestedCounts[featureName]++;

		try {
			var resultRows =
				reconstructWithCoverage(
					alignmentName,
					selectorModuleName,
					featureName,
					minCoveragePct,
					outputFile
				);

			if(
				resultRows === null ||
				resultRows === undefined ||
				resultRows.length === 0
			) {
				incrementCount(
					statusCounts,
					"no_result"
				);

				return;
			}

			_.each(resultRows, function(resultRow) {
				incrementCount(
					statusCounts,
					resultRow.status
				);

				if(
					resultRow.reason !== null &&
					resultRow.reason !== undefined &&
					("" + resultRow.reason).trim() !== ""
				) {
					incrementCount(
						reasonCounts,
						resultRow.reason
					);
				}
			});

		} catch(error) {
			invocationErrorCount++;

			invocationErrors.push({
				alignmentName: alignmentName,
				referenceName: referenceName,
				featureName: featureName,
				selectorModuleName: selectorModuleName,
				outputFile: outputFile,
				error: "" + error
			});

			log(
				"ERROR reconstructing " +
				alignmentName +
				" " +
				featureName +
				": " +
				error
			);
		}
	});
});


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log("============================================================");
log("ERV lineage/sublineage phylogeny reconstruction summary");
log("============================================================");

log(
	"Target alignments: " +
	alignmentRows.length
);

log(
	"Lineage alignments: " +
	lineageAlignmentCount
);

log(
	"Sublineage alignments: " +
	sublineageAlignmentCount
);

log(
	"Reconstruction requests: " +
	reconstructionRequestedCount
);

log(
	"Missing selector combinations: " +
	selectorMissingCount
);

log(
	"Invocation errors: " +
	invocationErrorCount
);

log("------------------------------------------------------------");
log("Requests by feature");
log("------------------------------------------------------------");

_.each(FEATURE_SETTINGS, function(featureSetting) {
	var featureName =
		featureSetting.featureName;

	log(
		featureName +
		": " +
		featureRequestedCounts[featureName] +
		" requested; " +
		featureMissingSelectorCounts[featureName] +
		" missing selector(s)"
	);
});

log("------------------------------------------------------------");
log("Tree-builder result statuses");
log("------------------------------------------------------------");

var statusKeys =
	sortedKeys(statusCounts);

if(statusKeys.length === 0) {
	log("No result statuses returned");
} else {
	_.each(statusKeys, function(status) {
		log(
			"  " +
			status +
			": " +
			statusCounts[status]
		);
	});
}

log("------------------------------------------------------------");
log("Tree-builder skip/error reasons");
log("------------------------------------------------------------");

var reasonKeys =
	sortedKeys(reasonCounts);

if(reasonKeys.length === 0) {
	log("No skip reasons returned");
} else {
	_.each(reasonKeys, function(reason) {
		log(
			"  " +
			reason +
			": " +
			reasonCounts[reason]
		);
	});
}


// -----------------------------------------------------------------------------
// Detailed missing-selector report
// -----------------------------------------------------------------------------

if(missingSelectors.length > 0) {
	log("------------------------------------------------------------");
	log("Missing selector modules");
	log("------------------------------------------------------------");

	_.each(missingSelectors, function(item) {
		log(
			"  " +
			item.alignmentName +
			" [" +
			item.featureName +
			"]: " +
			item.selectorModuleName +
			(
				item.referenceName !== null &&
				item.referenceName !== undefined
					? " (reference " +
						item.referenceName +
						")"
					: ""
			)
		);
	});
}


// -----------------------------------------------------------------------------
// Detailed invocation-error report
// -----------------------------------------------------------------------------

if(invocationErrors.length > 0) {
	log("------------------------------------------------------------");
	log("Tree-builder invocation errors");
	log("------------------------------------------------------------");

	_.each(invocationErrors, function(item) {
		log(
			"  " +
			item.alignmentName +
			" [" +
			item.featureName +
			"]: " +
			item.error
		);
	});
}

log("============================================================");

if(DRY_RUN) {
	log(
		"Dry run complete; no phylogenies were reconstructed"
	);
} else {
	log(
		"Finished ERV lineage/sublineage phylogeny reconstruction"
	);
}

if(invocationErrorCount > 0) {
	throw new Error(
		"Phylogeny reconstruction completed with " +
		invocationErrorCount +
		" tree-builder invocation error(s); " +
		"see the preceding log messages"
	);
}