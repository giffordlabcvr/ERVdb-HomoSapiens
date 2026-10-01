// glue/utility/exportErvrBasicFeatureLocs.js

// Validate single-LTR ERVR reference relationships before
// generating feature-location files.

var ERVR_SEQUENCE_IDS = [
	"HARLEQUIN",
	"HERV-19",
	"HERV-16",
	"ERV-L47",
	"HERV-52",
	"HERV-L74",
	"ERV-Lb4",
	"MER-101",
	"MER-89",
	"MER-83A",
	"MER-84",
	"HERV-G25",
	"MER-76"
];

function log(message) {
	glue.logInfo(message);
}

function norm(value) {
	if(value === null || value === undefined) {
		return null;
	}

	var stringValue = ("" + value).trim();

	if(stringValue === "" || stringValue === "-") {
		return null;
	}

	return stringValue;
}

function getListRows(command) {
	var result = glue.command(command);

	if(!result.listResult ||
			!result.listResult.row) {
		return [];
	}

	return result.listResult.row;
}

function getValues(row) {
	if(!row || !row.value) {
		return [];
	}

	return row.value;
}

function requireOneRow(rows, description) {
	if(rows.length !== 1) {
		throw new Error(
			description +
			": expected exactly one row, found " +
			rows.length
		);
	}

	return getValues(rows[0]);
}


// --------------------------------------------------
// Load ERV-LTR associations
// --------------------------------------------------

var ltrsByErvLineage = {};

var associationRows = getListRows([
	"list", "custom-table-row", "erv_lineage_ltr_assoc",
	"id",
	"erv_lineage.id",
	"ltr_lineage.id"
]);

associationRows.forEach(function(row) {
	var values = getValues(row);

	var ervLineageId = norm(values[1]);
	var ltrLineageId = norm(values[2]);

	if(
		ervLineageId === null ||
		ltrLineageId === null
	) {
		return;
	}

	if(!ltrsByErvLineage[ervLineageId]) {
		ltrsByErvLineage[ervLineageId] = [];
	}

	ltrsByErvLineage[ervLineageId].push(
		ltrLineageId
	);
});


// --------------------------------------------------
// Load active canonical LTR references
// --------------------------------------------------

var ltrReferences = {};

var ltrReferenceRows = getListRows([
	"list", "sequence",
	"sequenceID",
	"length",
	"ltr_lineage_reference.ltr_lineage.id",
	"-w",
	"ltr_lineage_reference.reference_role = 'canonical' and " +
	"ltr_lineage_reference.reference_status = 'active'"
]);

ltrReferenceRows.forEach(function(row) {
	var values = getValues(row);

	var sequenceId = norm(values[0]);
	var length = values[1];
	var ltrLineageId = norm(values[2]);

	if(ltrLineageId === null) {
		return;
	}

	if(!ltrReferences[ltrLineageId]) {
		ltrReferences[ltrLineageId] = [];
	}

	ltrReferences[ltrLineageId].push({
		sequenceId: sequenceId,
		length: length
	});
});


// --------------------------------------------------
// Validate target ERVR sequences
// --------------------------------------------------

log("");
log(
	"sequenceID\t" +
	"ERVR_length\t" +
	"ERV_lineage\t" +
	"LTR_lineage\t" +
	"LTR_sequence\t" +
	"LTR_length"
);

ERVR_SEQUENCE_IDS.forEach(function(sequenceId) {

	var sequenceRows = getListRows([
		"list", "sequence",
		"sequenceID",
		"length",
		"erv_lineage_reference.erv_lineage.id",
		"-w",
		"sequenceID = '" + sequenceId + "'"
	]);

	var sequenceValues = requireOneRow(
		sequenceRows,
		"ERVR sequence " + sequenceId
	);

	var ervrLength = sequenceValues[1];
	var ervLineageId = norm(sequenceValues[2]);

	if(ervLineageId === null) {
		throw new Error(
			sequenceId +
			": no linked ERV lineage"
		);
	}

	var associatedLtrs =
		ltrsByErvLineage[ervLineageId] || [];

	if(associatedLtrs.length !== 1) {
		throw new Error(
			sequenceId +
			" / " +
			ervLineageId +
			": expected exactly one associated LTR lineage, found " +
			associatedLtrs.length
		);
	}

	var ltrLineageId = associatedLtrs[0];

	var references =
		ltrReferences[ltrLineageId] || [];

	if(references.length !== 1) {
		throw new Error(
			sequenceId +
			" / " +
			ltrLineageId +
			": expected exactly one active canonical LTR reference, found " +
			references.length
		);
	}

	var ltrReference = references[0];

	log(
		sequenceId + "\t" +
		ervrLength + "\t" +
		ervLineageId + "\t" +
		ltrLineageId + "\t" +
		ltrReference.sequenceId + "\t" +
		ltrReference.length
	);
});

