// glue/build/locus/summariseErvLocusLayer.js
//
// Read-only summary and integrity checks for the completed ERV locus layer.

var DETAIL_LIMIT = 100;

function log(message) {
	glue.logInfo(message);
}

function norm(value) {
	if(value === null || value === undefined) {
		return null;
	}
	var result = ("" + value).trim();
	if(result === "") {
		return null;
	}
	var lower = result.toLowerCase();
	if(lower === "n/a" || lower === "na" ||
		lower === "n/k" || lower === "nk" ||
		lower === "null" || lower === "none" ||
		lower === "unknown" || result === "-") {
		return null;
	}
	return result;
}

function normInt(value) {
	value = norm(value);
	if(value === null) {
		return null;
	}
	var number = parseInt(value, 10);
	return isNaN(number) ? null : number;
}

function query(commandWords) {
	return glue.tableToObjects(
		glue.command(commandWords)
	);
}

function increment(map, key) {
	key = norm(key);
	if(key === null) {
		key = "(not set)";
	}
	map[key] = (map[key] || 0) + 1;
}

function addUnique(map, key, value) {
	if(map[key] === undefined) {
		map[key] = [];
	}
	for(var i = 0; i < map[key].length; i++) {
		if(map[key][i] === value) {
			return;
		}
	}
	map[key].push(value);
}

function sortedKeys(map) {
	var keys = Object.keys(map);
	keys.sort();
	return keys;
}

function heading(title) {
	log("");
	log("============================================================");
	log(title);
	log("============================================================");
}

function printCounts(label, counts) {
	var keys = sortedKeys(counts);
	log(label + ":");
	for(var i = 0; i < keys.length; i++) {
		log("  " + keys[i] + ": " + counts[keys[i]]);
	}
}

function printExamples(label, rows, formatter) {
	log(label + ": " + rows.length);

	var limit = Math.min(
		rows.length,
		DETAIL_LIMIT
	);

	for(var i = 0; i < limit; i++) {
		log("  " + formatter(rows[i]));
	}

	if(rows.length > limit) {
		log(
			"  ... " +
			(rows.length - limit) +
			" more"
		);
	}
}

function standardErvAlignmentSuffix(lineageId) {
	lineageId = norm(lineageId);

	if(lineageId === null) {
		return null;
	}

	var suffix = lineageId
		.replace(
			/^ERVR-([A-Za-z0-9]+)(?=\.|$)/i,
			"$1R"
		)
		.replace(
			/^ERV-/i,
			""
		)
		.replace(
			/[^A-Za-z0-9]+/g,
			"_"
		)
		.replace(/^_+/, "")
		.replace(/_+$/, "");

	return suffix === "" ? null : suffix;
}

function expectedErvAlignmentName(
	lineageId,
	entityLevel
) {
	var suffix =
		standardErvAlignmentSuffix(
			lineageId
		);

	entityLevel = norm(entityLevel);

	if(suffix === null || entityLevel === null) {
		return null;
	}

	entityLevel = entityLevel.toLowerCase();

	if(entityLevel === "lineage") {
		return "AL_LINEAGE_" + suffix;
	}

	if(entityLevel === "sublineage") {
		return "AL_SUBLINEAGE_" + suffix;
	}

	return null;
}


// ========================================================================
// Permanent locus inventory
// ========================================================================

heading("Permanent ERV locus inventory");

var locusRows = query([
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
	"mosaic_component",
	"is_high_support",
	"curation_tier",
	"orthology_group",
	"missillac_id",
	"-s",
	"id"
]);

var loci = {};
var locusTypeCounts = {};
var resolutionCounts = {};
var profileCounts = {};
var supportCounts = {};
var tierCounts = {};
var invalidLocusRows = [];

