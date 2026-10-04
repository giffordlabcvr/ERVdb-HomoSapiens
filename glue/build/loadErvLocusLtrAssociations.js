// glue/build/locus/loadErvLocusLtrAssociations.js
//
// Create ERV-locus-to-LTR-lineage associations in:
//
//   erv_locus_ltr_assoc
//
// Input metadata are read from:
//
//   erv_locus_candidate
//
// Permanent locus rows must already exist in:
//
//   erv_locus
//
// Interpretation:
//
//   status = LTR
//       The locus is a solo LTR.
//
//   status = ERV
//       The locus contains internal ERV sequence.
//
// For ERV loci, comma-separated entries in `names` are ordered by the
// genomic start coordinate of the contributing source annotations.
//
// Explicit Repbase-style internal annotations ending in "-int" are used
// to establish the internal interval:
//
//   LTR-X,ERV-X-int,ERV-X-int,LTR-Y
//
// Recognised LTR annotations before the first internal annotation are
// treated as genomic-left LTR candidates. Recognised LTR annotations
// after the last internal annotation are treated as genomic-right LTR
// candidates.
//
// Genomic left/right is translated into proviral 5'/3' orientation using
// the candidate strand:
//
//   + strand: left = 5', right = 3'
//   - strand: left = 3', right = 5'
//
// Repeated or synonymous annotations resolving to the same LTR lineage
// are collapsed within each side. Distinct LTR lineages on opposite sides
// are retained, allowing genuine mismatched-LTR proviruses.
//
// If several distinct LTR lineages occur on the same side, the side is
// considered ambiguous and no positional association is created for it.
//
// region_start and region_end are deliberately left unset. A later
// alignment-based loader can determine exact sequence-relative component
// coordinates.
//
// The script is idempotent with respect to its deterministic association
// IDs, but it does not delete stale associations from previous runs.

var CANDIDATE_TABLE = "erv_locus_candidate";
var LOCUS_TABLE = "erv_locus";
var LTR_LINEAGE_TABLE = "ltr_lineage";
var LOCUS_LTR_ASSOC_TABLE = "erv_locus_ltr_assoc";

var LOCUS_LINEAGE_ASSOC_TABLE = "erv_locus_lineage_assoc";
var LINEAGE_LTR_ASSOC_TABLE = "erv_lineage_ltr_assoc";

var DRY_RUN = false;


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

	var result = ("" + value).trim();

	if(result === "") {
		return null;
	}

	var lower = result.toLowerCase();

	if(
		lower === "n/a" ||
		lower === "na" ||
		lower === "n/k" ||
		lower === "nk" ||
		lower === "null" ||
		lower === "none" ||
		lower === "unknown" ||
		result === "-"
	) {
		return null;
	}

	return result;
}


function escapeQuotes(value) {

	if(value === null || value === undefined) {
		return "";
	}

	return ("" + value).replace(/'/g, "''");
}


function customRowPath(tableName, rowId) {

	return (
		"custom-table-row/" +
		tableName +
		"/" +
		rowId
	);
}


function sanitiseId(value) {

	return ("" + value).replace(
		/[^A-Za-z0-9._-]/g,
		"_"
	);
}


function makeAssociationId(
	locusId,
	ltrLineageId,
	associationRole
) {

	return sanitiseId(
		locusId +
		"__" +
		ltrLineageId +
		"__" +
		associationRole
	);
}


function customRowExists(tableName, rowId) {

	var result = glue.command([
		"list",
		"custom-table-row",
		tableName,
		"id",
		"-w",
		"id = '" +
			escapeQuotes(rowId) +
			"'"
	]);

	return (
		result.listResult &&
		result.listResult.row &&
		result.listResult.row.length > 0
	);
}


function createCustomRowIfMissing(tableName, rowId) {

	if(customRowExists(tableName, rowId)) {
		return false;
	}

	if(!DRY_RUN) {
		glue.command([
			"create",
			"custom-table-row",
			tableName,
			rowId
		]);
	}

	log(
		"Created " +
		tableName +
		"/" +
		rowId
	);

	return true;
}


function setField(
	tableName,
	rowId,
	fieldName,
	value
) {

	value = norm(value);

	if(value === null || DRY_RUN) {
		return;
	}

	glue.inMode(
		customRowPath(tableName, rowId),
		function() {
			glue.command([
				"set",
				"field",
				fieldName,
				value
			]);
		}
	);
}


function setLink(
	tableName,
	rowId,
	linkName,
	targetTable,
	targetId
) {

	if(
		targetId === null ||
		targetId === undefined ||
		DRY_RUN
	) {
		return;
	}

	glue.inMode(
		customRowPath(tableName, rowId),
		function() {
			glue.command([
				"set",
				"link-target",
				linkName,
				customRowPath(
					targetTable,
					targetId
				)
			]);
		}
	);
}


function splitCommaSeparated(value) {

	value = norm(value);

	if(value === null) {
		return [];
	}

	var results = [];

	_.each(
		value.split(","),
		function(token) {

			token = norm(token);

			if(token !== null) {
				results.push(token);
			}
		}
	);

	return results;
}


function normalisedLookupKey(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	return value
		.toLowerCase()
		.replace(/\(/g, "-")
		.replace(/\)/g, "")
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]+/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}


