// glue/build/locus/loadErvLocusLineageAssociations.js
//
// Resolve fully resolved ERV locus candidates to curated ERV lineages and
// persist the relationships in:
//
//   erv_locus_lineage_assoc
//
// The script assumes:
//
//   1. erv_locus_candidate rows have already been loaded.
//   2. erv_locus rows have already been created.
//   3. erv_lineage and erv_lineage_alias have already been populated.
//   4. Base/sublineage LTR relationships have already been loaded.
//
// Only candidates with:
//
//   case_status = Fully resolved
//
// are assigned a primary ERV lineage association.
//
// Resolution order:
//
//   1. Exact erv_lineage.id
//   2. Exact erv_lineage.legacy_name
//   3. Exact erv_lineage.legacy_full_name
//   4. Exact erv_lineage_alias.alias_name
//   5. Established legacy-name translation
//   6. Conservative punctuation-normalised lineage matching
//   7. Unambiguous LTR-lineage-to-ERV-lineage association
//
// The LTR bridge is useful where names_decision contains an LTR name rather
// than an ERV lineage name. It is accepted only when that LTR lineage maps
// to exactly one ERV lineage.
//
// Mosaics and candidates resolved only above lineage level are deliberately
// not assigned here. Multiple component relationships can later be recorded
// as separate association rows with region_start and region_end.

var CANDIDATE_TABLE = "erv_locus_candidate";
var LOCUS_TABLE = "erv_locus";
var LINEAGE_TABLE = "erv_lineage";
var LINEAGE_ALIAS_TABLE = "erv_lineage_alias";
var LTR_LINEAGE_TABLE = "ltr_lineage";
var LINEAGE_LTR_ASSOC_TABLE = "erv_lineage_ltr_assoc";
var LOCUS_LINEAGE_ASSOC_TABLE = "erv_locus_lineage_assoc";

var FULLY_RESOLVED_STATUS = "Fully resolved";

var ASSOCIATION_ROLE = "primary";
var ASSOCIATION_EVIDENCE = "candidate_names_decision";
var ASSOCIATION_CONFIDENCE = "high";

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


function makeAssociationId(locusId, lineageId) {

	return sanitiseId(
		locusId +
		"__" +
		lineageId
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
			("" + rowId).replace(/'/g, "''") +
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


function setField(tableName, rowId, fieldName, value) {

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


// -------------------------------------------------------------------------
// Resolution-map helpers
// -------------------------------------------------------------------------

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


function translationLookupKey(value) {

	value = norm(value);

	if(value === null) {
		return null;
	}

	return value
		.toLowerCase()
		.replace(/[^a-z0-9()]+/g, "");
}


function addUniqueResolution(
	targetMap,
	ambiguousMap,
	key,
	lineageId
) {

	if(key === null || lineageId === null) {
		return;
	}

	if(ambiguousMap[key]) {
		return;
	}

	if(targetMap[key] === undefined) {
		targetMap[key] = lineageId;
		return;
	}

	if(targetMap[key] !== lineageId) {
		delete targetMap[key];
		ambiguousMap[key] = true;
	}
}


function makeResolved(
	lineageId,
	method,
	rawName,
	resolvedName
) {

	return {
		status: "resolved",
		lineage_id: lineageId,
		method: method,
		raw_name: rawName,
		resolved_name: resolvedName,
		reason: null
	};
}


function makeUnresolved(
	rawName,
	method,
	reason
) {

	return {
		status: "unresolved",
		lineage_id: null,
		method: method,
		raw_name: rawName,
		resolved_name: null,
		reason: reason
	};
}


// -------------------------------------------------------------------------
// Established legacy-name translations
// -------------------------------------------------------------------------
//
// These translate source nomenclature into curated names. The translated
// name is then resolved through the current lineage IDs, legacy names and
// aliases.

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
// Load ERV lineage lookup maps
// -------------------------------------------------------------------------

var lineageById = {};
var lineageByLegacyName = {};
var lineageByLegacyFullName = {};
var lineageByAlias = {};

var ambiguousLegacyNames = {};
var ambiguousLegacyFullNames = {};
var ambiguousAliases = {};

var lineageByNormalisedId = {};
var lineageByNormalisedLegacyName = {};
var lineageByNormalisedLegacyFullName = {};
var lineageByNormalisedAlias = {};

var ambiguousNormalisedIds = {};
var ambiguousNormalisedLegacyNames = {};
var ambiguousNormalisedLegacyFullNames = {};
var ambiguousNormalisedAliases = {};


var lineageRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LINEAGE_TABLE,
		"id",
		"legacy_name",
		"legacy_full_name"
	])
);


_.each(lineageRows, function(row) {

	var lineageId = norm(row["id"]);
	var legacyName = norm(row["legacy_name"]);
	var legacyFullName = norm(row["legacy_full_name"]);

	if(lineageId === null) {
		return;
	}

	lineageById[lineageId] = lineageId;

	addUniqueResolution(
		lineageByNormalisedId,
		ambiguousNormalisedIds,
		normalisedLookupKey(lineageId),
		lineageId
	);

	addUniqueResolution(
		lineageByLegacyName,
		ambiguousLegacyNames,
		legacyName,
		lineageId
	);

	addUniqueResolution(
		lineageByNormalisedLegacyName,
		ambiguousNormalisedLegacyNames,
		normalisedLookupKey(legacyName),
		lineageId
	);

	addUniqueResolution(
		lineageByLegacyFullName,
		ambiguousLegacyFullNames,
		legacyFullName,
		lineageId
	);

	addUniqueResolution(
		lineageByNormalisedLegacyFullName,
		ambiguousNormalisedLegacyFullNames,
		normalisedLookupKey(legacyFullName),
		lineageId
	);
});


var aliasRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LINEAGE_ALIAS_TABLE,
		"id",
		"alias_name",
		"erv_lineage.id"
	])
);