for(var i = 0; i < locusRows.length; i++) {
	var row = locusRows[i];
	var id = norm(row.id);

	if(id === null) {
		continue;
	}

	var locus = {
		id: id,
		host: norm(row.host_species),
		build: norm(row.genome_build),
		scaffold: norm(row.scaffold),
		start: normInt(row.start_position),
		end: normInt(row.end_position),
		orientation: norm(row.orientation),
		type: norm(row.locus_type),
		profile: norm(row.structural_profile),
		resolution: norm(row.taxonomic_resolution),
		mosaicComponent: norm(row.mosaic_component),
		highSupport: norm(row.is_high_support),
		tier: norm(row.curation_tier),
		group: normInt(row.orthology_group),
		missillacId: norm(row.missillac_id)
	};

	loci[id] = locus;

	increment(locusTypeCounts, locus.type);
	increment(resolutionCounts, locus.resolution);
	increment(profileCounts, locus.profile);
	increment(supportCounts, locus.highSupport);
	increment(tierCounts, locus.tier);

	var problems = [];

	if(locus.host === null) {
		problems.push("host_species");
	}
	if(locus.build === null) {
		problems.push("genome_build");
	}
	if(locus.scaffold === null) {
		problems.push("scaffold");
	}
	if(locus.start === null || locus.start < 1) {
		problems.push("start_position");
	}
	if(locus.end === null ||
		(locus.start !== null &&
			locus.end < locus.start)) {
		problems.push("end_position");
	}
	if(locus.orientation !== "+" &&
		locus.orientation !== "-") {
		problems.push("orientation");
	}
	if(locus.type === null) {
		problems.push("locus_type");
	}
	if(locus.profile === null) {
		problems.push("structural_profile");
	}
	if(locus.resolution === null) {
		problems.push("taxonomic_resolution");
	}

	if(problems.length > 0) {
		invalidLocusRows.push({
			id: id,
			problems: problems
		});
	}
}

log("Permanent erv_locus rows: " + locusRows.length);
printCounts("Counts by locus_type", locusTypeCounts);
printCounts("Counts by taxonomic_resolution", resolutionCounts);
printCounts("Counts by structural_profile", profileCounts);
printCounts("Counts by is_high_support", supportCounts);
printCounts("Counts by curation_tier", tierCounts);

printExamples(
	"Loci with missing or invalid core fields",
	invalidLocusRows,
	function(x) {
		return x.id +
			" [" +
			x.problems.join(",") +
			"]";
	}
);


// ========================================================================
// Sequence coverage
// ========================================================================

heading("Permanent locus sequence coverage");

var sequenceRows = query([
	"list",
	"sequence",
	"source.name",
	"sequenceID",
	"length",
	"erv_locus.id",
	"-w",
	"erv_locus.id != null"
]);

var sequencesByLocus = {};

for(i = 0; i < sequenceRows.length; i++) {
	var sequenceLocusId =
		norm(
			sequenceRows[i]["erv_locus.id"]
		);

	if(sequenceLocusId === null) {
		continue;
	}

	if(sequencesByLocus[sequenceLocusId] === undefined) {
		sequencesByLocus[sequenceLocusId] = [];
	}

	sequencesByLocus[
		sequenceLocusId
	].push(sequenceRows[i]);
}

var lociWithoutSequence = [];
var lociWithMultipleSequences = [];
var sequenceLengthMismatches = [];
var unknownSequenceLocusLinks = [];

var locusIds = sortedKeys(loci);

for(i = 0; i < locusIds.length; i++) {
	var locusId = locusIds[i];
	var linkedSequences =
		sequencesByLocus[locusId] || [];

	if(linkedSequences.length === 0) {
		lociWithoutSequence.push(locusId);
		continue;
	}

	if(linkedSequences.length > 1) {
		lociWithMultipleSequences.push({
			id: locusId,
			count: linkedSequences.length
		});
	}

	if(linkedSequences.length === 1) {
		var sequenceLength =
			normInt(
				linkedSequences[0].length
			);

		var locusLength =
			loci[locusId].start !== null &&
			loci[locusId].end !== null
				? loci[locusId].end -
					loci[locusId].start + 1
				: null;

		if(sequenceLength !== null &&
			locusLength !== null &&
			sequenceLength !== locusLength) {
			sequenceLengthMismatches.push({
				id: locusId,
				sequenceLength: sequenceLength,
				locusLength: locusLength
			});
		}
	}
}

var sequenceLocusIds =
	sortedKeys(sequencesByLocus);

for(i = 0; i < sequenceLocusIds.length; i++) {
	if(loci[sequenceLocusIds[i]] === undefined) {
		unknownSequenceLocusLinks.push(
			sequenceLocusIds[i]
		);
	}
}

log(
	"Sequences linked to an erv_locus: " +
	sequenceRows.length
);