function isInternalAnnotation(name) {

	name = norm(name);

	if(name === null) {
		return false;
	}

	/*
	 * Examples:
	 *
	 *   HERVH-int
	 *   HERVK9-int
	 *   ERV3-16A3_I-int
	 *   ERV3-16A3_LTR is not internal.
	 */
	return /-int$/i.test(name);
}


function lower(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	return value.toLowerCase();
}


function isPositiveStrand(strand) {

	strand = lower(strand);

	return (
		strand === "+" ||
		strand === "positive" ||
		strand === "forward" ||
		strand === "fwd"
	);
}


function isNegativeStrand(strand) {

	strand = lower(strand);

	return (
		strand === "-" ||
		strand === "negative" ||
		strand === "reverse" ||
		strand === "rev"
	);
}


function roleForGenomicSide(side, strand) {

	if(isPositiveStrand(strand)) {

		if(side === "left") {
			return "five_prime_ltr";
		}

		if(side === "right") {
			return "three_prime_ltr";
		}
	}

	if(isNegativeStrand(strand)) {

		if(side === "left") {
			return "three_prime_ltr";
		}

		if(side === "right") {
			return "five_prime_ltr";
		}
	}

	return null;
}


// -------------------------------------------------------------------------
// Unique-resolution map helpers
// -------------------------------------------------------------------------

function addUniqueResolution(
	targetMap,
	ambiguousMap,
	key,
	value
) {

	if(key === null || value === null) {
		return;
	}

	if(ambiguousMap[key]) {
		return;
	}

	if(targetMap[key] === undefined) {
		targetMap[key] = value;
		return;
	}

	if(targetMap[key] !== value) {
		delete targetMap[key];
		ambiguousMap[key] = true;
	}
}


// -------------------------------------------------------------------------
// Load LTR lineage resolution maps
// -------------------------------------------------------------------------

var ltrById = {};
var ltrByOriginalName = {};

var ambiguousOriginalNames = {};

var ltrByNormalisedId = {};
var ltrByNormalisedOriginalName = {};

var ambiguousNormalisedIds = {};
var ambiguousNormalisedOriginalNames = {};


var ltrLineageRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LTR_LINEAGE_TABLE,
		"id",
		"original_name"
	])
);


_.each(ltrLineageRows, function(row) {

	var ltrLineageId = norm(row["id"]);
	var originalName = norm(row["original_name"]);

	if(ltrLineageId === null) {
		return;
	}

	ltrById[ltrLineageId] = ltrLineageId;

	addUniqueResolution(
		ltrByNormalisedId,
		ambiguousNormalisedIds,
		normalisedLookupKey(ltrLineageId),
		ltrLineageId
	);

	addUniqueResolution(
		ltrByOriginalName,
		ambiguousOriginalNames,
		originalName,
		ltrLineageId
	);

	addUniqueResolution(
		ltrByNormalisedOriginalName,
		ambiguousNormalisedOriginalNames,
		normalisedLookupKey(originalName),
		ltrLineageId
	);
});


