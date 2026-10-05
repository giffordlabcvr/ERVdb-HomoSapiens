// glue/build/summariseErvLocusLayer.js
//
// Summarise and perform consistency checks on the completed permanent
// ERV locus layer.
//
// Current ERV entity types:
//
//   lineage
//   sublineage
//   erv_derived_repeat
//   uncertain
//
// The first three are treated as resolved ERV entity associations.
// "uncertain" is reported but is not treated as a resolved target.
//
// This script is read-only.


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


function query(commandWords) {

	return glue.tableToObjects(
		glue.command(
			commandWords
		)
	);
}


function increment(
	map,
	key
) {

	if(key === null ||
		key === undefined) {

		key = "(null)";
	}

	if(map[key] === undefined) {
		map[key] = 0;
	}

	map[key]++;
}


function addUnique(
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


function printCounts(
	title,
	counts
) {

	log("");
	log(title);

	var keys =
		sortedKeys(counts);

	if(keys.length === 0) {

		log("  (none)");
		return;
	}

	for(var i = 0;
		i < keys.length;
		i++) {

		var key =
			keys[i];

		log(
			"  " +
			key +
			": " +
			counts[key]
		);
	}
}


function printExamples(
	title,
	items,
	formatter
) {

	log("");
	log(
		title +
		": " +
		items.length
	);

	var limit =
		Math.min(
			items.length,
			20
		);

	for(var i = 0;
		i < limit;
		i++) {

		log(
			"  " +
			formatter(
				items[i]
			)
		);
	}

	if(items.length > limit) {

		log(
			"  ... " +
			(items.length - limit) +
			" more"
		);
	}
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
			"AL_ERVR_" +
			suffix
		);
	}

	/*
	 * In particular, entity_type = "uncertain"
	 * has no resolved alignment target.
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
// Header
// -------------------------------------------------------------------------

log("");
log("============================================================");
log("Permanent ERV locus inventory");
log("============================================================");


// -------------------------------------------------------------------------
// Load permanent ERV loci
// -------------------------------------------------------------------------

var locusRows =
	query([
		"list",
		"custom-table-row",
		"erv_locus",
		"id",
		"host_species",
		"genome_build",
		"scaffold",
		"start_position",
		"end_position",
		"orientation",
		"locus_type",
		"structural_profile",
		"taxonomic_resolution",
		"is_high_support",
		"curation_tier",
		"orthology_group",
		"missillac_id",
		"-s",
		"id"
	]);

var loci = {};

var locusTypeCounts = {};
var structuralProfileCounts = {};
var taxonomicResolutionCounts = {};
var highSupportCounts = {};
var curationTierCounts = {};

for(var i = 0;
	i < locusRows.length;
	i++) {

	var row =
		locusRows[i];

	var locusId =
		norm(
			row.id
		);

	if(locusId === null) {
		continue;
	}

	var locus = {

		id:
			locusId,

		hostSpecies:
			norm(
				row.host_species
			),

		genomeBuild:
			norm(
				row.genome_build
			),

		scaffold:
			norm(
				row.scaffold
			),

		startPosition:
			normInt(
				row.start_position
			),

		endPosition:
			normInt(
				row.end_position
			),

		orientation:
			norm(
				row.orientation
			),

		locusType:
			norm(
				row.locus_type
			),

		structuralProfile:
			norm(
				row.structural_profile
			),

		taxonomicResolution:
			norm(
				row.taxonomic_resolution
			),

		isHighSupport:
			norm(
				row.is_high_support
			),

		curationTier:
			norm(
				row.curation_tier
			),

		orthologyGroup:
			normInt(
				row.orthology_group
			),

		missillacId:
			norm(
				row.missillac_id
			)
	};

	loci[
		locusId
	] = locus;

	increment(
		locusTypeCounts,
		locus.locusType
	);

	increment(
		structuralProfileCounts,
		locus.structuralProfile
	);

	increment(
		taxonomicResolutionCounts,
		locus.taxonomicResolution
	);

	increment(
		highSupportCounts,
		locus.isHighSupport
	);

	increment(
		curationTierCounts,
		locus.curationTier
	);
}


log(
	"Permanent ERV loci: " +
	Object.keys(loci).length
);

printCounts(
	"Locus counts by locus_type",
	locusTypeCounts
);

printCounts(
	"Locus counts by structural_profile",
	structuralProfileCounts
);

printCounts(
	"Locus counts by taxonomic_resolution",
	taxonomicResolutionCounts
);

printCounts(
	"Locus counts by is_high_support",
	highSupportCounts
);

printCounts(
	"Locus counts by curation_tier",
	curationTierCounts
);


// -------------------------------------------------------------------------
// Load sequences linked to permanent loci
// -------------------------------------------------------------------------

log("");
log("============================================================");
log("Permanent locus sequence links");
log("============================================================");

var sequenceRows =
	query([
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
var orphanSequenceLinks = [];

for(i = 0;
	i < sequenceRows.length;
	i++) {

	row =
		sequenceRows[i];

	var sequenceLocusId =
		norm(
			row[
				"erv_locus.id"
			]
		);

	var sourceName =
		norm(
			row[
				"source.name"
			]
		);

	var sequenceId =
		norm(
			row.sequenceID
		);

	if(sequenceLocusId === null ||
		loci[sequenceLocusId] === undefined) {

		orphanSequenceLinks.push({
			sourceName:
				sourceName,

			sequenceId:
				sequenceId,

			locusId:
				sequenceLocusId
		});

		continue;
	}

	if(sequenceRefsByLocus[
		sequenceLocusId
	] === undefined) {

		sequenceRefsByLocus[
			sequenceLocusId
		] = [];
	}

	sequenceRefsByLocus[
		sequenceLocusId
	].push({
		sourceName:
			sourceName,

		sequenceId:
			sequenceId
	});
}


var lociWithoutSequence = [];
var lociWithMultipleSequences = [];

var locusIds =
	sortedKeys(loci);

for(i = 0;
	i < locusIds.length;
	i++) {

	var locusId =
		locusIds[i];

	var sequenceRefs =
		sequenceRefsByLocus[
			locusId
		];

	if(sequenceRefs === undefined ||
		sequenceRefs.length === 0) {

		lociWithoutSequence.push(
			locusId
		);
	}
	else if(sequenceRefs.length > 1) {

		lociWithMultipleSequences.push({
			locusId:
				locusId,

			count:
				sequenceRefs.length
		});
	}
}


log(
	"Sequences linked to permanent loci: " +
	sequenceRows.length
);

printExamples(
	"Permanent loci without a linked sequence",
	lociWithoutSequence,
	function(x) {
		return x;
	}
);

printExamples(
	"Permanent loci with multiple linked sequences",
	lociWithMultipleSequences,
	function(x) {
		return (
			x.locusId +
			" [" +
			x.count +
			"]"
		);
	}
);

printExamples(
	"Sequence links pointing to missing permanent loci",
	orphanSequenceLinks,
	function(x) {
		return (
			x.sourceName +
			"/" +
			x.sequenceId +
			" -> " +
			x.locusId
		);
	}
);


// -------------------------------------------------------------------------
// Load ERV locus-to-lineage associations
// -------------------------------------------------------------------------

log("");
log("============================================================");
log("ERV locus-to-entity associations");
log("============================================================");

var lineageAssocRows =
	query([
		"list",
		"custom-table-row",
		"erv_locus_lineage_assoc",
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

var lineageTargetsByLocus = {};
var lineageDetails = {};

var lineageCounts = {};
var entityTypeCounts = {};

var orphanLineageAssocs = [];
var uncertainLineageAssocs = [];
var unsupportedEntityTypeAssocs = [];

for(i = 0;
	i < lineageAssocRows.length;
	i++) {

	row =
		lineageAssocRows[i];

	var assocLocusId =
		norm(
			row[
				"erv_locus.id"
			]
		);

	var lineageId =
		norm(
			row[
				"erv_lineage.id"
			]
		);

	var entityType =
		norm(
			row[
				"erv_lineage.entity_type"
			]
		);

	if(assocLocusId === null ||
		loci[assocLocusId] === undefined ||
		lineageId === null ||
		entityType === null) {

		orphanLineageAssocs.push(
			norm(
				row.id
			)
		);

		continue;
	}

	entityType =
		entityType.toLowerCase();

	increment(
		lineageCounts,
		lineageId
	);

	increment(
		entityTypeCounts,
		entityType
	);

	/*
	 * "uncertain" is deliberately not considered a resolved
	 * ERV entity target.
	 */
	if(entityType === "uncertain") {

		uncertainLineageAssocs.push({
			id:
				norm(
					row.id
				),

			locusId:
				assocLocusId,

			lineageId:
				lineageId
		});

		continue;
	}

	if(entityType !== "lineage" &&
		entityType !== "sublineage" &&
		entityType !==
			"erv_derived_repeat") {

		unsupportedEntityTypeAssocs.push({
			id:
				norm(
					row.id
				),

			locusId:
				assocLocusId,

			lineageId:
				lineageId,

			entityType:
				entityType
		});

		continue;
	}

	var targetKey =
		entityType +
		"\t" +
		lineageId;

	addUnique(
		lineageTargetsByLocus,
		assocLocusId,
		targetKey
	);

	lineageDetails[
		targetKey
	] = {
		id:
			lineageId,

		entityType:
			entityType
	};
}


