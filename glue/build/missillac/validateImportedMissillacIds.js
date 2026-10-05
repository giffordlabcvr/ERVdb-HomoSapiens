// glue/build/locus/missillac/validateImportedMissillacIds.js
//
// Validate Missillac identifiers that have been imported or otherwise
// preassigned to erv_locus rows before allocation of identifiers to
// previously unnamed loci.
//
// This script is intended to run immediately before:
//
//   applyErvLocusNames.js
//
// It does NOT require every eligible locus to have a Missillac ID.
// Unnamed loci are expected at this stage and will be handled by the
// allocation step.
//
// It DOES require every imported/preassigned assignment to be internally
// consistent.
//
// Checks:
//
//   1. orthology_group and missillac_id are either both present or both absent.
//
//   2. A named locus must have exactly one distinct erv_lineage association.
//
//   3. locus_type must be "erv" or "solo_ltr".
//
//   4. missillac_id must exactly match the identifier reconstructed from:
//
//          <erv_lineage.id>-<orthology_group>
//
//      with "(LTR)" appended for solo-LTR loci.
//
//   5. No Missillac ID may be assigned to more than one current locus.
//
//   6. No orthology-group number may be assigned to more than one current
//      locus within the same ERV-lineage namespace.
//
// This script is read-only. Any validation error causes the build to fail.
//
// NOTE:
//
// Once the persistent Missillac registry is implemented, this script can
// additionally validate imported assignments against the registry itself.
// The checks below deliberately validate the database state independently
// of how the assignments were imported.

var LOCUS_TABLE =
	"erv_locus";

var LINEAGE_ASSOC_TABLE =
	"erv_locus_lineage_assoc";


// -------------------------------------------------------------------------
// General utilities
// -------------------------------------------------------------------------

function log(message) {
	glue.logInfo(message);
}


function norm(value) {

	if(value === null ||
		value === undefined) {

		return null;
	}

	var result =
		("" + value).trim();

	if(result === "") {
		return null;
	}

	var lower =
		result.toLowerCase();

	if(lower === "n/a" ||
		lower === "na" ||
		lower === "n/k" ||
		lower === "nk" ||
		lower === "null" ||
		lower === "none" ||
		lower === "unknown" ||
		result === "-") {

		return null;
	}

	return result;
}


function normInt(value) {

	value =
		norm(value);

	if(value === null) {
		return null;
	}

	var number =
		parseInt(
			value,
			10
		);

	return isNaN(number)
		? null
		: number;
}


function positiveInt(value) {

	var number =
		normInt(value);

	if(number === null ||
		number < 1) {

		return null;
	}

	return number;
}


function queryObjects(commandWords) {

	return glue.tableToObjects(
		glue.command(
			commandWords
		)
	);
}


function addUniqueValue(
	map,
	key,
	value
) {

	if(map[key] === undefined) {
		map[key] = [];
	}

	for(var i = 0;
		i < map[key].length;
		i++) {

		if(map[key][i] === value) {
			return;
		}
	}

	map[key].push(value);
}


function makeMissillacId(
	lineageId,
	orthologyGroup,
	locusType
) {

	lineageId =
		norm(lineageId);

	orthologyGroup =
		positiveInt(
			orthologyGroup
		);

	locusType =
		norm(locusType);

	if(lineageId === null ||
		orthologyGroup === null) {

		return null;
	}

	var missillacId =
		lineageId +
		"-" +
		orthologyGroup;

	if(locusType !== null &&
		locusType.toLowerCase() ===
			"solo_ltr") {

		missillacId +=
			"(LTR)";
	}

	return missillacId;
}


// -------------------------------------------------------------------------
// Validation-error collection
// -------------------------------------------------------------------------

var errors = [];


function addError(
	errorType,
	message
) {

	errors.push({
		error_type:
			errorType,

		message:
			message
	});
}


// -------------------------------------------------------------------------
// Load permanent loci
// -------------------------------------------------------------------------

log(
	"Loading permanent erv_locus rows for imported Missillac-ID validation"
);

var locusRows =
	queryObjects([
		"list",
		"custom-table-row",
		LOCUS_TABLE,
		"id",
		"locus_type",
		"taxonomic_resolution",
		"orthology_group",
		"missillac_id",
		"-s",
		"id"
	]);

var locusById = {};

