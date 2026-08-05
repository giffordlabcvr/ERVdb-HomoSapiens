// glue/analyse/buildHervLineagePhylogeniesNucs.js
//
// Recreate nucleotide masking selector modules and generate phylogenies for
// configured human ERV lineage alignments.
//
// This replaces:
//
//   run file glue/analyse/createPhylogenyModules.glue
//   run file glue/analyse/ervComputeLineagePhylogeniesNucs.glue
//
// Scope:
//
//   AL_LINEAGE_* alignments only.
//
// LTR phylogenies are deliberately excluded for now because their masking,
// sequence-selection and tree-building strategy may differ.
//
// General rules:
//
//   - recreate each configured masking selector module from XML;
//   - only process alignments that exist;
//   - require at least four total alignment members;
//   - require at least four members passing the configured feature-coverage
//     filter;
//   - use ervRaxmlPhylogenyGeneratorNucs;
//   - apply the configured selector module and coverage where-clause;
//   - write bootstrap-labelled Newick trees under trees/lineage/.
//
// Assumes this script is run from within the ervdb project mode.


var DRY_RUN = false;

var PHYLOGENY_GENERATOR_MODULE =
	"ervRaxmlPhylogenyGeneratorNucs";

var MIN_TREE_MEMBERS = 4;


// -----------------------------------------------------------------------------
// Explicit lineage phylogeny configuration
// -----------------------------------------------------------------------------

var lineagePhylogenyConfigs = [

	// ---------------------------------------------------------------------
	// Clade I
	// ---------------------------------------------------------------------

	{
		alignmentName: "AL_LINEAGE_HERVT",
		selectorModule: "ervSelectorHervtPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervtPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervTPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVE",
		selectorModule: "ervSelectorHervePolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervePolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervEPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVR",
		selectorModule: "ervSelectorHervrPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervrPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervRPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVRb",
		selectorModule: "ervSelectorHervRbPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervRbPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervRbPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVI",
		selectorModule: "ervSelectorHerviPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHerviPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervIPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVH",
		selectorModule: "ervSelectorHervhPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervhPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervHPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVFa",
		selectorModule: "ervSelectorHervFaPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervFaPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervFaPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVFb",
		selectorModule: "ervSelectorHervFbPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervFbPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervFbPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVFc",
		selectorModule: "ervSelectorHervFcPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervFcPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervFcPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVW",
		selectorModule: "ervSelectorHervWPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervWPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervWPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERV9",
		selectorModule: "ervSelectorHerv9PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHerv9PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/herv9PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVLb",
		selectorModule: "ervSelectorHervLbPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_I/nucs/" +
			"ervSelectorHervLbPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervLbPolNucs.tree"
	},


	// ---------------------------------------------------------------------
	// Clade II: betaretroviruses
	// ---------------------------------------------------------------------

	{
		alignmentName: "AL_LINEAGE_HERVKHML1",
		selectorModule: "ervSelectorHervkhml1PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml1PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml1PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVKHML2",
		selectorModule: "ervSelectorHervkhml2PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml2PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml2PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVKHML3",
		selectorModule: "ervSelectorHervkhml3PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml3PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml3PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVKHML4",
		selectorModule: "ervSelectorHervkhml4PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml4PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml4PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVKHML7",
		selectorModule: "ervSelectorHervkhml7PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml7PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml7PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVKHML8",
		selectorModule: "ervSelectorHervkhml8PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml8PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml8PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVKHML9",
		selectorModule: "ervSelectorHervkhml9PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml9PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml9PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVKHML10",
		selectorModule: "ervSelectorHervkhml10PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml10PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml10PolNucs.tree"
	},


	// ---------------------------------------------------------------------
	// Clade II: archaeobetaretroviruses
	// ---------------------------------------------------------------------

	{
		alignmentName: "AL_LINEAGE_HERVKHML5",
		selectorModule: "ervSelectorHervkhml5PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml5PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml5PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVKHML6",
		selectorModule: "ervSelectorHervkhml6PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_II/nucs/" +
			"ervSelectorHervkhml6PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervKhml6PolNucs.tree"
	},


	// ---------------------------------------------------------------------
	// Clade III
	// ---------------------------------------------------------------------

	{
		alignmentName: "AL_LINEAGE_HERVS",
		selectorModule: "ervSelectorHervSPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_III/nucs/" +
			"ervSelectorHervSPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervSPolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVU3",
		selectorModule: "ervSelectorHervU3PolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_III/nucs/" +
			"ervSelectorHervU3PolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervU3PolNucs.tree"
	},

	{
		alignmentName: "AL_LINEAGE_HERVL",
		selectorModule: "ervSelectorHervLPolNucs",
		selectorFile:
			"modules/analyse/msa_masking/clade_III/nucs/" +
			"ervSelectorHervLPolNucs.xml",
		featureName: "pol",
		minCoveragePct: 55,
		outputFile:
			"trees/lineage/hervLPolNucs.tree"
	}
];


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function log(msg) {
	glue.log("INFO", msg);
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

	return glue.command(cmdWords);
}


// -----------------------------------------------------------------------------
// Module and alignment checks
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


