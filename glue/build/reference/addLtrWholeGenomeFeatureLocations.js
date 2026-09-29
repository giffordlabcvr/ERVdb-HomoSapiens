// glue/build/erv/addLtrWholeGenomeFeatureLocations.js
// Add a whole_genome feature location spanning the complete sequence
// to every LTR reference.
//
// LTR sequences are identified using:
//
//   sequence_kind like 'ltr_%'
//
// LTR references are identified using:
//
//   name like 'LTR_REF_%'
//
// Each LTR reference is matched to its underlying sequence via
// sequence.sequenceID. The whole_genome feature location spans:
//
//   1 .. sequence length
//
// Existing whole_genome feature locations are left unchanged.
//
// Assumes execution from within the ervdb project mode.


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


// -----------------------------------------------------------------------------
// Recover LTR sequence lengths
// -----------------------------------------------------------------------------

function getLtrSequences() {

	return queryObjects([
		"list",
		"sequence",
		"sequenceID",
		"length",
		"-w",
		"sequence_kind like 'ltr_%'"
	]);
}


// -----------------------------------------------------------------------------
// Recover LTR references
// -----------------------------------------------------------------------------

function getLtrReferences() {

	return queryObjects([
		"list",
		"reference",
		"-w",
		"name like 'LTR_REF_%'"
	]);
}


// -----------------------------------------------------------------------------
// Check whether a reference already has a whole_genome feature location
// -----------------------------------------------------------------------------

function wholeGenomeFeatureLocationExists(
	referenceName
) {

	var rows = [];

	glue.inMode(
		"/reference/" +
			referenceName,
		function() {

			rows =
				queryObjects([
					"list",
					"feature-location"
				]);
		}
	);

	return _.some(
		rows,
		function(row) {

			return (
				row["feature.name"] ===
				"whole_genome"
			);
		}
	);
}

// -----------------------------------------------------------------------------
// Add whole_genome feature location spanning the complete reference
// -----------------------------------------------------------------------------

function addWholeGenomeFeatureLocation(
	referenceName,
	sequenceLength
) {

	glue.inMode(
		"/reference/" +
			referenceName,
		function() {

			glue.command([
				"add",
				"feature-location",
				"whole_genome"
			]);


			glue.inMode(
				"feature-location/whole_genome",
				function() {

					glue.command([
						"add",
						"segment",
						"1",
						"" + sequenceLength
					]);
				}
			);
		}
	);
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

log(
	"Adding whole_genome feature locations to LTR references"
);


// -----------------------------------------------------------------------------
// Build sequence-length lookup
// -----------------------------------------------------------------------------

var ltrSequences =
	getLtrSequences();


log(
	"Found " +
	ltrSequences.length +
	" LTR sequence(s)"
);


var lengthBySequenceId = {};


_.each(
	ltrSequences,
	function(sequenceRow) {

		var sequenceId =
			sequenceRow.sequenceID;

		var sequenceLength =
			parseInt(
				sequenceRow.length,
				10
			);


		if(
			!sequenceId ||
			isNaN(sequenceLength)
		) {

			log(
				"Skipping malformed sequence row: " +
				JSON.stringify(sequenceRow)
			);

			return;
		}


		lengthBySequenceId[
			sequenceId
		] =
			sequenceLength;
	}
);


// -----------------------------------------------------------------------------
// Process LTR references
// -----------------------------------------------------------------------------

var ltrReferences =
	getLtrReferences();


log(
	"Found " +
	ltrReferences.length +
	" LTR reference(s)"
);


var addedCount = 0;

var existingCount = 0;

var missingSequenceCount = 0;


_.each(
	ltrReferences,
	function(referenceRow) {

		var referenceName =
			referenceRow.name;

		var sequenceId =
			referenceRow[
				"sequence.sequenceID"
			];

		var sequenceLength =
			lengthBySequenceId[
				sequenceId
			];


		if(sequenceLength == null) {

			log(
				"Skipping " +
				referenceName +
				": no matching LTR sequence length found for sequenceID " +
				sequenceId
			);

			missingSequenceCount++;

			return;
		}


		if(
			wholeGenomeFeatureLocationExists(
				referenceName
			)
		) {

			log(
				"Skipping " +
				referenceName +
				": whole_genome feature location already exists"
			);

			existingCount++;

			return;
		}


		log(
			"Adding whole_genome to " +
			referenceName +
			": 1.." +
			sequenceLength
		);


		addWholeGenomeFeatureLocation(
			referenceName,
			sequenceLength
		);


		addedCount++;
	}
);


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log(
	"LTR WHOLE_GENOME FEATURE LOCATION SUMMARY"
);

log(
	"LTR sequences found: " +
	ltrSequences.length
);

log(
	"LTR references found: " +
	ltrReferences.length
);

log(
	"whole_genome feature locations added: " +
	addedCount
);

log(
	"Existing whole_genome feature locations skipped: " +
	existingCount
);

log(
	"LTR references without matching sequence lengths: " +
	missingSequenceCount
);

log(
	"Finished adding whole_genome feature locations to LTR references"
);