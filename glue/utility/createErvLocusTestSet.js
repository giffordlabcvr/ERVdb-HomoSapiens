// glue/utility/createErvLocusTestSet.js
//
// Construct a compact, varied ERV locus dataset for end-to-end
// testing of the Homo sapiens locus-layer build.
//
// The utility:
//
//   1. Reads the complete locus TSV.
//   2. Excludes loci for which no corresponding FASTA is available.
//   3. Excludes loci that are not cleanly resolved:
//        - case must be "Fully resolved"
//        - makes_mosaic must not indicate a mosaic
//   4. Classifies remaining loci as LTR or non-LTR using `status`.
//   5. Uses `names_decision` as the current annotation-group key.
//   6. Selects a diverse ~1000-locus test set.
//   7. Caps representation of any one annotation group.
//   8. Biases the set towards non-LTR / provirus-like loci.
//   9. Writes the selected original TSV rows unchanged.
//  10. Copies the corresponding <locus_id>.fas files into a
//      separate GLUE source directory.
//
// IMPORTANT:
//
// This is deliberately a CLEAN integration-test dataset. It is intended
// to exercise the normal locus-layer build across a broad range of
// classifications without testing mosaic or unresolved-locus handling.
//
// `names_decision` is used here as a practical sampling category.
// It is NOT assumed to correspond exactly to either an ERV lineage or
// an LTR lineage.
//
// Some classified loci do not have a corresponding FASTA because
// sequence extraction failed following updates to the upstream merged
// dataset. These loci remain legitimate catalogue records, but they
// cannot participate in this sequence-based integration test.
//
// This script prepares test INPUT DATA. It does not modify the database.


// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

var INPUT_TSV =
	"tabular/locus/HERVs-RBRT-filtered.tsv";

var INPUT_FASTA_DIR =
	"sources/filtered_2026_07";

var OUTPUT_TSV =
	"tabular/locus/test/HERVs-RBRT-filtered.tsv";

var OUTPUT_FASTA_DIR =
	"sources/filtered_test";


// Desired test-set size.

var TARGET_TOTAL = 1000;


// Desired broad locus-type balance.
//
// These are targets rather than biological proportions.
// The test set is deliberately enriched for non-LTR loci.

var TARGET_NON_LTR = 700;
var TARGET_LTR = 300;


// Prevent abundant annotation groups from dominating.

var MAX_PER_GROUP = 50;


// Number of exclusion examples to report.

var MAX_EXCLUSION_EXAMPLES = 20;


// Reproducible pseudo-random selection.
//
// Changing this value will generate a different deterministic sample.

var RANDOM_SEED = 20261004;


// -----------------------------------------------------------------------------
// Java classes
// -----------------------------------------------------------------------------

var Files =
	Java.type("java.nio.file.Files");

var Paths =
	Java.type("java.nio.file.Paths");

var StandardCopyOption =
	Java.type("java.nio.file.StandardCopyOption");

var StandardCharsets =
	Java.type("java.nio.charset.StandardCharsets");

var ArrayList =
	Java.type("java.util.ArrayList");

var Collections =
	Java.type("java.util.Collections");

var Random =
	Java.type("java.util.Random");


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function log(message) {
	glue.logInfo(message);
}


function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var s =
		("" + value).trim();

	if(s === "") {
		return null;
	}

	var lower =
		s.toLowerCase();

	if(
		lower === "n/a" ||
		lower === "na" ||
		lower === "null" ||
		lower === "none"
	) {
		return null;
	}

	return s;
}


function splitTsvLine(line) {

	return (
		("" + line).split("\t")
	);
}


function makeRow(
	headers,
	values,
	rawLine,
	inputIndex
) {

	var row = {
		_rawLine: rawLine,
		_inputIndex: inputIndex
	};

	for(
		var i = 0;
		i < headers.length;
		i++
	) {

		row[
			headers[i]
		] =
			(
				i < values.length
					? values[i]
					: ""
			);
	}

	return row;
}


function isLtrLocus(row) {

	var status =
		norm(
			row["status"]
		);

	if(status === null) {
		return false;
	}

	return (
		status.toUpperCase() === "LTR"
	);
}


