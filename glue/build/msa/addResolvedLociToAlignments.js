// glue/build/msa/addResolvedLociToAlignments.js
//
// Add permanent ERV locus sequences to the appropriate ERV-lineage,
// ERV-sublineage, ERV-derived-repeat, or LTR-lineage alignments.
//
// ERV locus placement is determined from erv_locus_lineage_assoc and the
// entity_type of the associated erv_lineage:
//
//   lineage             -> AL_LINEAGE_*
//   sublineage          -> AL_SUBLINEAGE_*
//   erv_derived_repeat  -> AL_ERV_DERIVED_REPEAT_*
//   uncertain           -> excluded
//
// LTR locus placement is determined from erv_locus_ltr_assoc.
//
// Only loci having an unambiguous target at the relevant level are added.
// Existing alignment members are not added again.
//
// ERV-derived-repeat alignments are treated as independent alignment
// objects here. Their eventual placement within, or outside, the broader
// alignment hierarchy can be decided separately.


var LOCUS_TABLE =
	"erv_locus";

var LINEAGE_ASSOC_TABLE =
	"erv_locus_lineage_assoc";

var LTR_ASSOC_TABLE =
	"erv_locus_ltr_assoc";


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


function sortedKeys(map) {

	var keys =
		Object.keys(map);

	keys.sort();

	return keys;
}


// -------------------------------------------------------------------------
// Alignment-name utilities
// -------------------------------------------------------------------------

function standardErvAlignmentSuffix(
	lineageId
) {

	lineageId =
		norm(lineageId);

	if(lineageId === null) {
		return null;
	}

	/*
	 * ERV entity IDs use dots as hierarchical separators, whereas
	 * alignment names use underscores.
	 *
	 * Examples:
	 *
	 *   ERV-1.Eta.1
	 *       -> 1_Eta_1
	 *
	 *   ERV-1.Zeta.W9P.P.1
	 *       -> 1_Zeta_W9P_P_1
	 *
	 *   ERVR-1.Theta.101
	 *       -> 1_Theta_101
	 */

	var suffix =
		lineageId;

	suffix =
		suffix.replace(
			/^ERVR?-/,
			""
		);

	suffix =
		suffix.replace(
			/\./g,
			"_"
		);

	return suffix;
}


function expectedErvAlignmentName(
	lineageId,
	entityType
) {

	var suffix =
		standardErvAlignmentSuffix(
			lineageId
		);

	entityType =
		norm(entityType);

	if(suffix === null ||
		entityType === null) {

		return null;
	}

	entityType =
		entityType.toLowerCase();

	if(entityType === "lineage") {

		return (
			"AL_LINEAGE_" +
			suffix
		);
	}

	if(entityType === "sublineage") {

		return (
			"AL_SUBLINEAGE_" +
			suffix
		);
	}

	if(entityType === "erv_derived_repeat") {

		return (
			"AL_ERV_DERIVED_REPEAT_" +
			suffix
		);
	}

	/*
	 * In particular, entity_type = "uncertain" has no resolved
	 * alignment target.
	 */
	return null;
}


function normaliseLtrAlignmentKey(
	ltrLineageId
) {

	ltrLineageId =
		norm(ltrLineageId);

	if(ltrLineageId === null) {
		return null;
	}

	return ltrLineageId
		.toUpperCase()
		.replace(
			/[^A-Z0-9]/g,
			""
		);
}


// -------------------------------------------------------------------------
// Load existing alignments
// -------------------------------------------------------------------------

log(
	"Loading existing alignments"
);

var alignmentRows =
	queryObjects([
		"list",
		"alignment",
		"name",
		"-s",
		"name"
	]);

var existingAlignmentByName = {};

var ltrAlignmentNamesByNormalisedKey = {};

for(var i = 0;
	i < alignmentRows.length;
	i++) {

	var alignmentName =
		norm(
			alignmentRows[i].name
		);

	if(alignmentName === null) {
		continue;
	}

	existingAlignmentByName[
		alignmentName
	] = true;

	if(alignmentName.indexOf(
		"AL_LTR_"
	) === 0) {

		var ltrPart =
			alignmentName.substring(
				"AL_LTR_".length
			);

		var normalisedKey =
			normaliseLtrAlignmentKey(
				ltrPart
			);

		if(normalisedKey !== null) {

			addUniqueValue(
				ltrAlignmentNamesByNormalisedKey,
				normalisedKey,
				alignmentName
			);
		}
	}
}

