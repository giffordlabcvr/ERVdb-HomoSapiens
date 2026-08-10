// glue/analyse/reconstructLineageLevelPhylogenies.js
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
// HERV lineage alignments are discovered directly from the GLUE project.
// Selector modules are assumed to have been created separately by:
//
//   run file glue/analyse/createPhylogenyModules.glue
//
// Selector modules are highly curated and are therefore NOT created,
// deleted or modified by this script.
//
// Naming convention:
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
//   Output tree:
//       trees/lineage/HERVFRD_pol_nucs.tree
//
// Workflow:
//
//   1. Discover AL_LINEAGE_HERV* alignments.
//   2. Derive the expected selector module name.
//   3. Skip the lineage if no curated selector module is defined.
//   4. Skip the lineage if the output tree already exists.
//   5. Require at least four total alignment members.
//   6. Require at least four members passing the pol coverage filter.
//   7. Generate a bootstrap-labelled nucleotide tree with RAxML.
//
// Existing trees are skipped, allowing interrupted or partial phylogeny
// reconstruction runs to be resumed without repeating expensive analyses.
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

var TREE_DIR =
	"trees/lineage";


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
// Discover HERV lineage alignments
//
// Equivalent GLUE command:
//
//   list alignment -w "name like 'AL_LINEAGE_HERV%'"
//
// Restricting the query to AL_LINEAGE_HERV% excludes lineage alignments
// belonging to non-human ERVs.
// -----------------------------------------------------------------------------

function getHervLineageAlignments() {

	return queryObjects([
		"list",
		"alignment",
		"-w",
		"name like 'AL_LINEAGE_HERV%'"
	]);
}


// -----------------------------------------------------------------------------
// Derive canonical HERV name
//
// Example:
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
			alignmentName +
			". Expected alignment name beginning with " +
			prefix
		);
	}

	return alignmentName.substring(
		prefix.length
	);
}


// -----------------------------------------------------------------------------
// Derive selector module name
//
// Example:
//
//   AL_LINEAGE_HERVFRD
//
// becomes:
//
//   msaSelector_HERVFRD_pol_nucs
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


// -----------------------------------------------------------------------------
// Derive output tree path
//
// Example:
//
//   AL_LINEAGE_HERVFRD
//
// becomes:
//
//   trees/lineage/HERVFRD_pol_nucs.tree
// -----------------------------------------------------------------------------

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
//
// list module does not accept explicit column names.
// Its default result already includes module name and type.
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
// Construct the feature-coverage where-clause
//
// This is the same filter applied both when counting eligible members and
// when generating the phylogeny.
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
// Count alignment members passing the feature-coverage filter
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
// Generate one lineage phylogeny
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
	// Curated selector module
	//
	// Selector modules are instantiated separately by
	// createPhylogenyModules.glue.
	//
	// Absence of a selector therefore means that this lineage has not yet
	// been curated/enabled for this phylogenetic analysis.
	// ---------------------------------------------------------------------

	if(!moduleExists(
			selectorModule
		)) {

		log(
			"Skipping " +
			alignmentName +
			": selector module not defined -> " +
			selectorModule
		);

		return {
			status: "skipped",
			reason:
				"SELECTOR_NOT_DEFINED"
		};
	}


	// ---------------------------------------------------------------------
	// Existing tree
	//
	// Phylogeny reconstruction may be expensive. If the expected output
	// tree already exists, regard this lineage as completed.
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
			reason:
				"TREE_ALREADY_EXISTS"
		};
	}


	// ---------------------------------------------------------------------
	// Total alignment membership
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
	// Feature coverage
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
	// Generate phylogeny
	// ---------------------------------------------------------------------

	log(
		"Generating " +
		FEATURE_NAME +
		" nucleotide phylogeny for " +
		alignmentName +
		" using " +
		selectorModule +
		": " +
		eligibleMemberCount +
		" of " +
		totalMemberCount +
		" member(s) pass the coverage filter"
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
	"Building HERV lineage " +
	FEATURE_NAME +
	" nucleotide phylogenies"
);


var lineageAlignments =
	getHervLineageAlignments();


log(
	"Discovered " +
	lineageAlignments.length +
	" HERV lineage alignment(s)"
);


if(SKIP_EXISTING_TREES) {

	log(
		"Existing output trees will be skipped"
	);
}
else {

	log(
		"Existing output trees will be rebuilt"
	);
}


// -----------------------------------------------------------------------------
// Summary counters
// -----------------------------------------------------------------------------

var generatedCount = 0;

var selectorNotDefinedCount = 0;

var existingTreeCount = 0;

var insufficientMembersCount = 0;

var insufficientEligibleMembersCount = 0;


// -----------------------------------------------------------------------------
// Process discovered HERV lineage alignments
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
				"SELECTOR_NOT_DEFINED") {

			selectorNotDefinedCount++;
		}
		else if(result.reason ===
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
	"Lineages without a curated selector module: " +
	selectorNotDefinedCount
);

log(
	"Existing phylogenies skipped: " +
	existingTreeCount
);

log(
	"Alignments skipped with fewer than " +
	MIN_TREE_MEMBERS +
	" total members: " +
	insufficientMembersCount
);

log(
	"Alignments skipped with fewer than " +
	MIN_TREE_MEMBERS +
	" members passing the " +
	FEATURE_NAME +
	" coverage >= " +
	MIN_COVERAGE_PCT +
	"% filter: " +
	insufficientEligibleMembersCount
);

log(
	"Finished building HERV lineage nucleotide phylogenies."
);