function isTrueValue(value) {

	value =
		norm(
			value
		);

	if(value === null) {
		return false;
	}

	var lower =
		value.toLowerCase();

	return (
		lower === "true" ||
		lower === "yes" ||
		lower === "1"
	);
}


function isCleanlyResolvedLocus(row) {

	var caseValue =
		norm(
			row["case"]
		);

	if(
		caseValue !==
		"Fully resolved"
	) {
		return false;
	}


	if(
		isTrueValue(
			row["makes_mosaic"]
		)
	) {
		return false;
	}


	return true;
}


function cleanResolutionExclusionReason(row) {

	var caseValue =
		norm(
			row["case"]
		);

	if(
		caseValue !==
		"Fully resolved"
	) {

		return (
			"case=" +
			(
				caseValue === null
					? "<empty>"
					: caseValue
			)
		);
	}


	if(
		isTrueValue(
			row["makes_mosaic"]
		)
	) {
		return "makes_mosaic=true";
	}


	return "not cleanly resolved";
}


function annotationGroup(row) {

	var value =
		norm(
			row["names_decision"]
		);

	if(value !== null) {
		return value;
	}


	// Fallbacks are only used when names_decision is unavailable.

	value =
		norm(
			row["phylogeny_name"]
		);

	if(value !== null) {
		return value;
	}


	value =
		norm(
			row["names"]
		);

	if(value !== null) {
		return value;
	}


	return "UNRESOLVED";
}


function ensureDirectory(pathString) {

	var path =
		Paths.get(
			pathString
		);

	if(!Files.exists(path)) {

		Files.createDirectories(
			path
		);
	}
}


function fastaPath(
	directory,
	locusId
) {

	return Paths.get(
		directory,
		locusId + ".fas"
	);
}


// -----------------------------------------------------------------------------
// Deterministic shuffle
// -----------------------------------------------------------------------------

function shuffleArray(
	array,
	random
) {

	var list =
		new ArrayList();

	_.each(
		array,
		function(item) {
			list.add(item);
		}
	);

	Collections.shuffle(
		list,
		random
	);


	var shuffled = [];

	for(
		var i = 0;
		i < list.size();
		i++
	) {

		shuffled.push(
			list.get(i)
		);
	}

	return shuffled;
}


// -----------------------------------------------------------------------------
// Read complete TSV and establish the clean sequence-bearing sampling universe
// -----------------------------------------------------------------------------

log(
	"Reading full locus dataset: " +
	INPUT_TSV
);


var inputPath =
	Paths.get(
		INPUT_TSV
	);


if(!Files.exists(inputPath)) {

	throw new Error(
		"Input TSV does not exist: " +
		INPUT_TSV
	);
}


var lines =
	Files.readAllLines(
		inputPath,
		StandardCharsets.UTF_8
	);


if(lines.size() < 2) {

	throw new Error(
		"Input TSV contains no data rows: " +
		INPUT_TSV
	);
}


var headerLine =
	"" + lines.get(0);

var headers =
	splitTsvLine(
		headerLine
	);


var rows = [];

var locusIdsSeen = {};

var totalInputRows = 0;


// FASTA exclusions.

var unavailableSequenceCount = 0;

var unavailableSequenceExamples = [];


// Classification exclusions.

var excludedClassificationCount = 0;

var excludedClassificationExamples = [];

var excludedByCase = {};

var excludedMosaicCount = 0;


