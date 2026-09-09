// glue/build/locus/missillac/applyErvLocusNames.js
//
// Assign Missillac identifiers and orthology-group numbers to permanent,
// taxonomically resolved ERV loci.
//
// Reads:
//
//   erv_locus
//   erv_locus_lineage_assoc
//   erv_lineage
//   erv_locus_legacy_xref
//
// Writes:
//
//   erv_locus.orthology_group
//   erv_locus.missillac_id
//
// Eligibility:
//
//   - the locus must have exactly one distinct erv_lineage association;
//   - the associated erv_lineage must have entity_level "lineage" or
//     "sublineage";
//   - locus_type must be "erv" or "solo_ltr".
//
// Numbering:
//
//   1. Preserve an unambiguous source_numeric_id from the authoritative
//      DBM/Gifford legacy source.
//   2. Allocate the lowest unused positive integer within each
//      erv_lineage.id namespace.
//   3. Allocate new numbers deterministically in genomic order.
//
// Identifier format:
//
//   <erv_lineage.id>-<orthology_group>
//
// Examples:
//
//   ERV-1.Eta.1-12
//   ERV-1.Zeta.W9P.P.1-4
//   ERVR-1.Theta.101-7
//
// For a solo LTR:
//
//   ERV-1.Eta.1-12(LTR)
//
// The "(LTR)" suffix describes the structural form of the locus. It does
// not change its orthology-group number.
//
// Loci resolved only at genus, subgenus, or clade level are not named.
// Mosaic and taxonomically unresolved loci are also left unnamed.

var DRY_RUN = false;

var LOCUS_TABLE =
	"erv_locus";

var LINEAGE_ASSOC_TABLE =
	"erv_locus_lineage_assoc";

var LEGACY_XREF_TABLE =
	"erv_locus_legacy_xref";

var NUMBERING_LEGACY_SOURCE =
	"compiled_human_erv_loci_hg19";


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


