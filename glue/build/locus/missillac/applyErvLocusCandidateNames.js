// glue/build/locus/missillac/applyErvLocusCandidateNames.js
//
// Assigns Missillac IDs to ERV locus candidates.
//
// Reads:
//   erv_locus_candidate
//   erv_locus_candidate -> erv_lineage
//   erv_locus_legacy_xref
//
// Writes:
//   erv_locus_candidate_name
//
// Naming rules:
//
// 1. Fully resolved candidates
//
//    The persisted erv_lineage link is authoritative.
//
//    Naming stem:
//      erv_locus_candidate.erv_lineage.standard_id
//
//    Number:
//      a. Preserve the DBM/Gifford source_numeric_id where uniquely
//         available.
//      b. Otherwise assign the lowest unused positive integer within
//         the lineage, in genomic order.
//
// 2. Candidates resolved above lineage level
//
//    This includes:
//      Resolved at subgenus level
//      Resolved at genus level
//      Resolved at clade level
//
//    Naming stem:
//      derived from names_decision using CATEGORY_STANDARD_IDS.
//
//    Number:
//      numeric component of the internal candidate ID.
//
//    Example:
//      RBRT454868, Lambda
//      -> ERV-3.Lambda-454868
//
// 3. Mosaic candidates
//
//    Naming stem:
//      Mosaic
//
//    Number:
//      numeric component of the internal candidate ID.
//
// 4. LTR candidates
//
//    If status = LTR, append:
//
//      (LTR)
//
//    Example:
//      ERV-1.Zeta.MER57-6407(LTR)
//
// No links are created or modified.

var CANDIDATE_TABLE =
	"erv_locus_candidate";

var NAME_TABLE =
	"erv_locus_candidate_name";

var LEGACY_XREF_TABLE =
	"erv_locus_legacy_xref";

var NUMBERING_LEGACY_SOURCE =
	"compiled_human_erv_loci_hg19";

var FULLY_RESOLVED_STATUS =
	"Fully resolved";


// -------------------------------------------------------------------------
// Above-lineage category names
// -------------------------------------------------------------------------
//
// Add further exact mappings here as required.
//
// The values are Missillac naming stems, not erv_lineage identifiers.
//
// Where names_decision already begins with "ERV-", the value is accepted
// directly and does not need an entry here.

var CATEGORY_STANDARD_IDS = {

	// Deep clades
	"Clade I":
		"ERV-1",

	"Clade II":
		"ERV-2",

	"Clade III":
		"ERV-3",

	// Common genus-level concepts
	"Gamma":
		"ERV-1.Gamma",

	"Gammaretrovirus":
		"ERV-1.Gamma",

	"Zeta":
		"ERV-1.Zeta",

	"Eta":
		"ERV-1.Eta",

	"Theta":
		"ERV-1.Theta",

	"Kappa":
		"ERV-2.Kappa",

	"Betaretrovirus":
		"ERV-2.Kappa",

	"Lambda":
		"ERV-3.Lambda",

	"Lambdaretrovirus":
		"ERV-3.Lambda"
};


// -------------------------------------------------------------------------
// General utilities
// -------------------------------------------------------------------------

function norm(value) {

	if(
		value === null ||
		value === undefined
	) {
		return null;
	}

	var result =
		("" + value).trim();

	if(result === "") {
		return null;
	}

	var lower =
		result.toLowerCase();

	if(
		lower === "n/a" ||
		lower === "na" ||
		lower === "null" ||
		lower === "none" ||
		lower === "unknown" ||
		result === "-"
	) {
		return null;
	}

	return result;
}


function normInt(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	var number =
		parseInt(value, 10);

	return isNaN(number)
		? null
		: number;
}


