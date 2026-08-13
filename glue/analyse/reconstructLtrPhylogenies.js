// glue/analyse/reconstructLtrPhylogenies.js
//
// Build nucleotide phylogenies for LTR alignments.
//
// Scope:
//
//   AL_LTR_* alignments
//
// No nucleotide selector module is used. The complete LTR alignment is
// supplied to the phylogeny generator.
//
// Alignment members are qualified using feature coverage against the
// whole_genome feature of the LTR reference:
//
//   fLocNotes.featureLoc.feature.name = 'whole_genome'
//   and
//   fLocNotes.ref_nt_coverage_pct >= 70
//
// Naming convention:
//
//   Alignment:
//       AL_LTR_HERV1LTR
//
//   Output tree:
//       trees/ltr/HERV1LTR_nucs.tree
//
// Workflow:
//
//   1. Discover AL_LTR_* alignments.
//   2. Skip the alignment if its output tree already exists.
//   3. Count members passing the whole_genome coverage threshold.
//   4. Require at least four qualifying members.
//   5. Generate a bootstrap-labelled nucleotide tree using the complete
//      alignment.
//
// Existing trees are skipped so interrupted or partial reconstruction runs
// can be resumed without repeating expensive RAxML analyses.
//
// Assumes:
//   - whole_genome feature locations have been defined on LTR references;
//   - whole_genome feature coverage has been calculated using
//     rvFeaturePresenceRecorder;
//   - ervRaxmlPhylogenyGeneratorNucs exists;
//   - execution occurs from within the ervdb project.


var DRY_RUN = false;

var SKIP_EXISTING_TREES = true;


// -----------------------------------------------------------------------------
// Analysis settings
// -----------------------------------------------------------------------------

var FEATURE_NAME =
	"whole_genome";

var MIN_COVERAGE_PCT =
	70;

var MIN_TREE_MEMBERS =
	4;

var PHYLOGENY_GENERATOR_MODULE =
	"ervRaxmlPhylogenyGeneratorNucs";

var TREE_DIR =
	"trees/ltr";


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
// Discover LTR alignments
//
// Equivalent GLUE command:
//
//   list alignment -w "name like 'AL_LTR_%'"
// -----------------------------------------------------------------------------

function getLtrAlignments() {

	return queryObjects([
		"list",
		"alignment",
		"-w",
		"name like 'AL_LTR_%'"
	]);
}


// -----------------------------------------------------------------------------
// Derive LTR alignment token
//
// Example:
//
//   AL_LTR_HERV1LTR
//
// becomes:
//
//   HERV1LTR
// -----------------------------------------------------------------------------

function getLtrName(
	alignmentName
) {

	var prefix =
		"AL_LTR_";

	if(alignmentName.indexOf(prefix) !== 0) {

		throw new Error(
			"Cannot derive LTR name from alignment: " +
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
// Derive output tree path
//
// Example:
//
//   AL_LTR_HERV1LTR
//
// becomes:
//
//   trees/ltr/HERV1LTR_nucs.tree
// -----------------------------------------------------------------------------

function getTreeFile(
	alignmentName
) {

	return (
		TREE_DIR +
		"/" +
		getLtrName(alignmentName) +
		"_nucs.tree"
	);
}


// -----------------------------------------------------------------------------
// Filesystem helper
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
// GLUE module check
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
// Count all alignment members
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
// Construct whole_genome feature-coverage filter
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
// Count alignment members passing the coverage filter
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
// Generate one LTR phylogeny
// -----------------------------------------------------------------------------

function generateLtrPhylogeny(
	alignmentRow
) {

	var alignmentName =
		alignmentRow.name;

	var ltrName =
		getLtrName(
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
		ltrName +
		")"
	);


	// ---------------------------------------------------------------------
	// Existing tree
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
	// Total membership
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
	// whole_genome feature coverage
	// ---------------------------------------------------------------------

	var whereClause =
		buildCoverageWhereClause();


	var eligibleMemberCount =
		countEligibleMembers(
			alignmentName,
			whereClause
		);


	if(eligibleMemberCount === 0) {

		log(
			"Skipping " +
			alignmentName +
			": no members pass the " +
			FEATURE_NAME +
			" coverage >= " +
			MIN_COVERAGE_PCT +
			"% filter; check that LTR feature coverage has been calculated"
		);

		return {
			status: "skipped",
			reason:
				"NO_COVERAGE_DATA"
		};
	}


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
	//
	// No selector is supplied: the complete LTR alignment is used.
	// The where-clause restricts membership to sequences with sufficient
	// whole_genome coverage.
	// ---------------------------------------------------------------------

	log(
		"Generating LTR nucleotide phylogeny for " +
		alignmentName +
		": " +
		eligibleMemberCount +
		" of " +
		totalMemberCount +
		" member(s) pass whole_genome coverage >= " +
		MIN_COVERAGE_PCT +
		"%"
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
	"Building LTR nucleotide phylogenies"
);


var ltrAlignments =
	getLtrAlignments();


log(
	"Discovered " +
	ltrAlignments.length +
	" LTR alignment(s)"
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

var existingTreeCount = 0;

var insufficientMembersCount = 0;

var insufficientEligibleMembersCount = 0;

var noCoverageDataCount = 0;


// -----------------------------------------------------------------------------
// Process discovered LTR alignments
// -----------------------------------------------------------------------------

_.each(
	ltrAlignments,
	function(alignmentRow) {

		var result =
			generateLtrPhylogeny(
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
				"NO_COVERAGE_DATA") {

			noCoverageDataCount++;
		}
	}
);


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log(
	"LTR PHYLOGENY SUMMARY"
);

log(
	"LTR alignments discovered: " +
	ltrAlignments.length
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
	" total members: " +
	insufficientMembersCount
);

log(
	"Alignments skipped with fewer than " +
	MIN_TREE_MEMBERS +
	" members passing whole_genome coverage >= " +
	MIN_COVERAGE_PCT +
	"%: " +
	insufficientEligibleMembersCount
);

log(
	"Alignments with zero members having qualifying coverage: " +
	noCoverageDataCount
);

log(
	"Finished building LTR nucleotide phylogenies."
);
