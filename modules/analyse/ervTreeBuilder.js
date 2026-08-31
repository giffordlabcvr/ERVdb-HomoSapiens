// glue/analyse/ervTreeBuilder.js
//
// Build nucleotide phylogenies for individual human ERV lineage alignments.
//
// Intended for use via the ervTreeBuilder ECMA function invoker module.
//
// Two reconstruction modes are supported:
//
//   1. Selector-only reconstruction
//
//      A curated nucleotide selector module determines the alignment region.
//      All members of the lineage alignment are eligible for inclusion.
//
//   2. Feature-coverage reconstruction
//
//      A curated nucleotide selector module determines the alignment region,
//      while an additional where-clause restricts members according to
//      coverage of a specified feature.
//
// Example underlying GLUE commands:
//
//   generate nucleotide phylogeny AL_LINEAGE_HERVFc \
//       -s ervSelectorHervFcGagNucs \
//       -o trees/lineage/hervFcGagNucs.tree \
//       NEWICK_BOOTSTRAPS
//
//   generate nucleotide phylogeny AL_LINEAGE_HERVFc \
//       -s ervSelectorHervFcGagNucs \
//       -w "fLocNotes.featureLoc.feature.name = 'gag' and fLocNotes.ref_nt_coverage_pct >= 65" \
//       -o trees/lineage/hervFcGagNucs.tree \
//       NEWICK_BOOTSTRAPS
//
// Selector modules are curated separately and are NOT created, deleted or
// modified by this script.
//
// Existing trees are skipped, allowing interrupted or partial reconstruction
// runs to be resumed without repeating expensive analyses.
//
// Assumes execution from within the ervdb project mode.


var DRY_RUN = false;

var SKIP_EXISTING_TREES = true;


// -----------------------------------------------------------------------------
// Analysis settings
// -----------------------------------------------------------------------------

var MIN_TREE_MEMBERS =
	4;

var PHYLOGENY_GENERATOR_MODULE =
	"ervRaxmlPhylogenyGeneratorNucs";


// -----------------------------------------------------------------------------
// Java filesystem access
// -----------------------------------------------------------------------------

var File =
	Java.type("java.io.File");


// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------

function log(msg) {

	glue.log(
		"INFO",
		msg
	);
}


function escapeQuotes(value) {

	return ("" + value)
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'");
}


function queryObjects(cmdWords) {

	return glue.tableToObjects(
		glue.command(cmdWords)
	);
}


function runCmd(cmdWords) {

	if(DRY_RUN) {

		log(
			"[DRY RUN] " +
			cmdWords.join(" ")
		);

		return null;
	}

	return glue.command(
		cmdWords
	);
}


// -----------------------------------------------------------------------------
// Argument validation
// -----------------------------------------------------------------------------

function requireString(
	value,
	parameterName
) {

	if(
		value === null ||
		value === undefined
	) {

		throw new Error(
			parameterName +
			" must be supplied"
		);
	}


	var stringValue =
		("" + value).trim();


	if(stringValue === "") {

		throw new Error(
			parameterName +
			" must not be empty"
		);
	}


	return stringValue;
}


function validateCoveragePct(
	minCoveragePct
) {

	if(
		minCoveragePct === null ||
		minCoveragePct === undefined ||
		("" + minCoveragePct).trim() === ""
	) {

		throw new Error(
			"minCoveragePct must be supplied"
		);
	}


	var parsed =
		parseFloat(
			minCoveragePct
		);


	if(isNaN(parsed)) {

		throw new Error(
			"minCoveragePct must be numeric: " +
			minCoveragePct
		);
	}


	if(
		parsed < 0 ||
		parsed > 100
	) {

		throw new Error(
			"minCoveragePct must be between 0 and 100: " +
			parsed
		);
	}


	return parsed;
}


// -----------------------------------------------------------------------------
// Filesystem helpers
// -----------------------------------------------------------------------------

function fileExists(
	filePath
) {

	var file =
		new File(
			filePath
		);

	return (
		file.exists() &&
		file.isFile()
	);
}