printExamples(
	"Loci without a linked sequence",
	lociWithoutSequence,
	function(x) {
		return x;
	}
);

printExamples(
	"Loci with multiple linked sequences",
	lociWithMultipleSequences,
	function(x) {
		return x.id + " [" + x.count + "]";
	}
);

printExamples(
	"Sequence/locus coordinate-length mismatches",
	sequenceLengthMismatches,
	function(x) {
		return x.id +
			" [sequence=" +
			x.sequenceLength +
			", coordinates=" +
			x.locusLength +
			"]";
	}
);

printExamples(
	"Sequence links to unknown erv_locus IDs",
	unknownSequenceLocusLinks,
	function(x) {
		return x;
	}
);


// ========================================================================
// ERV lineage associations
// ========================================================================

heading("ERV locus-to-lineage associations");

var lineageAssocRows = query([
	"list",
	"custom-table-row",
	"erv_locus_lineage_assoc",
	"id",
	"erv_locus.id",
	"erv_lineage.id",
	"erv_lineage.entity_level",
	"association_role",
	"evidence",
	"confidence"
]);

var lineageTargetsByLocus = {};
var lineageDetails = {};
var lineageCounts = {};
var entityLevelCounts = {};
var orphanLineageAssocs = [];

for(i = 0; i < lineageAssocRows.length; i++) {
	row = lineageAssocRows[i];

	var assocLocusId =
		norm(row["erv_locus.id"]);

	var lineageId =
		norm(row["erv_lineage.id"]);

	var entityLevel =
		norm(
			row["erv_lineage.entity_level"]
		);

	if(assocLocusId === null ||
		loci[assocLocusId] === undefined ||
		lineageId === null) {
		orphanLineageAssocs.push(
			norm(row.id)
		);
		continue;
	}

	var targetKey =
		(entityLevel || "") +
		"\t" +
		lineageId;

	addUnique(
		lineageTargetsByLocus,
		assocLocusId,
		targetKey
	);

	lineageDetails[targetKey] = {
		id: lineageId,
		entityLevel: entityLevel
	};

	increment(lineageCounts, lineageId);
	increment(entityLevelCounts, entityLevel);
}

var noLineage = [];
var multipleLineages = [];

for(i = 0; i < locusIds.length; i++) {
	locusId = locusIds[i];

	var targets =
		lineageTargetsByLocus[locusId] || [];

	if(targets.length === 0) {
		noLineage.push(locusId);
	}

	if(targets.length > 1) {
		multipleLineages.push({
			id: locusId,
			targets: targets
		});
	}
}

log(
	"erv_locus_lineage_assoc rows: " +
	lineageAssocRows.length
);

printCounts(
	"Association counts by erv_lineage.id",
	lineageCounts
);

printCounts(
	"Association counts by entity_level",
	entityLevelCounts
);

printExamples(
	"Loci without an ERV lineage/sublineage association",
	noLineage,
	function(x) {
		return x;
	}
);

printExamples(
	"Loci with multiple distinct lineage targets",
	multipleLineages,
	function(x) {
		return x.id +
			" [" +
			x.targets.join(",") +
			"]";
	}
);

printExamples(
	"Invalid or orphan lineage associations",
	orphanLineageAssocs,
	function(x) {
		return x;
	}
);


// ========================================================================
// LTR associations
// ========================================================================

heading("ERV locus-to-LTR associations");

var ltrAssocRows = query([
	"list",
	"custom-table-row",
	"erv_locus_ltr_assoc",
	"id",
	"erv_locus.id",
	"ltr_lineage.id",
	"association_role",
	"evidence",
	"confidence",
	"region_start",
	"region_end"
]);

var ltrByLocus = {};
var ltrRoleCounts = {};
var orphanLtrAssocs = [];

for(i = 0; i < ltrAssocRows.length; i++) {
	row = ltrAssocRows[i];

	assocLocusId =
		norm(row["erv_locus.id"]);

	var ltrId =
		norm(row["ltr_lineage.id"]);

	var role =
		norm(row.association_role);

	if(assocLocusId === null ||
		loci[assocLocusId] === undefined ||
		ltrId === null) {
		orphanLtrAssocs.push(
			norm(row.id)
		);
		continue;
	}

	if(ltrByLocus[assocLocusId] === undefined) {
		ltrByLocus[assocLocusId] = [];
	}

	ltrByLocus[assocLocusId].push({
		ltrId: ltrId,
		role: role
	});

	increment(ltrRoleCounts, role);
}

