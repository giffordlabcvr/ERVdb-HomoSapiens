// glue/analyse/buildHervLineagePhylogeniesNucs.js
//
// Build nucleotide phylogenies for human ERV lineage alignments.
//
// Current scope:
//
//   - HERV lineage alignments only:
//         AL_LINEAGE_HERV*
//
//   - pol nucleotide phylogenies only.
//
// HERV lineage alignments are discovered directly from the GLUE project,
// rather than being specified in a configuration block.
//
// Naming conventions:
//
//   Alignment:
//       AL_LINEAGE_HERVFRD
//
//   HERV name:
//       HERVFRD
//
//   Selector module:
//       msaSelector_HERVFRD_pol_nucs
//
//   Selector XML:
//       modules/analyse/msa_masking/nucs/
//           msaSelector_HERVFRD_pol_nucs.xml
//
//   Output tree:
//       trees/lineage/HERVFRD_pol_nucs.tree
//
// Workflow:
//
//   1. Discover AL_LINEAGE_HERV* alignments.
//   2. Derive the selector and output tree names.
//   3. Skip the lineage if the output tree already exists.
//   4. Require at least four total alignment members.
//   5. Recreate the selector module from its XML definition.
//   6. Require at least four members passing the pol coverage filter.
//   7. Generate a bootstrap-labelled nucleotide tree with RAxML.
//
// Because existing trees are skipped, the script can safely be rerun after
// partial or interrupted phylogeny-building runs.
//
// Assumes execution from within the ervdb project mode.


var DRY_RUN = false;

var SKIP_EXISTING_TREES = true;


// -----------------------------------------------------------------------------
// Analysis settings
// -----------------------------------------------------------------------------

var FEATURE_NAME =
	"pol";

var MIN_COVERAGE_PCT =
	55;

var MIN_TREE_MEMBERS =
	4;

var PHYLOGENY_GENERATOR_MODULE =
	"ervRaxmlPhylogenyGeneratorNucs";

var SELECTOR_DIR =
	"modules/analyse/msa_masking/nucs";

var TREE_DIR =
	"trees/lineage";


// Java filesystem access.
//
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
// Discover HERV lineage alignments
//
// Equivalent console command:
//
//   list alignment name refSequence.name
//       -w "name like 'AL_LINEAGE_HERV%'"
//       -s name
//
// Restricting this to AL_LINEAGE_HERV% prevents other non-human lineage
// alignments such as AL_LINEAGE_CeratotheriumRb from entering this workflow.
// -----------------------------------------------------------------------------

function getHervLineageAlignments() {

	return queryObjects([
		"list",
		"alignment",
		"name",
		"refSequence.name",
		"-w",
		"name like 'AL_LINEAGE_HERV%'",
		"-s",
		"name"
	]);
}


// -----------------------------------------------------------------------------
// Derive canonical HERV name
//
//   AL_LINEAGE_HERVFRD
//
// becomes:
//
//   HERVFRD
// -----------------------------------------------------------------------------

function getHervName(alignmentName) {

	var prefix =
		"AL_LINEAGE_";

	if(alignmentName.indexOf(prefix) !== 0) {

		throw new Error(
			"Cannot derive HERV name from alignment: " +
			alignmentName
		);
	}

	return alignmentName.substring(
		prefix.length
	);
}


// -----------------------------------------------------------------------------
// Derived names and paths
// -----------------------------------------------------------------------------

function getSelectorModuleName(
	alignmentName
) {

	return (
		"msaSelector_" +
		getHervName(alignmentName) +
		"_" +
		FEATURE_NAME +
		"_nucs"
	);
}


function getSelectorFile(
	alignmentName
) {

	return (
		SELECTOR_DIR +
		"/" +
		getSelectorModuleName(
			alignmentName
		) +
		".xml"
	);
}


function getTreeFile(
	alignmentName
) {

	return (
		TREE_DIR +
		"/" +
		getHervName(alignmentName) +
		"_" +
		FEATURE_NAME +
		"_nucs.tree"
	);
}