for(var i = 0;
	i < locusRows.length;
	i++) {

	var locusRow =
		locusRows[i];

	var locusId =
		norm(
			locusRow.id
		);

	if(locusId === null) {
		continue;
	}

	locusById[locusId] = {
		locus_id:
			locusId,

		locus_type:
			norm(
				locusRow.locus_type
			),

		taxonomic_resolution:
			norm(
				locusRow.taxonomic_resolution
			),

		orthology_group:
			positiveInt(
				locusRow.orthology_group
			),

		raw_orthology_group:
			norm(
				locusRow.orthology_group
			),

		missillac_id:
			norm(
				locusRow.missillac_id
			)
	};
}

log(
	"Loaded " +
	Object.keys(locusById).length +
	" permanent ERV loci"
);


// -------------------------------------------------------------------------
// Load locus-to-lineage associations
// -------------------------------------------------------------------------

log(
	"Loading locus-to-lineage associations"
);

var associationRows =
	queryObjects([
		"list",
		"custom-table-row",
		LINEAGE_ASSOC_TABLE,
		"id",
		"erv_locus.id",
		"erv_lineage.id",
		"-s",
		"erv_locus.id,erv_lineage.id"
	]);

var lineageTargetsByLocus = {};

for(var i = 0;
	i < associationRows.length;
	i++) {

	var associationRow =
		associationRows[i];

	var locusId =
		norm(
			associationRow[
				"erv_locus.id"
			]
		);

	var lineageId =
		norm(
			associationRow[
				"erv_lineage.id"
			]
		);

	if(locusId === null ||
		lineageId === null) {

		continue;
	}

	addUniqueValue(
		lineageTargetsByLocus,
		locusId,
		lineageId
	);
}

log(
	"Loaded " +
	associationRows.length +
	" locus-to-lineage association rows"
);


// -------------------------------------------------------------------------
// Validate individual imported/preassigned assignments
// -------------------------------------------------------------------------

log(
	"Validating imported/preassigned Missillac identifiers"
);

var namedLocusCount = 0;
var unnamedLocusCount = 0;

var locusByMissillacId = {};
var lociByLineageAndNumber = {};

var locusIds =
	Object.keys(
		locusById
	);

locusIds.sort();