_.each(aliasRows, function(row) {

	var aliasName = norm(row["alias_name"]);
	var lineageId = norm(row["erv_lineage.id"]);

	if(aliasName === null || lineageId === null) {
		return;
	}

	addUniqueResolution(
		lineageByAlias,
		ambiguousAliases,
		aliasName,
		lineageId
	);

	addUniqueResolution(
		lineageByNormalisedAlias,
		ambiguousNormalisedAliases,
		normalisedLookupKey(aliasName),
		lineageId
	);
});


log("Loaded ERV lineages: " + lineageRows.length);
log("Loaded ERV lineage aliases: " + aliasRows.length);


// -------------------------------------------------------------------------
// Load LTR -> ERV lineage bridge
// -------------------------------------------------------------------------

var lineageByLtrId = {};
var lineageByNormalisedLtrId = {};

var ambiguousLtrIds = {};
var ambiguousNormalisedLtrIds = {};


var lineageLtrAssocRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		LINEAGE_LTR_ASSOC_TABLE,
		"id",
		"ltr_lineage.id",
		"erv_lineage.id"
	])
);


_.each(lineageLtrAssocRows, function(row) {

	var ltrLineageId = norm(row["ltr_lineage.id"]);
	var lineageId = norm(row["erv_lineage.id"]);

	if(ltrLineageId === null || lineageId === null) {
		return;
	}

	addUniqueResolution(
		lineageByLtrId,
		ambiguousLtrIds,
		ltrLineageId,
		lineageId
	);

	addUniqueResolution(
		lineageByNormalisedLtrId,
		ambiguousNormalisedLtrIds,
		normalisedLookupKey(ltrLineageId),
		lineageId
	);
});


log(
	"Loaded ERV-LTR lineage associations: " +
	lineageLtrAssocRows.length
);


// -------------------------------------------------------------------------
// Resolve a candidate name
// -------------------------------------------------------------------------