function customRowPath(
	tableName,
	rowId
) {

	return (
		"custom-table-row/" +
		tableName +
		"/" +
		rowId
	);
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


// -------------------------------------------------------------------------
// Genomic ordering
// -------------------------------------------------------------------------

function chromosomeRank(scaffold) {

	scaffold =
		norm(scaffold);

	if(scaffold === null) {
		return 1000;
	}

	var value =
		scaffold.replace(
			/^chr/i,
			""
		);

	var upper =
		value.toUpperCase();

	if(upper === "X") {
		return 23;
	}

	if(upper === "Y") {
		return 24;
	}

	if(upper === "M" ||
		upper === "MT") {

		return 25;
	}

	var number =
		parseInt(
			value,
			10
		);

	return isNaN(number)
		? 1000
		: number;
}


function compareNullableStrings(
	a,
	b
) {

	a = a === null ? "" : a;
	b = b === null ? "" : b;

	if(a < b) {
		return -1;
	}

	if(a > b) {
		return 1;
	}

	return 0;
}


function genomicSort(
	a,
	b
) {

	/*
	 * Keep ordering deterministic if additional host species or genome
	 * builds are incorporated later.
	 */
	var comparison =
		compareNullableStrings(
			a.host_species,
			b.host_species
		);

	if(comparison !== 0) {
		return comparison;
	}

	comparison =
		compareNullableStrings(
			a.genome_build,
			b.genome_build
		);

	if(comparison !== 0) {
		return comparison;
	}

	comparison =
		chromosomeRank(
			a.scaffold
		) -
		chromosomeRank(
			b.scaffold
		);

	if(comparison !== 0) {
		return comparison;
	}

	comparison =
		compareNullableStrings(
			a.scaffold,
			b.scaffold
		);

	if(comparison !== 0) {
		return comparison;
	}

	var aStart =
		a.start_position !== null
			? a.start_position
			: 0;

	var bStart =
		b.start_position !== null
			? b.start_position
			: 0;

	if(aStart !== bStart) {
		return aStart - bStart;
	}

   var aEnd =
	   a.end_position !== null
		   ? a.end_position
		   : 0;
		
	var bEnd =
		b.end_position !== null
			? b.end_position
			: 0;

	if(aEnd !== bEnd) {
		return aEnd - bEnd;
	}

	return compareNullableStrings(
		a.locus_id,
		b.locus_id
	);
}


// -------------------------------------------------------------------------
// Missillac identifier construction
// -------------------------------------------------------------------------

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
// Write the two permanent naming fields
// -------------------------------------------------------------------------

function writeLocusName(
	locusId,
	orthologyGroup,
	missillacId
) {

	if(DRY_RUN) {

		log(
			"[DRY RUN] Set erv_locus/" +
			locusId +
			": orthology_group=" +
			orthologyGroup +
			", missillac_id=" +
			missillacId
		);

		return;
	}

	glue.inMode(
		customRowPath(
			LOCUS_TABLE,
			locusId
		),

		function() {

			glue.command([
				"set",
				"field",
				"orthology_group",
				"" + orthologyGroup
			]);

			glue.command([
				"set",
				"field",
				"missillac_id",
				missillacId
			]);
		}
	);
}


// -------------------------------------------------------------------------
// Load permanent loci
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
		"host_species",
		"genome_build",
		"scaffold",
		"start_position",
		"end_position",
		"orientation",
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

		host_species:
			norm(
				locusRow.host_species
			),

		genome_build:
			norm(
				locusRow.genome_build
			),

		scaffold:
			norm(
				locusRow.scaffold
			),

		start_position:
			normInt(
				locusRow.start_position
			),

		end_position:
			normInt(
				locusRow.end_position
			),

		orientation:
			norm(
				locusRow.orientation
			),

		locus_type:
			norm(
				locusRow.locus_type
			),

		taxonomic_resolution:
			norm(
				locusRow.taxonomic_resolution
			),

		existing_orthology_group:
			positiveInt(
				locusRow.orthology_group
			),

		existing_missillac_id:
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
		"erv_lineage.entity_level",
		"association_role",
		"evidence",
		"confidence",
		"-s",
		"erv_locus.id,erv_lineage.id"
	]);

var lineageTargetsByLocus = {};
var lineageDetailsByTargetKey = {};

for(var i = 0;
	i < associationRows.length;
	i++) {

	var associationRow =
		associationRows[i];

	var associatedLocusId =
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

	var entityLevel =
		norm(
			associationRow[
				"erv_lineage.entity_level"
			]
		);

	if(associatedLocusId === null ||
		lineageId === null ||
		entityLevel === null) {

		continue;
	}

	var lowerEntityLevel =
		entityLevel.toLowerCase();

	if(lowerEntityLevel !== "lineage" &&
		lowerEntityLevel !== "sublineage") {

		continue;
	}

	var targetKey =
		lowerEntityLevel +
		"\t" +
		lineageId;

	addUniqueValue(
		lineageTargetsByLocus,
		associatedLocusId,
		targetKey
	);

	lineageDetailsByTargetKey[
		targetKey
	] = {
		lineage_id:
			lineageId,

		entity_level:
			lowerEntityLevel
	};
}

log(
	"Loaded " +
	associationRows.length +
	" locus-to-lineage association rows"
);


// -------------------------------------------------------------------------
// Load authoritative legacy-number claims
// -------------------------------------------------------------------------

log(
	"Loading authoritative DBM/Gifford numbering claims"
);

var legacyRows =
	queryObjects([
		"list",
		"custom-table-row",
		LEGACY_XREF_TABLE,
		"id",
		"legacy_name",
		"legacy_classification",
		"source_numeric_id",
		"erv_locus.id",
		"-w",
		"legacy_source = '" +
			NUMBERING_LEGACY_SOURCE +
			"' and " +
			"mapping_status = 'mapped' and " +
			"source_numeric_id != null",
		"-s",
		"erv_locus.id,source_numeric_id"
	]);

