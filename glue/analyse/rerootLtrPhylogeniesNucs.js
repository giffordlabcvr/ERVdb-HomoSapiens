// glue/analyse/rerootLtrPhylogeniesNucs.js
//
// Prepare reconstructed LTR nucleotide phylogenies for inspection.
//
// Uses the same alignment universe and tree naming scheme as
// reconstructLtrPhylogenies.js.
//
//   1. Discover AL_LTR_* alignments.
//   2. Derive the corresponding unrooted nucleotide tree path.
//   3. If the source tree exists:
//        - midpoint-reroot it using ervPhyloUtility;
//        - export FigTree annotations for the source alignment using
//          ervFigTreeAnnotationExporterLocus.
//   4. If the source tree does not exist, skip the alignment.
//
// Naming convention:
//
//   Alignment:
//       AL_LTR_LTR10E
//
//   Input tree:
//       trees/ltr/LTR10E_nucs.tree
//
//   Midpoint-rerooted tree:
//       trees/ltr/LTR10E_nucs_midpoint_rerooted.tree
//
//   FigTree annotations:
//       trees/ltr/AL_LTR_LTR10E.annotations.tsv
//
// This script assumes that the following modules already exist:
//
//   ervPhyloUtility
//   ervFigTreeAnnotationExporterLocus
//
// These modules should be instantiated separately as part of the normal
// project build.
//
// Assumes execution from within the ervdb project mode.


var DRY_RUN = false;

var SKIP_EXISTING_REROOTED_TREES = true;

var SKIP_EXISTING_ANNOTATIONS = false;


// -----------------------------------------------------------------------------
// Analysis settings
// -----------------------------------------------------------------------------

var ALIGNMENT_PREFIX =
	"AL_LTR_";

var TREE_DIR =
	"trees/ltr";

var PHYLO_UTILITY_MODULE =
	"ervPhyloUtility";

var FIGTREE_EXPORTER_MODULE =
	"ervFigTreeAnnotationExporterLocus";


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
// Discover LTR alignments
// -----------------------------------------------------------------------------

function loadLtrAlignments() {

	var rows =
		queryObjects([
			"list",
			"alignment",
			"name",
			"refSequence.name",
			"-w",
			"name like 'AL_LTR_%'"
		]);

	rows.sort(
		function(rowA, rowB) {

			if(rowA.name < rowB.name) {

				return -1;
			}

			if(rowA.name > rowB.name) {

				return 1;
			}

			return 0;
		}
	);

	return rows;
}


// -----------------------------------------------------------------------------
// Derive the LTR token from an alignment name
// -----------------------------------------------------------------------------

function getLtrName(alignmentName) {

	if(
		alignmentName.indexOf(
			ALIGNMENT_PREFIX
		) !== 0
	) {

		throw new Error(
			"Cannot derive LTR name from alignment: " +
			alignmentName +
			". Expected alignment name beginning with " +
			ALIGNMENT_PREFIX
		);
	}

	return alignmentName.substring(
		ALIGNMENT_PREFIX.length
	);
}


// -----------------------------------------------------------------------------
// Derive tree and annotation paths
// -----------------------------------------------------------------------------

function getSourceTreeFile(alignmentName) {

	return (
		TREE_DIR +
		"/" +
		getLtrName(alignmentName) +
		"_nucs.tree"
	);
}


function getRerootedTreeFile(alignmentName) {

	return (
		TREE_DIR +
		"/" +
		getLtrName(alignmentName) +
		"_nucs_midpoint_rerooted.tree"
	);
}


function getAnnotationFile(alignmentName) {

	return (
		TREE_DIR +
		"/" +
		alignmentName +
		".annotations.tsv"
	);
}


// -----------------------------------------------------------------------------
// Midpoint-reroot one tree
//
// Equivalent GLUE syntax:
//
//   module ervPhyloUtility
//
//     reroot-phylogeny \
//       --inputFile <inputTree> NEWICK_BOOTSTRAPS \
//       --midpoint \
//       --outputFile <outputTree> NEWICK_BOOTSTRAPS
// -----------------------------------------------------------------------------

function rerootPhylogeny(
	alignmentName,
	inputFile,
	outputFile
) {

	if(
		SKIP_EXISTING_REROOTED_TREES &&
		fileExists(outputFile)
	) {

		log(
			"Skipping reroot for " +
			alignmentName +
			": midpoint-rerooted tree already exists -> " +
			outputFile
		);

		return "already_exists";
	}


	log(
		"Midpoint-rerooting " +
		inputFile +
		" -> " +
		outputFile
	);


	glue.inMode(
		"/module/" +
			PHYLO_UTILITY_MODULE,
		function() {

			runCmd([
				"reroot-phylogeny",
				"--inputFile",
				inputFile,
				"NEWICK_BOOTSTRAPS",
				"--midpoint",
				"--outputFile",
				outputFile,
				"NEWICK_BOOTSTRAPS"
			]);
		}
	);


	log(
		"Generated midpoint-rerooted tree: " +
		outputFile
	);


	return "generated";
}


