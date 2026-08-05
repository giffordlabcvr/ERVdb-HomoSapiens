// glue/build/locus/linkLocusCandidatesToErvLineages.js
//
// Resolves fully resolved ERV locus candidates to curated erv_lineage
// concepts and persists the relationship using:
//
//   erv_locus_candidate -> erv_lineage
//
// Only candidates with:
//
//   case_status = Fully resolved
//
// are eligible for a lineage link.
//
// Candidates resolved only at clade, genus or subgenus level, mosaics,
// and unresolved candidates are deliberately left without a lineage link.
//
// Resolution order:
//
//   1. Exact erv_lineage.id
//   2. Exact erv_lineage.standard_id
//   3. Exact erv_lineage_alias.alias_name
//   4. Established source-name translations
//   5. Conservative punctuation-normalised matching
//
// The script reports linked, skipped and unresolved candidates.

var CANDIDATE_TABLE = "erv_locus_candidate";
var LINEAGE_TABLE = "erv_lineage";
var LINEAGE_ALIAS_TABLE = "erv_lineage_alias";

var LINEAGE_LINK = "erv_lineage";
var FULLY_RESOLVED_STATUS = "Fully resolved";


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

	var result = ("" + value).trim();

	if(result === "") {
		return null;
	}

	var lower = result.toLowerCase();

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


function esc(value) {

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


/*
 * Lookup key used only as a fallback after exact and explicit alias
 * resolution.
 *
 * Examples:
 *
 *   HERV-K(HML3) -> herv-k-hml3
 *   HERV-K-HML3  -> herv-k-hml3
 *   HERV_K_HML3  -> herv-k-hml3
 *
 * This deliberately preserves letters and numbers while treating common
 * punctuation differences as equivalent.
 */
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


/*
 * Separate compact key used for the established translation table.
 *
 * Examples:
 *
 *   HUERS-P3B  -> huersp3b
 *   RRHERV-I   -> rrhervi
 */
function translationLookupKey(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	return value
		.toLowerCase()
		.replace(/[^a-z0-9()]+/g, "");
}


// -------------------------------------------------------------------------
// Established source-name translations
// -------------------------------------------------------------------------
//
// These mappings were already used by the alignment-assignment stage.
// They represent semantic nomenclature mappings, not merely punctuation
// normalisation.
//
// Wherever possible, persistent entries in erv_lineage_alias should
// eventually replace this local table.

var lineageTranslationByKey = {

	"ervle":
		"ERV-L",

	"hervea":
		"HERV-E",

	"hervip":
		"HERV-I",

	"hervk(hml1)":
		"HERV-K-HML1",

	"hervk(hml2)":
		"HERV-K-HML2",

	"hervk(hml3)":
		"HERV-K-HML3",

	"hervk(hml4)":
		"HERV-K-HML4",

	"hervk(hml5)":
		"HERV-K-HML5",

	"hervk(hml6)":
		"HERV-K-HML6",

	"hervk(hml7)":
		"HERV-K-HML7",

	"hervk(hml8)":
		"HERV-K-HML8",

	"hervk(hml9)":
		"HERV-K-HML9",

	"hervk(hml10)":
		"HERV-K-HML10",

	"hervlb1":
		"HERV-Lb",

	"hervlb2":
		"HERV-Lb",

	"hervrb1":
		"HERV-Rb",

	"hervrb2":
		"HERV-Rb",

	"huersp3b":
		"HERV-P",

	"rrhervi":
		"HERV-15"
};


// -------------------------------------------------------------------------
// Build lineage-resolution maps
// -------------------------------------------------------------------------

var lineageById = {};
var lineageByStandardId = {};

var lineageByNormalisedId = {};
var lineageByNormalisedStandardId = {};

var ambiguousNormalisedIds = {};
var ambiguousNormalisedStandardIds = {};


function addUniqueNormalisedResolution(
	targetMap,
	ambiguousMap,
	key,
	resolution
) {

	if(key === null) {
		return;
	}

	if(ambiguousMap[key]) {
		return;
	}

	if(!targetMap[key]) {

		targetMap[key] = resolution;
		return;
	}

	if(
		targetMap[key].lineage_id !==
		resolution.lineage_id
	) {

		delete targetMap[key];
		ambiguousMap[key] = true;
	}
}


var lineageRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LINEAGE_TABLE,
		"id",
		"standard_id"
	])
);


