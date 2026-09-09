// glue/build/locus/msa/computeHervLineageAlignments.js
//
// Compute ERV lineage and sublineage alignments.
//
// Target alignments:
//
//   AL_LINEAGE_*
//   AL_SUBLINEAGE_*
//
// The aligner is selected from the feature locations defined on each
// alignment's constraining reference:
//
//   env present
//       -> rvCompoundAligner
//
//   no env, but gag/pro/pol/pro-pol present
//       -> rvCompoundAlignerNoEnv
//
//   no recognised coding feature present
//       -> rvCompoundAlignerNoOrfs
//
// Explicit per-alignment overrides can be added where necessary.
//
// Only alignments containing more than one member are computed.
// LTR alignments are handled separately by
// computeHervLineageLtrAlignments.js.

var DRY_RUN = false;


// -------------------------------------------------------------------------
// Explicit exceptions
//
// These are keyed by the current standard alignment name, not by a
// historical ERV display name.
// -------------------------------------------------------------------------

var alignerOverrideByAlignmentName = {

	/*
	 * Example:
	 *
	 * "AL_LINEAGE_3_Lambda_L":
	 *     "rvCompoundAlignerNoEnv"
	 */
};


// -------------------------------------------------------------------------
// Recognised coding features
//
// Presence of any one of these features indicates that the reference has
// sufficient internal annotation to use the no-env compound aligner when
// env itself is absent.
// -------------------------------------------------------------------------

var recognisedInternalCodingFeatures = {
	"gag": true,
	"pro": true,
	"pol": true,
	"pro-pol": true
};


// -------------------------------------------------------------------------
// General utilities
// -------------------------------------------------------------------------

function log(message) {
	glue.logInfo(message);
}


function norm(value) {

	if(value === null || value === undefined) {
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
		lower === "unknown" ||
		lower === "null" ||
		lower === "none" ||
		result === "-") {

		return null;
	}

	return result;
}


function runCommand(commandWords) {

	if(DRY_RUN) {

		log(
			"[DRY RUN] " +
			commandWords.join(" ")
		);

		return null;
	}

	return glue.command(
		commandWords
	);
}


function queryObjects(commandWords) {

	return glue.tableToObjects(
		glue.command(
			commandWords
		)
	);
}


// -------------------------------------------------------------------------
// Count alignment members
// -------------------------------------------------------------------------

function countAlignmentMembers(
	alignmentName
) {

	var memberRows = [];

	glue.inMode(
		"/alignment/" +
		alignmentName,
		function() {

			memberRows =
				queryObjects([
					"list",
					"member"
				]);
		}
	);

	return memberRows.length;
}


// -------------------------------------------------------------------------
// Load feature locations from a constraining reference
// -------------------------------------------------------------------------

function loadReferenceFeatureNames(
	referenceName
) {

	var featureLocationRows = [];

	glue.inMode(
		"/reference/" +
		referenceName,
		function() {

			featureLocationRows =
				queryObjects([
					"list",
					"feature-location"
				]);
		}
	);

	var featureNames = {};

	for(var i = 0;
		i < featureLocationRows.length;
		i++) {

		var featureName =
			norm(
				featureLocationRows[i][
					"feature.name"
				]
			);

		if(featureName === null) {
			continue;
		}

		featureNames[
			featureName.toLowerCase()
		] = true;
	}

	return featureNames;
}

// -------------------------------------------------------------------------
// Return sorted feature names for logging
// -------------------------------------------------------------------------

function featureNameList(
	featureNames
) {

	var names =
		Object.keys(
			featureNames
		);

	names.sort();

	return names;
}


// -------------------------------------------------------------------------
// Determine whether the reference has a recognised internal coding feature
// -------------------------------------------------------------------------

function hasRecognisedInternalCodingFeature(
	featureNames
) {

	var recognisedNames =
		Object.keys(
			recognisedInternalCodingFeatures
		);

	for(var i = 0;
		i < recognisedNames.length;
		i++) {

		var recognisedName =
			recognisedNames[i];

		if(featureNames[
			recognisedName
		] === true) {

			return true;
		}
	}

	return false;
}


// -------------------------------------------------------------------------
// Select the alignment module
// -------------------------------------------------------------------------

function chooseAlignerModule(
	alignmentName,
	featureNames
) {

	if(alignerOverrideByAlignmentName
		.hasOwnProperty(
			alignmentName
		)) {

		return {
			moduleName:
				alignerOverrideByAlignmentName[
					alignmentName
				],
			selectionReason:
				"explicit_override"
		};
	}

	if(featureNames["env"] === true) {

		return {
			moduleName:
				"rvCompoundAligner",
			selectionReason:
				"env_feature_present"
		};
	}

	if(hasRecognisedInternalCodingFeature(
		featureNames
	)) {

		return {
			moduleName:
				"rvCompoundAlignerNoEnv",
			selectionReason:
				"internal_coding_feature_present_without_env"
		};
	}

	return {
		moduleName:
			"rvCompoundAlignerNoOrfs",
		selectionReason:
			"no_recognised_coding_feature"
	};
}