for(var i = 0;
	i < locusIds.length;
	i++) {

	var locusId =
		locusIds[i];

	var locus =
		locusById[
			locusId
		];

	var hasRawOrthologyGroup =
		locus.raw_orthology_group !== null;

	var hasValidOrthologyGroup =
		locus.orthology_group !== null;

	var hasMissillacId =
		locus.missillac_id !== null;


	// -----------------------------------------------------------------
	// Reject malformed/non-positive orthology-group values
	// -----------------------------------------------------------------

	if(hasRawOrthologyGroup &&
		!hasValidOrthologyGroup) {

		addError(
			"INVALID_ORTHOLOGY_GROUP",

			locusId +
			" has invalid orthology_group '" +
			locus.raw_orthology_group +
			"'"
		);
	}


	// -----------------------------------------------------------------
	// The two naming fields must occur together
	// -----------------------------------------------------------------

	if(hasRawOrthologyGroup !==
		hasMissillacId) {

		addError(
			"PARTIAL_ASSIGNMENT",

			locusId +
			" has inconsistent naming fields: " +
			"orthology_group=" +
			(
				locus.raw_orthology_group === null
					? "null"
					: locus.raw_orthology_group
			) +
			", missillac_id=" +
			(
				locus.missillac_id === null
					? "null"
					: locus.missillac_id
			)
		);

		continue;
	}


	// -----------------------------------------------------------------
	// Completely unnamed loci are expected before allocation
	// -----------------------------------------------------------------

	if(!hasRawOrthologyGroup &&
		!hasMissillacId) {

		unnamedLocusCount++;
		continue;
	}

	namedLocusCount++;


	// -----------------------------------------------------------------
	// A named locus requires a valid positive orthology group
	// -----------------------------------------------------------------

	if(!hasValidOrthologyGroup) {

		/*
		 * The malformed value has already been reported above.
		 * Do not attempt downstream reconstruction using it.
		 */
		continue;
	}


	// -----------------------------------------------------------------
	// A named locus must have exactly one ERV-lineage identity
	// -----------------------------------------------------------------

	var lineageTargets =
		lineageTargetsByLocus[
			locusId
		];

	if(lineageTargets === undefined ||
		lineageTargets.length === 0) {

		addError(
			"NAMED_LOCUS_WITHOUT_LINEAGE",

			locusId +
			" has Missillac ID '" +
			locus.missillac_id +
			"' but has no ERV-lineage association"
		);

		continue;
	}

	if(lineageTargets.length > 1) {

		addError(
			"NAMED_LOCUS_MULTIPLE_LINEAGES",

			locusId +
			" has Missillac ID '" +
			locus.missillac_id +
			"' but is associated with multiple ERV lineages: " +
			lineageTargets.join(",")
		);

		continue;
	}

	var lineageId =
		lineageTargets[0];


	// -----------------------------------------------------------------
	// Validate locus type
	// -----------------------------------------------------------------

	var locusType =
		locus.locus_type !== null
			? locus.locus_type.toLowerCase()
			: null;

	if(locusType !== "erv" &&
		locusType !== "solo_ltr") {

		addError(
			"NAMED_UNSUPPORTED_LOCUS_TYPE",

			locusId +
			" has Missillac ID '" +
			locus.missillac_id +
			"' but locus_type is '" +
			(
				locus.locus_type === null
					? "null"
					: locus.locus_type
			) +
			"'"
		);

		continue;
	}


	// -----------------------------------------------------------------
	// Reconstruct and verify the identifier
	// -----------------------------------------------------------------

	var expectedMissillacId =
		makeMissillacId(
			lineageId,
			locus.orthology_group,
			locusType
		);

	if(locus.missillac_id !==
		expectedMissillacId) {

		addError(
			"MISSILLAC_ID_MISMATCH",

			locusId +
			" has Missillac ID '" +
			locus.missillac_id +
			"' but expected '" +
			expectedMissillacId +
			"' from lineage '" +
			lineageId +
			"', orthology_group " +
			locus.orthology_group +
			" and locus_type '" +
			locusType +
			"'"
		);
	}


	// -----------------------------------------------------------------
	// Record current Missillac-ID usage
	// -----------------------------------------------------------------

	if(locusByMissillacId[
		locus.missillac_id
	] !== undefined) {

		addError(
			"DUPLICATE_MISSILLAC_ID",

			"Missillac ID '" +
			locus.missillac_id +
			"' is assigned to both " +
			locusByMissillacId[
				locus.missillac_id
			] +
			" and " +
			locusId
		);
	}
	else {

		locusByMissillacId[
			locus.missillac_id
		] = locusId;
	}


	// -----------------------------------------------------------------
	// Record lineage + orthology-group usage
	// -----------------------------------------------------------------

	var lineageNumberKey =
		lineageId +
		"\t" +
		locus.orthology_group;

	if(lociByLineageAndNumber[
		lineageNumberKey
	] === undefined) {

		lociByLineageAndNumber[
			lineageNumberKey
		] = locusId;
	}
	else {

		addError(
			"DUPLICATE_LINEAGE_NUMBER",

			"ERV lineage '" +
			lineageId +
			"' orthology_group " +
			locus.orthology_group +
			" is assigned to both " +
			lociByLineageAndNumber[
				lineageNumberKey
			] +
			" and " +
			locusId
		);
	}
}


// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

log(
	"============================================================"
);

log(
	"Imported Missillac-ID validation summary"
);

log(
	"============================================================"
);

log(
	"Permanent ERV loci examined: " +
	locusIds.length
);

log(
	"Preassigned/named loci examined: " +
	namedLocusCount
);

log(
	"Currently unnamed loci: " +
	unnamedLocusCount
);

log(
	"Validation errors: " +
	errors.length
);


// -------------------------------------------------------------------------
// Detailed error report
// -------------------------------------------------------------------------

for(var i = 0;
	i < errors.length;
	i++) {

	var error =
		errors[i];

	log(
		"ERROR\t" +
		error.error_type +
		"\t" +
		error.message
	);
}


// -------------------------------------------------------------------------
// Fail the build if any imported assignment is invalid
// -------------------------------------------------------------------------

if(errors.length > 0) {

	throw new Error(
		"Imported Missillac-ID validation failed with " +
		errors.length +
		" error(s); see ERROR records above"
	);
}


log(
	"Imported Missillac-ID validation passed"
);
