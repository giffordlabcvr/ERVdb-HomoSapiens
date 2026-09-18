// glue/analyse/rerootLineagePhylogeniesNucs.js
//
// Prepare reconstructed human ERV lineage and sublineage nucleotide
// phylogenies for inspection.
//
// Uses the same standard-ID naming scheme and alignment universe as
// reconstructLineageLevelPhylogenies.js.
//
//   1. Identify lineage and sublineage alignments corresponding to
//      erv_lineage rows for which human_erv = TRUE.
//   2. Derive the corresponding unrooted pol tree path.
//   3. Check whether that tree exists.
//   4. If it exists:
//        - midpoint-reroot it using ervPhyloUtility;
//        - export FigTree annotations for the source alignment using
//          ervFigTreeAnnotationExporterLocus.
//   5. If it does not exist, skip the alignment.
//
// Naming convention:
//
//   Alignment:
//       AL_LINEAGE_1_Zeta_FRD_1
//
//   Input tree:
//       trees/lineage/1_Zeta_FRD_1_pol_nucs.tree
//
//   Midpoint-rerooted tree:
//       trees/lineage/1_Zeta_FRD_1_pol_nucs_midpoint_rerooted.tree
//
//   FigTree annotations:
//       trees/lineage/AL_LINEAGE_1_Zeta_FRD_1.annotations.tsv
//
//   Sublineage alignment:
//       AL_SUBLINEAGE_1_Eta_E_HQ
//
//   Input tree:
//       trees/sublineage/1_Eta_E_HQ_pol_nucs.tree
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

var TREE_ROOT =
	"trees";

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
// Standard-ID and alignment helpers
// -----------------------------------------------------------------------------

function standardLineageStem(lineageId) {

	if(lineageId.indexOf("ERVR-") === 0) {

		var stem =
			lineageId.substring(
				"ERVR-".length
			);

		var firstDot =
			stem.indexOf(".");

		if(firstDot >= 0) {

			stem =
				stem.substring(
					0,
					firstDot
				) +
				"R" +
				stem.substring(
					firstDot
				);
		}
		else {

			stem =
				stem +
				"R";
		}

		return stem.replace(
			/\./g,
			"_"
		);
	}

	if(lineageId.indexOf("ERV-") === 0) {

		return lineageId
			.substring(
				"ERV-".length
			)
			.replace(
				/\./g,
				"_"
			);
	}

	throw new Error(
		"Unsupported ERV lineage ID: " +
		lineageId
	);
}


function loadHumanErvIndex() {

	var rows =
		queryObjects([
			"list",
			"custom-table-row",
			"erv_lineage",
			"id",
			"name",
			"entity_level",
			"-w",
			"human_erv = 'TRUE'"
		]);

	var index = {};

	_.each(
		rows,
		function(row) {

			var stem =
				standardLineageStem(
					row.id
				);

			if(index[stem]) {

				throw new Error(
					"Multiple human ERV rows produce alignment stem '" +
					stem +
					"': " +
					index[stem].id +
					" and " +
					row.id
				);
			}

			index[stem] = {
				id: row.id,
				name: row.name,
				entityLevel:
					row.entity_level
			};
		}
	);

	return {
		rows: rows,
		byStem: index
	};
}


