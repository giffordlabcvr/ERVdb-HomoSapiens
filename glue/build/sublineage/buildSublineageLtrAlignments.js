// glue/build/sublineage/buildSublineageLtrAlignments.js
//
// Create one constrained alignment for every LTR reference sequence imported
// as part of the ERV sublineage layer.
//
// References are selected from sequences belonging to the following sources:
//
//     ltr_refseqs_erv1_sublineage
//     ltr_refseqs_erv2_sublineage
//     ltr_refseqs_erv3_sublineage
//
// Reference names are expected to use the prefix:
//
//     LTR_REF_
//
// Alignment naming:
//
//     LTR_REF_HERV1LTR  ->  AL_LTR_HERV1LTR
//     LTR_REF_LTR10B    ->  AL_LTR_LTR10B
//
// The alignments are flat: no parent alignment is assigned.
//
// Existing alignments are left unchanged.
//
// Set DRY_RUN to true to report intended changes without modifying the
// project.

var DRY_RUN = false;

var LTR_SOURCE_NAMES = [
	"ltr_refseqs_erv1_sublineage",
	"ltr_refseqs_erv2_sublineage",
	"ltr_refseqs_erv3_sublineage"
];

var REFERENCE_PREFIX = "LTR_REF_";
var ALIGNMENT_PREFIX = "AL_LTR_";


// -----------------------------------------------------------------------------
// Load project state
// -----------------------------------------------------------------------------

var referenceRows = listSublineageLtrReferences();
var alignmentIndex = listAlignments();

log(
	"Loaded " +
	referenceRows.length +
	" sublineage LTR reference sequences"
);

log(
	"Loaded " +
	Object.keys(alignmentIndex).length +
	" existing alignments"
);


// -----------------------------------------------------------------------------
// Summary counters
// -----------------------------------------------------------------------------

var createdCount = 0;
var existingCount = 0;
var skippedCount = 0;
var dryRunCount = 0;


// -----------------------------------------------------------------------------
// Create LTR alignments
// -----------------------------------------------------------------------------

referenceRows.forEach(function(referenceRow) {

	var referenceName =
		normalise(referenceRow["name"]);

	var sourceName =
		normalise(referenceRow["sequence.source.name"]);

	var sequenceID =
		normalise(referenceRow["sequence.sequenceID"]);


	if(referenceName === null) {

		skippedCount++;

		log(
			"Skipping reference row because name is missing" +
			formatSequenceDescription(
				sourceName,
				sequenceID
			)
		);

		return;
	}


	if(referenceName.indexOf(REFERENCE_PREFIX) !== 0) {

		skippedCount++;

		log(
			"Skipping unexpected reference name: " +
			referenceName +
			formatSequenceDescription(
				sourceName,
				sequenceID
			)
		);

		return;
	}


	var alignmentName =
		alignmentNameForReference(referenceName);


	if(alignmentIndex[alignmentName]) {

		existingCount++;

		log(
			"Alignment already exists: " +
			alignmentName
		);

		return;
	}


	log(
		"Creating LTR alignment " +
		alignmentName +
		" using reference " +
		referenceName +
		formatSequenceDescription(
			sourceName,
			sequenceID
		)
	);


	if(DRY_RUN) {

		log(
			"[DRY RUN] create alignment " +
			alignmentName +
			" -r " +
			referenceName
		);

		dryRunCount++;

	} else {

		glue.command([
			"create",
			"alignment",
			alignmentName,
			"-r",
			referenceName
		]);

		createdCount++;
	}


	/*
	 * Update the in-memory index so duplicate reference rows cannot cause
	 * repeated create attempts during the same run.
	 */

	alignmentIndex[alignmentName] = {
		name: alignmentName,
		refName: referenceName
	};
});


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

log("----- SUMMARY -----");

log(
	"Sublineage LTR references found: " +
	referenceRows.length
);

log(
	"Existing LTR alignments: " +
	existingCount
);

log(
	"LTR alignments created: " +
	createdCount
);

if(DRY_RUN) {
	log(
		"LTR alignments to create: " +
		dryRunCount
	);
}

log(
	"Reference rows skipped: " +
	skippedCount
);


// -----------------------------------------------------------------------------
// Reference loading
// -----------------------------------------------------------------------------

function listSublineageLtrReferences() {

	var whereClause =
		LTR_SOURCE_NAMES.map(function(sourceName) {

			return (
				"sequence.source.name = '" +
				escapeQuotes(sourceName) +
				"'"
			);

		}).join(" or ");

	var rows = queryObjects([
		"list",
		"reference",
		"name",
		"sequence.source.name",
		"sequence.sequenceID",
		"-w",
		whereClause,
		"-s",
		"name"
	]);

	return rows;
}


// -----------------------------------------------------------------------------
// Alignment loading
// -----------------------------------------------------------------------------

function listAlignments() {

	var rows = queryObjects([
		"list",
		"alignment",
		"name",
		"parent.name",
		"refSequence.name"
	]);

	var alignmentIndex = {};

	rows.forEach(function(row) {

		var alignmentName =
			normalise(row["name"]);

		if(alignmentName === null) {
			return;
		}

		alignmentIndex[alignmentName] = {
			name: alignmentName,

			parentName:
				normalise(
					row["parent.name"]
				),

			refName:
				normalise(
					row["refSequence.name"]
				)
		};
	});

	return alignmentIndex;
}


// -----------------------------------------------------------------------------
// Naming
// -----------------------------------------------------------------------------

function alignmentNameForReference(referenceName) {

	var suffix =
		referenceName.substring(
			REFERENCE_PREFIX.length
		);

	if(suffix === "") {
		throw (
			"Cannot derive alignment name from reference: " +
			referenceName
		);
	}

	return (
		ALIGNMENT_PREFIX +
		sanitiseIdentifier(suffix)
	);
}


function sanitiseIdentifier(value) {

	return (
		"" + value
	).replace(
		/[^A-Za-z0-9._-]/g,
		"_"
	);
}


// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------

function queryObjects(commandWords) {

	return glue.tableToObjects(
		glue.command(commandWords)
	);
}


function normalise(value) {

	if(
		value === null ||
		value === undefined
	) {
		return null;
	}

	var stringValue =
		("" + value).trim();

	if(
		stringValue === "" ||
		stringValue === "-" ||
		stringValue.toLowerCase() === "null" ||
		stringValue.toLowerCase() === "n/a"
	) {
		return null;
	}

	return stringValue;
}


function escapeQuotes(value) {

	return (
		"" + value
	)
		.replace(
			/\\/g,
			"\\\\"
		)
		.replace(
			/'/g,
			"\\'"
		);
}


function formatSequenceDescription(
	sourceName,
	sequenceID
) {

	if(
		sourceName === null &&
		sequenceID === null
	) {
		return "";
	}

	return (
		" [" +
		(sourceName || "?") +
		"/" +
		(sequenceID || "?") +
		"]"
	);
}


function log(message) {

	glue.log(
		"INFO",
		message
	);
}