function resolveWithoutTranslation(rawName) {

	rawName = norm(rawName);

	if(rawName === null) {
		return makeUnresolved(
			null,
			null,
			"names_decision is empty"
		);
	}

	if(lineageById[rawName]) {
		return makeResolved(
			lineageById[rawName],
			"erv_lineage.id",
			rawName,
			rawName
		);
	}

	if(lineageByLegacyName[rawName]) {
		return makeResolved(
			lineageByLegacyName[rawName],
			"erv_lineage.legacy_name",
			rawName,
			rawName
		);
	}

	if(lineageByLegacyFullName[rawName]) {
		return makeResolved(
			lineageByLegacyFullName[rawName],
			"erv_lineage.legacy_full_name",
			rawName,
			rawName
		);
	}

	if(lineageByAlias[rawName]) {
		return makeResolved(
			lineageByAlias[rawName],
			"erv_lineage_alias.alias_name",
			rawName,
			rawName
		);
	}

	var key = normalisedLookupKey(rawName);

	if(key !== null && lineageByNormalisedId[key]) {
		return makeResolved(
			lineageByNormalisedId[key],
			"normalised_erv_lineage.id",
			rawName,
			rawName
		);
	}

	if(
		key !== null &&
		lineageByNormalisedLegacyName[key]
	) {
		return makeResolved(
			lineageByNormalisedLegacyName[key],
			"normalised_erv_lineage.legacy_name",
			rawName,
			rawName
		);
	}

	if(
		key !== null &&
		lineageByNormalisedLegacyFullName[key]
	) {
		return makeResolved(
			lineageByNormalisedLegacyFullName[key],
			"normalised_erv_lineage.legacy_full_name",
			rawName,
			rawName
		);
	}

	if(key !== null && lineageByNormalisedAlias[key]) {
		return makeResolved(
			lineageByNormalisedAlias[key],
			"normalised_erv_lineage_alias.alias_name",
			rawName,
			rawName
		);
	}

	if(lineageByLtrId[rawName]) {
		return makeResolved(
			lineageByLtrId[rawName],
			"unique_ltr_lineage_association",
			rawName,
			rawName
		);
	}

	if(key !== null && lineageByNormalisedLtrId[key]) {
		return makeResolved(
			lineageByNormalisedLtrId[key],
			"normalised_unique_ltr_lineage_association",
			rawName,
			rawName
		);
	}

	var ambiguous = (
		ambiguousLegacyNames[rawName] ||
		ambiguousLegacyFullNames[rawName] ||
		ambiguousAliases[rawName] ||
		ambiguousLtrIds[rawName] ||
		(
			key !== null &&
			(
				ambiguousNormalisedIds[key] ||
				ambiguousNormalisedLegacyNames[key] ||
				ambiguousNormalisedLegacyFullNames[key] ||
				ambiguousNormalisedAliases[key] ||
				ambiguousNormalisedLtrIds[key]
			)
		)
	);

	return makeUnresolved(
		rawName,
		null,
		ambiguous
			? "Name resolves ambiguously to multiple ERV lineages"
			: "Could not resolve names_decision to an ERV lineage"
	);
}


function resolveCandidateLineage(rawName) {

	var directResolution =
		resolveWithoutTranslation(rawName);

	if(directResolution.status === "resolved") {
		return directResolution;
	}

	var translationKey =
		translationLookupKey(rawName);

	var translatedName =
		translationKey !== null
			? lineageTranslationByKey[translationKey]
			: null;

	if(translatedName !== null && translatedName !== undefined) {

		var translatedResolution =
			resolveWithoutTranslation(translatedName);

		if(translatedResolution.status === "resolved") {

			translatedResolution.method =
				"established_translation+" +
				translatedResolution.method;

			translatedResolution.raw_name =
				rawName;

			translatedResolution.resolved_name =
				translatedName;

			return translatedResolution;
		}

		return makeUnresolved(
			rawName,
			"established_translation",
			"Translated name '" +
				translatedName +
				"' does not resolve to an ERV lineage"
		);
	}

	return directResolution;
}


// -------------------------------------------------------------------------
// Load locus and candidate rows
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


var candidateRows = glue.tableToObjects(
	glue.command([
		"list",
		"custom-table-row",
		CANDIDATE_TABLE,
		"id",
		"case_status",
		"status",
		"names_decision",
		"makes_mosaic"
	])
);


log("Loaded ERV loci: " + locusRows.length);
log("Loaded locus candidates: " + candidateRows.length);


// -------------------------------------------------------------------------
// Process candidates
// -------------------------------------------------------------------------

var eligibleCount = 0;
var createdCount = 0;
var updatedCount = 0;
var skippedStatusCount = 0;
var skippedMosaicCount = 0;
var missingLocusCount = 0;
var unresolvedCount = 0;

var unresolvedResults = [];