function parseAlignmentName(
	alignmentName
) {

	var lineagePrefix =
		"AL_LINEAGE_";

	var sublineagePrefix =
		"AL_SUBLINEAGE_";

	if(
		alignmentName.indexOf(
			lineagePrefix
		) === 0
	) {

		return {
			entityLevel: "lineage",
			standardStem:
				alignmentName.substring(
					lineagePrefix.length
				),
			treeDirectory: "lineage"
		};
	}

	if(
		alignmentName.indexOf(
			sublineagePrefix
		) === 0
	) {

		return {
			entityLevel: "sublineage",
			standardStem:
				alignmentName.substring(
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


function loadTargetAlignments(
	humanErvIndex
) {

	var rows =
		queryObjects([
			"list",
			"alignment",
			"name",
			"refSequence.name",
			"-w",
			"name like 'AL_LINEAGE_%' or " +
				"name like 'AL_SUBLINEAGE_%'"
		]);

	var selectedRows = [];

	_.each(
		rows,
		function(row) {

			var alignmentInfo =
				parseAlignmentName(
					row.name
				);

			var humanErv =
				humanErvIndex.byStem[
					alignmentInfo.standardStem
				];

			if(!humanErv) {

				return;
			}

			if(
				humanErv.entityLevel !== null &&
				humanErv.entityLevel !== undefined &&
				("" + humanErv.entityLevel).trim() !== "" &&
				humanErv.entityLevel !==
					alignmentInfo.entityLevel
			) {

				throw new Error(
					"Entity-level mismatch for " +
					humanErv.id +
					": erv_lineage.entity_level is '" +
					humanErv.entityLevel +
					"', but alignment " +
					row.name +
					" implies '" +
					alignmentInfo.entityLevel +
					"'"
				);
			}

			row.alignmentInfo =
				alignmentInfo;

			row.ervLineageId =
				humanErv.id;

			row.ervLineageName =
				humanErv.name;

			selectedRows.push(
				row
			);
		}
	);

	selectedRows.sort(
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

	return selectedRows;
}


// -----------------------------------------------------------------------------
// Derive source tree path
//
// Must match reconstructLineageLevelPhylogenies.js.
//
//   AL_LINEAGE_1_Zeta_FRD_1
//
// becomes:
//
//   trees/lineage/1_Zeta_FRD_1_pol_nucs.tree
// -----------------------------------------------------------------------------

function getSourceTreeFile(
	alignmentInfo
) {

	return (
		TREE_ROOT +
		"/" +
		alignmentInfo.treeDirectory +
		"/" +
		alignmentInfo.standardStem +
		"_" +
		FEATURE_NAME +
		"_nucs.tree"
	);
}


// -----------------------------------------------------------------------------
// Derive midpoint-rerooted tree path
// -----------------------------------------------------------------------------

function getRerootedTreeFile(
	alignmentInfo
) {

	return (
		TREE_ROOT +
		"/" +
		alignmentInfo.treeDirectory +
		"/" +
		alignmentInfo.standardStem +
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
	alignmentName,
	alignmentInfo
) {

	return (
		TREE_ROOT +
		"/" +
		alignmentInfo.treeDirectory +
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
//     export figtree-annotation AL_LINEAGE_1_Zeta_FRD_1 \
//       -f trees/lineage/AL_LINEAGE_1_Zeta_FRD_1.annotations.tsv
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
// Prepare one lineage or sublineage phylogeny
// -----------------------------------------------------------------------------

function prepareLineagePhylogeny(
	alignmentRow
) {

	var alignmentName =
		alignmentRow.name;

	var alignmentInfo =
		alignmentRow.alignmentInfo;

	var sourceTreeFile =
		getSourceTreeFile(
			alignmentInfo
		);

	var rerootedTreeFile =
		getRerootedTreeFile(
			alignmentInfo
		);

	var annotationFile =
		getAnnotationFile(
			alignmentName,
			alignmentInfo
		);


	log(
		"Processing " +
		alignmentName
	);


	// ---------------------------------------------------------------------
	// The source tree defines whether this alignment actually produced a
	// phylogeny during the reconstruction stage.
	// ---------------------------------------------------------------------

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
	"Preparing human ERV lineage and sublineage nucleotide phylogenies"
);


var humanErvIndex =
	loadHumanErvIndex();


log(
	"Loaded " +
	humanErvIndex.rows.length +
	" ERV rows with human_erv = TRUE"
);


var targetAlignments =
	loadTargetAlignments(
		humanErvIndex
	);


log(
	"Discovered " +
	targetAlignments.length +
	" human ERV lineage/sublineage alignment(s)"
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
	targetAlignments,
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
	"LINEAGE/SUBLINEAGE PHYLOGENY PREPARATION SUMMARY"
);

log(
	"Human ERV lineage/sublineage alignments discovered: " +
	targetAlignments.length
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
	"Finished preparing human ERV lineage/sublineage nucleotide phylogenies."
);