for(
	var lineIndex = 1;
	lineIndex < lines.size();
	lineIndex++
) {

	var rawLine =
		"" + lines.get(lineIndex);


	if(rawLine.trim() === "") {
		continue;
	}


	totalInputRows++;


	var values =
		splitTsvLine(
			rawLine
		);

	var row =
		makeRow(
			headers,
			values,
			rawLine,
			lineIndex
		);


	var locusId =
		norm(
			row["locus_id"]
		);


	if(locusId === null) {

		throw new Error(
			"Input line " +
			(lineIndex + 1) +
			" has no locus_id"
		);
	}


	if(locusIdsSeen[locusId]) {

		throw new Error(
			"Duplicate locus_id in input TSV: " +
			locusId
		);
	}


	locusIdsSeen[locusId] =
		true;


	row._locusId =
		locusId;


	// ---------------------------------------------------------------------
	// Only sequence-bearing loci can participate in the locus-layer test.
	// ---------------------------------------------------------------------

	var sourceFastaPath =
		fastaPath(
			INPUT_FASTA_DIR,
			locusId
		);


	if(
		!Files.exists(
			sourceFastaPath
		)
	) {

		unavailableSequenceCount++;


		if(
			unavailableSequenceExamples.length <
			MAX_EXCLUSION_EXAMPLES
		) {

			unavailableSequenceExamples.push(
				locusId
			);
		}


		continue;
	}


	// ---------------------------------------------------------------------
	// Restrict the test set to cleanly resolved loci.
	//
	// We are not currently trying to exercise mosaic resolution or other
	// difficult classification cases. Those can be tested separately.
	// ---------------------------------------------------------------------

	if(
		!isCleanlyResolvedLocus(
			row
		)
	) {

		excludedClassificationCount++;


		var caseValue =
			norm(
				row["case"]
			);


		if(
			caseValue !==
			"Fully resolved"
		) {

			var caseKey =
				caseValue === null
					? "<empty>"
					: caseValue;


			if(
				excludedByCase[caseKey] ===
				undefined
			) {
				excludedByCase[caseKey] = 0;
			}


			excludedByCase[caseKey]++;
		}


		if(
			isTrueValue(
				row["makes_mosaic"]
			)
		) {
			excludedMosaicCount++;
		}


		if(
			excludedClassificationExamples.length <
			MAX_EXCLUSION_EXAMPLES
		) {

			excludedClassificationExamples.push({
				locusId: locusId,
				reason: cleanResolutionExclusionReason(row)
			});
		}


		continue;
	}


	row._isLtr =
		isLtrLocus(
			row
		);

	row._group =
		annotationGroup(
			row
		);


	rows.push(
		row
	);
}


// -----------------------------------------------------------------------------
// Report sampling-universe exclusions
// -----------------------------------------------------------------------------

log(
	"Full TSV locus rows: " +
	totalInputRows
);


log(
	"Loci excluded because FASTA sequence was unavailable: " +
	unavailableSequenceCount
);


if(
	unavailableSequenceExamples.length > 0
) {

	log(
		"Examples of loci without FASTA sequence:"
	);


	_.each(
		unavailableSequenceExamples,
		function(locusId) {

			log(
				"  " +
				locusId +
				".fas"
			);
		}
	);


	if(
		unavailableSequenceCount >
		unavailableSequenceExamples.length
	) {

		log(
			"  ... and " +
			(
				unavailableSequenceCount -
				unavailableSequenceExamples.length
			) +
			" others"
		);
	}
}


log(
	"Loci excluded because they were not cleanly resolved: " +
	excludedClassificationCount
);


var excludedCaseNames =
	Object.keys(
		excludedByCase
	);


excludedCaseNames.sort();


_.each(
	excludedCaseNames,
	function(caseName) {

		log(
			"  case=" +
			caseName +
			": " +
			excludedByCase[
				caseName
			]
		);
	}
);


log(
	"  makes_mosaic=true: " +
	excludedMosaicCount
);


if(
	excludedClassificationExamples.length > 0
) {

	log(
		"Examples of loci excluded by classification:"
	);


	_.each(
		excludedClassificationExamples,
		function(example) {

			log(
				"  " +
				example.locusId +
				": " +
				example.reason
			);
		}
	);
}


log(
	"Clean sequence-bearing loci available for sampling: " +
	rows.length
);


if(
	rows.length <
	TARGET_TOTAL
) {

	throw new Error(
		"Only " +
		rows.length +
		" clean sequence-bearing loci are available, fewer than TARGET_TOTAL=" +
		TARGET_TOTAL
	);
}


// -----------------------------------------------------------------------------
// Partition by broad locus type and annotation group
// -----------------------------------------------------------------------------

var nonLtrGroups = {};
var ltrGroups = {};


