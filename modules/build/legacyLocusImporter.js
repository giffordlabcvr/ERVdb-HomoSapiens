// legacyLocusImporter.js
//
// Imports historical or published ERV locus records, maps them onto
// erv_locus_candidate, and records:
//
//   1. Source-record provenance in erv_locus_legacy_xref
//   2. Searchable alternative names in erv_locus_alias
//
// Current assumptions:
//   - imported records concern Homo sapiens;
//   - imported coordinates use the same assembly as erv_locus_candidate;
//   - hostSpecies and genomeBuild are retained as provenance on xref rows;
//   - orthology calibrations are not created by this module.
//
// The createOrthologyCalibrations function argument is retained so that
// legacyLocusImporter.xml and existing invoke-function calls remain valid.

var LOCUS_CANDIDATE_TABLE = "erv_locus_candidate";
var LOCUS_CANDIDATE_LINK = "erv_locus_candidate";

var XREF_TABLE = "erv_locus_legacy_xref";

var ALIAS_TABLE = "erv_locus_alias";
var ALIAS_LOCUS_LINK = "erv_locus_candidate";

var MAPPING_METHOD = "coordinate_overlap";


/*
 * -------------------------------------------------------------------------
 * General utility functions
 * -------------------------------------------------------------------------
 */

function esc(str) {

	if(str == null) {
		return "";
	}

	return ("" + str).replace(/'/g, "''");
}


function clean(str) {

	if(str == null) {
		return null;
	}

	var cleaned = ("" + str).replace(/^\s+|\s+$/g, "");

	if(
		cleaned === "" ||
		cleaned.toLowerCase() === "null"
	) {
		return null;
	}

	return cleaned;
}


function safeId(str) {

	return ("" + str)
		.replace(/[^A-Za-z0-9_.-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
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


function getField(row, names) {

	for(var i = 0; i < names.length; i++) {

		var value = clean(row[names[i]]);

		if(value != null) {
			return value;
		}
	}

	return null;
}


function parseCoordinate(value) {

	value = clean(value);

	if(value == null) {
		return null;
	}

	var coordinate = parseInt(value, 10);

	if(isNaN(coordinate)) {
		return null;
	}

	return coordinate;
}


function normaliseOrientation(value) {

	value = clean(value);

	if(value == null) {
		return null;
	}

	var lowerValue = value.toLowerCase();

	if(
		value === "+" ||
		value === "(+)" ||
		lowerValue === "positive" ||
		lowerValue === "plus" ||
		lowerValue === "forward"
	) {
		return "+";
	}

	if(
		value === "-" ||
		value === "(-)" ||
		lowerValue === "negative" ||
		lowerValue === "minus" ||
		lowerValue === "reverse"
	) {
		return "-";
	}

	return value;
}


function intervalLength(start, end) {

	return end - start + 1;
}


function overlapBp(
	aStart,
	aEnd,
	bStart,
	bEnd
) {

	var overlapStart = Math.max(
		aStart,
		bStart
	);

	var overlapEnd = Math.min(
		aEnd,
		bEnd
	);

	if(overlapEnd < overlapStart) {
		return 0;
	}

	return overlapEnd - overlapStart + 1;
}


/*
 * Return a stable unsigned integer hash as a string.
 *
 * This is used only to construct deterministic custom-table row IDs.
 */
function hashString(str) {

	if(str == null) {
		str = "";
	}

	str = "" + str;

	var hash = 0;

	for(var i = 0; i < str.length; i++) {

		hash =
			((hash << 5) - hash) +
			str.charCodeAt(i);

		hash = hash | 0;
	}

	return "" + (hash >>> 0);
}


/*
 * -------------------------------------------------------------------------
 * Custom-table helpers
 * -------------------------------------------------------------------------
 */

function customTableRowExists(
	tableName,
	rowId
) {

	var rows = rowList(glue.command([
		"list",
		"custom-table-row",
		tableName,
		"-w",
		"id = '" + esc(rowId) + "'"
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


function setFieldIfNotNull(
	fieldName,
	value
) {

	value = clean(value);

	if(value != null) {

		glue.command([
			"set",
			"field",
			fieldName,
			"" + value
		]);
	}
}


/*
 * -------------------------------------------------------------------------
 * Source-row normalisation
 * -------------------------------------------------------------------------
 */

function normaliseLegacyRow(row) {

	/*
	 * Retained for provenance and possible future use.
	 *
	 * These values are not used to restrict candidate matching because
	 * erv_locus_candidate currently has no host_species or genome_build
	 * fields.
	 */
	var inputOrganism = getField(row, [
		"organism",
		"host_species"
	]);

	var inputAssembly = getField(row, [
		"assembly",
		"genome_build"
	]);

	var approvedName = getField(row, [
		"approved_name"
	]);

	var approvedSymbol = getField(row, [
		"approved_symbol"
	]);

	var sourceAliases = getField(row, [
		"alias_symbol",
		"aliases",
		"source_aliases",
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
	 * The DBM/Gifford source file uses the historical spelling
	 * "mnenomic-number".
	 *
	 * This value is retained as source_numeric_id so that the subsequent
	 * naming stage can preserve the curated historical locus number.
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

	var start = parseCoordinate(getField(row, [
		"start",
		"start_position",
		"extract_start",
		"Start"
	]));

	var end = parseCoordinate(getField(row, [
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

	var sourceNote = getField(row, [
		"extra",
		"source_note"
	]);

	var sourceBand = getField(row, [
		"source_band",
		"band",
		"Locus",
		"Chr. band",
		"chromosome_location"
	]);

	var sourceOrthology = getField(row, [
		"orthology",
		"source_orthology",
		"oldest_common_ancestor",
		"OCA"
	]);

	var legacyName = getField(row, [
		"legacy_name",
		"legacyName",
		"Locus"
	]);

	/*
	 * Generate a primary source-record name where the input does not
	 * provide one explicitly.
	 */
	if(legacyName == null) {

		if(approvedSymbol != null) {

			legacyName = approvedSymbol;

		} else if(approvedName != null) {

			legacyName = approvedName;

		} else if(
			legacyClassification != null &&
			sourceNumericId != null
		) {

			legacyName =
				legacyClassification +
				"_" +
				sourceNumericId;

		} else {

			var nameParts = [];

			if(legacyClassification != null) {
				nameParts.push(
					legacyClassification
				);
			}

			if(sourceNumericId != null) {
				nameParts.push(
					sourceNumericId
				);
			}

			if(scaffold != null) {
				nameParts.push(
					scaffold
				);
			}

			if(start != null) {
				nameParts.push(
					"" + start
				);
			}

			if(end != null) {
				nameParts.push(
					"" + end
				);
			}

			legacyName =
				nameParts.join("_");
		}
	}

	/*
	 * Preserve the previous importer behaviour in which an "extra"
	 * qualifier contributes to the generated legacy name.
	 */
	if(
		legacyName != null &&
		sourceNote != null
	) {
		legacyName =
			legacyName +
			"_" +
			sourceNote;
	}

	return {
		legacyName:
			legacyName,

		approvedName:
			approvedName,

		approvedSymbol:
			approvedSymbol,

		inputOrganism:
			inputOrganism,

		inputAssembly:
			inputAssembly,

		legacyClassification:
			legacyClassification,

		sourceNumericId:
			sourceNumericId,

		sourceAliases:
			sourceAliases,

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
			orientation,

		sourceOrthology:
			sourceOrthology
	};
}


/*
 * -------------------------------------------------------------------------
 * Source-row validation
 * -------------------------------------------------------------------------
 */

function validateLegacyRow(normRow) {

	if(normRow.legacyName == null) {
		return "Unable to determine a legacy name";
	}

	if(normRow.scaffold == null) {
		return "Missing chromosome or scaffold";
	}

	if(normRow.start == null) {
		return "Missing or invalid start coordinate";
	}

	if(normRow.end == null) {
		return "Missing or invalid end coordinate";
	}

	if(normRow.start < 1) {
		return "Start coordinate is less than 1";
	}

	if(normRow.end < normRow.start) {
		return "End coordinate precedes start coordinate";
	}

	return null;
}


/*
 * -------------------------------------------------------------------------
 * Legacy-xref identifier generation
 * -------------------------------------------------------------------------
 */

function makeXrefId(
	legacySource,
	normRow,
	rowIndex
) {

	var sourceHash =
		hashString(legacySource);

	var rowPart =
		"" + (rowIndex + 1);

	var coordinatePart = "";

	if(
		normRow.scaffold != null &&
		normRow.start != null
	) {
		coordinatePart =
			"_" +
			safeId(normRow.scaffold) +
			"_" +
			normRow.start;
	}

	var xrefId =
		"lx_" +
		sourceHash +
		"_" +
		rowPart +
		coordinatePart;

	/*
	 * Keep the row ID safely below the usual GLUE custom-table row-ID
	 * length limit.
	 */
	if(xrefId.length > 45) {

		xrefId =
			"lx_" +
			sourceHash +
			"_" +
			rowPart;
	}

	return xrefId;
}


/*
 * -------------------------------------------------------------------------
 * Candidate-locus matching
 * -------------------------------------------------------------------------
 */

function getOverlappingLocusCandidates(
	normRow
) {

	/*
	 * erv_locus_candidate uses:
	 *
	 *   chrom
	 *   strand
	 *   start_position
	 *   end_position
	 *
	 * The xref table deliberately uses the source-oriented terms
	 * scaffold and orientation.
	 */
	var whereClause =
		"chrom = '" +
		esc(normRow.scaffold) +
		"' and " +
		normRow.start +
		" <= end_position and " +
		normRow.end +
		" >= start_position";

	var result = glue.command([
		"list",
		"custom-table-row",
		LOCUS_CANDIDATE_TABLE,
		"--whereClause",
		whereClause,
		"id",
		"start_position",
		"end_position",
		"strand"
	]);

	var rows =
		rowList(result);

	var candidates = [];

	for(var i = 0; i < rows.length; i++) {

		var values =
			rows[i].value;

		var candidateId =
			values[0];

		var candidateStart =
			parseInt(values[1], 10);

		var candidateEnd =
			parseInt(values[2], 10);

		var candidateOrientation =
			normaliseOrientation(values[3]);

		if(
			isNaN(candidateStart) ||
			isNaN(candidateEnd)
		) {
			continue;
		}

		var overlap =
			overlapBp(
				normRow.start,
				normRow.end,
				candidateStart,
				candidateEnd
			);

		if(overlap <= 0) {
			continue;
		}

		var sourceLength =
			intervalLength(
				normRow.start,
				normRow.end
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

		/*
		 * Reciprocal overlap is the smaller of:
		 *
		 *   proportion of the source record covered;
		 *   proportion of the candidate covered.
		 */
		var reciprocalOverlap =
			Math.min(
				sourceOverlapFraction,
				candidateOverlapFraction
			);

		var orientationMatches = null;

		if(
			normRow.orientation != null &&
			candidateOrientation != null
		) {
			orientationMatches =
				normRow.orientation ===
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


function compareCandidateMatches(
	a,
	b
) {

	/*
	 * Primary criterion:
	 * strongest reciprocal overlap.
	 */
	if(
		a.reciprocalOverlap !==
		b.reciprocalOverlap
	) {
		return (
			b.reciprocalOverlap -
			a.reciprocalOverlap
		);
	}

	/*
	 * Secondary criterion:
	 * greatest absolute overlap.
	 */
	if(a.overlapBp !== b.overlapBp) {
		return b.overlapBp - a.overlapBp;
	}

	/*
	 * If overlap measures are tied, prefer orientation agreement where
	 * both source and candidate orientations are available.
	 */
	if(
		a.orientationMatches !==
		b.orientationMatches
	) {

		if(a.orientationMatches === true) {
			return -1;
		}

		if(b.orientationMatches === true) {
			return 1;
		}
	}

	/*
	 * Next prefer the candidate covering the greatest proportion of the
	 * source interval.
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
	 * Final deterministic tie-break.
	 */
	if(a.candidateId < b.candidateId) {
		return -1;
	}

	if(a.candidateId > b.candidateId) {
		return 1;
	}

	return 0;
}


function findBestLocusCandidateMatch(
	normRow
) {

	var candidates =
		getOverlappingLocusCandidates(
			normRow
		);

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

	candidates.sort(
		compareCandidateMatches
	);

	var bestCandidate =
		candidates[0];

	return {
		status:
			candidates.length === 1
				? "mapped"
				: "mapped_multiple_overlaps",

		method:
			MAPPING_METHOD,

		candidateId:
			bestCandidate.candidateId,

		matchCount:
			candidates.length,

		overlapBp:
			bestCandidate.overlapBp,

		sourceOverlapFraction:
			bestCandidate.sourceOverlapFraction,

		candidateOverlapFraction:
			bestCandidate.candidateOverlapFraction,

		reciprocalOverlap:
			bestCandidate.reciprocalOverlap,

		orientationMatches:
			bestCandidate.orientationMatches
	};
}


/*
 * -------------------------------------------------------------------------
 * Legacy-xref creation
 * -------------------------------------------------------------------------
 */

function createOrUpdateXref(
	xrefId,
	normRow,
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
		"custom-table-row/" +
		XREF_TABLE +
		"/" +
		xrefId,

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
				normRow.legacyName
			]);

			setFieldIfNotNull(
				"pubmed_id",
				pubmedId
			);

			/*
			 * These are currently assumed rather than used to restrict
			 * candidate matching. They remain useful xref provenance.
			 */
			setFieldIfNotNull(
				"host_species",
				hostSpecies
			);

			setFieldIfNotNull(
				"genome_build",
				genomeBuild
			);

			glue.command([
				"set",
				"field",
				"scaffold",
				normRow.scaffold
			]);

			glue.command([
				"set",
				"field",
				"start_position",
				"" + normRow.start
			]);

			glue.command([
				"set",
				"field",
				"end_position",
				"" + normRow.end
			]);

			setFieldIfNotNull(
				"orientation",
				normRow.orientation
			);

			setFieldIfNotNull(
				"legacy_classification",
				normRow.legacyClassification
			);

			setFieldIfNotNull(
				"source_numeric_id",
				normRow.sourceNumericId
			);

			setFieldIfNotNull(
				"source_aliases",
				normRow.sourceAliases
			);

			setFieldIfNotNull(
				"source_orthology",
				normRow.sourceOrthology
			);

			setFieldIfNotNull(
				"source_band",
				normRow.sourceBand
			);

			setFieldIfNotNull(
				"source_note",
				normRow.sourceNote
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

			if(match.candidateId != null) {

				glue.command([
					"set",
					"link-target",
					LOCUS_CANDIDATE_LINK,
					"custom-table-row/" +
					LOCUS_CANDIDATE_TABLE +
					"/" +
					match.candidateId
				]);
			}
		}
	);

	return xrefId;
}


/*
 * -------------------------------------------------------------------------
 * Alias handling
 * -------------------------------------------------------------------------
 */

function normaliseAlias(aliasName) {

	aliasName =
		clean(aliasName);

	if(aliasName == null) {
		return null;
	}

	var lowerAlias =
		aliasName.toLowerCase();

	if(
		aliasName === "-" ||
		lowerAlias === "na" ||
		lowerAlias === "n/a" ||
		lowerAlias === "none" ||
		lowerAlias === "unknown"
	) {
		return null;
	}

	/*
	 * alias_name is VARCHAR 150.
	 *
	 * Do not silently truncate identifiers or names, because that could
	 * produce misleading aliases.
	 */
	if(aliasName.length > 150) {

		glue.log(
			"WARNING",
			"Skipping alias longer than 150 characters: " +
			aliasName
		);

		return null;
	}

	return aliasName;
}


function splitSourceAliases(
	aliasString
) {

	aliasString =
		clean(aliasString);

	if(aliasString == null) {
		return [];
	}

	/*
	 * The imported sources may separate aliases using commas,
	 * semicolons, or pipes.
	 */
	var parts =
		aliasString.split(/[;,|]/);

	var aliases = [];

	for(var i = 0; i < parts.length; i++) {

		var aliasName =
			normaliseAlias(parts[i]);

		if(aliasName != null) {
			aliases.push(aliasName);
		}
	}

	return aliases;
}


function makeAliasId(
	candidateId,
	aliasSource,
	aliasName
) {

	var candidateHash =
		hashString(candidateId);

	var sourceHash =
		hashString(aliasSource);

	var aliasHash =
		hashString(aliasName.toLowerCase());

	var aliasId =
		"la_" +
		candidateHash +
		"_" +
		sourceHash +
		"_" +
		aliasHash;

	/*
	 * This construction is normally well below the row-ID limit, but
	 * retain a defensive fallback.
	 */
	if(aliasId.length > 45) {

		aliasId =
			"la_" +
			hashString(
				candidateId +
				"|" +
				aliasSource +
				"|" +
				aliasName.toLowerCase()
			);
	}

	return aliasId;
}


function createLocusAlias(
	candidateId,
	aliasName,
	aliasSource
) {

	aliasName =
		normaliseAlias(aliasName);

	if(aliasName == null) {
		return false;
	}

	var aliasId =
		makeAliasId(
			candidateId,
			aliasSource,
			aliasName
		);

	/*
	 * A deterministic row ID makes repeated creation idempotent.
	 */
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
		"custom-table-row/" +
		ALIAS_TABLE +
		"/" +
		aliasId,

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
				ALIAS_LOCUS_LINK,
				"custom-table-row/" +
				LOCUS_CANDIDATE_TABLE +
				"/" +
				candidateId
			]);
		}
	);

	return true;
}


function createAliasesForMatchedRow(
	normRow,
	legacySource,
	match
) {

	/*
	 * Do not create aliases for unmatched records.
	 */
	if(match.candidateId == null) {
		return 0;
	}

	/*
	 * Initially create aliases only for unambiguous coordinate mappings.
	 *
	 * mapped_multiple_overlaps xrefs remain available for review, but do
	 * not automatically donate names to the selected candidate.
	 */
	if(match.status !== "mapped") {
		return 0;
	}

	var aliases = [];

	/*
	 * The primary source-record name.
	 */
	aliases.push(
		normRow.legacyName
	);

	/*
	 * For dbm-gifford-legacy-list-hg19.tsv this allows the locus to be
	 * found by both HGNC-style symbol and approved descriptive name.
	 */
	aliases.push(
		normRow.approvedSymbol
	);

	aliases.push(
		normRow.approvedName
	);

	/*
	 * Add individually parsed source aliases.
	 */
	var parsedSourceAliases =
		splitSourceAliases(
			normRow.sourceAliases
		);

	for(
		var i = 0;
		i < parsedSourceAliases.length;
		i++
	) {
		aliases.push(
			parsedSourceAliases[i]
		);
	}

	var seenAliases = {};
	var createdCount = 0;

	for(var j = 0; j < aliases.length; j++) {

		var aliasName =
			normaliseAlias(aliases[j]);

		if(aliasName == null) {
			continue;
		}

		/*
		 * Suppress duplicates within this source row while preserving
		 * the original spelling and capitalisation of the first value.
		 */
		var aliasKey =
			aliasName.toLowerCase();

		if(seenAliases[aliasKey]) {
			continue;
		}

		seenAliases[aliasKey] = true;

		if(
			createLocusAlias(
				match.candidateId,
				aliasName,
				legacySource
			)
		) {
			createdCount++;
		}
	}

	return createdCount;
}


/*
 * -------------------------------------------------------------------------
 * Public module functions
 * -------------------------------------------------------------------------
 */

function loadLegacyLocusFile(
	inputPath,
	legacySource,
	pubmedId,
	hostSpecies,
	genomeBuild,
	createOrthologyCalibrations
) {

	/*
	 * createOrthologyCalibrations is deliberately ignored.
	 *
	 * It remains in the function signature for compatibility with the
	 * existing ecmaFunctionInvoker XML and build script.
	 */
	if(
		createOrthologyCalibrations != null &&
		("" + createOrthologyCalibrations).toLowerCase() === "true"
	) {
		glue.log(
			"WARNING",
			"createOrthologyCalibrations was true, but " +
			"legacyLocusImporter.js now imports xrefs and aliases only"
		);
	}

	var inputRows = [];

	glue.inMode(
		"module/tabularUtility",

		function() {

			inputRows =
				glue.tableToObjects(
					glue.command([
						"load-tabular",
						inputPath
					])
				);
		}
	);

	var outputRows = [];

	for(var i = 0; i < inputRows.length; i++) {

		var normRow =
			normaliseLegacyRow(
				inputRows[i]
			);

		var validationError =
			validateLegacyRow(normRow);

		if(validationError != null) {

			glue.log(
				"WARNING",
				"Skipping legacy row " +
				(i + 1) +
				": " +
				validationError
			);

			continue;
		}

		/*
		 * We currently assume all records belong to the human/build
		 * context supplied by the module invocation.
		 *
		 * Input-row organism and assembly values are not validated.
		 */
		var match =
			findBestLocusCandidateMatch(
				normRow
			);

		var xrefId =
			makeXrefId(
				legacySource,
				normRow,
				i
			);

		createOrUpdateXref(
			xrefId,
			normRow,
			legacySource,
			pubmedId,
			hostSpecies,
			genomeBuild,
			match
		);

		var aliasesCreated =
			createAliasesForMatchedRow(
				normRow,
				legacySource,
				match
			);

		outputRows.push({
			legacy_source:
				legacySource,

			legacy_name:
				normRow.legacyName,

			legacy_classification:
				normRow.legacyClassification,

			source_numeric_id:
				normRow.sourceNumericId,

			scaffold:
				normRow.scaffold,

			start:
				normRow.start,

			end:
				normRow.end,

			source_orthology:
				normRow.sourceOrthology,

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


function clearLegacySource(
	legacySource
) {

	/*
	 * Delete aliases before deleting xrefs.
	 *
	 * The two tables are independently linked to the candidate table, but
	 * deleting both source-derived layers prevents stale aliases remaining
	 * when mappings or source records change.
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

		var aliasRowId =
			aliasRows[i].value[0];

		glue.command([
			"delete",
			"custom-table-row",
			ALIAS_TABLE,
			aliasRowId
		]);
	}

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

		var xrefRowId =
			xrefRows[j].value[0];

		glue.command([
			"delete",
			"custom-table-row",
			XREF_TABLE,
			xrefRowId
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