log(
	"Loaded LTR lineages: " +
	ltrLineageRows.length
);


// -------------------------------------------------------------------------
// Resolve an annotation name to an LTR lineage
// -------------------------------------------------------------------------

function resolveLtrAnnotation(annotationName) {

	annotationName = norm(annotationName);

	if(annotationName === null) {
		return null;
	}

	if(ltrById[annotationName]) {

		return {
			status: "resolved",
			ltr_lineage_id: ltrById[annotationName],
			method: "ltr_lineage.id",
			confidence: "high"
		};
	}

	if(ltrByOriginalName[annotationName]) {

		return {
			status: "resolved",
			ltr_lineage_id: ltrByOriginalName[annotationName],
			method: "ltr_lineage.original_name",
			confidence: "high"
		};
	}

	var key = normalisedLookupKey(annotationName);

	if(
		key !== null &&
		(
			ambiguousNormalisedIds[key] ||
			ambiguousNormalisedOriginalNames[key]
		)
	) {
		return {
			status: "ambiguous",
			ltr_lineage_id: null,
			method: "normalised_ltr_name",
			confidence: null
		};
	}

	if(key !== null && ltrByNormalisedId[key]) {

		return {
			status: "resolved",
			ltr_lineage_id: ltrByNormalisedId[key],
			method: "normalised_ltr_lineage.id",
			confidence: "medium"
		};
	}

	if(
		key !== null &&
		ltrByNormalisedOriginalName[key]
	) {

		return {
			status: "resolved",
			ltr_lineage_id:
				ltrByNormalisedOriginalName[key],
			method:
				"normalised_ltr_lineage.original_name",
			confidence:
				"medium"
		};
	}

	return null;
}


// -------------------------------------------------------------------------
// Convert candidate names into ordered annotation observations
// -------------------------------------------------------------------------

function loadAnnotationObservations(names) {

	var tokens = splitCommaSeparated(names);
	var observations = [];

	_.each(tokens, function(token, index) {

		var resolution =
			resolveLtrAnnotation(token);

		observations.push({
			index: index,
			raw_name: token,
			is_internal: isInternalAnnotation(token),
			resolution: resolution
		});
	});

	return observations;
}


function findInternalBounds(observations) {

	var firstInternalIndex = null;
	var lastInternalIndex = null;

	_.each(observations, function(observation) {

		if(!observation.is_internal) {
			return;
		}

		if(firstInternalIndex === null) {
			firstInternalIndex = observation.index;
		}

		lastInternalIndex = observation.index;
	});

	return {
		first: firstInternalIndex,
		last: lastInternalIndex
	};
}


function resolvedLtrObservations(observations) {

	var results = [];

	_.each(observations, function(observation) {

		if(
			observation.resolution !== null &&
			observation.resolution.status === "resolved"
		) {
			results.push(observation);
		}
	});

	return results;
}


function ambiguousLtrObservations(observations) {

	var results = [];

	_.each(observations, function(observation) {

		if(
			observation.resolution !== null &&
			observation.resolution.status === "ambiguous"
		) {
			results.push(observation);
		}
	});

	return results;
}


// -------------------------------------------------------------------------
// Collapse repeated observations within one component/side
// -------------------------------------------------------------------------

function collapseLtrObservations(observations) {

	var byLtrId = {};
	var orderedIds = [];

	_.each(observations, function(observation) {

		var resolution = observation.resolution;

		if(
			resolution === null ||
			resolution.status !== "resolved"
		) {
			return;
		}

		var ltrLineageId =
			resolution.ltr_lineage_id;

		if(byLtrId[ltrLineageId] === undefined) {

			byLtrId[ltrLineageId] = {
				ltr_lineage_id: ltrLineageId,
				raw_names: [],
				methods: [],
				indices: [],
				has_exact_resolution: false
			};

			orderedIds.push(ltrLineageId);
		}

		var collapsed =
			byLtrId[ltrLineageId];

		collapsed.raw_names.push(
			observation.raw_name
		);

		collapsed.methods.push(
			resolution.method
		);

		collapsed.indices.push(
			observation.index
		);

		if(resolution.confidence === "high") {
			collapsed.has_exact_resolution = true;
		}
	});

	var results = [];

	_.each(orderedIds, function(ltrLineageId) {

		var collapsed =
			byLtrId[ltrLineageId];

		collapsed.confidence =
			collapsed.has_exact_resolution
				? "high"
				: "medium";

		results.push(collapsed);
	});

	return results;
}