_.each(
	rows,
	function(row) {

		var groups =
			row._isLtr
				? ltrGroups
				: nonLtrGroups;


		if(!groups[row._group]) {

			groups[row._group] = [];
		}


		groups[row._group].push(
			row
		);
	}
);


log(
	"Clean non-LTR loci available: " +
	_.filter(
		rows,
		function(row) {
			return !row._isLtr;
		}
	).length
);


log(
	"Clean LTR loci available: " +
	_.filter(
		rows,
		function(row) {
			return row._isLtr;
		}
	).length
);


log(
	"Non-LTR annotation groups available: " +
	Object.keys(nonLtrGroups).length
);


log(
	"LTR annotation groups available: " +
	Object.keys(ltrGroups).length
);


// -----------------------------------------------------------------------------
// Selection
//
// Selection is performed in rounds.
//
// In each round we take at most one locus from every annotation group.
// This ensures that rare groups receive representation before abundant
// groups accumulate large numbers of loci.
//
// Groups are capped at MAX_PER_GROUP.
//
// Non-LTR and LTR loci are selected separately to give deliberate
// control over the broad test-set composition.
// -----------------------------------------------------------------------------

var random =
	new Random(
		RANDOM_SEED
	);


function prepareGroups(groups) {

	var prepared = {};

	var groupNames =
		Object.keys(groups);


	_.each(
		groupNames,
		function(groupName) {

			prepared[groupName] =
				shuffleArray(
					groups[groupName],
					random
				);
		}
	);


	return prepared;
}


var preparedNonLtrGroups =
	prepareGroups(
		nonLtrGroups
	);

var preparedLtrGroups =
	prepareGroups(
		ltrGroups
	);


// -----------------------------------------------------------------------------
// Round-robin stratified selector
// -----------------------------------------------------------------------------

function selectFromGroups(
	groups,
	target,
	maxPerGroup
) {

	var selected = [];

	var selectedCountByGroup = {};


	var groupNames =
		Object.keys(
			groups
		);


	// Shuffle group order so no alphabetical category receives systematic
	// priority when the target is reached part-way through a round.

	groupNames =
		shuffleArray(
			groupNames,
			random
		);


	_.each(
		groupNames,
		function(groupName) {
			selectedCountByGroup[groupName] = 0;
		}
	);


	var madeProgress = true;


	while(
		selected.length < target &&
		madeProgress
	) {

		madeProgress = false;


		_.each(
			groupNames,
			function(groupName) {

				if(
					selected.length >=
					target
				) {
					return;
				}


				var groupRows =
					groups[groupName];

				var alreadySelected =
					selectedCountByGroup[
						groupName
					];


				if(
					alreadySelected >=
					maxPerGroup
				) {
					return;
				}


				if(
					alreadySelected >=
					groupRows.length
				) {
					return;
				}


				selected.push(
					groupRows[
						alreadySelected
					]
				);


				selectedCountByGroup[
					groupName
				]++;


				madeProgress = true;
			}
		);
	}


	return {
		selected: selected,
		counts: selectedCountByGroup
	};
}


// -----------------------------------------------------------------------------
// Select non-LTR and LTR components
// -----------------------------------------------------------------------------

var nonLtrSelection =
	selectFromGroups(
		preparedNonLtrGroups,
		TARGET_NON_LTR,
		MAX_PER_GROUP
	);


var ltrSelection =
	selectFromGroups(
		preparedLtrGroups,
		TARGET_LTR,
		MAX_PER_GROUP
	);


var selected =
	nonLtrSelection.selected.concat(
		ltrSelection.selected
	);


// -----------------------------------------------------------------------------
// Fill any unused capacity
//
// If one broad locus category cannot reach its target, use available
// capacity from the other category while retaining MAX_PER_GROUP.
// -----------------------------------------------------------------------------

function selectedLocusMap(
	selectedRows
) {

	var result = {};

	_.each(
		selectedRows,
		function(row) {
			result[row._locusId] = true;
		}
	);

	return result;
}


function selectedGroupCounts(
	selectedRows
) {

	var result = {};

	_.each(
		selectedRows,
		function(row) {

			if(result[row._group] === undefined) {
				result[row._group] = 0;
			}

			result[row._group]++;
		}
	);

	return result;
}


