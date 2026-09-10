// glue/analyse/createPhylogenyModules.js
//
// Recreate gag, pol and env nucleotide MSA selector modules for the ERV
// lineage and sublineage alignments present in the current project.
//
// The standard-ID stem is derived directly from the alignment name:
//
//   AL_LINEAGE_1_Eta_1
//       -> 1_Eta_1
//       -> msaSelector_1_Eta_1_pol_nucs
//
//   AL_SUBLINEAGE_1R_Theta_101
//       -> 1R_Theta_101
//       -> msaSelector_1R_Theta_101_pol_nucs
//
// Selector XML files are expected beneath:
//
//   modules/analyse/msa_masking/nucs/gag/
//   modules/analyse/msa_masking/nucs/pol/
//   modules/analyse/msa_masking/nucs/env/
//
// A missing XML file means that no curated selector is currently available
// for that alignment/feature combination. Such combinations are reported and
// skipped.
//
// This script does not create, delete or modify the base-layer ervTreeBuilder
// module.
//
// Assumes execution from within the ervdb project mode.


var SELECTOR_ROOT =
	"modules/analyse/msa_masking/nucs";

var FEATURES = [
	"gag",
	"pol",
	"env"
];

var DRY_RUN =
	false;


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
			)
		};
	}

	if(alignmentName.indexOf(sublineagePrefix) === 0) {
		return {
			entityLevel: "sublineage",
			standardStem: alignmentName.substring(
				sublineagePrefix.length
			)
		};
	}

	throw new Error(
		"Unsupported alignment name: " +
		alignmentName
	);
}


// -----------------------------------------------------------------------------
// Selector naming
// -----------------------------------------------------------------------------

function selectorModuleName(
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

function selectorXmlPath(
	standardStem,
	featureName
) {
	return (
		SELECTOR_ROOT +
		"/" +
		featureName +
		"/" +
		selectorModuleName(
			standardStem,
			featureName
		) +
		".xml"
	);
}


// -----------------------------------------------------------------------------
// Module operations
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

function deleteModuleIfPresent(moduleName) {
	if(!moduleExists(moduleName)) {
		return false;
	}

	if(DRY_RUN) {
		log(
			"[DRY RUN] Would delete module " +
			moduleName
		);

		return true;
	}

	glue.command([
		"delete",
		"module",
		moduleName
	]);

	log(
		"Deleted module " +
		moduleName
	);

	return true;
}

function isMissingFileError(error) {
	var message =
		"" + error;

	return (
		message.indexOf("File not found") >= 0 ||
		message.indexOf("No such file") >= 0 ||
		message.indexOf("does not exist") >= 0
	);
}

function createModuleFromXml(
	moduleName,
	xmlPath
) {
	if(DRY_RUN) {
		log(
			"[DRY RUN] Would create module " +
			moduleName +
			" from " +
			xmlPath
		);

		return {
			created: false,
			dryRun: true,
			missingXml: false
		};
	}

	try {
		glue.command([
			"create",
			"module",
			"-f",
			xmlPath
		]);

		log(
			"Created module " +
			moduleName +
			" from " +
			xmlPath
		);

		return {
			created: true,
			dryRun: false,
			missingXml: false
		};

	} catch(error) {
		if(isMissingFileError(error)) {
			log(
				"Skipping " +
				moduleName +
				": selector XML does not exist: " +
				xmlPath
			);

			return {
				created: false,
				dryRun: false,
				missingXml: true
			};
		}

		throw error;
	}
}


// -----------------------------------------------------------------------------
// Load target alignments
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
// Construct expected selector definitions
// -----------------------------------------------------------------------------

var selectorDefinitions = [];

var seenModuleNames = {};

var lineageAlignmentCount = 0;
var sublineageAlignmentCount = 0;

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

	_.each(FEATURES, function(featureName) {
		var moduleName =
			selectorModuleName(
				alignmentInfo.standardStem,
				featureName
			);

		var xmlPath =
			selectorXmlPath(
				alignmentInfo.standardStem,
				featureName
			);

		if(seenModuleNames[moduleName]) {
			throw new Error(
				"Duplicate expected selector module name: " +
				moduleName
			);
		}

		seenModuleNames[moduleName] = true;

		selectorDefinitions.push({
			alignmentName: alignmentName,
			referenceName: referenceName,
			entityLevel: alignmentInfo.entityLevel,
			standardStem: alignmentInfo.standardStem,
			featureName: featureName,
			moduleName: moduleName,
			xmlPath: xmlPath
		});
	});
});

log(
	"Constructed " +
	selectorDefinitions.length +
	" expected selector definition(s)"
);


// -----------------------------------------------------------------------------
// Phase 1: delete existing standard-ID selector modules
// -----------------------------------------------------------------------------

log(
	"Deleting existing standard-ID selector modules"
);

var deletedCount = 0;

_.each(selectorDefinitions, function(definition) {
	if(deleteModuleIfPresent(definition.moduleName)) {
		deletedCount++;
	}
});


// -----------------------------------------------------------------------------
// Phase 2: create modules for available selector XML files
// -----------------------------------------------------------------------------

log(
	"Creating selector modules from available XML configurations"
);

var createdCount = 0;
var missingXmlCount = 0;
var dryRunCount = 0;

var featureCreatedCounts = {
	gag: 0,
	pol: 0,
	env: 0
};

var featureMissingCounts = {
	gag: 0,
	pol: 0,
	env: 0
};

var missingXmlDefinitions = [];

_.each(selectorDefinitions, function(definition) {
	var result =
		createModuleFromXml(
			definition.moduleName,
			definition.xmlPath
		);

	if(result.created) {
		createdCount++;
		featureCreatedCounts[
			definition.featureName
		]++;
	}

	if(result.dryRun) {
		dryRunCount++;
	}

	if(result.missingXml) {
		missingXmlCount++;
		featureMissingCounts[
			definition.featureName
		]++;

		missingXmlDefinitions.push(
			definition
		);
	}
});


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log("============================================================");
log("Phylogeny selector module summary");
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
	"Expected selector combinations: " +
	selectorDefinitions.length
);

log(
	"Existing selector modules deleted: " +
	deletedCount
);

if(DRY_RUN) {
	log(
		"Selector modules that would be created: " +
		dryRunCount
	);
} else {
	log(
		"Selector modules created: " +
		createdCount
	);
}

log(
	"Missing selector XML files: " +
	missingXmlCount
);

log("------------------------------------------------------------");
log("Selector availability by feature");
log("------------------------------------------------------------");

_.each(FEATURES, function(featureName) {
	log(
		featureName +
		": " +
		featureCreatedCounts[featureName] +
		" created; " +
		featureMissingCounts[featureName] +
		" unavailable"
	);
});


// -----------------------------------------------------------------------------
// Detailed missing-selector report
// -----------------------------------------------------------------------------

if(missingXmlDefinitions.length > 0) {
	log("------------------------------------------------------------");
	log("Unavailable selector XML configurations");
	log("------------------------------------------------------------");

	_.each(missingXmlDefinitions, function(definition) {
		log(
			"  " +
			definition.alignmentName +
			" [" +
			definition.featureName +
			"]: " +
			definition.xmlPath +
			(
				definition.referenceName !== null &&
				definition.referenceName !== undefined
					? " (reference " +
						definition.referenceName +
						")"
					: ""
			)
		);
	});
}

log("============================================================");

if(DRY_RUN) {
	log(
		"Dry run complete; no selector modules were changed"
	);
} else {
	log(
		"Finished recreating phylogeny selector modules"
	);
}