// -------------------------------------------------------------------------
// Association creation
// -------------------------------------------------------------------------

function createOrUpdateAssociation(
	locusId,
	ltrLineageId,
	associationRole,
	confidence
) {

	var associationId =
		makeAssociationId(
			locusId,
			ltrLineageId,
			associationRole
		);

	var created =
		createCustomRowIfMissing(
			LOCUS_LTR_ASSOC_TABLE,
			associationId
		);

	setLink(
		LOCUS_LTR_ASSOC_TABLE,
		associationId,
		"erv_locus",
		LOCUS_TABLE,
		locusId
	);

	setLink(
		LOCUS_LTR_ASSOC_TABLE,
		associationId,
		"ltr_lineage",
		LTR_LINEAGE_TABLE,
		ltrLineageId
	);

	setField(
		LOCUS_LTR_ASSOC_TABLE,
		associationId,
		"association_role",
		associationRole
	);

	setField(
		LOCUS_LTR_ASSOC_TABLE,
		associationId,
		"evidence",
		"candidate_names"
	);

	setField(
		LOCUS_LTR_ASSOC_TABLE,
		associationId,
		"confidence",
		confidence
	);

	/*
	 * region_start and region_end are deliberately not populated here.
	 */

	return {
		association_id: associationId,
		created: created
	};
}


// -------------------------------------------------------------------------
// Load permanent loci
// -------------------------------------------------------------------------

var locusRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LOCUS_TABLE,
		"id"
	])
);

var locusById = {};

_.each(locusRows, function(row) {

	var locusId = norm(row["id"]);

	if(locusId !== null) {
		locusById[locusId] = true;
	}
});


log(
	"Loaded ERV loci: " +
	locusRows.length
);


// -------------------------------------------------------------------------
// Load ERV-lineage compatibility maps
// -------------------------------------------------------------------------

var ervLineagesByLocusId = {};

var locusLineageAssocRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LOCUS_LINEAGE_ASSOC_TABLE,
		"erv_locus.id",
		"erv_lineage.id"
	])
);


_.each(locusLineageAssocRows, function(row) {

	var locusId =
		norm(row["erv_locus.id"]);

	var ervLineageId =
		norm(row["erv_lineage.id"]);

	if(
		locusId === null ||
		ervLineageId === null
	) {
		return;
	}

	if(ervLineagesByLocusId[locusId] === undefined) {
		ervLineagesByLocusId[locusId] = {};
	}

	ervLineagesByLocusId[locusId][ervLineageId] = true;
});


var ervLineagesByLtrId = {};

var lineageLtrAssocRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LINEAGE_LTR_ASSOC_TABLE,
		"ltr_lineage.id",
		"erv_lineage.id"
	])
);


_.each(lineageLtrAssocRows, function(row) {

	var ltrLineageId =
		norm(row["ltr_lineage.id"]);

	var ervLineageId =
		norm(row["erv_lineage.id"]);

	if(
		ltrLineageId === null ||
		ervLineageId === null
	) {
		return;
	}

	if(
		ervLineagesByLtrId[ltrLineageId] ===
		undefined
	) {
		ervLineagesByLtrId[ltrLineageId] = {};
	}

	ervLineagesByLtrId[
		ltrLineageId
	][ervLineageId] = true;
});


function ltrIsCompatibleWithLocus(
	locusId,
	ltrLineageId
) {

	var locusLineages =
		ervLineagesByLocusId[locusId];

	var ltrLineages =
		ervLineagesByLtrId[ltrLineageId];

	if(
		locusLineages === undefined ||
		ltrLineages === undefined
	) {
		return null;
	}

	var compatible = false;

	_.each(
		_.keys(locusLineages),
		function(lineageId) {

			if(ltrLineages[lineageId]) {
				compatible = true;
			}
		}
	);

	return compatible;
}