var soloLtrWithoutAssoc = [];
var ervWithoutLtrAssoc = [];
var matchedPairedLtrs = [];
var mismatchedPairedLtrs = [];
var oneSidedLtrs = [];

for(i = 0; i < locusIds.length; i++) {
	locusId = locusIds[i];

	var locusType =
		loci[locusId].type === null
			? null
			: loci[locusId].type.toLowerCase();

	var ltrAssocs =
		ltrByLocus[locusId] || [];

	if(locusType === "solo_ltr" &&
		ltrAssocs.length === 0) {
		soloLtrWithoutAssoc.push(locusId);
	}

	if(locusType === "erv" &&
		ltrAssocs.length === 0) {
		ervWithoutLtrAssoc.push(locusId);
	}

	if(locusType !== "erv") {
		continue;
	}

	var five = {};
	var three = {};

	for(var j = 0; j < ltrAssocs.length; j++) {
		if(ltrAssocs[j].role ===
			"five_prime_ltr") {
			five[ltrAssocs[j].ltrId] = true;
		}

		if(ltrAssocs[j].role ===
			"three_prime_ltr") {
			three[ltrAssocs[j].ltrId] = true;
		}
	}

	var fiveIds = sortedKeys(five);
	var threeIds = sortedKeys(three);

	if(fiveIds.length === 1 &&
		threeIds.length === 1) {
		if(fiveIds[0] === threeIds[0]) {
			matchedPairedLtrs.push(locusId);
		} else {
			mismatchedPairedLtrs.push({
				id: locusId,
				five: fiveIds[0],
				three: threeIds[0]
			});
		}
	} else if(
		(fiveIds.length > 0 &&
			threeIds.length === 0) ||
		(fiveIds.length === 0 &&
			threeIds.length > 0)
	) {
		oneSidedLtrs.push(locusId);
	}
}

log(
	"erv_locus_ltr_assoc rows: " +
	ltrAssocRows.length
);

printCounts(
	"LTR associations by role",
	ltrRoleCounts
);

log(
	"ERV loci with one matching 5'/3' LTR lineage: " +
	matchedPairedLtrs.length
);

printExamples(
	"ERV loci with mismatched 5'/3' LTR lineages",
	mismatchedPairedLtrs,
	function(x) {
		return x.id +
			" [5'=" +
			x.five +
			", 3'=" +
			x.three +
			"]";
	}
);

printExamples(
	"ERV loci with only one positioned LTR side",
	oneSidedLtrs,
	function(x) {
		return x;
	}
);

printExamples(
	"ERV loci without an LTR association",
	ervWithoutLtrAssoc,
	function(x) {
		return x;
	}
);

printExamples(
	"Solo-LTR loci without an LTR association",
	soloLtrWithoutAssoc,
	function(x) {
		return x;
	}
);

printExamples(
	"Invalid or orphan LTR associations",
	orphanLtrAssocs,
	function(x) {
		return x;
	}
);


// ========================================================================
// Expected alignment objects
// ========================================================================

heading("Expected ERV alignment coverage");

var alignmentRows = query([
	"list",
	"alignment",
	"name"
]);

var alignmentExists = {};

for(i = 0; i < alignmentRows.length; i++) {
	var alignmentName =
		norm(alignmentRows[i].name);

	if(alignmentName !== null) {
		alignmentExists[alignmentName] = true;
	}
}

var missingExpectedAlignments = [];
var expectedAlignmentCounts = {};

for(i = 0; i < locusIds.length; i++) {
	locusId = locusIds[i];
	targets = lineageTargetsByLocus[locusId] || [];

	if(targets.length !== 1) {
		continue;
	}

	var detail =
		lineageDetails[targets[0]];

	var expectedAlignment =
		expectedErvAlignmentName(
			detail.id,
			detail.entityLevel
		);

	if(expectedAlignment === null) {
		continue;
	}

	increment(
		expectedAlignmentCounts,
		expectedAlignment
	);

	if(alignmentExists[expectedAlignment] !== true) {
		missingExpectedAlignments.push({
			id: locusId,
			lineageId: detail.id,
			expected: expectedAlignment
		});
	}
}