if(
	selected.length <
	TARGET_TOTAL
) {

	var selectedIds =
		selectedLocusMap(
			selected
		);


	var nonLtrCounts =
		selectedGroupCounts(
			nonLtrSelection.selected
		);

	var ltrCounts =
		selectedGroupCounts(
			ltrSelection.selected
		);


	var remaining =
		shuffleArray(
			rows,
			random
		);


	_.each(
		remaining,
		function(row) {

			if(
				selected.length >=
				TARGET_TOTAL
			) {
				return;
			}


			if(
				selectedIds[
					row._locusId
				]
			) {
				return;
			}


			var counts =
				row._isLtr
					? ltrCounts
					: nonLtrCounts;


			var count =
				counts[row._group] ||
				0;


			if(
				count >=
				MAX_PER_GROUP
			) {
				return;
			}


			selected.push(
				row
			);


			selectedIds[
				row._locusId
			] = true;


			counts[
				row._group
			] =
				count + 1;
		}
	);
}


// -----------------------------------------------------------------------------
// Ensure the requested test-set size was actually achievable
// -----------------------------------------------------------------------------

if(
	selected.length <
	TARGET_TOTAL
) {

	throw new Error(
		"Unable to select TARGET_TOTAL=" +
		TARGET_TOTAL +
		" loci under the current sampling constraints. Selected only " +
		selected.length +
		"."
	);
}


// -----------------------------------------------------------------------------
// Sort selected rows back into original TSV order.
//
// This makes the reduced TSV easy to compare against the full input and
// prevents random selection order from affecting downstream processing.
// -----------------------------------------------------------------------------

selected.sort(
	function(a, b) {
		return (
			a._inputIndex -
			b._inputIndex
		);
	}
);


// -----------------------------------------------------------------------------
// Validate selected FASTA files.
//
// Missing FASTAs were expected and excluded BEFORE sampling. Therefore,
// if a selected locus is missing its FASTA here, something unexpected
// has happened and generation should abort.
// -----------------------------------------------------------------------------

log(
	"Validating FASTA files for " +
	selected.length +
	" selected loci"
);


var missingFastas = [];


_.each(
	selected,
	function(row) {

		var sourcePath =
			fastaPath(
				INPUT_FASTA_DIR,
				row._locusId
			);


		if(
			!Files.exists(
				sourcePath
			)
		) {

			missingFastas.push(
				row._locusId
			);
		}
	}
);


if(
	missingFastas.length > 0
) {

	log(
		"Unexpectedly missing FASTA files after sampling: " +
		missingFastas.length
	);


	_.each(
		missingFastas,
		function(locusId) {

			log(
				"  " +
				locusId +
				".fas"
			);
		}
	);


	throw new Error(
		"Test-set generation aborted because selected loci unexpectedly lack FASTA files"
	);
}


// -----------------------------------------------------------------------------
// Validate output locations before writing anything
//
// The TSV and FASTA directory must be treated as a single generated dataset.
// Refuse to overwrite either component so that an old TSV can never become
// paired with new FASTAs, or vice versa.
// -----------------------------------------------------------------------------

var outputTsvPath =
	Paths.get(
		OUTPUT_TSV
	);


// Refuse to overwrite an existing generated TSV.

if(
	Files.exists(outputTsvPath)
) {

	throw new Error(
		"Output TSV already exists: " +
		OUTPUT_TSV +
		". Remove both the existing test TSV and FASTA directory before " +
		"regenerating the test set. No output files have been written."
	);
}


// Prepare the parent directory for the TSV.

var outputTsvParent =
	outputTsvPath.getParent();


if(outputTsvParent !== null) {

	Files.createDirectories(
		outputTsvParent
	);
}


// Prepare/check the FASTA output directory.

ensureDirectory(
	OUTPUT_FASTA_DIR
);


var outputFastaPath =
	Paths.get(
		OUTPUT_FASTA_DIR
	);


var existingFiles =
	Files.list(
		outputFastaPath
	);

var existingCount = 0;


try {

	var iterator =
		existingFiles.iterator();


	while(iterator.hasNext()) {

		iterator.next();
		existingCount++;
	}

} finally {

	existingFiles.close();
}