_.each(lineageRows, function(row) {

	var lineageId =
		norm(row["id"]);

	var standardId =
		norm(row["standard_id"]);

	if(lineageId === null) {
		return;
	}

	var resolution = {
		lineage_id:
			lineageId,

		standard_id:
			standardId !== null
				? standardId
				: lineageId
	};

	lineageById[lineageId] =
		resolution;

	addUniqueNormalisedResolution(
		lineageByNormalisedId,
		ambiguousNormalisedIds,
		normalisedLookupKey(lineageId),
		resolution
	);

	if(standardId !== null) {

		lineageByStandardId[standardId] =
			resolution;

		addUniqueNormalisedResolution(
			lineageByNormalisedStandardId,
			ambiguousNormalisedStandardIds,
			normalisedLookupKey(standardId),
			resolution
		);
	}
});


var lineageByAlias = {};
var lineageByNormalisedAlias = {};

var ambiguousAliases = {};
var ambiguousNormalisedAliases = {};


function addExactAlias(
	aliasName,
	resolution
) {

	if(aliasName === null) {
		return;
	}

	if(ambiguousAliases[aliasName]) {
		return;
	}

	if(!lineageByAlias[aliasName]) {

		lineageByAlias[aliasName] =
			resolution;

		return;
	}

	if(
		lineageByAlias[aliasName].lineage_id !==
		resolution.lineage_id
	) {

		delete lineageByAlias[aliasName];
		ambiguousAliases[aliasName] = true;
	}
}


var lineageAliasRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LINEAGE_ALIAS_TABLE,
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
		aliasName === null ||
		lineageId === null
	) {
		return;
	}

	var resolution = {
		lineage_id:
			lineageId,

		standard_id:
			standardId !== null
				? standardId
				: lineageId
	};

	addExactAlias(
		aliasName,
		resolution
	);

	addUniqueNormalisedResolution(
		lineageByNormalisedAlias,
		ambiguousNormalisedAliases,
		normalisedLookupKey(aliasName),
		resolution
	);
});


glue.logInfo(
	"Loaded ERV lineages: " +
	lineageRows.length
);

glue.logInfo(
	"Loaded ERV lineage aliases: " +
	lineageAliasRows.length
);


// -------------------------------------------------------------------------
// Resolve a fully resolved candidate name
// -------------------------------------------------------------------------

function makeResolution(
	lineageResolution,
	method,
	rawName,
	resolvedName
) {

	return {
		status:
			"resolved",

		lineage_id:
			lineageResolution.lineage_id,

		standard_id:
			lineageResolution.standard_id,

		method:
			method,

		raw_name:
			rawName,

		resolved_name:
			resolvedName
	};
}