log(
	"Existing alignments loaded: " +
	alignmentRows.length
);


var ambiguousLtrAlignmentKeyCount = 0;

var ltrKeys =
	sortedKeys(
		ltrAlignmentNamesByNormalisedKey
	);

for(var i = 0;
	i < ltrKeys.length;
	i++) {

	var ltrKey =
		ltrKeys[i];

	if(ltrAlignmentNamesByNormalisedKey[
		ltrKey
	].length > 1) {

		ambiguousLtrAlignmentKeyCount++;
	}
}

log(
	"Ambiguous normalised LTR alignment keys: " +
	ambiguousLtrAlignmentKeyCount
);


// -------------------------------------------------------------------------
// Load permanent ERV loci
// -------------------------------------------------------------------------

log(
	"Loading permanent erv_locus rows"
);

var locusRows =
	queryObjects([
		"list",
		"custom-table-row",
		LOCUS_TABLE,
		"id",
		"locus_type",
		"taxonomic_resolution",
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

	locusById[
		locusId
	] = {
		locus_id:
			locusId,

		locus_type:
			norm(
				locusRow.locus_type
			),

		taxonomic_resolution:
			norm(
				locusRow.taxonomic_resolution
			)
	};
}

log(
	"Permanent ERV loci loaded: " +
	Object.keys(locusById).length
);


// -------------------------------------------------------------------------
// Load sequences linked to permanent ERV loci
// -------------------------------------------------------------------------

log(
	"Loading sequences linked to permanent ERV loci"
);

var sequenceRows =
	queryObjects([
		"list",
		"sequence",
		"source.name",
		"sequenceID",
		"erv_locus.id",
		"-w",
		"erv_locus.id != null",
		"-s",
		"erv_locus.id,source.name,sequenceID"
	]);

var sequenceRefsByLocus = {};

for(var i = 0;
	i < sequenceRows.length;
	i++) {

	var sequenceRow =
		sequenceRows[i];

	var locusId =
		norm(
			sequenceRow[
				"erv_locus.id"
			]
		);

	var sourceName =
		norm(
			sequenceRow[
				"source.name"
			]
		);

	var sequenceID =
		norm(
			sequenceRow.sequenceID
		);

	if(locusId === null ||
		sourceName === null ||
		sequenceID === null) {

		continue;
	}

	if(sequenceRefsByLocus[
		locusId
	] === undefined) {

		sequenceRefsByLocus[
			locusId
		] = [];
	}

	sequenceRefsByLocus[
		locusId
	].push({
		source_name:
			sourceName,

		sequence_id:
			sequenceID
	});
}

log(
	"Linked locus sequences loaded: " +
	sequenceRows.length
);


// -------------------------------------------------------------------------
// Load ERV locus-to-lineage associations
// -------------------------------------------------------------------------

log(
	"Loading ERV locus-to-lineage associations"
);

var lineageAssociationRows =
	queryObjects([
		"list",
		"custom-table-row",
		LINEAGE_ASSOC_TABLE,
		"id",
		"erv_locus.id",
		"erv_lineage.id",
		"erv_lineage.entity_type",
		"association_role",
		"evidence",
		"confidence",
		"-s",
		"erv_locus.id,erv_lineage.id"
	]);

var ervTargetsByLocus = {};
var ervTargetDetailsByKey = {};

var excludedUncertainAssociationCount = 0;
var excludedUnsupportedEntityTypeCount = 0;

for(var i = 0;
	i < lineageAssociationRows.length;
	i++) {

	var associationRow =
		lineageAssociationRows[i];

	var associatedLocusId =
		norm(
			associationRow[
				"erv_locus.id"
			]
		);

	var ervLineageId =
		norm(
			associationRow[
				"erv_lineage.id"
			]
		);

	var entityType =
		norm(
			associationRow[
				"erv_lineage.entity_type"
			]
		);

	if(associatedLocusId === null ||
		ervLineageId === null ||
		entityType === null) {

		continue;
	}

	var lowerEntityType =
		entityType.toLowerCase();

	if(lowerEntityType ===
		"uncertain") {

		excludedUncertainAssociationCount++;
		continue;
	}

	if(lowerEntityType !== "lineage" &&
		lowerEntityType !== "sublineage" &&
		lowerEntityType !==
			"erv_derived_repeat") {

		excludedUnsupportedEntityTypeCount++;
		continue;
	}

	var targetKey =
		lowerEntityType +
		"\t" +
		ervLineageId;

	addUniqueValue(
		ervTargetsByLocus,
		associatedLocusId,
		targetKey
	);

	ervTargetDetailsByKey[
		targetKey
	] = {
		lineage_id:
			ervLineageId,

		entity_type:
			lowerEntityType
	};
}

log(
	"ERV locus-to-lineage association rows loaded: " +
	lineageAssociationRows.length
);

log(
	"Uncertain ERV-lineage associations excluded: " +
	excludedUncertainAssociationCount
);

log(
	"Unsupported ERV entity-type associations excluded: " +
	excludedUnsupportedEntityTypeCount
);


// -------------------------------------------------------------------------
// Load ERV locus-to-LTR-lineage associations
// -------------------------------------------------------------------------

log(
	"Loading ERV locus-to-LTR-lineage associations"
);

var ltrAssociationRows =
	queryObjects([
		"list",
		"custom-table-row",
		LTR_ASSOC_TABLE,
		"id",
		"erv_locus.id",
		"ltr_lineage.id",
		"association_role",
		"evidence",
		"confidence",
		"-s",
		"erv_locus.id,ltr_lineage.id"
	]);

var ltrTargetsByLocus = {};

for(var i = 0;
	i < ltrAssociationRows.length;
	i++) {

	var associationRow =
		ltrAssociationRows[i];

	var associatedLocusId =
		norm(
			associationRow[
				"erv_locus.id"
			]
		);

	var ltrLineageId =
		norm(
			associationRow[
				"ltr_lineage.id"
			]
		);

	if(associatedLocusId === null ||
		ltrLineageId === null) {

		continue;
	}

	addUniqueValue(
		ltrTargetsByLocus,
		associatedLocusId,
		ltrLineageId
	);
}

log(
	"ERV locus-to-LTR-lineage association rows loaded: " +
	ltrAssociationRows.length
);


// -------------------------------------------------------------------------
// Resolve an LTR-lineage ID to an existing LTR alignment
// -------------------------------------------------------------------------

function resolveLtrAlignmentName(
	ltrLineageId
) {

	var directName =
		"AL_LTR_" +
		ltrLineageId;

	if(existingAlignmentByName[
		directName
	] === true) {

		return {
			status:
				"resolved",

			alignment_name:
				directName
		};
	}

	var normalisedKey =
		normaliseLtrAlignmentKey(
			ltrLineageId
		);

	if(normalisedKey === null) {

		return {
			status:
				"missing",

			alignment_name:
				null
		};
	}

	var candidates =
		ltrAlignmentNamesByNormalisedKey[
			normalisedKey
		];

	if(candidates === undefined ||
		candidates.length === 0) {

		return {
			status:
				"missing",

			alignment_name:
				null
		};
	}

	if(candidates.length > 1) {

		return {
			status:
				"ambiguous",

			alignment_name:
				null,

			candidates:
				candidates
		};
	}

	return {
		status:
			"resolved",

		alignment_name:
			candidates[0]
	};
}



// -------------------------------------------------------------------------
// Determine required alignment placements
// -------------------------------------------------------------------------

log(
	"Determining resolved locus alignment placements"
);

var placements = [];

var skippedNoSequence = [];
var skippedMultipleSequences = [];

var skippedNoErvTarget = [];
var skippedMultipleErvTargets = [];
var skippedMissingErvAlignment = [];

var skippedNoLtrTarget = [];
var skippedMultipleLtrTargets = [];
var skippedMissingLtrAlignment = [];
var skippedAmbiguousLtrAlignment = [];

var locusIds =
	sortedKeys(
		locusById
	);

for(var i = 0;
	i < locusIds.length;
	i++) {

	var locusId =
		locusIds[i];

	var locus =
		locusById[
			locusId
		];

	var sequenceRefs =
		sequenceRefsByLocus[
			locusId
		];

	if(sequenceRefs === undefined ||
		sequenceRefs.length === 0) {

		skippedNoSequence.push(
			locusId
		);

		continue;
	}

	if(sequenceRefs.length !== 1) {

		skippedMultipleSequences.push(
			locusId
		);

		continue;
	}

	var sequenceRef =
		sequenceRefs[0];

	var locusType =
		locus.locus_type !== null
			? locus.locus_type.toLowerCase()
			: null;


	// -----------------------------------------------------------------
	// ERV / internal locus placement
	// -----------------------------------------------------------------

	if(locusType === "erv") {

		var ervTargets =
			ervTargetsByLocus[
				locusId
			];

		if(ervTargets === undefined ||
			ervTargets.length === 0) {

			skippedNoErvTarget.push(
				locusId
			);

			continue;
		}

		if(ervTargets.length !== 1) {

			skippedMultipleErvTargets.push(
				locusId
			);

			continue;
		}

		var ervTargetKey =
			ervTargets[0];

		var ervTarget =
			ervTargetDetailsByKey[
				ervTargetKey
			];

		var ervAlignmentName =
			expectedErvAlignmentName(
				ervTarget.lineage_id,
				ervTarget.entity_type
			);

		if(ervAlignmentName === null ||
			existingAlignmentByName[
				ervAlignmentName
			] !== true) {

			skippedMissingErvAlignment.push({
				locus_id:
					locusId,

				lineage_id:
					ervTarget.lineage_id,

				entity_type:
					ervTarget.entity_type,

				expected_alignment:
					ervAlignmentName
			});

			continue;
		}

		placements.push({
			locus_id:
				locusId,

			source_name:
				sequenceRef.source_name,

			sequence_id:
				sequenceRef.sequence_id,

			alignment_name:
				ervAlignmentName,

			target_type:
				ervTarget.entity_type,

			target_id:
				ervTarget.lineage_id
		});

		continue;
	}


	// -----------------------------------------------------------------
	// Solo-LTR locus placement
	// -----------------------------------------------------------------

	if(locusType === "solo_ltr") {

		var ltrTargets =
			ltrTargetsByLocus[
				locusId
			];

		if(ltrTargets === undefined ||
			ltrTargets.length === 0) {

			skippedNoLtrTarget.push(
				locusId
			);

			continue;
		}

		if(ltrTargets.length !== 1) {

			skippedMultipleLtrTargets.push(
				locusId
			);

			continue;
		}

		var ltrLineageId =
			ltrTargets[0];

		var ltrResolution =
			resolveLtrAlignmentName(
				ltrLineageId
			);

		if(ltrResolution.status ===
			"missing") {

			skippedMissingLtrAlignment.push({
				locus_id:
					locusId,

				ltr_lineage_id:
					ltrLineageId
			});

			continue;
		}

		if(ltrResolution.status ===
			"ambiguous") {

			skippedAmbiguousLtrAlignment.push({
				locus_id:
					locusId,

				ltr_lineage_id:
					ltrLineageId,

				candidates:
					ltrResolution.candidates
			});

			continue;
		}

		placements.push({
			locus_id:
				locusId,

			source_name:
				sequenceRef.source_name,

			sequence_id:
				sequenceRef.sequence_id,

			alignment_name:
				ltrResolution.alignment_name,

			target_type:
				"ltr_lineage",

			target_id:
				ltrLineageId
		});
	}
}


// -------------------------------------------------------------------------
// Group required placements by alignment
// -------------------------------------------------------------------------

log(
	"Grouping resolved locus placements by alignment"
);

var placementsByAlignment = {};

for(var i = 0;
	i < placements.length;
	i++) {

	var placement =
		placements[i];

	if(placementsByAlignment[
		placement.alignment_name
	] === undefined) {

		placementsByAlignment[
			placement.alignment_name
		] = [];
	}

	placementsByAlignment[
		placement.alignment_name
	].push(
		placement
	);
}


// -------------------------------------------------------------------------
// Add missing members alignment by alignment
// -------------------------------------------------------------------------

log(
	"Adding resolved locus sequences to alignments"
);

var addedCount = 0;
var alreadyPresentCount = 0;

var targetAlignmentNames =
	sortedKeys(
		placementsByAlignment
	);

for(var alignmentIndex = 0;
	alignmentIndex < targetAlignmentNames.length;
	alignmentIndex++) {

	var alignmentName =
		targetAlignmentNames[
			alignmentIndex
		];

	var alignmentPlacements =
		placementsByAlignment[
			alignmentName
		];

	/*
	 * Alignment members are queried from within the alignment mode.
	 * There is no project-mode "list member" command.
	 */
	glue.inMode(
		"alignment/" +
		alignmentName,

		function() {

			var memberRows =
				queryObjects([
					"list",
					"member",
					"sequence.source.name",
					"sequence.sequenceID"
				]);

			var existingMembership = {};

			for(var memberIndex = 0;
				memberIndex < memberRows.length;
				memberIndex++) {

				var memberRow =
					memberRows[
						memberIndex
					];

				var sourceName =
					norm(
						memberRow[
							"sequence.source.name"
						]
					);

				var sequenceID =
					norm(
						memberRow[
							"sequence.sequenceID"
						]
					);

				if(sourceName === null ||
					sequenceID === null) {

					continue;
				}

				var membershipKey =
					sourceName +
					"\t" +
					sequenceID;

				existingMembership[
					membershipKey
				] = true;
			}

			for(var placementIndex = 0;
				placementIndex < alignmentPlacements.length;
				placementIndex++) {

				var placement =
					alignmentPlacements[
						placementIndex
					];

				var membershipKey =
					placement.source_name +
					"\t" +
					placement.sequence_id;

				if(existingMembership[
					membershipKey
				] === true) {

					alreadyPresentCount++;
					continue;
				}

				glue.command([
					"add",
					"member",
					placement.source_name,
					placement.sequence_id
				]);

				existingMembership[
					membershipKey
				] = true;

				addedCount++;

				if(addedCount % 10000 === 0) {

					log(
						"Added " +
						addedCount +
						" locus sequences to alignments"
					);
				}
			}
		}
	);
}




// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

log(
	"============================================================"
);

log(
	"Resolved locus alignment summary"
);

log(
	"============================================================"
);

log(
	"Permanent ERV loci examined: " +
	locusIds.length
);

log(
	"Resolved alignment placements identified: " +
	placements.length
);

log(
	"New alignment members added: " +
	addedCount
);

log(
	"Members already present: " +
	alreadyPresentCount
);

log(
	"Loci skipped because no linked sequence exists: " +
	skippedNoSequence.length
);

log(
	"Loci skipped because multiple linked sequences exist: " +
	skippedMultipleSequences.length
);

log(
	"ERV loci skipped because no resolved ERV target exists: " +
	skippedNoErvTarget.length
);

log(
	"ERV loci skipped because multiple ERV targets exist: " +
	skippedMultipleErvTargets.length
);

log(
	"ERV loci skipped because the expected ERV alignment is missing: " +
	skippedMissingErvAlignment.length
);

log(
	"Solo-LTR loci skipped because no LTR target exists: " +
	skippedNoLtrTarget.length
);

log(
	"Solo-LTR loci skipped because multiple LTR targets exist: " +
	skippedMultipleLtrTargets.length
);

log(
	"Solo-LTR loci skipped because the expected LTR alignment is missing: " +
	skippedMissingLtrAlignment.length
);

log(
	"Solo-LTR loci skipped because LTR alignment resolution is ambiguous: " +
	skippedAmbiguousLtrAlignment.length
);


// -------------------------------------------------------------------------
// Detailed reports
// -------------------------------------------------------------------------

for(var i = 0;
	i < skippedMultipleErvTargets.length;
	i++) {

	var locusId =
		skippedMultipleErvTargets[i];

	log(
		"SKIP_MULTIPLE_ERV_TARGETS\t" +
		locusId +
		"\t" +
		ervTargetsByLocus[
			locusId
		].join(",")
	);
}


for(var i = 0;
	i < skippedMissingErvAlignment.length;
	i++) {

	var item =
		skippedMissingErvAlignment[i];

	log(
		"SKIP_MISSING_ERV_ALIGNMENT\t" +
		item.locus_id +
		"\t" +
		item.entity_type +
		"\t" +
		item.lineage_id +
		"\t" +
		item.expected_alignment
	);
}


for(var i = 0;
	i < skippedMultipleLtrTargets.length;
	i++) {

	var locusId =
		skippedMultipleLtrTargets[i];

	log(
		"SKIP_MULTIPLE_LTR_TARGETS\t" +
		locusId +
		"\t" +
		ltrTargetsByLocus[
			locusId
		].join(",")
	);
}


for(var i = 0;
	i < skippedMissingLtrAlignment.length;
	i++) {

	var item =
		skippedMissingLtrAlignment[i];

	log(
		"SKIP_MISSING_LTR_ALIGNMENT\t" +
		item.locus_id +
		"\t" +
		item.ltr_lineage_id
	);
}


for(var i = 0;
	i < skippedAmbiguousLtrAlignment.length;
	i++) {

	var item =
		skippedAmbiguousLtrAlignment[i];

	log(
		"SKIP_AMBIGUOUS_LTR_ALIGNMENT\t" +
		item.locus_id +
		"\t" +
		item.ltr_lineage_id +
		"\t" +
		item.candidates.join(",")
	);
}


log(
	"Finished adding resolved ERV loci to alignments"
);