if(existingCount > 0) {

	throw new Error(
		"Output FASTA directory is not empty: " +
		OUTPUT_FASTA_DIR +
		". Remove both the existing test TSV and FASTA directory before " +
		"regenerating the test set. No output files have been written."
	);
}


// -----------------------------------------------------------------------------
// Write reduced TSV
// -----------------------------------------------------------------------------

var outputLines =
	new ArrayList();


outputLines.add(
	headerLine
);


_.each(
	selected,
	function(row) {

		outputLines.add(
			row._rawLine
		);
	}
);


Files.write(
	outputTsvPath,
	outputLines,
	StandardCharsets.UTF_8
);


log(
	"Wrote " +
	selected.length +
	" locus rows to " +
	OUTPUT_TSV
);


// -----------------------------------------------------------------------------
// Copy selected FASTA files
// -----------------------------------------------------------------------------

var copied = 0;


_.each(
	selected,
	function(row) {

		var sourcePath =
			fastaPath(
				INPUT_FASTA_DIR,
				row._locusId
			);

		var destinationPath =
			fastaPath(
				OUTPUT_FASTA_DIR,
				row._locusId
			);


		Files.copy(
			sourcePath,
			destinationPath,
			StandardCopyOption.REPLACE_EXISTING
		);


		copied++;
	}
);


log(
	"Copied " +
	copied +
	" FASTA files to " +
	OUTPUT_FASTA_DIR
);

// -----------------------------------------------------------------------------
// Validate generated test dataset
//
// The reduced TSV and FASTA source must describe exactly the same set of loci.
// This is a hard integrity check: every TSV locus must have exactly one FASTA,
// and every FASTA must correspond to exactly one TSV locus.
// -----------------------------------------------------------------------------

log(
	"Validating generated TSV/FASTA test dataset"
);


// Build expected locus-ID set from the selected TSV rows.

var expectedIds = {};


_.each(
	selected,
	function(row) {

		if(
			expectedIds[
				row._locusId
			]
		) {

			throw new Error(
				"Duplicate selected locus ID during final validation: " +
				row._locusId
			);
		}


		expectedIds[
			row._locusId
		] = true;
	}
);


// Read actual FASTA filenames from the generated source directory.

var actualFastaIds = {};

var unexpectedFiles = [];

var fastaStream =
	Files.list(
		outputFastaPath
	);


try {

	var fastaIterator =
		fastaStream.iterator();


	while(
		fastaIterator.hasNext()
	) {

		var path =
			fastaIterator.next();


		if(
			!Files.isRegularFile(
				path
			)
		) {
			continue;
		}


		var filename =
			"" +
			path.getFileName();


		// Ignore hidden filesystem metadata such as .DS_Store.

		if(
			filename.indexOf(".") === 0
		) {
			continue;
		}


		if(
			!filename.endsWith(".fas")
		) {

			unexpectedFiles.push(
				filename
			);

			continue;
		}


		var locusId =
			filename.substring(
				0,
				filename.length - 4
			);


		if(
			actualFastaIds[
				locusId
			]
		) {

			throw new Error(
				"Duplicate FASTA locus ID during final validation: " +
				locusId
			);
		}


		actualFastaIds[
			locusId
		] = true;
	}

} finally {

	fastaStream.close();
}


// Compare the two sets.

var missingFastaIds = [];

var extraFastaIds = [];


_.each(
	Object.keys(
		expectedIds
	),
	function(locusId) {

		if(
			!actualFastaIds[
				locusId
			]
		) {

			missingFastaIds.push(
				locusId
			);
		}
	}
);


_.each(
	Object.keys(
		actualFastaIds
	),
	function(locusId) {

		if(
			!expectedIds[
				locusId
			]
		) {

			extraFastaIds.push(
				locusId
			);
		}
	}
);


var expectedCount =
	Object.keys(
		expectedIds
	).length;

var actualCount =
	Object.keys(
		actualFastaIds
	).length;


log(
	"Expected loci from TSV: " +
	expectedCount
);

log(
	"FASTA loci generated: " +
	actualCount
);