var legacyClaimsByLocus = {};

for(var i = 0;
	i < legacyRows.length;
	i++) {

	var legacyRow =
		legacyRows[i];


	var legacyLocusId =
		norm(
			legacyRow[
				"erv_locus.id"
			]
		);
	
	var sourceNumericId =
		positiveInt(
			legacyRow.source_numeric_id
		);

	if(legacyLocusId === null ||
		sourceNumericId === null) {

		continue;
	}

	if(legacyClaimsByLocus[
		legacyLocusId
	] === undefined) {

		legacyClaimsByLocus[
			legacyLocusId
		] = [];
	}

	legacyClaimsByLocus[
		legacyLocusId
	].push({
		xref_id:
			norm(
				legacyRow.id
			),

		legacy_name:
			norm(
				legacyRow.legacy_name
			),

		legacy_classification:
			norm(
				legacyRow.legacy_classification
			),

		source_numeric_id:
			sourceNumericId
	});
}

log(
	"Loaded " +
	legacyRows.length +
	" authoritative legacy-number xrefs"
);


// -------------------------------------------------------------------------
// Resolve the legacy number claimed by one locus
// -------------------------------------------------------------------------

function resolveLegacyNumber(
	locusId
) {

	var claims =
		legacyClaimsByLocus[
			locusId
		];

	if(claims === undefined ||
		claims.length === 0) {

		return {
			status:
				"none",

			number:
				null,

			claims:
				[]
		};
	}

	var numbersSeen = {};

	for(var i = 0;
		i < claims.length;
		i++) {

		numbersSeen[
			"" +
			claims[i].source_numeric_id
		] = true;
	}

	var distinctNumbers =
		Object.keys(
			numbersSeen
		);

	if(distinctNumbers.length !== 1) {

		return {
			status:
				"locus_conflict",

			number:
				null,

			claims:
				claims
		};
	}

	return {
		status:
			"preserved",

		number:
			parseInt(
				distinctNumbers[0],
				10
			),

		claims:
			claims
	};
}


// -------------------------------------------------------------------------
// Determine eligible and ineligible loci
// -------------------------------------------------------------------------

var eligibleByLineage = {};

var ineligibleNoLineage = [];
var ineligibleMultipleLineages = [];
var ineligibleResolution = [];
var ineligibleLocusType = [];
var legacyClaimConflicts = [];

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

	var lineageTargets =
		lineageTargetsByLocus[
			locusId
		];

	if(lineageTargets === undefined ||
		lineageTargets.length === 0) {

		ineligibleNoLineage.push({
			locus_id:
				locusId,

			taxonomic_resolution:
				locus.taxonomic_resolution
		});

		continue;
	}

	if(lineageTargets.length !== 1) {

		ineligibleMultipleLineages.push({
			locus_id:
				locusId,

			targets:
				lineageTargets.join(",")
		});

		continue;
	}

	var target =
		lineageDetailsByTargetKey[
			lineageTargets[0]
		];

	/*
	 * The association must resolve to a lineage or sublineage.
	 * This has already been enforced while loading the association map,
	 * but the explicit check keeps the eligibility rule clear.
	 */
	if(target.entity_level !== "lineage" &&
		target.entity_level !== "sublineage") {

		ineligibleResolution.push({
			locus_id:
				locusId,

			taxonomic_resolution:
				locus.taxonomic_resolution,

			entity_level:
				target.entity_level
		});

		continue;
	}

	var locusType =
		locus.locus_type !== null
			? locus.locus_type.toLowerCase()
			: null;

	if(locusType !== "erv" &&
		locusType !== "solo_ltr") {

		ineligibleLocusType.push({
			locus_id:
				locusId,

			locus_type:
				locus.locus_type
		});

		continue;
	}

	var legacyResolution =
		resolveLegacyNumber(
			locusId
		);

	if(legacyResolution.status ===
		"locus_conflict") {

		legacyClaimConflicts.push({
			locus_id:
				locusId,

			lineage_id:
				target.lineage_id,

			claims:
				legacyResolution.claims
		});
	}

	var item = {
		locus_id:
			locusId,

		host_species:
			locus.host_species,

		genome_build:
			locus.genome_build,

		scaffold:
			locus.scaffold,

		start_position:
			locus.start_position,

		end_position:
			locus.end_position,

		locus_type:
			locusType,

		taxonomic_resolution:
			locus.taxonomic_resolution,

		lineage_id:
			target.lineage_id,

		entity_level:
			target.entity_level,

		existing_orthology_group:
			locus.existing_orthology_group,

		existing_missillac_id:
			locus.existing_missillac_id,

		legacy_number_status:
			legacyResolution.status,

		legacy_number:
			legacyResolution.number,

		legacy_claims:
			legacyResolution.claims
	};

	if(eligibleByLineage[
		target.lineage_id
	] === undefined) {

		eligibleByLineage[
			target.lineage_id
		] = [];
	}

	eligibleByLineage[
		target.lineage_id
	].push(item);
}