function alignmentExists(alignmentName) {

	var rows = queryObjects([
		"list",
		"alignment",
		"name",
		"-w",
		"name = '" +
			escapeQuotes(alignmentName) +
			"'"
	]);

	return rows.length > 0;
}


// -----------------------------------------------------------------------------
// Count all members in one alignment
//
// Equivalent console syntax:
//
//   alignment <alignmentName> list member
// -----------------------------------------------------------------------------

function countAlignmentMembers(alignmentName) {

	var rows = [];

	glue.inMode(
		"/alignment/" + alignmentName,
		function() {

			rows = queryObjects([
				"list",
				"member"
			]);
		}
	);

	return rows.length;
}


// -----------------------------------------------------------------------------
// Recreate one masking selector module
// -----------------------------------------------------------------------------

function recreateSelectorModule(config) {

	if(moduleExists(config.selectorModule)) {

		runCmd([
			"delete",
			"module",
			config.selectorModule
		]);
	}

	runCmd([
		"create",
		"module",
		"-f",
		config.selectorFile
	]);

	log(
		"Recreated selector module " +
		config.selectorModule +
		" from " +
		config.selectorFile
	);
}


// -----------------------------------------------------------------------------
// Construct the feature-coverage where-clause
// -----------------------------------------------------------------------------

function buildCoverageWhereClause(config) {

	return (
		"fLocNotes.featureLoc.feature.name = '" +
		escapeQuotes(config.featureName) +
		"' and " +
		"fLocNotes.ref_nt_coverage_pct >= " +
		config.minCoveragePct
	);
}


// -----------------------------------------------------------------------------
// Count members passing the same coverage filter used for tree generation
// -----------------------------------------------------------------------------

function countEligibleMembers(
	config,
	whereClause
) {

	var rows = [];

	glue.inMode(
		"/alignment/" +
			config.alignmentName,
		function() {

			rows = queryObjects([
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

function generateLineagePhylogeny(config) {

	if(!alignmentExists(config.alignmentName)) {

		log(
			"Skipping " +
			config.alignmentName +
			": alignment does not exist"
		);

		return {
			status: "skipped",
			reason: "ALIGNMENT_NOT_FOUND"
		};
	}


	var totalMemberCount =
		countAlignmentMembers(
			config.alignmentName
		);

	if(totalMemberCount < MIN_TREE_MEMBERS) {

		log(
			"Skipping " +
			config.alignmentName +
			": only " +
			totalMemberCount +
			" total alignment member(s); " +
			MIN_TREE_MEMBERS +
			" are required"
		);

		return {
			status: "skipped",
			reason: "INSUFFICIENT_MEMBERS"
		};
	}


	if(!moduleExists(config.selectorModule)) {

		log(
			"Skipping " +
			config.alignmentName +
			": selector module does not exist -> " +
			config.selectorModule
		);

		return {
			status: "skipped",
			reason: "SELECTOR_NOT_FOUND"
		};
	}


	var whereClause =
		buildCoverageWhereClause(config);


	var eligibleMemberCount =
		countEligibleMembers(
			config,
			whereClause
		);

	if(eligibleMemberCount < MIN_TREE_MEMBERS) {

		log(
			"Skipping " +
			config.alignmentName +
			": " +
			totalMemberCount +
			" total member(s), but only " +
			eligibleMemberCount +
			" pass the " +
			config.featureName +
			" coverage >= " +
			config.minCoveragePct +
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


	log(
		"Generating phylogeny for " +
		config.alignmentName +
		" using " +
		config.selectorModule +
		": " +
		eligibleMemberCount +
		" of " +
		totalMemberCount +
		" member(s) pass the " +
		config.featureName +
		" coverage >= " +
		config.minCoveragePct +
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
				config.alignmentName,
				"-s",
				config.selectorModule,
				"-w",
				whereClause,
				"-o",
				config.outputFile,
				"NEWICK_BOOTSTRAPS"
			]);
		}
	);


	log(
		"Generated " +
		config.outputFile +
		" from " +
		config.alignmentName +
		" using " +
		config.selectorModule +
		" (" +
		config.featureName +
		" coverage >= " +
		config.minCoveragePct +
		"%)"
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
	"Recreating " +
	lineagePhylogenyConfigs.length +
	" lineage selector modules"
);

_.each(
	lineagePhylogenyConfigs,
	function(config) {

		recreateSelectorModule(config);
	}
);


var generatedCount = 0;
var alignmentNotFoundCount = 0;
var insufficientMembersCount = 0;
var insufficientEligibleMembersCount = 0;
var selectorNotFoundCount = 0;


log(
	"Generating configured HERV lineage nucleotide phylogenies"
);

_.each(
	lineagePhylogenyConfigs,
	function(config) {

		var result =
			generateLineagePhylogeny(
				config
			);

		if(result.status === "generated") {

			generatedCount++;
			return;
		}

		if(result.reason ===
				"ALIGNMENT_NOT_FOUND") {

			alignmentNotFoundCount++;
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
				"SELECTOR_NOT_FOUND") {

			selectorNotFoundCount++;
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
	"Phylogenies generated: " +
	generatedCount
);

log(
	"Alignments not found: " +
	alignmentNotFoundCount
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
	" members passing the coverage filter: " +
	insufficientEligibleMembersCount
);

log(
	"Alignments skipped because selector module was unavailable: " +
	selectorNotFoundCount
);

log(
	"Finished building HERV lineage nucleotide phylogenies."
);