log(
	"ERV locus-to-entity association rows: " +
	lineageAssocRows.length
);

printCounts(
	"Association counts by entity_type",
	entityTypeCounts
);

printExamples(
	"Uncertain ERV-lineage associations excluded from resolved targets",
	uncertainLineageAssocs,
	function(x) {

		return (
			x.id +
			" [" +
			x.locusId +
			" -> " +
			x.lineageId +
			"]"
		);
	}
);

printExamples(
	"Associations with unsupported ERV entity_type",
	unsupportedEntityTypeAssocs,
	function(x) {

		return (
			x.id +
			" [" +
			x.locusId +
			" -> " +
			x.lineageId +
			"; " +
			x.entityType +
			"]"
		);
	}
);

printExamples(
	"Orphan/incomplete ERV-lineage associations",
	orphanLineageAssocs,
	function(x) {
		return x;
	}
);


// -------------------------------------------------------------------------
// Summarise resolved ERV targets per locus
// -------------------------------------------------------------------------

var lociWithoutResolvedErvTarget = [];
var lociWithMultipleResolvedErvTargets = [];

for(i = 0;
	i < locusIds.length;
	i++) {

	locusId =
		locusIds[i];

	var targets =
		lineageTargetsByLocus[
			locusId
		];

	if(targets === undefined ||
		targets.length === 0) {

		lociWithoutResolvedErvTarget.push(
			locusId
		);
	}
	else if(targets.length > 1) {

		lociWithMultipleResolvedErvTargets.push({
			locusId:
				locusId,

			targets:
				targets
		});
	}
}