// -------------------------------------------------------------------------
// Load target alignments
// -------------------------------------------------------------------------

log(
	"Loading ERV lineage and sublineage alignments"
);

var alignmentRows =
	queryObjects([
		"list",
		"alignment",
		"name",
		"parent.name",
		"refSequence.name",
		"-w",
		"name like 'AL_LINEAGE_%' or " +
			"name like 'AL_SUBLINEAGE_%'",
		"-s",
		"name"
	]);

log(
	"Loaded " +
	alignmentRows.length +
	" ERV lineage/sublineage alignments"
);


// -------------------------------------------------------------------------
// Process alignments
// -------------------------------------------------------------------------

var computed = [];
var skippedNoReference = [];
var skippedInsufficientMembers = [];
var skippedReferenceInspectionFailure = [];
var failedComputations = [];

var lineageComputedCount = 0;
var sublineageComputedCount = 0;

var compoundAlignerCount = 0;
var compoundAlignerNoEnvCount = 0;
var compoundAlignerNoOrfsCount = 0;
var overrideCount = 0;


for(var i = 0;
	i < alignmentRows.length;
	i++) {

	var alignmentRow =
		alignmentRows[i];

	var alignmentName =
		norm(
			alignmentRow.name
		);

	var referenceName =
		norm(
			alignmentRow[
				"refSequence.name"
			]
		);

	var parentAlignmentName =
		norm(
			alignmentRow[
				"parent.name"
			]
		);

	if(alignmentName === null) {

		log(
			"Skipping alignment row with no name"
		);

		continue;
	}

	var alignmentType = null;

	if(alignmentName.indexOf(
		"AL_LINEAGE_"
	) === 0) {

		alignmentType =
			"lineage";
	}
	else if(alignmentName.indexOf(
		"AL_SUBLINEAGE_"
	) === 0) {

		alignmentType =
			"sublineage";
	}
	else {

		log(
			"Skipping unexpected alignment " +
			alignmentName
		);

		continue;
	}

	var memberCount =
		countAlignmentMembers(
			alignmentName
		);

	if(memberCount <= 1) {

		skippedInsufficientMembers.push({
			alignmentName:
				alignmentName,
			alignmentType:
				alignmentType,
			referenceName:
				referenceName,
			memberCount:
				memberCount
		});

		log(
			"Skipping " +
			alignmentName +
			": only " +
			memberCount +
			" alignment member(s)"
		);

		continue;
	}

	if(referenceName === null) {

		skippedNoReference.push({
			alignmentName:
				alignmentName,
			alignmentType:
				alignmentType,
			parentAlignmentName:
				parentAlignmentName,
			memberCount:
				memberCount
		});

		log(
			"Skipping " +
			alignmentName +
			": no constraining reference"
		);

		continue;
	}

	var featureNames;

	try {

		featureNames =
			loadReferenceFeatureNames(
				referenceName
			);
	}
	catch(error) {

		skippedReferenceInspectionFailure.push({
			alignmentName:
				alignmentName,
			referenceName:
				referenceName,
			error:
				"" + error
		});

		log(
			"Skipping " +
			alignmentName +
			": unable to inspect feature locations on " +
			referenceName +
			": " +
			error
		);

		continue;
	}

	var alignerSelection =
		chooseAlignerModule(
			alignmentName,
			featureNames
		);

	var moduleName =
		alignerSelection.moduleName;

	var selectionReason =
		alignerSelection.selectionReason;

	var referenceFeatureNames =
		featureNameList(
			featureNames
		);

	log(
		"Computing " +
		alignmentName +
		" using " +
		moduleName +
		"; reference=" +
		referenceName +
		"; members=" +
		memberCount +
		"; reason=" +
		selectionReason +
		"; features=" +
		(
			referenceFeatureNames.length > 0
				? referenceFeatureNames.join(",")
				: "(none)"
		)
	);

	try {

		runCommand([
			"compute",
			"alignment",
			alignmentName,
			moduleName
		]);
	}
	catch(error) {

		failedComputations.push({
			alignmentName:
				alignmentName,
			alignmentType:
				alignmentType,
			referenceName:
				referenceName,
			moduleName:
				moduleName,
			error:
				"" + error
		});

		log(
			"ERROR computing " +
			alignmentName +
			" using " +
			moduleName +
			": " +
			error
		);

		continue;
	}

	computed.push({
		alignmentName:
			alignmentName,
		alignmentType:
			alignmentType,
		parentAlignmentName:
			parentAlignmentName,
		referenceName:
			referenceName,
		memberCount:
			memberCount,
		moduleName:
			moduleName,
		selectionReason:
			selectionReason,
		features:
			referenceFeatureNames.join(",")
	});

	if(alignmentType === "lineage") {
		lineageComputedCount++;
	}
	else {
		sublineageComputedCount++;
	}

	if(moduleName ===
		"rvCompoundAligner") {

		compoundAlignerCount++;
	}
	else if(moduleName ===
		"rvCompoundAlignerNoEnv") {

		compoundAlignerNoEnvCount++;
	}
	else if(moduleName ===
		"rvCompoundAlignerNoOrfs") {

		compoundAlignerNoOrfsCount++;
	}

	if(selectionReason ===
		"explicit_override") {

		overrideCount++;
	}
}


// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

log(
	"============================================================"
);

log(
	"ERV lineage/sublineage alignment computation summary"
);

log(
	"============================================================"
);

log(
	"Target alignments examined: " +
	alignmentRows.length
);

log(
	"Alignments computed: " +
	computed.length
);

log(
	"Lineage alignments computed: " +
	lineageComputedCount
);

log(
	"Sublineage alignments computed: " +
	sublineageComputedCount
);

log(
	"Computed with rvCompoundAligner: " +
	compoundAlignerCount
);

log(
	"Computed with rvCompoundAlignerNoEnv: " +
	compoundAlignerNoEnvCount
);

log(
	"Computed with rvCompoundAlignerNoOrfs: " +
	compoundAlignerNoOrfsCount
);

log(
	"Computed using an explicit override: " +
	overrideCount
);

log(
	"Skipped with <= 1 member: " +
	skippedInsufficientMembers.length
);

log(
	"Skipped without a constraining reference: " +
	skippedNoReference.length
);

log(
	"Skipped because reference features could not be inspected: " +
	skippedReferenceInspectionFailure.length
);

log(
	"Failed alignment computations: " +
	failedComputations.length
);


// -------------------------------------------------------------------------
// Detailed computed-alignment report
// -------------------------------------------------------------------------

for(var i = 0;
	i < computed.length;
	i++) {

	var computedRow =
		computed[i];

	log(
		"COMPUTED\t" +
		computedRow.alignmentName +
		"\t" +
		computedRow.alignmentType +
		"\t" +
		computedRow.referenceName +
		"\t" +
		computedRow.memberCount +
		"\t" +
		computedRow.moduleName +
		"\t" +
		computedRow.selectionReason +
		"\t" +
		computedRow.features
	);
}


// -------------------------------------------------------------------------
// Detailed skipped-alignment reports
// -------------------------------------------------------------------------

for(var i = 0;
	i < skippedInsufficientMembers.length;
	i++) {

	var insufficientRow =
		skippedInsufficientMembers[i];

	log(
		"SKIPPED_INSUFFICIENT_MEMBERS\t" +
		insufficientRow.alignmentName +
		"\t" +
		insufficientRow.alignmentType +
		"\t" +
		insufficientRow.memberCount +
		"\t" +
		insufficientRow.referenceName
	);
}


for(var i = 0;
	i < skippedNoReference.length;
	i++) {

	var noReferenceRow =
		skippedNoReference[i];

	log(
		"SKIPPED_NO_REFERENCE\t" +
		noReferenceRow.alignmentName +
		"\t" +
		noReferenceRow.alignmentType +
		"\t" +
		noReferenceRow.memberCount +
		"\t" +
		noReferenceRow.parentAlignmentName
	);
}


for(var i = 0;
	i < skippedReferenceInspectionFailure.length;
	i++) {

	var inspectionFailureRow =
		skippedReferenceInspectionFailure[i];

	log(
		"SKIPPED_REFERENCE_INSPECTION_FAILURE\t" +
		inspectionFailureRow.alignmentName +
		"\t" +
		inspectionFailureRow.referenceName +
		"\t" +
		inspectionFailureRow.error
	);
}


for(var i = 0;
	i < failedComputations.length;
	i++) {

	var failedRow =
		failedComputations[i];

	log(
		"COMPUTATION_FAILED\t" +
		failedRow.alignmentName +
		"\t" +
		failedRow.alignmentType +
		"\t" +
		failedRow.referenceName +
		"\t" +
		failedRow.moduleName +
		"\t" +
		failedRow.error
	);
}


log(
	DRY_RUN
		? "Dry run finished; no alignments were computed"
		: "Finished computing ERV lineage and sublineage alignments"
);