log(
	"Existing alignment objects: " +
	alignmentRows.length
);

log(
	"Distinct expected lineage/sublineage alignments used by loci: " +
	Object.keys(expectedAlignmentCounts).length
);

printExamples(
	"Resolved loci whose expected alignment object is missing",
	missingExpectedAlignments,
	function(x) {
		return x.id +
			" [" +
			x.lineageId +
			" -> " +
			x.expected +
			"]";
	}
);


// ========================================================================
// Missillac nomenclature
// ========================================================================

heading("Missillac nomenclature checks");

var eligibleNamingCount = 0;
var eligibleUnnamed = [];
var ineligibleNamed = [];
var inconsistentNames = [];
var lociByMissillacId = {};
var lociByGroupKey = {};

for(i = 0; i < locusIds.length; i++) {
	locusId = locusIds[i];

	var current =
		loci[locusId];

	targets =
		lineageTargetsByLocus[locusId] || [];

	locusType =
		current.type === null
			? null
			: current.type.toLowerCase();

	var eligible =
		targets.length === 1 &&
		(locusType === "erv" ||
			locusType === "solo_ltr");

	if(eligible) {
		eligibleNamingCount++;
		detail =
			lineageDetails[targets[0]];

		if(current.group === null ||
			current.missillacId === null) {
			eligibleUnnamed.push(locusId);
		} else {
			var expectedId =
				detail.id +
				"-" +
				current.group +
				(
					locusType === "solo_ltr"
						? "(LTR)"
						: ""
				);

			if(current.missillacId !== expectedId) {
				inconsistentNames.push({
					id: locusId,
					observed:
						current.missillacId,
					expected:
						expectedId
				});
			}

			addUnique(
				lociByMissillacId,
				current.missillacId,
				locusId
			);

			var groupKey =
				(current.host || "") +
				"\t" +
				(current.build || "") +
				"\t" +
				detail.id +
				"\t" +
				current.group;

			addUnique(
				lociByGroupKey,
				groupKey,
				locusId
			);
		}
	} else if(current.group !== null ||
		current.missillacId !== null) {
		ineligibleNamed.push(locusId);
	}
}

var duplicateMissillacIds = [];
var keys =
	sortedKeys(lociByMissillacId);

for(i = 0; i < keys.length; i++) {
	if(lociByMissillacId[keys[i]].length > 1) {
		duplicateMissillacIds.push({
			key: keys[i],
			loci: lociByMissillacId[keys[i]]
		});
	}
}

var duplicateGroups = [];
keys = sortedKeys(lociByGroupKey);

for(i = 0; i < keys.length; i++) {
	if(lociByGroupKey[keys[i]].length > 1) {
		duplicateGroups.push({
			key: keys[i],
			loci: lociByGroupKey[keys[i]]
		});
	}
}

log(
	"Loci eligible for Missillac nomenclature: " +
	eligibleNamingCount
);

log(
	"Eligible loci with complete nomenclature: " +
	(
		eligibleNamingCount -
		eligibleUnnamed.length
	)
);

printExamples(
	"Eligible loci missing orthology_group or missillac_id",
	eligibleUnnamed,
	function(x) {
		return x;
	}
);

printExamples(
	"Ineligible loci carrying nomenclature",
	ineligibleNamed,
	function(x) {
		return x;
	}
);

printExamples(
	"Missillac IDs inconsistent with lineage/group/type",
	inconsistentNames,
	function(x) {
		return x.id +
			" [observed=" +
			x.observed +
			", expected=" +
			x.expected +
			"]";
	}
);

printExamples(
	"Duplicate Missillac IDs",
	duplicateMissillacIds,
	function(x) {
		return x.key +
			" [" +
			x.loci.join(",") +
			"]";
	}
);

printExamples(
	"Duplicate lineage/orthology groups within a host build",
	duplicateGroups,
	function(x) {
		return x.key +
			" [" +
			x.loci.join(",") +
			"]";
	}
);


// ========================================================================
// Provenance
// ========================================================================

heading("Source provenance coverage");