// -------------------------------------------------------------------------
// Allocate orthology groups within each lineage
// -------------------------------------------------------------------------

var namedItems = [];
var numberingConflicts = [];

var preservedNumberCount = 0;
var newlyAllocatedCount = 0;
var unchangedCount = 0;
var changedCount = 0;

var lineageIds =
	Object.keys(
		eligibleByLineage
	);

lineageIds.sort();

for(var lineageIndex = 0;
	lineageIndex < lineageIds.length;
	lineageIndex++) {

	var lineageId =
		lineageIds[
			lineageIndex
		];

	var items =
		eligibleByLineage[
			lineageId
		];

	items.sort(
		genomicSort
	);

	/*
	 * Gather authoritative legacy-number claims within this lineage.
	 */
	var claimantsByNumber = {};

	for(var itemIndex = 0;
		itemIndex < items.length;
		itemIndex++) {

		var claimItem =
			items[itemIndex];

		if(claimItem.legacy_number_status !==
			"preserved") {

			continue;
		}

		var claimedNumberKey =
			"" +
			claimItem.legacy_number;

		if(claimantsByNumber[
			claimedNumberKey
		] === undefined) {

			claimantsByNumber[
				claimedNumberKey
			] = [];
		}

		claimantsByNumber[
			claimedNumberKey
		].push(
			claimItem
		);
	}

	var usedNumbers = {};
	var preservedNumberByLocus = {};
	var conflictingLocusIds = {};

	var claimedNumbers =
		Object.keys(
			claimantsByNumber
		);

	for(var claimIndex = 0;
		claimIndex < claimedNumbers.length;
		claimIndex++) {

		var numberKey =
			claimedNumbers[
				claimIndex
			];

		var claimants =
			claimantsByNumber[
				numberKey
			];

		/*
		 * In the current human hg19 layer, the same lineage and
		 * orthology-group number must not be claimed by multiple loci.
		 *
		 * When multi-species locus layers are introduced, this can be
		 * extended to allow the same number in different host genomes
		 * where orthology has been established.
		 */
		if(claimants.length !== 1) {

			var conflictingIds = [];

			for(var conflictIndex = 0;
				conflictIndex < claimants.length;
				conflictIndex++) {

				var conflictingItem =
					claimants[
						conflictIndex
					];

				conflictingLocusIds[
					conflictingItem.locus_id
				] = true;

				conflictingIds.push(
					conflictingItem.locus_id
				);
			}

			numberingConflicts.push({
				lineage_id:
					lineageId,

				orthology_group:
					parseInt(
						numberKey,
						10
					),

				locus_ids:
					conflictingIds
			});

			continue;
		}

		var soleClaimant =
			claimants[0];

		preservedNumberByLocus[
			soleClaimant.locus_id
		] = parseInt(
			numberKey,
			10
		);

		usedNumbers[
			numberKey
		] = true;
	}

	var nextAvailableNumber = 1;

	function allocateNextNumber() {

		while(usedNumbers[
			"" + nextAvailableNumber
		] === true) {

			nextAvailableNumber++;
		}

		var allocated =
			nextAvailableNumber;

		usedNumbers[
			"" + allocated
		] = true;

		nextAvailableNumber++;

		return allocated;
	}

	for(var itemIndex = 0;
		itemIndex < items.length;
		itemIndex++) {

		var item =
			items[itemIndex];

		if(item.legacy_number_status ===
			"locus_conflict") {

			continue;
		}

		if(conflictingLocusIds[
			item.locus_id
		] === true) {

			continue;
		}

		var orthologyGroup;
		var namingSource;

		if(preservedNumberByLocus[
			item.locus_id
		] !== undefined) {

			orthologyGroup =
				preservedNumberByLocus[
					item.locus_id
				];

			namingSource =
				NUMBERING_LEGACY_SOURCE;

			preservedNumberCount++;
		}
		else {

			orthologyGroup =
				allocateNextNumber();

			namingSource =
				"genomic_order";

			newlyAllocatedCount++;
		}

		var missillacId =
			makeMissillacId(
				item.lineage_id,
				orthologyGroup,
				item.locus_type
			);

		var unchanged =
			item.existing_orthology_group ===
				orthologyGroup &&
			item.existing_missillac_id ===
				missillacId;

		if(unchanged) {
			unchangedCount++;
		}
		else {
			changedCount++;
		}

		item.orthology_group =
			orthologyGroup;

		item.missillac_id =
			missillacId;

		item.naming_source =
			namingSource;

		item.unchanged =
			unchanged;

		namedItems.push(
			item
		);
	}
}