printExamples(
	"Loci without a resolved ERV entity association",
	lociWithoutResolvedErvTarget,
	function(x) {
		return x;
	}
);

printExamples(
	"Loci with multiple resolved ERV entity associations",
	lociWithMultipleResolvedErvTargets,
	function(x) {

		return (
			x.locusId +
			" [" +
			x.targets.join(",") +
			"]"
		);
	}
);


// -------------------------------------------------------------------------
// Load locus-to-LTR-lineage associations
// -------------------------------------------------------------------------

log("");
log("============================================================");
log("ERV locus-to-LTR-lineage associations");
log("============================================================");

var ltrAssocRows =
	query([
		"list",
		"custom-table-row",
		"erv_locus_ltr_assoc",
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
var ltrLineageCounts = {};
var orphanLtrAssocs = [];

for(i = 0;
	i < ltrAssocRows.length;
	i++) {

	row =
		ltrAssocRows[i];

	var ltrAssocLocusId =
		norm(
			row[
				"erv_locus.id"
			]
		);

	var ltrLineageId =
		norm(
			row[
				"ltr_lineage.id"
			]
		);

	if(ltrAssocLocusId === null ||
		loci[ltrAssocLocusId] === undefined ||
		ltrLineageId === null) {

		orphanLtrAssocs.push(
			norm(
				row.id
			)
		);

		continue;
	}

	addUnique(
		ltrTargetsByLocus,
		ltrAssocLocusId,
		ltrLineageId
	);

	increment(
		ltrLineageCounts,
		ltrLineageId
	);
}


log(
	"ERV locus-to-LTR-lineage association rows: " +
	ltrAssocRows.length
);

printExamples(
	"Orphan/incomplete LTR-lineage associations",
	orphanLtrAssocs,
	function(x) {
		return x;
	}
);


// -------------------------------------------------------------------------
// Solo-LTR association checks
// -------------------------------------------------------------------------

var soloLtrWithoutTarget = [];
var soloLtrMultipleTargets = [];

for(i = 0;
	i < locusIds.length;
	i++) {

	locusId =
		locusIds[i];

	var locus =
		loci[
			locusId
		];

	var locusType =
		locus.locusType !== null
			? locus.locusType.toLowerCase()
			: null;

	if(locusType !== "solo_ltr") {
		continue;
	}

	var ltrTargets =
		ltrTargetsByLocus[
			locusId
		];

	if(ltrTargets === undefined ||
		ltrTargets.length === 0) {

		soloLtrWithoutTarget.push(
			locusId
		);
	}
	else if(ltrTargets.length > 1) {

		soloLtrMultipleTargets.push({
			locusId:
				locusId,

			targets:
				ltrTargets
		});
	}
}


printExamples(
	"Solo-LTR loci without an LTR-lineage association",
	soloLtrWithoutTarget,
	function(x) {
		return x;
	}
);

printExamples(
	"Solo-LTR loci with multiple LTR-lineage associations",
	soloLtrMultipleTargets,
	function(x) {

		return (
			x.locusId +
			" [" +
			x.targets.join(",") +
			"]"
		);
	}
);


// -------------------------------------------------------------------------
// Missillac naming summary
// -------------------------------------------------------------------------

log("");
log("============================================================");
log("Missillac identifier summary");
log("============================================================");

var namedLoci = [];
var unnamedEligibleLoci = [];
var namedIneligibleLoci = [];

var missillacIdToLoci = {};
var lineageNumberToLoci = {};

for(i = 0;
	i < locusIds.length;
	i++) {

	locusId =
		locusIds[i];

	locus =
		loci[
			locusId
		];

	targets =
		lineageTargetsByLocus[
			locusId
		];

	if(targets === undefined) {
		targets = [];
	}

	locusType =
		locus.locusType !== null
			? locus.locusType.toLowerCase()
			: null;

	/*
	 * Current Missillac eligibility rule:
	 *
	 *   - exactly one resolved ERV entity association;
	 *   - locus_type = erv or solo_ltr.
	 *
	 * NOTE:
	 *
	 * Because erv_derived_repeat is currently treated as a resolved ERV
	 * entity type, such loci are included by this rule. If ERV-derived
	 * repeats are later excluded from Missillac nomenclature, this rule
	 * should be changed here and in applyErvLocusNames.js together.
	 */
	var eligible =
		targets.length === 1 &&
		(
			locusType === "erv" ||
			locusType === "solo_ltr"
		);

	var hasOrthologyGroup =
		locus.orthologyGroup !== null;

	var hasMissillacId =
		locus.missillacId !== null;

	var isNamed =
		hasOrthologyGroup &&
		hasMissillacId;

	if(isNamed) {

		namedLoci.push(
			locusId
		);

		if(!eligible) {

			namedIneligibleLoci.push(
				locusId
			);
		}

		if(missillacIdToLoci[
			locus.missillacId
		] === undefined) {

			missillacIdToLoci[
				locus.missillacId
			] = [];
		}

		missillacIdToLoci[
			locus.missillacId
		].push(
			locusId
		);

		if(targets.length === 1) {

			var targetDetail =
				lineageDetails[
					targets[0]
				];

			if(targetDetail !== undefined) {

				var lineageNumberKey =
					targetDetail.id +
					"\t" +
					locus.orthologyGroup;

				if(lineageNumberToLoci[
					lineageNumberKey
				] === undefined) {

					lineageNumberToLoci[
						lineageNumberKey
					] = [];
				}

				lineageNumberToLoci[
					lineageNumberKey
				].push(
					locusId
				);
			}
		}
	}
	else if(eligible) {

		unnamedEligibleLoci.push(
			locusId
		);
	}
}


var duplicateMissillacIds = [];

var missillacIds =
	sortedKeys(
		missillacIdToLoci
	);

for(i = 0;
	i < missillacIds.length;
	i++) {

	var missillacId =
		missillacIds[i];

	if(missillacIdToLoci[
		missillacId
	].length > 1) {

		duplicateMissillacIds.push({
			missillacId:
				missillacId,

			loci:
				missillacIdToLoci[
					missillacId
				]
		});
	}
}


var duplicateLineageNumbers = [];

var lineageNumberKeys =
	sortedKeys(
		lineageNumberToLoci
	);

for(i = 0;
	i < lineageNumberKeys.length;
	i++) {

	var lineageNumberKey =
		lineageNumberKeys[i];

	if(lineageNumberToLoci[
		lineageNumberKey
	].length > 1) {

		duplicateLineageNumbers.push({
			key:
				lineageNumberKey,

			loci:
				lineageNumberToLoci[
					lineageNumberKey
				]
		});
	}
}


log(
	"Named loci: " +
	namedLoci.length
);

printExamples(
	"Eligible loci without a Missillac identifier",
	unnamedEligibleLoci,
	function(x) {
		return x;
	}
);

printExamples(
	"Named loci that are not currently eligible",
	namedIneligibleLoci,
	function(x) {
		return x;
	}
);

printExamples(
	"Duplicate Missillac identifiers",
	duplicateMissillacIds,
	function(x) {

		return (
			x.missillacId +
			" [" +
			x.loci.join(",") +
			"]"
		);
	}
);

printExamples(
	"Duplicate orthology-group numbers within an ERV entity",
	duplicateLineageNumbers,
	function(x) {

		return (
			x.key +
			" [" +
			x.loci.join(",") +
			"]"
		);
	}
);


// -------------------------------------------------------------------------
// Load existing alignments
// -------------------------------------------------------------------------

log("");
log("============================================================");
log("Alignment coverage");
log("============================================================");

var alignmentRows =
	query([
		"list",
		"alignment",
		"name",
		"-s",
		"name"
	]);

var alignmentByName = {};
var ltrAlignmentNamesByNormalisedKey = {};

for(i = 0;
	i < alignmentRows.length;
	i++) {

	var alignmentName =
		norm(
			alignmentRows[i].name
		);

	if(alignmentName === null) {
		continue;
	}

	alignmentByName[
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

			addUnique(
				ltrAlignmentNamesByNormalisedKey,
				normalisedKey,
				alignmentName
			);
		}
	}
}


// -------------------------------------------------------------------------
// Expected resolved ERV alignments
// -------------------------------------------------------------------------

var expectedErvAlignmentNames = {};
var missingErvAlignments = [];

var targetKeys =
	sortedKeys(
		lineageDetails
	);

for(i = 0;
	i < targetKeys.length;
	i++) {

	var targetKey =
		targetKeys[i];

	var detail =
		lineageDetails[
			targetKey
		];

	var expectedAlignment =
		expectedErvAlignmentName(
			detail.id,
			detail.entityType
		);

	if(expectedAlignment === null) {
		continue;
	}

	expectedErvAlignmentNames[
		expectedAlignment
	] = true;

	if(alignmentByName[
		expectedAlignment
	] !== true) {

		missingErvAlignments.push({
			lineageId:
				detail.id,

			entityType:
				detail.entityType,

			alignmentName:
				expectedAlignment
		});
	}
}


log(
	"Distinct expected resolved ERV alignments used by loci: " +
	Object.keys(
		expectedErvAlignmentNames
	).length
);

printExamples(
	"Expected resolved ERV alignments that are missing",
	missingErvAlignments,
	function(x) {

		return (
			x.entityType +
			":" +
			x.lineageId +
			" -> " +
			x.alignmentName
		);
	}
);


// -------------------------------------------------------------------------
// Expected LTR alignments
// -------------------------------------------------------------------------

var missingLtrAlignments = [];
var ambiguousLtrAlignments = [];

var ltrIds =
	sortedKeys(
		ltrLineageCounts
	);

for(i = 0;
	i < ltrIds.length;
	i++) {

	ltrLineageId =
		ltrIds[i];

	var directName =
		"AL_LTR_" +
		ltrLineageId;

	if(alignmentByName[
		directName
	] === true) {

		continue;
	}

	var normalisedKey =
		normaliseLtrAlignmentKey(
			ltrLineageId
		);

	var candidates =
		ltrAlignmentNamesByNormalisedKey[
			normalisedKey
		];

	if(candidates === undefined ||
		candidates.length === 0) {

		missingLtrAlignments.push(
			ltrLineageId
		);
	}
	else if(candidates.length > 1) {

		ambiguousLtrAlignments.push({
			ltrLineageId:
				ltrLineageId,

			candidates:
				candidates
		});
	}
}


printExamples(
	"LTR lineages used by loci but lacking an LTR alignment",
	missingLtrAlignments,
	function(x) {
		return x;
	}
);

printExamples(
	"LTR lineages with ambiguous alignment resolution",
	ambiguousLtrAlignments,
	function(x) {

		return (
			x.ltrLineageId +
			" [" +
			x.candidates.join(",") +
			"]"
		);
	}
);


// -------------------------------------------------------------------------
// Overall QA summary
// -------------------------------------------------------------------------

log("");
log("============================================================");
log("ERV locus layer QA summary");
log("============================================================");

var warningCount =
	lociWithoutSequence.length +
	lociWithMultipleSequences.length +
	orphanSequenceLinks.length +
	orphanLineageAssocs.length +
	uncertainLineageAssocs.length +
	unsupportedEntityTypeAssocs.length +
	lociWithMultipleResolvedErvTargets.length +
	orphanLtrAssocs.length +
	soloLtrWithoutTarget.length +
	soloLtrMultipleTargets.length +
	unnamedEligibleLoci.length +
	namedIneligibleLoci.length +
	duplicateMissillacIds.length +
	duplicateLineageNumbers.length +
	missingErvAlignments.length +
	missingLtrAlignments.length +
	ambiguousLtrAlignments.length;


log(
	"Permanent ERV loci: " +
	locusIds.length
);

log(
	"Permanent loci with exactly one linked sequence: " +
	(
		locusIds.length -
		lociWithoutSequence.length -
		lociWithMultipleSequences.length
	)
);

log(
	"Loci without a resolved ERV entity association: " +
	lociWithoutResolvedErvTarget.length
);

log(
	"Loci with multiple resolved ERV entity associations: " +
	lociWithMultipleResolvedErvTargets.length
);

log(
	"Uncertain ERV entity associations: " +
	uncertainLineageAssocs.length
);

log(
	"Named loci: " +
	namedLoci.length
);

log(
	"Eligible but unnamed loci: " +
	unnamedEligibleLoci.length
);

log(
	"QA warnings/issues detected: " +
	warningCount
);


if(warningCount === 0) {

	log(
		"ERV locus layer summary completed with no detected QA issues"
	);
}
else {

	log(
		"ERV locus layer summary completed; review the QA items above"
	);
}