function loadProvenanceLocusSet(tableName) {
	var rows = query([
		"list",
		"custom-table-row",
		tableName,
		"id",
		"erv_locus.id"
	]);

	var set = {};
	var orphan = [];

	for(var p = 0; p < rows.length; p++) {
		var linkedId =
			norm(rows[p]["erv_locus.id"]);

		if(linkedId === null ||
			loci[linkedId] === undefined) {
			orphan.push(
				norm(rows[p].id)
			);
		} else {
			set[linkedId] = true;
		}
	}

	return {
		rows: rows,
		set: set,
		orphan: orphan
	};
}

var digs =
	loadProvenanceLocusSet(
		"digs_locus"
	);

var repbase =
	loadProvenanceLocusSet(
		"erv_locus_repbase_assoc"
	);

var retrotector =
	loadProvenanceLocusSet(
		"retrotector_locus"
	);

var provenanceCombinationCounts = {};
var lociWithoutProvenance = [];

for(i = 0; i < locusIds.length; i++) {
	locusId = locusIds[i];

	var sources = [];

	if(digs.set[locusId]) {
		sources.push("DIGS");
	}
	if(repbase.set[locusId]) {
		sources.push("Repbase");
	}
	if(retrotector.set[locusId]) {
		sources.push("RetroTector");
	}

	var combination =
		sources.length === 0
			? "none"
			: sources.join("+");

	increment(
		provenanceCombinationCounts,
		combination
	);

	if(sources.length === 0) {
		lociWithoutProvenance.push(locusId);
	}
}

log(
	"DIGS provenance rows: " +
	digs.rows.length
);

log(
	"Repbase provenance rows: " +
	repbase.rows.length
);

log(
	"RetroTector provenance rows: " +
	retrotector.rows.length
);

printCounts(
	"Locus counts by provenance combination",
	provenanceCombinationCounts
);

printExamples(
	"Loci without source provenance",
	lociWithoutProvenance,
	function(x) {
		return x;
	}
);

printExamples(
	"Orphan DIGS provenance rows",
	digs.orphan,
	function(x) {
		return x;
	}
);

printExamples(
	"Orphan Repbase provenance rows",
	repbase.orphan,
	function(x) {
		return x;
	}
);

printExamples(
	"Orphan RetroTector provenance rows",
	retrotector.orphan,
	function(x) {
		return x;
	}
);


var legacyRows = query([
	"list",
	"custom-table-row",
	"erv_locus_legacy_xref",
	"id",
	"legacy_source",
	"mapping_status",
	"erv_locus.id"
]);

var legacyStatusCounts = {};
var legacySourceCounts = {};
var orphanLegacyRows = [];

for(i = 0; i < legacyRows.length; i++) {
	increment(
		legacyStatusCounts,
		legacyRows[i].mapping_status
	);

	increment(
		legacySourceCounts,
		legacyRows[i].legacy_source
	);

	var legacyLinkedId =
		norm(
			legacyRows[i]["erv_locus.id"]
		);

	if(legacyLinkedId !== null &&
		loci[legacyLinkedId] === undefined) {
		orphanLegacyRows.push(
			norm(legacyRows[i].id)
		);
	}
}

printCounts(
	"Legacy xrefs by mapping_status",
	legacyStatusCounts
);

printCounts(
	"Legacy xrefs by source",
	legacySourceCounts
);

printExamples(
	"Legacy xrefs linked to unknown loci",
	orphanLegacyRows,
	function(x) {
		return x;
	}
);


var aliasRows = query([
	"list",
	"custom-table-row",
	"erv_locus_alias",
	"id",
	"alias_source",
	"erv_locus.id"
]);

var aliasSourceCounts = {};
var orphanAliasRows = [];

for(i = 0; i < aliasRows.length; i++) {
	increment(
		aliasSourceCounts,
		aliasRows[i].alias_source
	);

	var aliasLocusId =
		norm(
			aliasRows[i]["erv_locus.id"]
		);

	if(aliasLocusId === null ||
		loci[aliasLocusId] === undefined) {
		orphanAliasRows.push(
			norm(aliasRows[i].id)
		);
	}
}

log(
	"ERV locus aliases: " +
	aliasRows.length
);

printCounts(
	"Aliases by source",
	aliasSourceCounts
);

printExamples(
	"Orphan locus aliases",
	orphanAliasRows,
	function(x) {
		return x;
	}
);