function resolveCandidateLineage(rawName) {

	rawName = norm(rawName);

	if(rawName === null) {

		return {
			status:
				"unresolved",

			lineage_id:
				null,

			standard_id:
				null,

			method:
				null,

			raw_name:
				null,

			resolved_name:
				null,

			reason:
				"names_decision is empty"
		};
	}

	/*
	 * 1. Exact lineage ID
	 */
	if(lineageById[rawName]) {

		return makeResolution(
			lineageById[rawName],
			"erv_lineage.id",
			rawName,
			rawName
		);
	}

	/*
	 * 2. Exact standard ID
	 */
	if(lineageByStandardId[rawName]) {

		return makeResolution(
			lineageByStandardId[rawName],
			"erv_lineage.standard_id",
			rawName,
			rawName
		);
	}

	/*
	 * 3. Exact curated alias
	 */
	if(lineageByAlias[rawName]) {

		return makeResolution(
			lineageByAlias[rawName],
			"erv_lineage_alias.alias_name",
			rawName,
			rawName
		);
	}

	/*
	 * 4. Established semantic translation
	 */
	var translationKey =
		translationLookupKey(rawName);

	var translatedName =
		translationKey !== null
			? lineageTranslationByKey[
				translationKey
			]
			: null;

	if(translatedName !== null && translatedName !== undefined) {

		if(lineageById[translatedName]) {

			return makeResolution(
				lineageById[translatedName],
				"established_translation_to_erv_lineage.id",
				rawName,
				translatedName
			);
		}

		if(lineageByStandardId[translatedName]) {

			return makeResolution(
				lineageByStandardId[translatedName],
				"established_translation_to_standard_id",
				rawName,
				translatedName
			);
		}

		if(lineageByAlias[translatedName]) {

			return makeResolution(
				lineageByAlias[translatedName],
				"established_translation_to_alias",
				rawName,
				translatedName
			);
		}

		return {
			status:
				"unresolved",

			lineage_id:
				null,

			standard_id:
				null,

			method:
				"established_translation",

			raw_name:
				rawName,

			resolved_name:
				translatedName,

			reason:
				"Translation target does not resolve to an erv_lineage"
		};
	}

	/*
	 * 5. Conservative punctuation-normalised matching
	 */
	var normalisedKey =
		normalisedLookupKey(rawName);

	if(
		normalisedKey !== null &&
		lineageByNormalisedId[normalisedKey]
	) {

		return makeResolution(
			lineageByNormalisedId[normalisedKey],
			"normalised_erv_lineage.id",
			rawName,
			lineageByNormalisedId[
				normalisedKey
			].lineage_id
		);
	}

	if(
		normalisedKey !== null &&
		lineageByNormalisedStandardId[
			normalisedKey
		]
	) {

		return makeResolution(
			lineageByNormalisedStandardId[
				normalisedKey
			],
			"normalised_erv_lineage.standard_id",
			rawName,
			lineageByNormalisedStandardId[
				normalisedKey
			].standard_id
		);
	}

	if(
		normalisedKey !== null &&
		lineageByNormalisedAlias[
			normalisedKey
		]
	) {

		return makeResolution(
			lineageByNormalisedAlias[
				normalisedKey
			],
			"normalised_erv_lineage_alias.alias_name",
			rawName,
			rawName
		);
	}

	var ambiguousReason = null;

	if(
		normalisedKey !== null &&
		(
			ambiguousNormalisedIds[
				normalisedKey
			] ||
			ambiguousNormalisedStandardIds[
				normalisedKey
			] ||
			ambiguousNormalisedAliases[
				normalisedKey
			]
		)
	) {
		ambiguousReason =
			"Normalised name matches more than one lineage";
	}

	return {
		status:
			"unresolved",

		lineage_id:
			null,

		standard_id:
			null,

		method:
			null,

		raw_name:
			rawName,

		resolved_name:
			null,

		reason:
			ambiguousReason !== null
				? ambiguousReason
				: "Could not resolve names_decision to an ERV lineage"
	};
}


// -------------------------------------------------------------------------
// Link helpers
// -------------------------------------------------------------------------

function setCandidateLineageLink(
	candidateId,
	lineageId
) {

	glue.inMode(
		customRowPath(
			CANDIDATE_TABLE,
			candidateId
		),

		function() {

			glue.command([
				"set",
				"link-target",
				LINEAGE_LINK,
				customRowPath(
					LINEAGE_TABLE,
					lineageId
				)
			]);
		}
	);
}


/*
 * Clear an existing link when a candidate is no longer eligible or no
 * longer resolves.
 *
 * On a newly created link this will usually do nothing. The try/catch
 * allows the script to remain usable if GLUE reports that no link target
 * is currently set.
 */
function clearCandidateLineageLink(
	candidateId
) {

	try {

		glue.inMode(
			customRowPath(
				CANDIDATE_TABLE,
				candidateId
			),

			function() {

				glue.command([
					"unset",
					"link-target",
					LINEAGE_LINK
				]);
			}
		);

		return true;

	} catch(e) {

		return false;
	}
}


// -------------------------------------------------------------------------
// Load and process candidates
// -------------------------------------------------------------------------

var candidateRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		CANDIDATE_TABLE,
		"id",
		"case_status",
		"status",
		"names_decision",
		"erv_lineage.id"
	])
);


var results = [];

var linkedCount = 0;
var unchangedCount = 0;
var skippedCount = 0;
var unresolvedCount = 0;
var clearedCount = 0;