_.each(candidateRows, function(row) {

	var candidateId = norm(row["id"]);
	var caseStatus = norm(row["case_status"]);
	var locusStatus = norm(row["status"]);
	var rawName = norm(row["names_decision"]);
	var makesMosaic = norm(row["makes_mosaic"]);

	if(candidateId === null) {
		return;
	}

	if(caseStatus !== FULLY_RESOLVED_STATUS) {

		skippedStatusCount++;
		return;
	}

	/*
	 * A fully resolved row marked as mosaic still needs explicit component
	 * assignments and region bounds. Do not create a misleading single
	 * primary relationship.
	 */
	if(
		makesMosaic !== null &&
		(
			makesMosaic.toLowerCase() === "true" ||
			makesMosaic.toLowerCase() === "yes" ||
			makesMosaic === "1"
		)
	) {
		skippedMosaicCount++;

		log(
			"Skipping mosaic candidate " +
			candidateId +
			"; component lineage regions must be loaded separately"
		);

		return;
	}

	eligibleCount++;

	if(!locusById[candidateId]) {

		missingLocusCount++;

		log(
			"No erv_locus row found for fully resolved candidate " +
			candidateId
		);

		return;
	}

	var resolution =
		resolveCandidateLineage(rawName);

	if(resolution.status !== "resolved") {

		unresolvedCount++;

		unresolvedResults.push({
			candidate_id: candidateId,
			case_status: caseStatus,
			locus_status: locusStatus,
			names_decision: rawName,
			resolution_method: resolution.method,
			reason: resolution.reason
		});

		log(
			"Could not resolve candidate " +
			candidateId +
			" using names_decision '" +
			rawName +
			"': " +
			resolution.reason
		);

		return;
	}

	var lineageId = resolution.lineage_id;

	if(!lineageById[lineageId]) {

		unresolvedCount++;

		log(
			"Resolved candidate " +
			candidateId +
			" to missing erv_lineage row " +
			lineageId
		);

		return;
	}

	var associationId =
		makeAssociationId(
			candidateId,
			lineageId
		);

	var created =
		createCustomRowIfMissing(
			LOCUS_LINEAGE_ASSOC_TABLE,
			associationId
		);

	setLink(
		LOCUS_LINEAGE_ASSOC_TABLE,
		associationId,
		"erv_locus",
		LOCUS_TABLE,
		candidateId
	);

	setLink(
		LOCUS_LINEAGE_ASSOC_TABLE,
		associationId,
		"erv_lineage",
		LINEAGE_TABLE,
		lineageId
	);

	setField(
		LOCUS_LINEAGE_ASSOC_TABLE,
		associationId,
		"association_role",
		ASSOCIATION_ROLE
	);

	setField(
		LOCUS_LINEAGE_ASSOC_TABLE,
		associationId,
		"evidence",
		ASSOCIATION_EVIDENCE
	);

	setField(
		LOCUS_LINEAGE_ASSOC_TABLE,
		associationId,
		"confidence",
		ASSOCIATION_CONFIDENCE
	);

	if(created) {
		createdCount++;
	} else {
		updatedCount++;
	}

	log(
		"Associated erv_locus/" +
		candidateId +
		" -> erv_lineage/" +
		lineageId +
		" using " +
		resolution.method
	);
});


// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

log("============================================================");
log("ERV locus-to-lineage association summary");
log("============================================================");
log("Candidates examined: " + candidateRows.length);
log("Fully resolved, non-mosaic candidates: " + eligibleCount);
log("Association rows created: " + createdCount);
log("Existing association rows updated: " + updatedCount);
log("Skipped because not Fully resolved: " + skippedStatusCount);
log("Skipped because mosaic: " + skippedMosaicCount);
log("Fully resolved candidates without an erv_locus row: " + missingLocusCount);
log("Fully resolved candidates unresolved to a lineage: " + unresolvedCount);

if(unresolvedResults.length > 0) {

	log("Unresolved fully resolved candidates:");

	_.each(unresolvedResults, function(result) {

		log(
			"  " +
			result.candidate_id +
			" [" +
			result.names_decision +
			"]: " +
			result.reason
		);
	});
}

log("Finished loading ERV locus-to-lineage associations");

unresolvedResults;