// -------------------------------------------------------------------------
// Check final Missillac-ID uniqueness
// -------------------------------------------------------------------------

var locusByMissillacId = {};
var duplicateMissillacIds = {};

for(var i = 0;
	i < namedItems.length;
	i++) {

	var namedItem =
		namedItems[i];

	var missillacId =
		namedItem.missillac_id;

	if(locusByMissillacId[
		missillacId
	] !== undefined) {

		duplicateMissillacIds[
			missillacId
		] = true;
	}
	else {

		locusByMissillacId[
			missillacId
		] = namedItem.locus_id;
	}
}

var duplicateMissillacIdValues =
	Object.keys(
		duplicateMissillacIds
	);

if(duplicateMissillacIdValues.length > 0) {

	throw new Error(
		"Refusing to write non-unique Missillac IDs: " +
		duplicateMissillacIdValues.join(", ")
	);
}


// -------------------------------------------------------------------------
// Write names to permanent erv_locus rows
// -------------------------------------------------------------------------

log(
	"Writing " +
	namedItems.length +
	" Missillac identifiers"
);

for(var i = 0;
	i < namedItems.length;
	i++) {

	var namedItem =
		namedItems[i];

	writeLocusName(
		namedItem.locus_id,
		namedItem.orthology_group,
		namedItem.missillac_id
	);

	if((i + 1) % 10000 === 0) {

		log(
			"Named " +
			(i + 1) +
			" loci"
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
	"Missillac locus-naming summary"
);

log(
	"============================================================"
);

log(
	"Permanent ERV loci examined: " +
	Object.keys(locusById).length
);

log(
	"Eligible lineage/sublineage-resolved loci: " +
	(
		namedItems.length +
		legacyClaimConflicts.length +
		numberingConflicts.length
	)
);

log(
	"Loci assigned a Missillac identifier: " +
	namedItems.length
);

log(
	"Preserved DBM/Gifford orthology groups: " +
	preservedNumberCount
);

log(
	"New orthology groups allocated: " +
	newlyAllocatedCount
);

log(
	"Assignments already unchanged: " +
	unchangedCount
);

log(
	"Assignments changed or newly written: " +
	changedCount
);

log(
	"Loci intentionally unnamed because no lineage/sublineage association exists: " +
	ineligibleNoLineage.length
);

log(
	"Loci intentionally unnamed because multiple lineage/sublineage associations exist: " +
	ineligibleMultipleLineages.length
);

log(
	"Loci intentionally unnamed because taxonomic resolution is ineligible: " +
	ineligibleResolution.length
);

log(
	"Loci intentionally unnamed because locus_type is unsupported: " +
	ineligibleLocusType.length
);

log(
	"Loci with conflicting legacy-number claims: " +
	legacyClaimConflicts.length
);

log(
	"Duplicated legacy numbers within a lineage: " +
	numberingConflicts.length
);


// -------------------------------------------------------------------------
// Detailed reports
// -------------------------------------------------------------------------

for(var i = 0;
	i < namedItems.length;
	i++) {

	var namedItem =
		namedItems[i];

	log(
		"ASSIGNED\t" +
		namedItem.locus_id +
		"\t" +
		namedItem.lineage_id +
		"\t" +
		namedItem.entity_level +
		"\t" +
		namedItem.orthology_group +
		"\t" +
		namedItem.missillac_id +
		"\t" +
		namedItem.naming_source
	);
}


for(var i = 0;
	i < ineligibleNoLineage.length;
	i++) {

	var noLineageItem =
		ineligibleNoLineage[i];

	log(
		"UNNAMED_NO_LINEAGE\t" +
		noLineageItem.locus_id +
		"\t" +
		noLineageItem.taxonomic_resolution
	);
}


for(var i = 0;
	i < ineligibleMultipleLineages.length;
	i++) {

	var multipleLineageItem =
		ineligibleMultipleLineages[i];

	log(
		"UNNAMED_MULTIPLE_LINEAGES\t" +
		multipleLineageItem.locus_id +
		"\t" +
		multipleLineageItem.targets
	);
}


for(var i = 0;
	i < ineligibleResolution.length;
	i++) {

	var resolutionItem =
		ineligibleResolution[i];

	log(
		"UNNAMED_INELIGIBLE_RESOLUTION\t" +
		resolutionItem.locus_id +
		"\t" +
		resolutionItem.taxonomic_resolution +
		"\t" +
		resolutionItem.entity_level
	);
}


for(var i = 0;
	i < ineligibleLocusType.length;
	i++) {

	var locusTypeItem =
		ineligibleLocusType[i];

	log(
		"UNNAMED_UNSUPPORTED_LOCUS_TYPE\t" +
		locusTypeItem.locus_id +
		"\t" +
		locusTypeItem.locus_type
	);
}


for(var i = 0;
	i < legacyClaimConflicts.length;
	i++) {

	var legacyConflict =
		legacyClaimConflicts[i];

	var claimDescriptions = [];

	for(var claimIndex = 0;
		claimIndex < legacyConflict.claims.length;
		claimIndex++) {

		var claim =
			legacyConflict.claims[
				claimIndex
			];

		claimDescriptions.push(
			claim.xref_id +
			":" +
			claim.source_numeric_id
		);
	}

	log(
		"LEGACY_LOCUS_NUMBER_CONFLICT\t" +
		legacyConflict.locus_id +
		"\t" +
		legacyConflict.lineage_id +
		"\t" +
		claimDescriptions.join(",")
	);
}


for(var i = 0;
	i < numberingConflicts.length;
	i++) {

	var numberingConflict =
		numberingConflicts[i];

	log(
		"LEGACY_LINEAGE_NUMBER_CONFLICT\t" +
		numberingConflict.lineage_id +
		"\t" +
		numberingConflict.orthology_group +
		"\t" +
		numberingConflict.locus_ids.join(",")
	);
}


log(
	DRY_RUN
		? "Dry run finished; no locus names were written"
		: "Finished assigning Missillac identifiers to permanent ERV loci"
);
