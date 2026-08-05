// glue/build/locus/missillac/applyErvLocusCandidateNames.js
//
// Missillac naming pass for filtered ERV/LTR candidate loci.
//
// Reads:
//   erv_locus_candidate
//   erv_lineage
//   erv_lineage_alias
//   erv_locus_legacy_xref
//
// Writes:
//   erv_locus_candidate_name
//
// Logic:
//   - if case_status = Mosaic:
//       standard_id = Mosaic
//       resolution_status = mosaic
//
//   - if case_status = Resolved at clade level:
//       standard_id = normalised names_decision, e.g. Clade-I
//       resolution_status = resolved_category
//
//   - otherwise resolve names_decision to erv_lineage by:
//       1. erv_lineage.id
//       2. erv_lineage.standard_id
//       3. erv_lineage_alias.alias_name
//
//   - for legacy xrefs where:
//       legacy_source = compiled_human_erv_loci_hg19
//       mapping_status = mapped
//       source_numeric_id is a positive integer
//
//     preserve source_numeric_id as the Missillac locus number.
//
//   - assign remaining numbers sequentially within each standard_id,
//     in genomic order, while skipping preserved numbers.
//
// No links are created.

var NUMBERING_LEGACY_SOURCE =
	"compiled_human_erv_loci_hg19";


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

	var s = ("" + value).trim();

	if(s === "") {
		return null;
	}

	var low = s.toLowerCase();

	if(
		low === "n/a" ||
		low === "na" ||
		low === "null" ||
		low === "none" ||
		s === "-"
	) {
		return null;
	}

	return s;
}


function normInt(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	var n = parseInt(value, 10);

	return isNaN(n) ? null : n;
}


function positiveInt(value) {

	var n = normInt(value);

	if(n === null || n < 1) {
		return null;
	}

	return n;
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

	chrom = chrom.replace(/^chr/i, "");

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

	var n = parseInt(chrom, 10);

	return isNaN(n) ? 1000 : n;
}


function normaliseCategoryName(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	if(value === "Clade I") {
		return "Clade-I";
	}

	if(value === "Clade II") {
		return "Clade-II";
	}

	if(value === "Clade III") {
		return "Clade-III";
	}

	return value.replace(/\s+/g, "-");
}


function genomicSort(a, b) {

	var cr =
		chrRank(a.chrom) -
		chrRank(b.chrom);

	if(cr !== 0) {
		return cr;
	}

	var aStart =
		a.start_position !== null
			? a.start_position
			: 0;

	var bStart =
		b.start_position !== null
			? b.start_position
			: 0;

	var sp =
		aStart - bStart;

	if(sp !== 0) {
		return sp;
	}

	var aEnd =
		a.end_position !== null
			? a.end_position
			: 0;

	var bEnd =
		b.end_position !== null
			? b.end_position
			: 0;

	var ep =
		aEnd - bEnd;

	if(ep !== 0) {
		return ep;
	}

	if(a.candidate_id < b.candidate_id) {
		return -1;
	}

	if(a.candidate_id > b.candidate_id) {
		return 1;
	}

	return 0;
}


// -------------------------------------------------------------------------
// Build lineage-resolution maps
// -------------------------------------------------------------------------

var lineageById = {};
var lineageByStandardId = {};

var lineageRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		"erv_lineage",
		"id",
		"standard_id"
	])
);

_.each(lineageRows, function(row) {

	var id =
		norm(row["id"]);

	var standardId =
		norm(row["standard_id"]);

	if(id !== null) {

		lineageById[id] = {
			resolved_lineage_id:
				id,

			standard_id:
				standardId !== null
					? standardId
					: id
		};
	}

	if(
		standardId !== null &&
		id !== null
	) {
		lineageByStandardId[standardId] = {
			resolved_lineage_id:
				id,

			standard_id:
				standardId
		};
	}
});


var lineageByAlias = {};

var lineageAliasRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		"erv_lineage_alias",
		"id",
		"alias_name",
		"erv_lineage.id",
		"erv_lineage.standard_id"
	])
);

_.each(lineageAliasRows, function(row) {

	var aliasName =
		norm(row["alias_name"]);

	var lineageId =
		norm(row["erv_lineage.id"]);

	var standardId =
		norm(row["erv_lineage.standard_id"]);

	if(
		aliasName !== null &&
		lineageId !== null
	) {
		lineageByAlias[aliasName] = {
			resolved_lineage_id:
				lineageId,

			standard_id:
				standardId !== null
					? standardId
					: lineageId
		};
	}
});


function resolveLineage(
	rawName,
	caseStatus
) {

	rawName =
		norm(rawName);

	caseStatus =
		norm(caseStatus);

	if(caseStatus === "Mosaic") {

		return {
			source:
				"case_status.mosaic",

			raw_name:
				rawName,

			resolved_lineage_id:
				null,

			standard_id:
				"Mosaic",

			resolution_status:
				"mosaic",

			notes:
				"Mosaic locus; numbered in shared Mosaic category"
		};
	}

	if(
		caseStatus ===
		"Resolved at clade level"
	) {

		var categoryId =
			normaliseCategoryName(
				rawName
			);

		if(categoryId !== null) {

			return {
				source:
					"case_status.clade_level",

				raw_name:
					rawName,

				resolved_lineage_id:
					null,

				standard_id:
					categoryId,

				resolution_status:
					"resolved_category",

				notes:
					"Resolved at clade level; numbered within clade-level category"
			};
		}
	}

	if(rawName === null) {
		return null;
	}

	if(lineageById[rawName]) {

		return {
			source:
				"erv_lineage.id",

			raw_name:
				rawName,

			resolved_lineage_id:
				lineageById[rawName]
					.resolved_lineage_id,

			standard_id:
				lineageById[rawName]
					.standard_id,

			resolution_status:
				"resolved",

			notes:
				"Resolved via erv_lineage.id"
		};
	}

	if(lineageByStandardId[rawName]) {

		return {
			source:
				"erv_lineage.standard_id",

			raw_name:
				rawName,

			resolved_lineage_id:
				lineageByStandardId[rawName]
					.resolved_lineage_id,

			standard_id:
				lineageByStandardId[rawName]
					.standard_id,

			resolution_status:
				"resolved",

			notes:
				"Resolved via erv_lineage.standard_id"
		};
	}

	if(lineageByAlias[rawName]) {

		return {
			source:
				"erv_lineage_alias.alias_name",

			raw_name:
				rawName,

			resolved_lineage_id:
				lineageByAlias[rawName]
					.resolved_lineage_id,

			standard_id:
				lineageByAlias[rawName]
					.standard_id,

			resolution_status:
				"resolved",

			notes:
				"Resolved via erv_lineage_alias.alias_name"
		};
	}

	return null;
}


// -------------------------------------------------------------------------
// Load authoritative preserved-number claims
// -------------------------------------------------------------------------
//
// Map structure:
//
// legacyNumberClaimsByCandidate[candidateId] = [
//     {
//         xref_id: "...",
//         legacy_name: "...",
//         legacy_classification: "...",
//         source_numeric_id: 9
//     }
// ];
//
// Only unambiguously mapped DBM/Gifford xrefs contribute automatic
// number claims.

var legacyNumberClaimsByCandidate = {};

var legacyNumberRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		"erv_locus_legacy_xref",
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