_.each(candidateRows, function(row) {

	var candidateId =
		norm(row["id"]);

	var caseStatus =
		norm(row["case_status"]);

	var locusStatus =
		norm(row["status"]);

	var rawName =
		norm(row["names_decision"]);

	var existingLineageId =
		norm(row["erv_lineage.id"]);

	if(candidateId === null) {
		return;
	}

	/*
	 * Only Fully resolved candidates may carry a direct lineage link.
	 */
	if(caseStatus !== FULLY_RESOLVED_STATUS) {

		var linkCleared = false;

		if(existingLineageId !== null) {

			linkCleared =
				clearCandidateLineageLink(
					candidateId
				);

			if(linkCleared) {
				clearedCount++;
			}
		}

		results.push({
			candidate_id:
				candidateId,

			case_status:
				caseStatus,

			locus_status:
				locusStatus,

			names_decision:
				rawName,

			resolved_lineage_id:
				null,

			resolved_standard_id:
				null,

			resolution_method:
				null,

			result_status:
				"skipped_non_fully_resolved",

			previous_lineage_id:
				existingLineageId,

			link_cleared:
				linkCleared,

			notes:
				"Direct erv_lineage links are restricted to Fully resolved candidates"
		});

		skippedCount++;

		return;
	}

	var resolution =
		resolveCandidateLineage(
			rawName
		);

	if(resolution.status !== "resolved") {

		var unresolvedLinkCleared = false;

		if(existingLineageId !== null) {

			unresolvedLinkCleared =
				clearCandidateLineageLink(
					candidateId
				);

			if(unresolvedLinkCleared) {
				clearedCount++;
			}
		}

		results.push({
			candidate_id:
				candidateId,

			case_status:
				caseStatus,

			locus_status:
				locusStatus,

			names_decision:
				rawName,

			resolved_lineage_id:
				null,

			resolved_standard_id:
				null,

			resolution_method:
				resolution.method,

			result_status:
				"unresolved_fully_resolved",

			previous_lineage_id:
				existingLineageId,

			link_cleared:
				unresolvedLinkCleared,

			notes:
				resolution.reason
		});

		unresolvedCount++;

		return;
	}

	if(
		existingLineageId ===
		resolution.lineage_id
	) {

		results.push({
			candidate_id:
				candidateId,

			case_status:
				caseStatus,

			locus_status:
				locusStatus,

			names_decision:
				rawName,

			resolved_lineage_id:
				resolution.lineage_id,

			resolved_standard_id:
				resolution.standard_id,

			resolution_method:
				resolution.method,

			result_status:
				"already_linked",

			previous_lineage_id:
				existingLineageId,

			link_cleared:
				false,

			notes:
				resolution.resolved_name !== rawName
					? (
						"Resolved via " +
						resolution.resolved_name
					)
					: null
		});

		unchangedCount++;

		return;
	}

	setCandidateLineageLink(
		candidateId,
		resolution.lineage_id
	);

	results.push({
		candidate_id:
			candidateId,

		case_status:
			caseStatus,

		locus_status:
			locusStatus,

		names_decision:
			rawName,

		resolved_lineage_id:
			resolution.lineage_id,

		resolved_standard_id:
			resolution.standard_id,

		resolution_method:
			resolution.method,

		result_status:
			existingLineageId === null
				? "linked"
				: "relinked",

		previous_lineage_id:
			existingLineageId,

		link_cleared:
			false,

		notes:
			resolution.resolved_name !== rawName
				? (
					"Resolved via " +
					resolution.resolved_name
				)
				: null
	});

	linkedCount++;

	if(linkedCount % 10000 === 0) {

		glue.logInfo(
			"Linked or relinked " +
			linkedCount +
			" candidates"
		);
	}
});


glue.logInfo(
	"Candidate-to-lineage linking complete"
);

glue.logInfo(
	"Candidate rows examined: " +
	candidateRows.length
);

glue.logInfo(
	"Linked or relinked: " +
	linkedCount
);

glue.logInfo(
	"Already linked correctly: " +
	unchangedCount
);

glue.logInfo(
	"Skipped because not Fully resolved: " +
	skippedCount
);

glue.logInfo(
	"Fully resolved but unresolved to lineage: " +
	unresolvedCount
);

glue.logInfo(
	"Stale lineage links cleared: " +
	clearedCount
);


/*
 * Returning the full table is useful for initial validation.
 *
 * Once the script is stable, this can be replaced with a short summary if
 * the number of rows makes the console output inconvenient.
 */
results;