log(
	"TSV loci without FASTA: " +
	missingFastaIds.length
);

log(
	"FASTA loci without TSV row: " +
	extraFastaIds.length
);

log(
	"Unexpected non-FASTA files: " +
	unexpectedFiles.length
);


// Report discrepancies before aborting.

_.each(
	missingFastaIds,
	function(locusId) {

		log(
			"  Missing FASTA: " +
			locusId +
			".fas"
		);
	}
);


_.each(
	extraFastaIds,
	function(locusId) {

		log(
			"  Extra FASTA: " +
			locusId +
			".fas"
		);
	}
);


_.each(
	unexpectedFiles,
	function(filename) {

		log(
			"  Unexpected file: " +
			filename
		);
	}
);


if(
	expectedCount !== selected.length ||
	actualCount !== selected.length ||
	missingFastaIds.length > 0 ||
	extraFastaIds.length > 0 ||
	unexpectedFiles.length > 0
) {

	throw new Error(
		"Generated test dataset failed TSV/FASTA integrity validation"
	);
}


log(
	"Generated test dataset validated: " +
	selected.length +
	" TSV loci exactly match " +
	actualCount +
	" FASTA sequences"
);

// -----------------------------------------------------------------------------
// Final statistics
// -----------------------------------------------------------------------------

var finalLtr = 0;
var finalNonLtr = 0;

var finalLtrGroups = {};
var finalNonLtrGroups = {};


_.each(
	selected,
	function(row) {

		var counts;


		if(row._isLtr) {

			finalLtr++;

			counts =
				finalLtrGroups;

		} else {

			finalNonLtr++;

			counts =
				finalNonLtrGroups;
		}


		if(
			counts[row._group] ===
			undefined
		) {
			counts[row._group] = 0;
		}


		counts[row._group]++;
	}
);


function sortedGroupNames(
	counts
) {

	var names =
		Object.keys(
			counts
		);


	names.sort(
		function(a, b) {

			var diff =
				counts[b] -
				counts[a];

			if(diff !== 0) {
				return diff;
			}

			if(a < b) {
				return -1;
			}

			if(a > b) {
				return 1;
			}

			return 0;
		}
	);


	return names;
}


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log(
	"=================================================="
);

log(
	"ERV LOCUS TEST SET"
);

log(
	"=================================================="
);


log(
	"Full input loci: " +
	totalInputRows
);


log(
	"Loci excluded because FASTA was unavailable: " +
	unavailableSequenceCount
);


log(
	"Loci excluded because not cleanly resolved: " +
	excludedClassificationCount
);


log(
	"Clean sequence-bearing loci eligible for sampling: " +
	rows.length
);


log(
	"Selected loci: " +
	selected.length
);


log(
	"  Non-LTR loci: " +
	finalNonLtr
);


log(
	"  LTR loci: " +
	finalLtr
);


log(
	"Distinct non-LTR annotation groups: " +
	Object.keys(
		finalNonLtrGroups
	).length
);


log(
	"Distinct LTR annotation groups: " +
	Object.keys(
		finalLtrGroups
	).length
);


log(
	"Maximum loci per annotation group: " +
	MAX_PER_GROUP
);


log(
	"FASTA files copied: " +
	copied
);


log(
	"--------------------------------------------------"
);

log(
	"Non-LTR groups"
);

log(
	"--------------------------------------------------"
);


_.each(
	sortedGroupNames(
		finalNonLtrGroups
	),
	function(groupName) {

		log(
			"  " +
				groupName +
				": " +
				finalNonLtrGroups[
					groupName
				]
		);
	}
);


log(
	"--------------------------------------------------"
);

log(
	"LTR groups"
);

log(
	"--------------------------------------------------"
);


_.each(
	sortedGroupNames(
		finalLtrGroups
	),
	function(groupName) {

		log(
			"  " +
				groupName +
				": " +
				finalLtrGroups[
					groupName
				]
		);
	}
);


log(
	"=================================================="
);

log(
	"Test-set generation complete"
);

log(
	"TSV: " +
	OUTPUT_TSV
);

log(
	"FASTA source: " +
	OUTPUT_FASTA_DIR
);

log(
	"=================================================="
);