// ========================================================================
// Staging-to-permanent reconciliation
// ========================================================================

heading("Staging-to-permanent reconciliation");

var candidateRows = query([
	"list",
	"custom-table-row",
	"erv_locus_candidate",
	"id",
	"chrom",
	"start_position",
	"end_position",
	"strand",
	"status"
]);

var candidates = {};

for(i = 0; i < candidateRows.length; i++) {
	var candidateId =
		norm(candidateRows[i].id);

	if(candidateId !== null) {
		candidates[candidateId] =
			candidateRows[i];
	}
}

var candidatesWithoutLocus = [];
var lociWithoutCandidate = [];
var stagingDisagreements = [];

var candidateIds =
	sortedKeys(candidates);

for(i = 0; i < candidateIds.length; i++) {
	candidateId = candidateIds[i];

	if(loci[candidateId] === undefined) {
		candidatesWithoutLocus.push(
			candidateId
		);
	}
}

for(i = 0; i < locusIds.length; i++) {
	locusId = locusIds[i];

	if(candidates[locusId] === undefined) {
		lociWithoutCandidate.push(locusId);
		continue;
	}

	var candidate =
		candidates[locusId];

	current =
		loci[locusId];

	var differences = [];

	if(norm(candidate.chrom) !==
		current.scaffold) {
		differences.push("scaffold");
	}

	if(normInt(candidate.start_position) !==
		current.start) {
		differences.push("start");
	}

	if(normInt(candidate.end_position) !==
		current.end) {
		differences.push("end");
	}

	if(norm(candidate.strand) !==
		current.orientation) {
		differences.push("orientation");
	}

	var expectedType =
		norm(candidate.status);

	if(expectedType !== null) {
		expectedType =
			expectedType.toUpperCase() === "LTR"
				? "solo_ltr"
				: (
					expectedType.toUpperCase() === "ERV"
						? "erv"
						: expectedType.toLowerCase()
				);
	}

	if(expectedType !== current.type) {
		differences.push("locus_type");
	}

	if(differences.length > 0) {
		stagingDisagreements.push({
			id: locusId,
			differences: differences
		});
	}
}

log(
	"Staging erv_locus_candidate rows: " +
	candidateRows.length
);

log(
	"Permanent erv_locus rows: " +
	locusRows.length
);

printExamples(
	"Staging candidates without a permanent locus",
	candidatesWithoutLocus,
	function(x) {
		return x;
	}
);

printExamples(
	"Permanent loci without a staging candidate",
	lociWithoutCandidate,
	function(x) {
		return x;
	}
);

printExamples(
	"Staging/permanent field disagreements",
	stagingDisagreements,
	function(x) {
		return x.id +
			" [" +
			x.differences.join(",") +
			"]";
	}
);


// ========================================================================
// Final summary
// ========================================================================

heading("Final locus-layer check totals");

var criticalIssueCount =
	invalidLocusRows.length +
	lociWithoutSequence.length +
	lociWithMultipleSequences.length +
	unknownSequenceLocusLinks.length +
	orphanLineageAssocs.length +
	orphanLtrAssocs.length +
	missingExpectedAlignments.length +
	eligibleUnnamed.length +
	ineligibleNamed.length +
	inconsistentNames.length +
	duplicateMissillacIds.length +
	duplicateGroups.length +
	digs.orphan.length +
	repbase.orphan.length +
	retrotector.orphan.length +
	orphanLegacyRows.length +
	orphanAliasRows.length +
	lociWithoutCandidate.length +
	stagingDisagreements.length;

log(
	"Critical integrity issues: " +
	criticalIssueCount
);

log(
	"Review-only: candidates without permanent loci: " +
	candidatesWithoutLocus.length
);

log(
	"Review-only: loci without lineage association: " +
	noLineage.length
);

log(
	"Review-only: loci with multiple lineage associations: " +
	multipleLineages.length
);

log(
	"Review-only: ERV loci without LTR association: " +
	ervWithoutLtrAssoc.length
);

log(
	"Review-only: mismatched paired LTR lineages: " +
	mismatchedPairedLtrs.length
);

log(
	"Review-only: loci without provenance: " +
	lociWithoutProvenance.length
);

log(
	"Finished summarising the ERV locus layer"
);