// -----------------------------------------------------------------------------
// GLUE object checks
// -----------------------------------------------------------------------------

function alignmentExists(
	alignmentName
) {

	var rows =
		queryObjects([
			"list",
			"alignment",
			"-w",
			"name = '" +
				escapeQuotes(alignmentName) +
				"'"
		]);

	return rows.length > 0;
}


// list module does not accept explicit column names.
// Its default result already includes module name and type.

function moduleExists(
	moduleName
) {

	var rows =
		queryObjects([
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
// Count all members of an alignment
//
// Equivalent GLUE command:
//
//   alignment <alignmentName> list member
// -----------------------------------------------------------------------------

function countAlignmentMembers(
	alignmentName
) {

	var rows = [];

	glue.inMode(
		"/alignment/" +
			alignmentName,
		function() {

			rows =
				queryObjects([
					"list",
					"member"
				]);
		}
	);

	return rows.length;
}


// -----------------------------------------------------------------------------
// Construct a feature-coverage where-clause
//
// Example:
//
//   featureName      = gag
//   minCoveragePct   = 65
//
// produces:
//
//   fLocNotes.featureLoc.feature.name = 'gag' and
//   fLocNotes.ref_nt_coverage_pct >= 65
// -----------------------------------------------------------------------------

function buildCoverageWhereClause(
	featureName,
	minCoveragePct
) {

	return (
		"fLocNotes.featureLoc.feature.name = '" +
		escapeQuotes(featureName) +
		"' and " +
		"fLocNotes.ref_nt_coverage_pct >= " +
		minCoveragePct
	);
}


// -----------------------------------------------------------------------------
// Count alignment members satisfying a where-clause
// -----------------------------------------------------------------------------

function countEligibleMembers(
	alignmentName,
	whereClause
) {

	var rows = [];

	glue.inMode(
		"/alignment/" +
			alignmentName,
		function() {

			rows =
				queryObjects([
					"list",
					"member",
					"-w",
					whereClause
				]);
		}
	);

	return rows.length;
}


// -----------------------------------------------------------------------------
// Shared reconstruction-input validation
// -----------------------------------------------------------------------------

function validateCommonInputs(
	alignmentName,
	selectorModuleName,
	outputFile
) {

	alignmentName =
		requireString(
			alignmentName,
			"alignmentName"
		);

	selectorModuleName =
		requireString(
			selectorModuleName,
			"selectorModuleName"
		);

	outputFile =
		requireString(
			outputFile,
			"outputFile"
		);


	if(
		!moduleExists(
			PHYLOGENY_GENERATOR_MODULE
		)
	) {

		throw new Error(
			"Required phylogeny generator module does not exist: " +
			PHYLOGENY_GENERATOR_MODULE
		);
	}


	if(
		!alignmentExists(
			alignmentName
		)
	) {

		throw new Error(
			"Alignment does not exist: " +
			alignmentName
		);
	}


	if(
		!moduleExists(
			selectorModuleName
		)
	) {

		throw new Error(
			"Selector module does not exist: " +
			selectorModuleName
		);
	}


	return {
		alignmentName:
			alignmentName,

		selectorModuleName:
			selectorModuleName,

		outputFile:
			outputFile
	};
}


// -----------------------------------------------------------------------------
// Construct one-row table results
// -----------------------------------------------------------------------------

function buildResult(
	alignmentName,
	selectorModuleName,
	featureName,
	minCoveragePct,
	outputFile,
	status,
	reason,
	totalMemberCount,
	eligibleMemberCount
) {

	return [{
		alignmentName:
			alignmentName,

		selectorModuleName:
			selectorModuleName,

		featureName:
			featureName,

		minCoveragePct:
			minCoveragePct,

		outputFile:
			outputFile,

		status:
			status,

		reason:
			reason,

		totalMemberCount:
			totalMemberCount,

		eligibleMemberCount:
			eligibleMemberCount
	}];
}


// -----------------------------------------------------------------------------
// Reconstruct using selector only
//
// All members of the alignment are eligible for inclusion.
//
// Called via:
//
//   module ervTreeBuilder reconstructWithSelector \
//       <alignmentName> \
//       <selectorModuleName> \
//       <outputFile>
// -----------------------------------------------------------------------------

function reconstructWithSelector(
	alignmentName,
	selectorModuleName,
	outputFile
) {

	var inputs =
		validateCommonInputs(
			alignmentName,
			selectorModuleName,
			outputFile
		);


	alignmentName =
		inputs.alignmentName;

	selectorModuleName =
		inputs.selectorModuleName;

	outputFile =
		inputs.outputFile;


	log(
		"Processing " +
		alignmentName +
		" using selector " +
		selectorModuleName
	);


	// ---------------------------------------------------------------------
	// Existing tree
	// ---------------------------------------------------------------------

	if(
		SKIP_EXISTING_TREES &&
		fileExists(
			outputFile
		)
	) {

		log(
			"Skipping " +
			alignmentName +
			": tree already exists -> " +
			outputFile
		);


		return buildResult(
			alignmentName,
			selectorModuleName,
			null,
			null,
			outputFile,
			"skipped",
			"TREE_ALREADY_EXISTS",
			null,
			null
		);
	}


	// ---------------------------------------------------------------------
	// Alignment membership
	// ---------------------------------------------------------------------

	var totalMemberCount =
		countAlignmentMembers(
			alignmentName
		);


	if(
		totalMemberCount <
			MIN_TREE_MEMBERS
	) {

		log(
			"Skipping " +
			alignmentName +
			": only " +
			totalMemberCount +
			" total alignment member(s); " +
			MIN_TREE_MEMBERS +
			" are required"
		);


		return buildResult(
			alignmentName,
			selectorModuleName,
			null,
			null,
			outputFile,
			"skipped",
			"INSUFFICIENT_MEMBERS",
			totalMemberCount,
			totalMemberCount
		);
	}


	// ---------------------------------------------------------------------
	// Generate phylogeny
	// ---------------------------------------------------------------------

	log(
		"Generating nucleotide phylogeny for " +
		alignmentName +
		" using " +
		selectorModuleName +
		" with " +
		totalMemberCount +
		" alignment member(s)"
	);


	glue.inMode(
		"/module/" +
			PHYLOGENY_GENERATOR_MODULE,
		function() {

			runCmd([
				"generate",
				"nucleotide",
				"phylogeny",
				alignmentName,
				"-s",
				selectorModuleName,
				"-o",
				outputFile,
				"NEWICK_BOOTSTRAPS"
			]);
		}
	);


	log(
		"Generated " +
		outputFile
	);


	return buildResult(
		alignmentName,
		selectorModuleName,
		null,
		null,
		outputFile,
		"generated",
		null,
		totalMemberCount,
		totalMemberCount
	);
}


// -----------------------------------------------------------------------------
// Reconstruct using selector plus feature-coverage filtering
//
// The selector module determines the nucleotide region used for tree
// reconstruction. Alignment members are additionally filtered according to
// coverage of the specified feature.
//
// Called via:
//
//   module ervTreeBuilder reconstructWithCoverage \
//       <alignmentName> \
//       <selectorModuleName> \
//       <featureName> \
//       <minCoveragePct> \
//       <outputFile>
//
// Example underlying command:
//
//   generate nucleotide phylogeny AL_LINEAGE_HERVFc \
//       -s ervSelectorHervFcGagNucs \
//       -w "fLocNotes.featureLoc.feature.name = 'gag' and fLocNotes.ref_nt_coverage_pct >= 65" \
//       -o trees/lineage/hervFcGagNucs.tree \
//       NEWICK_BOOTSTRAPS
// -----------------------------------------------------------------------------

function reconstructWithCoverage(
	alignmentName,
	selectorModuleName,
	featureName,
	minCoveragePct,
	outputFile
) {

	var inputs =
		validateCommonInputs(
			alignmentName,
			selectorModuleName,
			outputFile
		);


	alignmentName =
		inputs.alignmentName;

	selectorModuleName =
		inputs.selectorModuleName;

	outputFile =
		inputs.outputFile;


	featureName =
		requireString(
			featureName,
			"featureName"
		);


	minCoveragePct =
		validateCoveragePct(
			minCoveragePct
		);


	log(
		"Processing " +
		alignmentName +
		" using selector " +
		selectorModuleName +
		", feature=" +
		featureName +
		", minCoveragePct=" +
		minCoveragePct
	);


	// ---------------------------------------------------------------------
	// Existing tree
	// ---------------------------------------------------------------------

	if(
		SKIP_EXISTING_TREES &&
		fileExists(
			outputFile
		)
	) {

		log(
			"Skipping " +
			alignmentName +
			": tree already exists -> " +
			outputFile
		);


		return buildResult(
			alignmentName,
			selectorModuleName,
			featureName,
			minCoveragePct,
			outputFile,
			"skipped",
			"TREE_ALREADY_EXISTS",
			null,
			null
		);
	}


	// ---------------------------------------------------------------------
	// Total alignment membership
	// ---------------------------------------------------------------------

	var totalMemberCount =
		countAlignmentMembers(
			alignmentName
		);


	if(
		totalMemberCount <
			MIN_TREE_MEMBERS
	) {

		log(
			"Skipping " +
			alignmentName +
			": only " +
			totalMemberCount +
			" total alignment member(s); " +
			MIN_TREE_MEMBERS +
			" are required"
		);


		return buildResult(
			alignmentName,
			selectorModuleName,
			featureName,
			minCoveragePct,
			outputFile,
			"skipped",
			"INSUFFICIENT_MEMBERS",
			totalMemberCount,
			null
		);
	}


	// ---------------------------------------------------------------------
	// Feature coverage
	// ---------------------------------------------------------------------

	var whereClause =
		buildCoverageWhereClause(
			featureName,
			minCoveragePct
		);


	var eligibleMemberCount =
		countEligibleMembers(
			alignmentName,
			whereClause
		);


	if(
		eligibleMemberCount <
			MIN_TREE_MEMBERS
	) {

		log(
			"Skipping " +
			alignmentName +
			": " +
			totalMemberCount +
			" total member(s), but only " +
			eligibleMemberCount +
			" pass the " +
			featureName +
			" coverage >= " +
			minCoveragePct +
			"% filter; " +
			MIN_TREE_MEMBERS +
			" eligible members are required"
		);


		return buildResult(
			alignmentName,
			selectorModuleName,
			featureName,
			minCoveragePct,
			outputFile,
			"skipped",
			"INSUFFICIENT_ELIGIBLE_MEMBERS",
			totalMemberCount,
			eligibleMemberCount
		);
	}


	// ---------------------------------------------------------------------
	// Generate phylogeny
	// ---------------------------------------------------------------------

	log(
		"Generating " +
		featureName +
		" nucleotide phylogeny for " +
		alignmentName +
		" using " +
		selectorModuleName +
		": " +
		eligibleMemberCount +
		" of " +
		totalMemberCount +
		" member(s) pass the coverage >= " +
		minCoveragePct +
		"% filter"
	);


	glue.inMode(
		"/module/" +
			PHYLOGENY_GENERATOR_MODULE,
		function() {

			runCmd([
				"generate",
				"nucleotide",
				"phylogeny",
				alignmentName,
				"-s",
				selectorModuleName,
				"-w",
				whereClause,
				"-o",
				outputFile,
				"NEWICK_BOOTSTRAPS"
			]);
		}
	);


	log(
		"Generated " +
		outputFile
	);


	return buildResult(
		alignmentName,
		selectorModuleName,
		featureName,
		minCoveragePct,
		outputFile,
		"generated",
		null,
		totalMemberCount,
		eligibleMemberCount
	);
}