// -------------------------------------------------------------------------
// Load candidate rows
// -------------------------------------------------------------------------

var candidateRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		CANDIDATE_TABLE,
		"id",
		"status",
		"strand",
		"names",
		"genes_order",
		"genes_simplified",
		"case_status",
		"names_decision",
		"makes_mosaic"
	])
);


log(
	"Loaded locus candidates: " +
	candidateRows.length
);


// -------------------------------------------------------------------------
// Counters and audit results
// -------------------------------------------------------------------------

var soloLtrLocusCount = 0;
var ervLocusCount = 0;

var associationCreatedCount = 0;
var associationUpdatedCount = 0;

var fivePrimeAssociationCount = 0;
var threePrimeAssociationCount = 0;
var soloAssociationCount = 0;

var matchingPairCount = 0;
var mismatchedPairCount = 0;
var oneSidedErvCount = 0;

var noObservedLtrCount = 0;
var ambiguousSideCount = 0;
var ambiguousSoloCount = 0;
var unpositionedLtrCount = 0;
var missingLocusCount = 0;
var unknownStatusCount = 0;
var unknownStrandCount = 0;
var incompatibleAssociationCount = 0;
var compatibilityUnavailableCount = 0;
var ambiguousNameCount = 0;

var reviewResults = [];


function recordReview(
	locusId,
	category,
	details
) {

	reviewResults.push({
		locus_id: locusId,
		category: category,
		details: details
	});

	log(
		"REVIEW " +
		locusId +
		": " +
		category +
		" - " +
		details
	);
}


function recordAssociationResult(
	locusId,
	ltrLineageId,
	role,
	confidence
) {

	var result =
		createOrUpdateAssociation(
			locusId,
			ltrLineageId,
			role,
			confidence
		);

	if(result.created) {
		associationCreatedCount++;
	} else {
		associationUpdatedCount++;
	}

	if(role === "five_prime_ltr") {
		fivePrimeAssociationCount++;
	}

	if(role === "three_prime_ltr") {
		threePrimeAssociationCount++;
	}

	if(role === "solo_ltr") {
		soloAssociationCount++;
	}

	var compatible =
		ltrIsCompatibleWithLocus(
			locusId,
			ltrLineageId
		);

	if(compatible === false) {

		incompatibleAssociationCount++;

		recordReview(
			locusId,
			"ltr_erv_lineage_disagreement",
			ltrLineageId +
			" is not associated with the locus ERV lineage"
		);

	} else if(compatible === null) {

		compatibilityUnavailableCount++;
	}

	log(
		"Associated erv_locus/" +
		locusId +
		" -> ltr_lineage/" +
		ltrLineageId +
		" as " +
		role
	);
}


// -------------------------------------------------------------------------
// Process candidate rows
// -------------------------------------------------------------------------

