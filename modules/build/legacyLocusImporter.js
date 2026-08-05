// legacyLocusImporter.js
//
// Imports historical or published ERV locus records, maps them onto
// erv_locus_candidate, and records:
//
//   1. Source provenance in erv_locus_legacy_xref
//   2. Searchable names in erv_locus_alias
//
// Current assumptions:
//   - all imported records concern Homo sapiens;
//   - source coordinates use the same assembly as erv_locus_candidate;
//   - hostSpecies and genomeBuild are retained as xref provenance;
//   - orthology calibrations are not created here.
//
// createOrthologyCalibrations remains in the public function signature
// for compatibility with the existing XML module and build script.

var LOCUS_TABLE = "erv_locus_candidate";
var LOCUS_LINK = "erv_locus_candidate";

var XREF_TABLE = "erv_locus_legacy_xref";

var ALIAS_TABLE = "erv_locus_alias";
var ALIAS_LINK = "erv_locus_candidate";

var DBM_GIFFORD_SOURCE = "compiled_human_erv_loci_hg19";

var MAPPING_METHOD = "coordinate_overlap";


// -------------------------------------------------------------------------
// General helpers
// -------------------------------------------------------------------------

function clean(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var result = ("" + value).replace(/^\s+|\s+$/g, "");

	if(result === "") {
		return null;
	}

	var lower = result.toLowerCase();

	if(
		lower === "null" ||
		lower === "none" ||
		lower === "n/a" ||
		lower === "na"
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


function getField(row, names) {

	for(var i = 0; i < names.length; i++) {

		var value = clean(row[names[i]]);

		if(value !== null) {
			return value;
		}
	}

	return null;
}


function parseInteger(value) {

	value = clean(value);

	if(value === null) {
		return null;
	}

	var number = parseInt(value, 10);

	return isNaN(number) ? null : number;
}


function rowList(result) {

	if(
		result &&
		result.listResult &&
		result.listResult.row
	) {
		return result.listResult.row;
	}

	return [];
}


function customRowPath(tableName, rowId) {

	return (
		"custom-table-row/" +
		tableName +
		"/" +
		rowId
	);
}


function normaliseOrientation(value) {

	value = clean(value);

	if(value === null) {
		return null;
	}

	var lower = value.toLowerCase();

	if(
		value === "+" ||
		value === "(+)" ||
		lower === "positive" ||
		lower === "plus" ||
		lower === "forward"
	) {
		return "+";
	}

	if(
		value === "-" ||
		value === "(-)" ||
		lower === "negative" ||
		lower === "minus" ||
		lower === "reverse"
	) {
		return "-";
	}

	return value;
}


function intervalLength(start, end) {

	return end - start + 1;
}


function overlapLength(
	aStart,
	aEnd,
	bStart,
	bEnd
) {

	var start = Math.max(aStart, bStart);
	var end = Math.min(aEnd, bEnd);

	if(end < start) {
		return 0;
	}

	return end - start + 1;
}


/*
 * Stable unsigned string hash used only for deterministic row IDs.
 */
function hashString(value) {

	value = value === null || value === undefined
		? ""
		: "" + value;

	var hash = 0;

	for(var i = 0; i < value.length; i++) {

		hash =
			((hash << 5) - hash) +
			value.charCodeAt(i);

		hash = hash | 0;
	}

	return "" + (hash >>> 0);
}


function customTableRowExists(
	tableName,
	rowId
) {

	var rows = rowList(glue.command([
		"list",
		"custom-table-row",
		tableName,
		"-w",
		"id = '" + esc(rowId) + "'",
		"id"
	]));

	return rows.length > 0;
}


function createCustomTableRowIfNeeded(
	tableName,
	rowId
) {

	if(
		!customTableRowExists(
			tableName,
			rowId
		)
	) {
		glue.command([
			"create",
			"custom-table-row",
			tableName,
			rowId
		]);
	}
}


function setFieldIfPresent(
	fieldName,
	value
) {

	value = clean(value);

	if(value !== null) {

		glue.command([
			"set",
			"field",
			fieldName,
			"" + value
		]);
	}
}


// -------------------------------------------------------------------------
// Source-row normalisation
// -------------------------------------------------------------------------

function normaliseLegacyRow(row) {

	var approvedName = getField(row, [
		"approved_name"
	]);

	var approvedSymbol = getField(row, [
		"approved_symbol"
	]);

	var hgncId = getField(row, [
		"hgnc_id",
		"HGNC ID",
		"hgnc"
	]);

	var sourceAliases = getField(row, [
		"alias_symbol",
		"source_aliases",
		"aliases",
		"Alias"
	]);

	var legacyClassification = getField(row, [
		"legacy_classification",
		"legacyClassification",
		"erv-taxonomic-component",
		"classification",
		"Dfam designation"
	]);

	/*
	 * The DBM/Gifford file uses the spelling "mnenomic-number".
	 * The value is retained as source_numeric_id for subsequent
	 * Missillac number preservation.
	 */
	var sourceNumericId = getField(row, [
		"source_numeric_id",
		"mnenomic-number",
		"mnemonic-number",
		"numeric_id"
	]);

	var scaffold = getField(row, [
		"scaffold",
		"chrom",
		"chromosome",
		"chr",
		"Chr"
	]);

	var start = parseInteger(getField(row, [
		"start",
		"start_position",
		"extract_start",
		"Start"
	]));

	var end = parseInteger(getField(row, [
		"end",
		"end_position",
		"extract_end",
		"End"
	]));

	var orientation = normaliseOrientation(
		getField(row, [
			"strand",
			"orientation",
			"Orientation"
		])
	);

	var sourceOrthology = getField(row, [
		"source_orthology",
		"orthology",
		"oldest_common_ancestor",
		"OCA"
	]);

	var sourceBand = getField(row, [
		"source_band",
		"band",
		"Chr. band",
		"chromosome_location"
	]);

	var sourceNote = getField(row, [
		"source_note",
		"extra"
	]);

	var legacyName = getField(row, [
		"legacy_name",
		"legacyName",
		"Locus"
	]);

	if(legacyName === null) {

		if(approvedSymbol !== null) {

			legacyName = approvedSymbol;

		} else if(approvedName !== null) {

			legacyName = approvedName;

		} else if(
			legacyClassification !== null &&
			sourceNumericId !== null
		) {

			legacyName =
				legacyClassification +
				"_" +
				sourceNumericId;

		} else {

			var nameParts = [];

			if(legacyClassification !== null) {
				nameParts.push(legacyClassification);
			}

			if(sourceNumericId !== null) {
				nameParts.push(sourceNumericId);
			}

			if(scaffold !== null) {
				nameParts.push(scaffold);
			}

			if(start !== null) {
				nameParts.push("" + start);
			}

			if(end !== null) {
				nameParts.push("" + end);
			}

			legacyName = nameParts.join("_");
		}
	}

	/*
	 * sourceNote is deliberately not appended to legacyName.
	 * It is stored independently in source_note.
	 */
	return {
		legacyName:
			legacyName,

		approvedName:
			approvedName,

		approvedSymbol:
			approvedSymbol,

		hgncId:
			hgncId,

		sourceAliases:
			sourceAliases,

		legacyClassification:
			legacyClassification,

		sourceNumericId:
			sourceNumericId,

		sourceOrthology:
			sourceOrthology,

		sourceBand:
			sourceBand,

		sourceNote:
			sourceNote,

		scaffold:
			scaffold,

		start:
			start,

		end:
			end,

		orientation:
			orientation
	};
}


function validateLegacyRow(row) {

	if(row.legacyName === null) {
		return "Unable to determine a legacy name";
	}

	if(row.scaffold === null) {
		return "Missing chromosome or scaffold";
	}

	if(row.start === null) {
		return "Missing or invalid start coordinate";
	}

	if(row.end === null) {
		return "Missing or invalid end coordinate";
	}

	if(row.start < 1) {
		return "Start coordinate is less than 1";
	}

	if(row.end < row.start) {
		return "End coordinate precedes start coordinate";
	}

	return null;
}


// -------------------------------------------------------------------------
// Deterministic row IDs
// -------------------------------------------------------------------------

function makeXrefId(
	legacySource,
	row,
	rowIndex
) {

	var key =
		legacySource +
		"|" +
		(row.legacyName || "") +
		"|" +
		(row.scaffold || "") +
		"|" +
		(row.start !== null ? row.start : "") +
		"|" +
		(row.end !== null ? row.end : "") +
		"|" +
		(rowIndex + 1);

	return "lx_" + hashString(key);
}


function makeAliasId(
	candidateId,
	aliasSource,
	aliasName
) {

	var key =
		candidateId +
		"|" +
		aliasSource +
		"|" +
		aliasName.toLowerCase();

	return "la_" + hashString(key);
}


// -------------------------------------------------------------------------
// Candidate matching
// -------------------------------------------------------------------------

function getOverlappingCandidates(row) {

	var whereClause =
		"chrom = '" +
		esc(row.scaffold) +
		"' and " +
		row.start +
		" <= end_position and " +
		row.end +
		" >= start_position";

	var result = glue.command([
		"list",
		"custom-table-row",
		LOCUS_TABLE,
		"--whereClause",
		whereClause,
		"id",
		"start_position",
		"end_position",
		"strand"
	]);

	var resultRows = rowList(result);
	var candidates = [];

	for(var i = 0; i < resultRows.length; i++) {

		var values = resultRows[i].value;

		var candidateId = clean(values[0]);
		var candidateStart = parseInteger(values[1]);
		var candidateEnd = parseInteger(values[2]);
		var candidateOrientation =
			normaliseOrientation(values[3]);

		if(
			candidateId === null ||
			candidateStart === null ||
			candidateEnd === null
		) {
			continue;
		}

		var overlap = overlapLength(
			row.start,
			row.end,
			candidateStart,
			candidateEnd
		);

		if(overlap < 1) {
			continue;
		}

		var sourceLength =
			intervalLength(
				row.start,
				row.end
			);

		var candidateLength =
			intervalLength(
				candidateStart,
				candidateEnd
			);

		var sourceOverlapFraction =
			overlap / sourceLength;

		var candidateOverlapFraction =
			overlap / candidateLength;

		var reciprocalOverlap =
			Math.min(
				sourceOverlapFraction,
				candidateOverlapFraction
			);

		var orientationMatches = null;

		if(
			row.orientation !== null &&
			candidateOrientation !== null
		) {
			orientationMatches =
				row.orientation ===
				candidateOrientation;
		}

		candidates.push({
			candidateId:
				candidateId,

			start:
				candidateStart,

			end:
				candidateEnd,

			orientation:
				candidateOrientation,

			orientationMatches:
				orientationMatches,

			overlapBp:
				overlap,

			sourceOverlapFraction:
				sourceOverlapFraction,

			candidateOverlapFraction:
				candidateOverlapFraction,

			reciprocalOverlap:
				reciprocalOverlap
		});
	}

	return candidates;
}


function compareCandidateMatches(a, b) {

	/*
	 * Prefer the strongest reciprocal overlap.
	 */
	if(a.reciprocalOverlap !== b.reciprocalOverlap) {

		return (
			b.reciprocalOverlap -
			a.reciprocalOverlap
		);
	}

	/*
	 * Then prefer the greatest absolute overlap.
	 */
	if(a.overlapBp !== b.overlapBp) {
		return b.overlapBp - a.overlapBp;
	}

	/*
	 * Then prefer strand/orientation agreement.
	 */
	if(a.orientationMatches !== b.orientationMatches) {

		if(a.orientationMatches === true) {
			return -1;
		}

		if(b.orientationMatches === true) {
			return 1;
		}
	}

	/*
	 * Then prefer greater coverage of the source interval.
	 */
	if(
		a.sourceOverlapFraction !==
		b.sourceOverlapFraction
	) {
		return (
			b.sourceOverlapFraction -
			a.sourceOverlapFraction
		);
	}

	/*
	 * Deterministic final tie-break.
	 */
	if(a.candidateId < b.candidateId) {
		return -1;
	}

	if(a.candidateId > b.candidateId) {
		return 1;
	}

	return 0;
}


function findBestCandidateMatch(row) {

	var candidates =
		getOverlappingCandidates(row);

	if(candidates.length === 0) {

		return {
			status:
				"unmatched",

			method:
				MAPPING_METHOD,

			candidateId:
				null,

			matchCount:
				0,

			overlapBp:
				null,

			sourceOverlapFraction:
				null,

			candidateOverlapFraction:
				null,

			reciprocalOverlap:
				null,

			orientationMatches:
				null
		};
	}

	candidates.sort(compareCandidateMatches);

	var best = candidates[0];

	return {
		status:
			candidates.length === 1
				? "mapped"
				: "mapped_multiple_overlaps",

		method:
			MAPPING_METHOD,

		candidateId:
			best.candidateId,

		matchCount:
			candidates.length,

		overlapBp:
			best.overlapBp,

		sourceOverlapFraction:
			best.sourceOverlapFraction,

		candidateOverlapFraction:
			best.candidateOverlapFraction,

		reciprocalOverlap:
			best.reciprocalOverlap,

		orientationMatches:
			best.orientationMatches
	};
}


// -------------------------------------------------------------------------
// Legacy xrefs
// -------------------------------------------------------------------------

function createOrUpdateXref(
	xrefId,
	row,
	legacySource,
	pubmedId,
	hostSpecies,
	genomeBuild,
	match
) {

	createCustomTableRowIfNeeded(
		XREF_TABLE,
		xrefId
	);

	glue.inMode(
		customRowPath(
			XREF_TABLE,
			xrefId
		),

		function() {

			glue.command([
				"set",
				"field",
				"legacy_source",
				legacySource
			]);

			glue.command([
				"set",
				"field",
				"legacy_name",
				row.legacyName
			]);

			setFieldIfPresent(
				"pubmed_id",
				pubmedId
			);

			setFieldIfPresent(
				"host_species",
				hostSpecies
			);

			setFieldIfPresent(
				"genome_build",
				genomeBuild
			);

			glue.command([
				"set",
				"field",
				"scaffold",
				row.scaffold
			]);

			glue.command([
				"set",
				"field",
				"start_position",
				"" + row.start
			]);

			glue.command([
				"set",
				"field",
				"end_position",
				"" + row.end
			]);

			setFieldIfPresent(
				"orientation",
				row.orientation
			);

			setFieldIfPresent(
				"legacy_classification",
				row.legacyClassification
			);

			setFieldIfPresent(
				"source_numeric_id",
				row.sourceNumericId
			);

			setFieldIfPresent(
				"source_aliases",
				row.sourceAliases
			);

			setFieldIfPresent(
				"source_orthology",
				row.sourceOrthology
			);

			setFieldIfPresent(
				"source_band",
				row.sourceBand
			);

			setFieldIfPresent(
				"source_note",
				row.sourceNote
			);

			glue.command([
				"set",
				"field",
				"mapping_status",
				match.status
			]);

			glue.command([
				"set",
				"field",
				"mapping_method",
				match.method
			]);

			if(match.candidateId !== null) {

				glue.command([
					"set",
					"link-target",
					LOCUS_LINK,
					customRowPath(
						LOCUS_TABLE,
						match.candidateId
					)
				]);
			}
		}
	);
}


// -------------------------------------------------------------------------
// Alias handling
// -------------------------------------------------------------------------

function normaliseAlias(value) {

	value = clean(value);

	if(value === null) {
		return null;
	}

	var lower = value.toLowerCase();

	if(
		value === "-" ||
		lower === "unknown" ||
		lower === "not known" ||
		lower === "not available"
	) {
		return null;
	}

	if(value.length > 150) {

		glue.log(
			"WARNING",
			"Skipping alias longer than 150 characters: " +
			value
		);

		return null;
	}

	return value;
}


function splitDelimitedAliases(
	value,
	delimiterRegex
) {

	value = clean(value);

	if(value === null) {
		return [];
	}

	var parts = value.split(delimiterRegex);
	var aliases = [];

	for(var i = 0; i < parts.length; i++) {

		var aliasName =
			normaliseAlias(parts[i]);

		if(aliasName !== null) {
			aliases.push(aliasName);
		}
	}

	return aliases;
}


function aliasesForSource(
	row,
	legacySource
) {

	var aliases = [];

	if(legacySource === DBM_GIFFORD_SOURCE) {

		/*
		 * Curated DBM/Gifford policy:
		 *
		 *   approved_symbol
		 *   each comma-separated alias_symbol
		 *   hgnc_id
		 *
		 * approved_name is deliberately excluded.
		 */
		aliases.push(row.approvedSymbol);

		var dbmAliases =
			splitDelimitedAliases(
				row.sourceAliases,
				/,/
			);

		for(var i = 0; i < dbmAliases.length; i++) {
			aliases.push(dbmAliases[i]);
		}

		aliases.push(row.hgncId);

	} else {

		/*
		 * For other published catalogues, retain the principal source
		 * identifier and any explicitly listed aliases.
		 */
		aliases.push(row.legacyName);

		if(
			row.approvedSymbol !== null &&
			row.approvedSymbol !== row.legacyName
		) {
			aliases.push(row.approvedSymbol);
		}

		var sourceAliases =
			splitDelimitedAliases(
				row.sourceAliases,
				/[;,|]/
			);

		for(
			var j = 0;
			j < sourceAliases.length;
			j++
		) {
			aliases.push(sourceAliases[j]);
		}
	}

	return aliases;
}


function createLocusAlias(
	candidateId,
	aliasName,
	aliasSource
) {

	aliasName =
		normaliseAlias(aliasName);

	if(aliasName === null) {
		return false;
	}

	var aliasId =
		makeAliasId(
			candidateId,
			aliasSource,
			aliasName
		);

	if(
		customTableRowExists(
			ALIAS_TABLE,
			aliasId
		)
	) {
		return false;
	}

	glue.command([
		"create",
		"custom-table-row",
		ALIAS_TABLE,
		aliasId
	]);

	glue.inMode(
		customRowPath(
			ALIAS_TABLE,
			aliasId
		),

		function() {

			glue.command([
				"set",
				"field",
				"alias_name",
				aliasName
			]);

			glue.command([
				"set",
				"field",
				"alias_source",
				aliasSource
			]);

			glue.command([
				"set",
				"link-target",
				ALIAS_LINK,
				customRowPath(
					LOCUS_TABLE,
					candidateId
				)
			]);
		}
	);

	return true;
}


function createAliasesForMatch(
	row,
	legacySource,
	match
) {

	/*
	 * Only unambiguous mappings donate aliases automatically.
	 */
	if(
		match.candidateId === null ||
		match.status !== "mapped"
	) {
		return 0;
	}

	var aliases =
		aliasesForSource(
			row,
			legacySource
		);

	var seen = {};
	var created = 0;

	for(var i = 0; i < aliases.length; i++) {

		var aliasName =
			normaliseAlias(aliases[i]);

		if(aliasName === null) {
			continue;
		}

		var key =
			aliasName.toLowerCase();

		if(seen[key]) {
			continue;
		}

		seen[key] = true;

		if(
			createLocusAlias(
				match.candidateId,
				aliasName,
				legacySource
			)
		) {
			created++;
		}
	}

	return created;
}


// -------------------------------------------------------------------------
// Public functions exposed through legacyLocusImporter.xml
// -------------------------------------------------------------------------

function loadLegacyLocusFile(
	inputPath,
	legacySource,
	pubmedId,
	hostSpecies,
	genomeBuild,
	createOrthologyCalibrations
) {

	if(
		createOrthologyCalibrations !== null &&
		createOrthologyCalibrations !== undefined &&
		("" + createOrthologyCalibrations)
			.toLowerCase() === "true"
	) {
		glue.log(
			"WARNING",
			"createOrthologyCalibrations was true, but this " +
			"module now imports legacy xrefs and aliases only"
		);
	}

	var inputRows = [];

	glue.inMode(
		"module/tabularUtility",

		function() {

			inputRows = glue.tableToObjects(
				glue.command([
					"load-tabular",
					inputPath
				])
			);
		}
	);

	var outputRows = [];

	for(var i = 0; i < inputRows.length; i++) {

		var row =
			normaliseLegacyRow(
				inputRows[i]
			);

		var validationError =
			validateLegacyRow(row);

		if(validationError !== null) {

			glue.log(
				"WARNING",
				"Skipping legacy row " +
				(i + 1) +
				" in " +
				legacySource +
				": " +
				validationError
			);

			continue;
		}

		var match =
			findBestCandidateMatch(row);

		var xrefId =
			makeXrefId(
				legacySource,
				row,
				i
			);

		createOrUpdateXref(
			xrefId,
			row,
			legacySource,
			pubmedId,
			hostSpecies,
			genomeBuild,
			match
		);

		var aliasesCreated =
			createAliasesForMatch(
				row,
				legacySource,
				match
			);

		outputRows.push({
			legacy_source:
				legacySource,

			legacy_name:
				row.legacyName,

			legacy_classification:
				row.legacyClassification,

			source_numeric_id:
				row.sourceNumericId,

			scaffold:
				row.scaffold,

			start_position:
				row.start,

			end_position:
				row.end,

			mapping_status:
				match.status,

			mapping_method:
				match.method,

			matched_locus_candidate:
				match.candidateId,

			match_count:
				match.matchCount,

			overlap_bp:
				match.overlapBp,

			source_overlap_fraction:
				match.sourceOverlapFraction,

			candidate_overlap_fraction:
				match.candidateOverlapFraction,

			reciprocal_overlap:
				match.reciprocalOverlap,

			orientation_matches:
				match.orientationMatches,

			aliases_created:
				aliasesCreated,

			xref_id:
				xrefId
		});
	}

	return outputRows;
}


function clearLegacySource(legacySource) {

	/*
	 * Remove source-derived aliases first.
	 */
	var aliasRows = rowList(glue.command([
		"list",
		"custom-table-row",
		ALIAS_TABLE,
		"-w",
		"alias_source = '" +
		esc(legacySource) +
		"'",
		"id"
	]));

	for(var i = 0; i < aliasRows.length; i++) {

		glue.command([
			"delete",
			"custom-table-row",
			ALIAS_TABLE,
			aliasRows[i].value[0]
		]);
	}

	/*
	 * Then remove source-derived xrefs.
	 */
	var xrefRows = rowList(glue.command([
		"list",
		"custom-table-row",
		XREF_TABLE,
		"-w",
		"legacy_source = '" +
		esc(legacySource) +
		"'",
		"id"
	]));

	for(var j = 0; j < xrefRows.length; j++) {

		glue.command([
			"delete",
			"custom-table-row",
			XREF_TABLE,
			xrefRows[j].value[0]
		]);
	}

	return [{
		legacy_source:
			legacySource,

		deleted_alias_rows:
			aliasRows.length,

		deleted_xref_rows:
			xrefRows.length
	}];
}