function positiveInt(value) {

	var number =
		normInt(value);

	if(
		number === null ||
		number < 1
	) {
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


function ensureRow(
	tableName,
	rowId
) {

	try {

		glue.command([
			"create",
			"custom-table-row",
			tableName,
			rowId
		]);

		return true;

	} catch(e) {

		return false;
	}
}


function setFieldIfPresent(
	fieldName,
	value
) {

	value = norm(value);

	if(value !== null) {

		glue.command([
			"set",
			"field",
			fieldName,
			value
		]);
	}
}


function setIntFieldIfPresent(
	fieldName,
	value
) {

	value = normInt(value);

	if(value !== null) {

		glue.command([
			"set",
			"field",
			fieldName,
			"" + value
		]);
	}
}


function chrRank(chrom) {

	chrom = norm(chrom);

	if(chrom === null) {
		return 1000;
	}

	chrom =
		chrom.replace(/^chr/i, "");

	if(chrom === "X") {
		return 23;
	}

	if(chrom === "Y") {
		return 24;
	}

	if(
		chrom === "M" ||
		chrom === "MT"
	) {
		return 25;
	}

	var number =
		parseInt(chrom, 10);

	return isNaN(number)
		? 1000
		: number;
}


function genomicSort(a, b) {

	var chromosomeComparison =
		chrRank(a.chrom) -
		chrRank(b.chrom);

	if(chromosomeComparison !== 0) {
		return chromosomeComparison;
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

	if(a.candidate_id < b.candidate_id) {
		return -1;
	}

	if(a.candidate_id > b.candidate_id) {
		return 1;
	}

	return 0;
}


/*
 * Extract the trailing numeric component of the internal candidate ID.
 *
 * Examples:
 *
 *   RBRT454868 -> 454868
 *   RBRT6407   -> 6407
 */
function candidateNumericId(candidateId) {

	candidateId =
		norm(candidateId);

	if(candidateId === null) {
		return null;
	}

	var match =
		candidateId.match(/(\d+)$/);

	if(!match) {
		return null;
	}

	return positiveInt(match[1]);
}


/*
 * Construct the final identifier.
 *
 * The LTR suffix is added only to missillac_id. It does not alter the
 * stored standard_id or locus_number.
 */
function makeMissillacId(
	standardId,
	locusNumber,
	locusStatus
) {

	standardId =
		norm(standardId);

	locusNumber =
		positiveInt(locusNumber);

	if(
		standardId === null ||
		locusNumber === null
	) {
		return null;
	}

	var missillacId =
		standardId +
		"-" +
		locusNumber;

	if(norm(locusStatus) === "LTR") {
		missillacId += "(LTR)";
	}

	return missillacId;
}


/*
 * Resolve an above-lineage category stem.
 *
 * Exact configured category names are preferred.
 *
 * An existing ERV-* stem is accepted directly, allowing explicitly
 * curated category stems to pass through without another lookup.
 */
function resolveCategoryStandardId(
	rawName
) {

	rawName = norm(rawName);

	if(rawName === null) {
		return null;
	}

	if(CATEGORY_STANDARD_IDS[rawName]) {
		return CATEGORY_STANDARD_IDS[rawName];
	}

	if(/^ERV-[123](\.|$)/.test(rawName)) {
		return rawName.replace(/\s+/g, "-");
	}

	return null;
}


/*
 * Identify case-status values representing resolution above lineage
 * level.
 */
function isAboveLineageResolution(
	caseStatus
) {

	caseStatus =
		norm(caseStatus);

	return (
		caseStatus ===
			"Resolved at subgenus level" ||

		caseStatus ===
			"Resolved at genus level" ||

		caseStatus ===
			"Resolved at clade level"
	);
}


// -------------------------------------------------------------------------
// Legacy DBM/Gifford numbering claims
// -------------------------------------------------------------------------
//
// Only unambiguously mapped xrefs from the curated DBM/Gifford source
// contribute preserved numbers.
//
// Structure:
//
// legacyClaimsByCandidate[candidateId] = [
//     {
//         xref_id: "...",
//         legacy_name: "...",
//         legacy_classification: "...",
//         source_numeric_id: 9
//     }
// ];

var legacyClaimsByCandidate = {};

var legacyRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LEGACY_XREF_TABLE,
		"-w",
		"legacy_source = '" +
			NUMBERING_LEGACY_SOURCE +
			"' and " +
		"mapping_status = 'mapped' and " +
		"source_numeric_id != null",
		"id",
		"legacy_name",
		"legacy_classification",
		"source_numeric_id",
		"erv_locus_candidate.id"
	])
);


_.each(legacyRows, function(row) {

	var candidateId =
		norm(
			row["erv_locus_candidate.id"]
		);

	var sourceNumericId =
		positiveInt(
			row["source_numeric_id"]
		);

	if(
		candidateId === null ||
		sourceNumericId === null
	) {
		return;
	}

	if(!legacyClaimsByCandidate[candidateId]) {
		legacyClaimsByCandidate[candidateId] = [];
	}

	legacyClaimsByCandidate[
		candidateId
	].push({
		xref_id:
			norm(row["id"]),

		legacy_name:
			norm(row["legacy_name"]),

		legacy_classification:
			norm(
				row["legacy_classification"]
			),

		source_numeric_id:
			sourceNumericId
	});
});


