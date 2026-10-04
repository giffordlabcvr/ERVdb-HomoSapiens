// glue/build/erv/recordLtrFeaturePresence.js
//
// Calculate feature coverage for all LTR alignments.
//
// LTR alignments are discovered using:
//
//   list alignment -w "name like 'AL_LTR_%'"
//
// For each alignment, run:
//
//   module rvFeaturePresenceRecorder
//     record feature-presence <alignmentName>
//       --featureName whole_genome
//       --descendentFeatures
//
// Assumes:
//   - each LTR reference has a whole_genome feature location;
//   - the rvFeaturePresenceRecorder module already exists;
//   - execution occurs from within the ervdb project.


var FEATURE_NAME =
	"whole_genome";

var FEATURE_PRESENCE_MODULE =
	"rvFeaturePresenceRecorder";


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function log(msg) {

	glue.log(
		"INFO",
		msg
	);
}


function queryObjects(cmdWords) {

	return glue.tableToObjects(
		glue.command(cmdWords)
	);
}


function moduleExists(moduleName) {

	var rows =
		queryObjects([
			"list",
			"module",
			"-w",
			"name = '" +
				moduleName +
				"'"
		]);

	return rows.length > 0;
}


// -----------------------------------------------------------------------------
// Discover LTR alignments
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
// Record feature presence for one alignment
// -----------------------------------------------------------------------------

function recordFeaturePresence(
	alignmentName
) {

	log(
		"Recording " +
		FEATURE_NAME +
		" feature presence for " +
		alignmentName
	);


	glue.inMode(
		"/module/" +
			FEATURE_PRESENCE_MODULE,
		function() {

			glue.command([
				"record",
				"feature-presence",
				alignmentName,
				"--featureName",
				FEATURE_NAME,
				"--descendentFeatures"
			]);
		}
	);


	log(
		"Finished " +
		alignmentName
	);
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

if(!moduleExists(
		FEATURE_PRESENCE_MODULE
	)) {

	throw new Error(
		"Required module does not exist: " +
		FEATURE_PRESENCE_MODULE
	);
}


log(
	"Calculating " +
	FEATURE_NAME +
	" feature coverage for LTR alignments"
);


var ltrAlignments =
	getLtrAlignments();


log(
	"Discovered " +
	ltrAlignments.length +
	" LTR alignment(s)"
);


var processedCount = 0;


_.each(
	ltrAlignments,
	function(alignmentRow) {

		recordFeaturePresence(
			alignmentRow.name
		);

		processedCount++;
	}
);


log(
	"LTR FEATURE COVERAGE SUMMARY"
);

log(
	"LTR alignments discovered: " +
	ltrAlignments.length
);

log(
	"LTR alignments processed: " +
	processedCount
);

log(
	"Finished calculating LTR feature coverage"
);

