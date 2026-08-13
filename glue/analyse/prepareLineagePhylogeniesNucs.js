// glue/analyse/prepareLineagePhylogeniesNucs.js
//
// Prepare reconstructed HERV lineage nucleotide phylogenies for inspection.
//
// For each AL_LINEAGE_HERV* alignment:
//
//   1. Derive the corresponding unrooted pol tree path.
//   2. Check whether that tree exists.
//   3. If it exists:
//        - midpoint-reroot it using ervPhyloUtility;
//        - export FigTree annotations for the source alignment using
//          ervFigTreeAnnotationExporterLocus.
//   4. If it does not exist, skip the lineage.
//
// Naming convention:
//
//   Alignment:
//       AL_LINEAGE_HERVFRD
//
//   Input tree:
//       trees/lineage/HERVFRD_pol_nucs.tree
//
//   Midpoint-rerooted tree:
//       trees/lineage/HERVFRD_pol_nucs_midpoint_rerooted.tree
//
//   FigTree annotations:
//       trees/lineage/AL_LINEAGE_HERVFRD.annotations.tsv
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

var FEATURE_NAME =
	"pol";

var TREE_DIR =
	"trees/lineage";

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
// Discover HERV lineage alignments
//
// Same alignment universe used by reconstructLineageLevelPhylogenies.js:
//
//   list alignment -w "name like 'AL_LINEAGE_HERV%'"
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
// Derive HERV name
//
//   AL_LINEAGE_HERVFRD
//
// becomes:
//
//   HERVFRD
// -----------------------------------------------------------------------------

function getHervName(
	alignmentName
) {

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
// Derive source tree path
//
// Must match reconstructLineageLevelPhylogenies.js.
//
//   AL_LINEAGE_HERVFRD
//
// becomes:
//
//   trees/lineage/HERVFRD_pol_nucs.tree
// -----------------------------------------------------------------------------

function getSourceTreeFile(
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
// Derive midpoint-rerooted tree path
// -----------------------------------------------------------------------------

function getRerootedTreeFile(
	alignmentName
) {

	return (
		TREE_DIR +
		"/" +
		getHervName(alignmentName) +
		"_" +
		FEATURE_NAME +
		"_nucs_midpoint_rerooted.tree"
	);
}


// -----------------------------------------------------------------------------
// Derive FigTree annotation path
//
// Retaining the alignment name here makes the relationship between the
// annotation file and its GLUE alignment completely explicit.
// -----------------------------------------------------------------------------

function getAnnotationFile(
	alignmentName
) {

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
//
// Equivalent GLUE syntax:
//
//   module ervFigTreeAnnotationExporterLocus
//
//     export figtree-annotation AL_LINEAGE_HERVFRD \
//       -f trees/lineage/AL_LINEAGE_HERVFRD.annotations.tsv
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
// Prepare one lineage phylogeny
// -----------------------------------------------------------------------------

function prepareLineagePhylogeny(
	alignmentRow
) {

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

	var annotationFile =
		getAnnotationFile(
			alignmentName
		);


	log(
		"Processing " +
		alignmentName
	);


	// ---------------------------------------------------------------------
	// The source tree defines whether this alignment actually produced a
	// phylogeny during the reconstruction stage.
	// ---------------------------------------------------------------------

	if(!fileExists(
			sourceTreeFile
		)) {

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


	// ---------------------------------------------------------------------
	// Midpoint reroot
	// ---------------------------------------------------------------------

	var rerootResult =
		rerootPhylogeny(
			alignmentName,
			sourceTreeFile,
			rerootedTreeFile
		);


	// ---------------------------------------------------------------------
	// FigTree annotations
	//
	// Annotation export is tied to the same alignment that generated the
	// source tree.
	// ---------------------------------------------------------------------

	var annotationResult =
		exportFigTreeAnnotations(
			alignmentName,
			annotationFile
		);


	return {
		status: "prepared",
		rerootResult:
			rerootResult,
		annotationResult:
			annotationResult
	};
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

if(!moduleExists(
		PHYLO_UTILITY_MODULE
	)) {

	throw new Error(
		"Required phylogeny utility module does not exist: " +
		PHYLO_UTILITY_MODULE
	);
}


if(!moduleExists(
		FIGTREE_EXPORTER_MODULE
	)) {

	throw new Error(
		"Required FigTree annotation exporter module does not exist: " +
		FIGTREE_EXPORTER_MODULE
	);
}


log(
	"Preparing HERV lineage nucleotide phylogenies"
);


var lineageAlignments =
	getHervLineageAlignments();


log(
	"Discovered " +
	lineageAlignments.length +
	" HERV lineage alignment(s)"
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
	lineageAlignments,
	function(alignmentRow) {

		var result =
			prepareLineagePhylogeny(
				alignmentRow
			);


		if(
			result.status ===
			"skipped"
		) {

			if(
				result.reason ===
				"TREE_NOT_FOUND"
			) {

				sourceTreeMissingCount++;
			}

			return;
		}


		sourceTreeFoundCount++;


		if(
			result.rerootResult ===
			"generated"
		) {

			rerootedGeneratedCount++;
		}
		else if(
			result.rerootResult ===
			"already_exists"
		) {

			rerootedExistingCount++;
		}


		if(
			result.annotationResult ===
			"generated"
		) {

			annotationsGeneratedCount++;
		}
		else if(
			result.annotationResult ===
			"already_exists"
		) {

			annotationsExistingCount++;
		}
	}
);


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log(
	"LINEAGE PHYLOGENY PREPARATION SUMMARY"
);

log(
	"HERV lineage alignments discovered: " +
	lineageAlignments.length
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
	"Finished preparing HERV lineage nucleotide phylogenies."
);