// -----------------------------------------------------------------------------
// Filesystem helpers
// -----------------------------------------------------------------------------

function fileExists(filePath) {

	var file =
		new File(filePath);

	return (
		file.exists() &&
		file.isFile()
	);
}


// -----------------------------------------------------------------------------
// GLUE object checks
// -----------------------------------------------------------------------------

function moduleExists(moduleName) {

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
// Build feature-coverage where-clause
// -----------------------------------------------------------------------------

function buildCoverageWhereClause() {

	return (
		"fLocNotes.featureLoc.feature.name = '" +
		escapeQuotes(FEATURE_NAME) +
		"' and " +
		"fLocNotes.ref_nt_coverage_pct >= " +
		MIN_COVERAGE_PCT
	);
}


// -----------------------------------------------------------------------------
// Count members passing the coverage filter
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
// Recreate selector module
// -----------------------------------------------------------------------------

function recreateSelectorModule(
	alignmentName
) {

	var selectorModule =
		getSelectorModuleName(
			alignmentName
		);

	var selectorFile =
		getSelectorFile(
			alignmentName
		);


	if(moduleExists(selectorModule)) {

		runCmd([
			"delete",
			"module",
			selectorModule
		]);
	}


	runCmd([
		"create",
		"module",
		"-f",
		selectorFile
	]);


	log(
		"Recreated selector module " +
		selectorModule +
		" from " +
		selectorFile
	);
}


// -----------------------------------------------------------------------------
// Process one HERV lineage alignment
// -----------------------------------------------------------------------------

function generateLineagePhylogeny(
	alignmentRow
) {

	var alignmentName =
		alignmentRow.name;

	var hervName =
		getHervName(
			alignmentName
		);

	var selectorModule =
		getSelectorModuleName(
			alignmentName
		);

	var selectorFile =
		getSelectorFile(
			alignmentName
		);

	var outputFile =
		getTreeFile(
			alignmentName
		);


	log(
		"Processing " +
		alignmentName +
		" (" +
		hervName +
		")"
	);


	// ---------------------------------------------------------------------
	// Skip completed analyses immediately.
	// ---------------------------------------------------------------------

	if(
		SKIP_EXISTING_TREES &&
		fileExists(outputFile)
	) {

		log(
			"Skipping " +
			alignmentName +
			": tree already exists -> " +
			outputFile
		);

		return {
			status: "skipped",
			reason: "TREE_ALREADY_EXISTS"
		};
	}


	// ---------------------------------------------------------------------
	// Require sufficient total alignment membership.
	// ---------------------------------------------------------------------

	var totalMemberCount =
		countAlignmentMembers(
			alignmentName
		);


	if(totalMemberCount <
			MIN_TREE_MEMBERS) {

		log(
			"Skipping " +
			alignmentName +
			": only " +
			totalMemberCount +
			" total alignment member(s); " +
			MIN_TREE_MEMBERS +
			" are required"
		);

		return {
			status: "skipped",
			reason:
				"INSUFFICIENT_MEMBERS"
		};
	}


	// ---------------------------------------------------------------------
	// The selector is curated manually and represented by its XML file.
	//
	// Do not attempt to infer the selected region here. The script simply
	// consumes the corresponding curated selector definition.
	// ---------------------------------------------------------------------

	if(!fileExists(selectorFile)) {

		log(
			"Skipping " +
			alignmentName +
			": selector XML does not exist -> " +
			selectorFile
		);

		return {
			status: "skipped",
			reason:
				"SELECTOR_FILE_NOT_FOUND"
		};
	}


	recreateSelectorModule(
		alignmentName
	);


	if(
		!DRY_RUN &&
		!moduleExists(selectorModule)
	) {

		log(
			"Skipping " +
			alignmentName +
			": selector module unavailable after recreation -> " +
			selectorModule
		);

		return {
			status: "skipped",
			reason:
				"SELECTOR_MODULE_NOT_FOUND"
		};
	}


	// ---------------------------------------------------------------------
	// Apply the pol coverage filter.
	// ---------------------------------------------------------------------

	var whereClause =
		buildCoverageWhereClause();


	var eligibleMemberCount =
		countEligibleMembers(
			alignmentName,
			whereClause
		);


	if(eligibleMemberCount <
			MIN_TREE_MEMBERS) {

		log(
			"Skipping " +
			alignmentName +
			": " +
			totalMemberCount +
			" total member(s), but only " +
			eligibleMemberCount +
			" pass the " +
			FEATURE_NAME +
			" coverage >= " +
			MIN_COVERAGE_PCT +
			"% filter; " +
			MIN_TREE_MEMBERS +
			" eligible members are required"
		);

		return {
			status: "skipped",
			reason:
				"INSUFFICIENT_ELIGIBLE_MEMBERS"
		};
	}


	// ---------------------------------------------------------------------
	// Generate nucleotide phylogeny.
	// ---------------------------------------------------------------------

	log(
		"Generating " +
		FEATURE_NAME +
		" nucleotide phylogeny for " +
		alignmentName +
		": " +
		eligibleMemberCount +
		" of " +
		totalMemberCount +
		" member(s) eligible"
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
				selectorModule,
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


	return {
		status: "generated",
		totalMemberCount:
			totalMemberCount,
		eligibleMemberCount:
			eligibleMemberCount
	};
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

if(!moduleExists(
		PHYLOGENY_GENERATOR_MODULE
	)) {

	throw new Error(
		"Required phylogeny generator module does not exist: " +
		PHYLOGENY_GENERATOR_MODULE
	);
}


log(
	"Discovering HERV lineage alignments"
);


var lineageAlignments =
	getHervLineageAlignments();


log(
	"Found " +
	lineageAlignments.length +
	" HERV lineage alignment(s)"
);


if(SKIP_EXISTING_TREES) {

	log(
		"Existing trees will be skipped"
	);
}


// -----------------------------------------------------------------------------
// Summary counters
// -----------------------------------------------------------------------------

var generatedCount = 0;

var existingTreeCount = 0;

var insufficientMembersCount = 0;

var insufficientEligibleMembersCount = 0;

var selectorFileNotFoundCount = 0;

var selectorModuleNotFoundCount = 0;


// -----------------------------------------------------------------------------
// Process discovered lineages
// -----------------------------------------------------------------------------

_.each(
	lineageAlignments,
	function(alignmentRow) {

		var result =
			generateLineagePhylogeny(
				alignmentRow
			);


		if(result.status ===
				"generated") {

			generatedCount++;
			return;
		}


		if(result.reason ===
				"TREE_ALREADY_EXISTS") {

			existingTreeCount++;
		}
		else if(result.reason ===
				"INSUFFICIENT_MEMBERS") {

			insufficientMembersCount++;
		}
		else if(result.reason ===
				"INSUFFICIENT_ELIGIBLE_MEMBERS") {

			insufficientEligibleMembersCount++;
		}
		else if(result.reason ===
				"SELECTOR_FILE_NOT_FOUND") {

			selectorFileNotFoundCount++;
		}
		else if(result.reason ===
				"SELECTOR_MODULE_NOT_FOUND") {

			selectorModuleNotFoundCount++;
		}
	}
);


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log(
	"LINEAGE PHYLOGENY SUMMARY"
);

log(
	"HERV lineage alignments discovered: " +
	lineageAlignments.length
);

log(
	"Phylogenies generated: " +
	generatedCount
);

log(
	"Existing phylogenies skipped: " +
	existingTreeCount
);

log(
	"Alignments skipped with fewer than " +
	MIN_TREE_MEMBERS +
	" members: " +
	insufficientMembersCount
);

log(
	"Alignments skipped with fewer than " +
	MIN_TREE_MEMBERS +
	" members passing the coverage filter: " +
	insufficientEligibleMembersCount
);

log(
	"Alignments without a selector XML: " +
	selectorFileNotFoundCount
);

log(
	"Selector modules unavailable after recreation: " +
	selectorModuleNotFoundCount
);

log(
	"Finished building HERV lineage nucleotide phylogenies."
);