_.each(candidateRows, function(row) {

	var locusId = norm(row["id"]);
	var locusStatus = lower(row["status"]);
	var strand = norm(row["strand"]);
	var names = norm(row["names"]);
	var genesOrder = norm(row["genes_order"]);
	var genesSimplified =
		norm(row["genes_simplified"]);
	var caseStatus = norm(row["case_status"]);
	var namesDecision = norm(row["names_decision"]);
	var makesMosaic = norm(row["makes_mosaic"]);

	if(locusId === null) {
		return;
	}

	if(!locusById[locusId]) {

		missingLocusCount++;

		recordReview(
			locusId,
			"missing_erv_locus",
			"Candidate has no corresponding permanent erv_locus row"
		);

		return;
	}

	var observations =
		loadAnnotationObservations(names);

	var resolvedObservations =
		resolvedLtrObservations(observations);

	var ambiguousObservations =
		ambiguousLtrObservations(observations);

	if(ambiguousObservations.length > 0) {

		ambiguousNameCount +=
			ambiguousObservations.length;

		recordReview(
			locusId,
			"ambiguous_ltr_name_resolution",
			ambiguousObservations.length +
			" annotation name(s) matched more than one LTR lineage"
		);
	}


	// -----------------------------------------------------------------
	// Solo LTR loci
	// -----------------------------------------------------------------

	if(locusStatus === "ltr") {

		soloLtrLocusCount++;

		var soloCandidates =
			collapseLtrObservations(
				resolvedObservations
			);

		if(soloCandidates.length === 0) {

			noObservedLtrCount++;

			recordReview(
				locusId,
				"solo_ltr_without_resolved_ltr_lineage",
				"names=" + names
			);

			return;
		}

		if(soloCandidates.length > 1) {

			ambiguousSoloCount++;

			var soloIds = [];

			_.each(
				soloCandidates,
				function(candidate) {
					soloIds.push(
						candidate.ltr_lineage_id
					);
				}
			);

			recordReview(
				locusId,
				"ambiguous_solo_ltr",
				"Resolved LTR lineages: " +
				soloIds.join(", ") +
				"; names_decision=" +
				namesDecision
			);

			return;
		}

		recordAssociationResult(
			locusId,
			soloCandidates[0].ltr_lineage_id,
			"solo_ltr",
			soloCandidates[0].confidence
		);

		return;
	}


	// -----------------------------------------------------------------
	// Internal ERV loci
	// -----------------------------------------------------------------

	if(locusStatus !== "erv") {

		unknownStatusCount++;

		recordReview(
			locusId,
			"unknown_locus_status",
			"status=" + row["status"]
		);

		return;
	}

	ervLocusCount++;

	if(
		!isPositiveStrand(strand) &&
		!isNegativeStrand(strand)
	) {

		unknownStrandCount++;

		recordReview(
			locusId,
			"unknown_strand",
			"strand=" +
				strand +
				"; positional LTR associations were not created"
		);

		return;
	}

	if(resolvedObservations.length === 0) {

		noObservedLtrCount++;
		return;
	}

	var internalBounds =
		findInternalBounds(observations);

	if(
		internalBounds.first === null ||
		internalBounds.last === null
	) {

		unpositionedLtrCount++;

		recordReview(
			locusId,
			"ltr_present_without_explicit_internal_boundary",
			"genes_simplified=" +
				genesSimplified +
				"; names=" +
				names
		);

		return;
	}

	var leftObservations = [];
	var rightObservations = [];
	var internalSpanLtrObservations = [];

	_.each(
		resolvedObservations,
		function(observation) {

			if(
				observation.index <
				internalBounds.first
			) {
				leftObservations.push(
					observation
				);
				return;
			}

			if(
				observation.index >
				internalBounds.last
			) {
				rightObservations.push(
					observation
				);
				return;
			}

			internalSpanLtrObservations.push(
				observation
			);
		}
	);

	var leftCandidates =
		collapseLtrObservations(
			leftObservations
		);

	var rightCandidates =
		collapseLtrObservations(
			rightObservations
		);

	if(
		internalSpanLtrObservations.length > 0
	) {

		unpositionedLtrCount++;

		var internalSpanCandidates =
			collapseLtrObservations(
				internalSpanLtrObservations
			);

		var internalSpanIds = [];

		_.each(
			internalSpanCandidates,
			function(candidate) {
				internalSpanIds.push(
					candidate.ltr_lineage_id
				);
			}
		);

		recordReview(
			locusId,
			"ltr_annotation_within_internal_span",
			"LTR lineages: " +
				internalSpanIds.join(", ") +
				"; genes_order=" +
				genesOrder
		);
	}

	var leftLoaded = null;
	var rightLoaded = null;


	// -----------------------------------------------------------------
	// Genomic-left LTR
	// -----------------------------------------------------------------

	if(leftCandidates.length === 1) {

		var leftRole =
			roleForGenomicSide(
				"left",
				strand
			);

		recordAssociationResult(
			locusId,
			leftCandidates[0].ltr_lineage_id,
			leftRole,
			leftCandidates[0].confidence
		);

		leftLoaded =
			leftCandidates[0].ltr_lineage_id;

	} else if(leftCandidates.length > 1) {

		ambiguousSideCount++;

		var leftIds = [];

		_.each(
			leftCandidates,
			function(candidate) {
				leftIds.push(
					candidate.ltr_lineage_id
				);
			}
		);

		recordReview(
			locusId,
			"ambiguous_left_ltr",
			"Resolved LTR lineages: " +
				leftIds.join(", ") +
				"; makes_mosaic=" +
				makesMosaic
		);
	}


	// -----------------------------------------------------------------
	// Genomic-right LTR
	// -----------------------------------------------------------------

	if(rightCandidates.length === 1) {

		var rightRole =
			roleForGenomicSide(
				"right",
				strand
			);

		recordAssociationResult(
			locusId,
			rightCandidates[0].ltr_lineage_id,
			rightRole,
			rightCandidates[0].confidence
		);

		rightLoaded =
			rightCandidates[0].ltr_lineage_id;

	} else if(rightCandidates.length > 1) {

		ambiguousSideCount++;

		var rightIds = [];

		_.each(
			rightCandidates,
			function(candidate) {
				rightIds.push(
					candidate.ltr_lineage_id
				);
			}
		);

		recordReview(
			locusId,
			"ambiguous_right_ltr",
			"Resolved LTR lineages: " +
				rightIds.join(", ") +
				"; makes_mosaic=" +
				makesMosaic
		);
	}


	// -----------------------------------------------------------------
	// Pair-level interpretation
	// -----------------------------------------------------------------

	if(
		leftLoaded !== null &&
		rightLoaded !== null
	) {

		if(leftLoaded === rightLoaded) {

			matchingPairCount++;

		} else {

			mismatchedPairCount++;

			recordReview(
				locusId,
				"mismatched_ltr_pair",
				"Genomic-left LTR=" +
					leftLoaded +
					"; genomic-right LTR=" +
					rightLoaded +
					"; strand=" +
					strand +
					"; makes_mosaic=" +
					makesMosaic
			);
		}

	} else if(
		leftLoaded !== null ||
		rightLoaded !== null
	) {

		oneSidedErvCount++;
	}
});


// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

log("============================================================");
log("ERV locus-to-LTR association summary");
log("============================================================");

log(
	"Candidate rows examined: " +
	candidateRows.length
);

log(
	"Permanent ERV loci available: " +
	locusRows.length
);

log(
	"Candidate rows with status ERV: " +
	ervLocusCount
);

log(
	"Candidate rows with status LTR: " +
	soloLtrLocusCount
);

log(
	"Association rows created: " +
	associationCreatedCount
);

log(
	"Existing association rows updated: " +
	associationUpdatedCount
);

log(
	"5-prime LTR associations: " +
	fivePrimeAssociationCount
);

log(
	"3-prime LTR associations: " +
	threePrimeAssociationCount
);

log(
	"Solo-LTR associations: " +
	soloAssociationCount
);

log(
	"ERV loci with matching paired LTR lineages: " +
	matchingPairCount
);

log(
	"ERV loci with mismatched paired LTR lineages: " +
	mismatchedPairCount
);

log(
	"ERV loci with one positioned LTR side: " +
	oneSidedErvCount
);

log(
	"Loci with no recognised LTR annotation: " +
	noObservedLtrCount
);

log(
	"Ambiguous positional sides: " +
	ambiguousSideCount
);

log(
	"Ambiguous solo-LTR classifications: " +
	ambiguousSoloCount
);

log(
	"Loci containing unpositioned LTR annotations: " +
	unpositionedLtrCount
);

log(
	"Candidate rows without an erv_locus row: " +
	missingLocusCount
);

log(
	"Rows with an unknown status: " +
	unknownStatusCount
);

log(
	"ERV rows with an unknown strand: " +
	unknownStrandCount
);

log(
	"Ambiguous normalised LTR-name matches: " +
	ambiguousNameCount
);

log(
	"Loaded LTR associations disagreeing with the locus ERV lineage: " +
	incompatibleAssociationCount
);

log(
	"LTR associations without enough information for compatibility testing: " +
	compatibilityUnavailableCount
);

log(
	"Review items generated: " +
	reviewResults.length
);

log(
	"Finished loading ERV locus-to-LTR associations"
);


/*
 * Return review rows to the GLUE console.
 */
reviewResults;