// -----------------------------------------------------------------------------
// Export FigTree annotations
// -----------------------------------------------------------------------------

function exportFigTreeAnnotations(
	alignmentName,
	outputFile
) {

	if(
		SKIP_EXISTING_ANNOTATIONS &&
		fileExists(outputFile)
	) {

		log(
			"Skipping annotation export for " +
			alignmentName +
			": annotation file already exists -> " +
			outputFile
		);

		return "already_exists";
	}


	log(
		"Exporting FigTree annotations for " +
		alignmentName +
		" -> " +
		outputFile
	);


	glue.inMode(
		"/module/" +
			FIGTREE_EXPORTER_MODULE,
		function() {

			runCmd([
				"export",
				"figtree-annotation",
				alignmentName,
				"-f",
				outputFile
			]);
		}
	);


	log(
		"Exported FigTree annotations: " +
		outputFile
	);


	return "generated";
}


// -----------------------------------------------------------------------------
// Prepare one LTR phylogeny
// -----------------------------------------------------------------------------

function prepareLtrPhylogeny(alignmentRow) {

	var alignmentName =
		alignmentRow.name;

	var sourceTreeFile =
		getSourceTreeFile(
			alignmentName
		);

	var rerootedTreeFile =
		getRerootedTreeFile(
			alignmentName
		);


	log(
		"Processing " +
		alignmentName
	);


	if(
		!fileExists(
			sourceTreeFile
		)
	) {

		log(
			"Skipping " +
			alignmentName +
			": source tree not found -> " +
			sourceTreeFile
		);

		return {
			status: "skipped",
			reason: "TREE_NOT_FOUND"
		};
	}


	var rerootResult =
		rerootPhylogeny(
			alignmentName,
			sourceTreeFile,
			rerootedTreeFile
		);

	var annotationResult =
		exportFigTreeAnnotations(
			alignmentName,
			getAnnotationFile(
				alignmentName
			)
		);


	return {
		status: "prepared",
		rerootResult: rerootResult,
		annotationResult: annotationResult
	};
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

if(
	!moduleExists(
		PHYLO_UTILITY_MODULE
	)
) {

	throw new Error(
		"Required phylogeny utility module does not exist: " +
		PHYLO_UTILITY_MODULE
	);
}


if(
	!moduleExists(
		FIGTREE_EXPORTER_MODULE
	)
) {

	throw new Error(
		"Required FigTree annotation exporter module does not exist: " +
		FIGTREE_EXPORTER_MODULE
	);
}


log(
	"Preparing LTR nucleotide phylogenies"
);


var ltrAlignments =
	loadLtrAlignments();


log(
	"Discovered " +
	ltrAlignments.length +
	" LTR alignment(s)"
);


// -----------------------------------------------------------------------------
// Summary counters
// -----------------------------------------------------------------------------

var sourceTreeFoundCount = 0;

var sourceTreeMissingCount = 0;

var rerootedGeneratedCount = 0;

var rerootedExistingCount = 0;

var annotationsGeneratedCount = 0;

var annotationsExistingCount = 0;


// -----------------------------------------------------------------------------
// Process discovered alignments
// -----------------------------------------------------------------------------

_.each(
	ltrAlignments,
	function(alignmentRow) {

		var result =
			prepareLtrPhylogeny(
				alignmentRow
			);

		if(result.status === "skipped") {

			sourceTreeMissingCount++;

			return;
		}

		sourceTreeFoundCount++;

		if(result.rerootResult === "generated") {

			rerootedGeneratedCount++;
		}
		else if(result.rerootResult === "already_exists") {

			rerootedExistingCount++;
		}

		if(result.annotationResult === "generated") {

			annotationsGeneratedCount++;
		}
		else if(result.annotationResult === "already_exists") {

			annotationsExistingCount++;
		}
	}
);


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log(
	"LTR PHYLOGENY PREPARATION SUMMARY"
);

log(
	"LTR alignments discovered: " +
	ltrAlignments.length
);

log(
	"Alignments with source trees: " +
	sourceTreeFoundCount
);

log(
	"Alignments without source trees: " +
	sourceTreeMissingCount
);

log(
	"Midpoint-rerooted trees generated: " +
	rerootedGeneratedCount
);

log(
	"Existing midpoint-rerooted trees skipped: " +
	rerootedExistingCount
);

log(
	"FigTree annotation files exported: " +
	annotationsGeneratedCount
);

log(
	"Existing FigTree annotation files skipped: " +
	annotationsExistingCount
);

log(
	"Finished preparing LTR nucleotide phylogenies."
);