glue.logInfo(
	"Loaded authoritative legacy-number xrefs: " +
	legacyRows.length
);


/*
 * Resolve the preserved number for one candidate.
 *
 * Multiple xrefs are acceptable when they all specify the same number.
 * Multiple distinct numbers are treated as a conflict.
 */
function resolveLegacyNumber(
	candidateId
) {

	var claims =
		legacyClaimsByCandidate[
			candidateId
		];

	if(
		claims === null ||
		claims === undefined ||
		claims.length === 0
	) {
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

	_.each(claims, function(claim) {

		numbersSeen[
			"" + claim.source_numeric_id
		] = true;
	});

	var distinctNumbers =
		Object.keys(numbersSeen);

	if(distinctNumbers.length !== 1) {

		return {
			status:
				"candidate_conflict",

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
// Candidate-name row writing
// -------------------------------------------------------------------------

function writeCandidateName(item) {

	ensureRow(
		NAME_TABLE,
		item.candidate_id
	);

	glue.inMode(
		customRowPath(
			NAME_TABLE,
			item.candidate_id
		),

		function() {

			setFieldIfPresent(
				"candidate_id",
				item.candidate_id
			);

			setFieldIfPresent(
				"naming_source",
				item.naming_source
			);

			setFieldIfPresent(
				"raw_name",
				item.raw_name
			);

			setFieldIfPresent(
				"resolved_lineage_id",
				item.resolved_lineage_id
			);

			setFieldIfPresent(
				"standard_id",
				item.standard_id
			);

			setIntFieldIfPresent(
				"locus_number",
				item.locus_number
			);

			setFieldIfPresent(
				"missillac_id",
				item.missillac_id
			);

			setFieldIfPresent(
				"resolution_status",
				item.resolution_status
			);

			setFieldIfPresent(
				"notes",
				item.notes
			);
		}
	);
}


// -------------------------------------------------------------------------
// Load candidates
// -------------------------------------------------------------------------

var candidateRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		CANDIDATE_TABLE,
		"id",
		"names_decision",
		"case_status",
		"status",
		"chrom",
		"start_position",
		"end_position",
		"erv_lineage.id",
		"erv_lineage.standard_id"
	])
);


var fullyResolvedByStandardId = [];
var fullyResolvedGroups = {};

var directNumberItems = [];
var unresolvedItems = [];


_.each(candidateRows, function(row) {

	var candidateId =
		norm(row["id"]);

	var rawName =
		norm(row["names_decision"]);

	var caseStatus =
		norm(row["case_status"]);

	var locusStatus =
		norm(row["status"]);

	var linkedLineageId =
		norm(row["erv_lineage.id"]);

	var linkedStandardId =
		norm(
			row["erv_lineage.standard_id"]
		);

	if(candidateId === null) {
		return;
	}

	/*
	 * Fully resolved candidates must use the persisted lineage link.
	 */
	if(caseStatus === FULLY_RESOLVED_STATUS) {

		if(
			linkedLineageId === null ||
			linkedStandardId === null
		) {
			unresolvedItems.push({
				candidate_id:
					candidateId,

				raw_name:
					rawName,

				naming_source:
					"erv_locus_candidate.erv_lineage",

				resolved_lineage_id:
					linkedLineageId,

				standard_id:
					linkedStandardId,

				locus_number:
					null,

				missillac_id:
					null,

				resolution_status:
					"unresolved",

				notes:
					"Fully resolved candidate has no valid persisted erv_lineage link"
			});

			return;
		}

		var legacyResolution =
			resolveLegacyNumber(
				candidateId
			);

		var item = {
			candidate_id:
				candidateId,

			raw_name:
				rawName,

			naming_source:
				"erv_locus_candidate.erv_lineage",

			resolved_lineage_id:
				linkedLineageId,

			standard_id:
				linkedStandardId,

			resolution_status:
				"resolved",

			notes:
				"Resolved through persisted erv_lineage link",

			locus_status:
				locusStatus,

			chrom:
				norm(row["chrom"]),

			start_position:
				normInt(
					row["start_position"]
				),

			end_position:
				normInt(
					row["end_position"]
				),

			legacy_number_status:
				legacyResolution.status,

			legacy_number:
				legacyResolution.number,

			legacy_number_claims:
				legacyResolution.claims
		};

		if(!fullyResolvedGroups[linkedStandardId]) {
			fullyResolvedGroups[linkedStandardId] = [];
		}

		fullyResolvedGroups[
			linkedStandardId
		].push(item);

		return;
	}

	/*
	 * Candidates resolved above lineage level use the category stem and
	 * numeric part of the internal candidate ID.
	 */
	if(isAboveLineageResolution(caseStatus)) {

		var categoryStandardId =
			resolveCategoryStandardId(
				rawName
			);

		var categoryNumber =
			candidateNumericId(
				candidateId
			);

		if(
			categoryStandardId === null ||
			categoryNumber === null
		) {
			unresolvedItems.push({
				candidate_id:
					candidateId,

				raw_name:
					rawName,

				naming_source:
					"case_status.category",

				resolved_lineage_id:
					null,

				standard_id:
					categoryStandardId,

				locus_number:
					categoryNumber,

				missillac_id:
					null,

				resolution_status:
					"unresolved_category",

				notes:
					categoryStandardId === null
						? (
							"No Missillac category stem is configured for names_decision '" +
							rawName +
							"'"
						)
						: (
							"Could not extract numeric component from candidate ID"
						)
			});

			return;
		}

		directNumberItems.push({
			candidate_id:
				candidateId,

			raw_name:
				rawName,

			naming_source:
				"case_status.category",

			resolved_lineage_id:
				null,

			standard_id:
				categoryStandardId,

			locus_number:
				categoryNumber,

			missillac_id:
				makeMissillacId(
					categoryStandardId,
					categoryNumber,
					locusStatus
				),

			resolution_status:
				"resolved_category",

			notes:
				caseStatus +
				"; number derived from internal candidate ID"
		});

		return;
	}

	/*
	 * Mosaics also use the numeric part of the internal candidate ID.
	 */
	if(caseStatus === "Mosaic") {

		var mosaicNumber =
			candidateNumericId(
				candidateId
			);

		if(mosaicNumber === null) {

			unresolvedItems.push({
				candidate_id:
					candidateId,

				raw_name:
					rawName,

				naming_source:
					"case_status.mosaic",

				resolved_lineage_id:
					null,

				standard_id:
					"Mosaic",

				locus_number:
					null,

				missillac_id:
					null,

				resolution_status:
					"unresolved",

				notes:
					"Could not extract numeric component from candidate ID"
			});

			return;
		}

		directNumberItems.push({
			candidate_id:
				candidateId,

			raw_name:
				rawName,

			naming_source:
				"case_status.mosaic",

			resolved_lineage_id:
				null,

			standard_id:
				"Mosaic",

			locus_number:
				mosaicNumber,

			missillac_id:
				makeMissillacId(
					"Mosaic",
					mosaicNumber,
					locusStatus
				),

			resolution_status:
				"mosaic",

			notes:
				"Mosaic locus; number derived from internal candidate ID"
		});

		return;
	}

	unresolvedItems.push({
		candidate_id:
			candidateId,

		raw_name:
			rawName,

		naming_source:
			"case_status",

		resolved_lineage_id:
			linkedLineageId,

		standard_id:
			null,

		locus_number:
			null,

		missillac_id:
			null,

		resolution_status:
			"unresolved",

		notes:
			"Unsupported or missing case_status: " +
			(caseStatus !== null ? caseStatus : "null")
	});
});


glue.logInfo(
	"Loaded candidate rows: " +
	candidateRows.length
);


// -------------------------------------------------------------------------
// Assign fully resolved lineage numbers
// -------------------------------------------------------------------------

var namedCount = 0;
var preservedNumberCount = 0;
var newlyAllocatedCount = 0;
var directCandidateIdCount = 0;
var candidateLegacyConflictCount = 0;
var lineageNumberConflictCount = 0;


/*
 * Write above-lineage and mosaic items first.
 */
_.each(directNumberItems, function(item) {

	writeCandidateName(item);

	namedCount++;
	directCandidateIdCount++;
});


_.each(
	Object.keys(fullyResolvedGroups).sort(),

	function(standardId) {

		var items =
			fullyResolvedGroups[
				standardId
			];

		items.sort(genomicSort);

		/*
		 * Gather all legacy number claims in this lineage.
		 */
		var claimsByNumber = {};

		_.each(items, function(item) {

			if(
				item.legacy_number_status ===
				"candidate_conflict"
			) {
				return;
			}

			if(item.legacy_number === null) {
				return;
			}

			var numberKey =
				"" + item.legacy_number;

			if(!claimsByNumber[numberKey]) {
				claimsByNumber[numberKey] = [];
			}

			claimsByNumber[
				numberKey
			].push(item);
		});

		var usedNumbers = {};
		var preservedByCandidate = {};
		var duplicateClaimCandidates = {};

		/*
		 * Reserve unambiguous legacy numbers.
		 */
		_.each(
			Object.keys(claimsByNumber),

			function(numberKey) {

				var claimItems =
					claimsByNumber[
						numberKey
					];

				if(claimItems.length === 1) {

					var claimItem =
						claimItems[0];

					preservedByCandidate[
						claimItem.candidate_id
					] =
						parseInt(
							numberKey,
							10
						);

					usedNumbers[numberKey] =
						true;

					return;
				}

				lineageNumberConflictCount++;

				_.each(
					claimItems,
					function(conflictItem) {

						duplicateClaimCandidates[
							conflictItem.candidate_id
						] = true;
					}
				);

				glue.logInfo(
					"Legacy number conflict in " +
					standardId +
					": number " +
					numberKey +
					" claimed by " +
					_.map(
						claimItems,
						function(conflictItem) {
							return conflictItem.candidate_id;
						}
					).join(", ")
				);
			}
		);


		var nextAvailableNumber = 1;

		function allocateNextNumber() {

			while(
				usedNumbers[
					"" + nextAvailableNumber
				]
			) {
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


		_.each(items, function(item) {

			var conflictReason = null;

			if(
				item.legacy_number_status ===
					"candidate_conflict"
			) {
				conflictReason =
					"Multiple distinct DBM/Gifford mnemonic numbers are linked to this candidate";
			}

			if(
				duplicateClaimCandidates[
					item.candidate_id
				]
			) {
				conflictReason =
					"DBM/Gifford mnemonic number is also claimed by another candidate in lineage " +
					standardId;
			}

			if(conflictReason !== null) {

				writeCandidateName({
					candidate_id:
						item.candidate_id,

					raw_name:
						item.raw_name,

					naming_source:
						NUMBERING_LEGACY_SOURCE,

					resolved_lineage_id:
						item.resolved_lineage_id,

					standard_id:
						item.standard_id,

					locus_number:
						null,

					missillac_id:
						null,

					resolution_status:
						"legacy_number_conflict",

					notes:
						conflictReason
				});

				candidateLegacyConflictCount++;

				return;
			}

			var locusNumber;
			var namingSource;
			var notes;

			if(
				preservedByCandidate[
					item.candidate_id
				] !== undefined
			) {
				locusNumber =
					preservedByCandidate[
						item.candidate_id
					];

				namingSource =
					NUMBERING_LEGACY_SOURCE;

				notes =
					"Resolved through persisted erv_lineage link; " +
					"preserved DBM/Gifford mnemonic number " +
					locusNumber;

				preservedNumberCount++;

			} else {

				locusNumber =
					allocateNextNumber();

				namingSource =
					"erv_locus_candidate.erv_lineage";

				notes =
					"Resolved through persisted erv_lineage link; " +
					"newly allocated Missillac locus number";

				newlyAllocatedCount++;
			}

			writeCandidateName({
				candidate_id:
					item.candidate_id,

				raw_name:
					item.raw_name,

				naming_source:
					namingSource,

				resolved_lineage_id:
					item.resolved_lineage_id,

				standard_id:
					item.standard_id,

				locus_number:
					locusNumber,

				missillac_id:
					makeMissillacId(
						item.standard_id,
						locusNumber,
						item.locus_status
					),

				resolution_status:
					item.resolution_status,

				notes:
					notes
			});

			namedCount++;

			if(namedCount % 10000 === 0) {

				glue.logInfo(
					"Named " +
					namedCount +
					" candidates"
				);
			}
		});
	}
);


// -------------------------------------------------------------------------
// Write unresolved and conflict rows
// -------------------------------------------------------------------------

_.each(unresolvedItems, function(item) {

	writeCandidateName(item);
});


// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

glue.logInfo(
	"Candidate Missillac naming pass complete"
);

glue.logInfo(
	"Named candidates: " +
	namedCount
);

glue.logInfo(
	"Preserved DBM/Gifford numbers: " +
	preservedNumberCount
);

glue.logInfo(
	"Newly allocated lineage numbers: " +
	newlyAllocatedCount
);

glue.logInfo(
	"IDs using candidate numeric component: " +
	directCandidateIdCount
);

glue.logInfo(
	"Candidates with legacy-number conflicts: " +
	candidateLegacyConflictCount
);

glue.logInfo(
	"Duplicated legacy numbers within lineage groups: " +
	lineageNumberConflictCount
);

glue.logInfo(
	"Unresolved candidates written: " +
	unresolvedItems.length
);