_.each(legacyNumberRows, function(row) {

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

	if(
		!legacyNumberClaimsByCandidate[
			candidateId
		]
	) {
		legacyNumberClaimsByCandidate[
			candidateId
		] = [];
	}

	legacyNumberClaimsByCandidate[
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
	legacyNumberRows.length
);


// -------------------------------------------------------------------------
// Resolve one candidate's legacy-number claim
// -------------------------------------------------------------------------
//
// A candidate may theoretically have more than one relevant xref.
//
// Accepted:
//   - one claim;
//   - multiple claims that all specify the same number.
//
// Rejected:
//   - multiple distinct numbers attached to one candidate.

function resolveCandidateLegacyNumber(
	candidateId
) {

	var claims =
		legacyNumberClaimsByCandidate[
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
// Load and resolve candidate rows
// -------------------------------------------------------------------------

var candidateRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		"erv_locus_candidate",
		"id",
		"names_decision",
		"case_status",
		"chrom",
		"start_position",
		"end_position"
	])
);

var resolvedByStandardId = {};
var unresolved = [];

_.each(candidateRows, function(row) {

	var candidateId =
		norm(row["id"]);

	var rawName =
		norm(row["names_decision"]);

	var caseStatus =
		norm(row["case_status"]);

	if(candidateId === null) {
		return;
	}

	var resolved =
		resolveLineage(
			rawName,
			caseStatus
		);

	if(resolved === null) {

		unresolved.push({
			candidate_id:
				candidateId,

			raw_name:
				rawName,

			case_status:
				caseStatus,

			reason:
				"Could not resolve names_decision to lineage/category"
		});

		return;
	}

	var standardId =
		resolved.standard_id;

	if(
		!resolvedByStandardId[
			standardId
		]
	) {
		resolvedByStandardId[
			standardId
		] = [];
	}

	var legacyNumberResolution =
		resolveCandidateLegacyNumber(
			candidateId
		);

	resolvedByStandardId[
		standardId
	].push({
		candidate_id:
			candidateId,

		raw_name:
			rawName,

		naming_source:
			resolved.source,

		resolved_lineage_id:
			resolved.resolved_lineage_id,

		standard_id:
			standardId,

		resolution_status:
			resolved.resolution_status,

		notes:
			resolved.notes,

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
			legacyNumberResolution.status,

		legacy_number:
			legacyNumberResolution.number,

		legacy_number_claims:
			legacyNumberResolution.claims
	});
});

glue.logInfo(
	"Loaded candidate rows: " +
	candidateRows.length
);

glue.logInfo(
	"Unresolved lineage/category candidates: " +
	unresolved.length
);


// -------------------------------------------------------------------------
// Write lineage/category-unresolved rows
// -------------------------------------------------------------------------

_.each(unresolved, function(item) {

	ensureRow(
		"erv_locus_candidate_name",
		item.candidate_id
	);

	glue.inMode(
		customRowPath(
			"erv_locus_candidate_name",
			item.candidate_id
		),

		function() {

			setFieldIfPresent(
				"candidate_id",
				item.candidate_id
			);

			setFieldIfPresent(
				"naming_source",
				"names_decision"
			);

			setFieldIfPresent(
				"raw_name",
				item.raw_name
			);

			setFieldIfPresent(
				"resolution_status",
				"unresolved"
			);

			setFieldIfPresent(
				"notes",
				item.reason
			);
		}
	);
});


// -------------------------------------------------------------------------
// Number and write resolved rows
// -------------------------------------------------------------------------

var namedCount = 0;
var preservedNumberCount = 0;
var newlyAllocatedCount = 0;
var candidateLegacyConflictCount = 0;
var standardIdNumberConflictCount = 0;

_.each(
	Object.keys(
		resolvedByStandardId
	).sort(),

	function(standardId) {

		var items =
			resolvedByStandardId[
				standardId
			];

		items.sort(genomicSort);

		/*
		 * First collect preserved-number claims within this standard_id.
		 *
		 * numberClaims[number] = [item, item, ...]
		 */
		var numberClaims = {};

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

			if(!numberClaims[numberKey]) {
				numberClaims[numberKey] = [];
			}

			numberClaims[numberKey].push(
				item
			);
		});

		/*
		 * Determine which preserved numbers are safe to reserve.
		 */
		var usedNumbers = {};
		var preservedNumberByCandidate = {};
		var numberConflictCandidates = {};

		_.each(
			Object.keys(numberClaims),

			function(numberKey) {

				var claimItems =
					numberClaims[numberKey];

				if(claimItems.length === 1) {

					var claimItem =
						claimItems[0];

					preservedNumberByCandidate[
						claimItem.candidate_id
					] =
						parseInt(
							numberKey,
							10
						);

					usedNumbers[numberKey] =
						true;

				} else {

					standardIdNumberConflictCount++;

					_.each(
						claimItems,
						function(conflictItem) {

							numberConflictCandidates[
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
			}
		);

		/*
		 * Assign numbers to candidates without valid preserved numbers.
		 *
		 * Use the smallest available positive integer, preserving genomic
		 * order among newly numbered candidates.
		 */
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

			var legacyConflictReason = null;

			if(
				item.legacy_number_status ===
				"candidate_conflict"
			) {
				legacyConflictReason =
					"Multiple distinct DBM/Gifford mnemonic numbers are linked to this candidate";
			}

			if(
				numberConflictCandidates[
					item.candidate_id
				]
			) {
				legacyConflictReason =
					"DBM/Gifford mnemonic number is also claimed by another candidate in standard_id " +
					standardId;
			}

			/*
			 * Do not silently replace a conflicting historical number with
			 * a newly allocated number.
			 */
			if(legacyConflictReason !== null) {

				ensureRow(
					"erv_locus_candidate_name",
					item.candidate_id
				);

				glue.inMode(
					customRowPath(
						"erv_locus_candidate_name",
						item.candidate_id
					),

					function() {

						setFieldIfPresent(
							"candidate_id",
							item.candidate_id
						);

						setFieldIfPresent(
							"naming_source",
							NUMBERING_LEGACY_SOURCE
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

						setFieldIfPresent(
							"resolution_status",
							"legacy_number_conflict"
						);

						setFieldIfPresent(
							"notes",
							legacyConflictReason
						);
					}
				);

				candidateLegacyConflictCount++;

				return;
			}

			var locusNumber = null;
			var namingSource = item.naming_source;
			var notes = item.notes;

			if(
				preservedNumberByCandidate[
					item.candidate_id
				] !== undefined
			) {
				locusNumber =
					preservedNumberByCandidate[
						item.candidate_id
					];

				namingSource =
					NUMBERING_LEGACY_SOURCE;

				notes =
					item.notes +
					"; preserved DBM/Gifford mnemonic number " +
					locusNumber;

				preservedNumberCount++;

			} else {

				locusNumber =
					allocateNextNumber();

				notes =
					item.notes +
					"; newly allocated Missillac locus number";

				newlyAllocatedCount++;
			}

			var missillacId =
				standardId +
				"-" +
				locusNumber;

			ensureRow(
				"erv_locus_candidate_name",
				item.candidate_id
			);

			glue.inMode(
				customRowPath(
					"erv_locus_candidate_name",
					item.candidate_id
				),

				function() {

					setFieldIfPresent(
						"candidate_id",
						item.candidate_id
					);

					setFieldIfPresent(
						"naming_source",
						namingSource
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
						locusNumber
					);

					setFieldIfPresent(
						"missillac_id",
						missillacId
					);

					setFieldIfPresent(
						"resolution_status",
						item.resolution_status
					);

					setFieldIfPresent(
						"notes",
						notes
					);
				}
			);

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
	"Newly allocated numbers: " +
	newlyAllocatedCount
);

glue.logInfo(
	"Candidates with legacy-number conflicts: " +
	candidateLegacyConflictCount
);

glue.logInfo(
	"Duplicated legacy numbers within standard_id groups: " +
	standardIdNumberConflictCount
);

glue.logInfo(
	"Unresolved lineage/category candidates written: " +
	unresolved.length
);

