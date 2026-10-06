// glue/build/locus/loadErvLoci.js
//
// Promote selected ERV locus candidates into permanent erv_locus rows
// and link their imported sequences to those rows.
//
// Required build order:
//
//   1. loadErvLocusCandidates.js
//   2. hervImportLocusSources.glue
//   3. hervSetLocusSeqLengthsAndKinds.js
//   4. loadErvLoci.js
//
// Identifier relationship:
//
//   input TSV locus_id
//       = erv_locus_candidate.id
//       = imported sequence.sequenceID
//       = erv_locus.id
//
// Source-to-permanent-field mappings:
//
//   chrom
//       -> scaffold
//
//   strand
//       -> orientation
//
//   status
//       -> locus_type
//          ERV -> erv
//          LTR -> solo_ltr
//
//   genes_simplified
//       -> structural_profile
//
//   case_status
//       -> taxonomic_resolution
//          Fully resolved              -> lineage
//          Resolved at subgenus level  -> subgenus
//          Resolved at genus level     -> genus
//          Resolved at clade level     -> clade
//          Any mosaic case             -> mosaic
//          Other unresolved cases      -> unresolved
//
//   case_status
//       -> is_mosaic
//          TRUE when case_status contains "mosaic"
//
//   curatedns
//       -> is_high_support
//
// curation_tier is deliberately not populated here. curatedNS is a Boolean
// high-support flag, not a tier assignment.
//
// Missillac identifiers are not used as primary keys. orthology_group and
// missillac_id are populated later.
//
// This script does not create ERV-lineage or LTR-lineage associations.

var HOST_SPECIES =
	"Homo sapiens";

var GENOME_BUILD =
	"hg19";

var DRY_RUN =
	false;

var DETAIL_LIMIT =
	100;


/*
 * Sources containing selected ERV locus sequences.
 */

var LOCUS_SOURCES = [

	"filtered_2026_10"

];


// ============================================================================
// General helpers
// ============================================================================

function log(message) {
	glue.logInfo(message);
}


function norm(value) {

	if(value === null || value === undefined) {
		return null;
	}

	var stringValue =
		("" + value).trim();

	if(stringValue === "") {
		return null;
	}

	var lowerValue =
		stringValue.toLowerCase();

	if(
		lowerValue === "n/a" ||
		lowerValue === "na" ||
		lowerValue === "n/k" ||
		lowerValue === "nk" ||
		lowerValue === "unknown" ||
		lowerValue === "null" ||
		lowerValue === "none"
	) {
		return null;
	}

	return stringValue;
}


function normInt(value) {

	value =
		norm(value);

	if(value === null) {
		return null;
	}

	var numberValue =
		parseInt(
			value,
			10
		);

	if(isNaN(numberValue)) {
		return null;
	}

	return numberValue;
}


function normBoolean(value) {

	value =
		norm(value);

	if(value === null) {
		return null;
	}

	var lowerValue =
		value.toLowerCase();

	if(
		lowerValue === "true" ||
		lowerValue === "yes" ||
		lowerValue === "y" ||
		lowerValue === "1"
	) {
		return true;
	}

	if(
		lowerValue === "false" ||
		lowerValue === "no" ||
		lowerValue === "n" ||
		lowerValue === "0"
	) {
		return false;
	}

	return null;
}


function escapeQuotes(value) {

	return ("" + value)
		.replace(
			/\\/g,
			"\\\\"
		)
		.replace(
			/'/g,
			"\\'"
		);
}


function sortedKeys(object) {
	return Object.keys(object).sort();
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


function queryObjects(commandWords) {

	return glue.tableToObjects(
		glue.command(commandWords)
	);
}


function setFieldIfPresent(
	fieldName,
	value
) {

	value =
		norm(value);

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

	value =
		normInt(value);

	if(value !== null) {
		glue.command([
			"set",
			"field",
			fieldName,
			"" + value
		]);
	}
}


function setBooleanFieldIfPresent(
	fieldName,
	value
) {

	if(value !== null) {
		glue.command([
			"set",
			"field",
			fieldName,
			value ? "true" : "false"
		]);
	}
}


function incrementCount(counts, key) {

	key = norm(key);

	if(key === null) {
		key = "[null]";
	}

	if(counts[key] === undefined) {
		counts[key] = 0;
	}

	counts[key]++;
}


function printCounts(title, counts) {

	log(title + ":");

	var keys =
		sortedKeys(counts);

	if(keys.length === 0) {
		log("  none");
		return;
	}

	_.each(
		keys,
		function(key) {
			log(
				"  " +
				key +
				": " +
				counts[key]
			);
		}
	);
}


function printLimitedValues(
	title,
	values
) {

	log(
		title +
		": " +
		values.length
	);

	var limit =
		Math.min(
			values.length,
			DETAIL_LIMIT
		);

	for(
		var i = 0;
		i < limit;
		i++
	) {
		log(
			"  " +
			values[i]
		);
	}

	if(values.length > DETAIL_LIMIT) {
		log(
			"  ... " +
			(
				values.length -
				DETAIL_LIMIT
			) +
			" additional records not shown"
		);
	}
}


// ============================================================================
// Permanent-field value mappings
// ============================================================================

function resolveLocusType(status) {

	status =
		norm(status);

	if(status === null) {
		return null;
	}

	var lowerStatus =
		status.toLowerCase();

	if(lowerStatus === "erv") {
		return "erv";
	}

	if(lowerStatus === "ltr") {
		return "solo_ltr";
	}

	return null;
}


function resolveTaxonomicResolution(caseStatus) {

	caseStatus =
		norm(caseStatus);

	if(caseStatus === null) {
		return null;
	}

	var lowerStatus =
		caseStatus.toLowerCase();

	if(lowerStatus === "fully resolved") {
		return "lineage";
	}

	if(
		lowerStatus ===
		"resolved at subgenus level"
	) {
		return "subgenus";
	}

	if(
		lowerStatus ===
		"resolved at genus level"
	) {
		return "genus";
	}

	if(
		lowerStatus ===
		"resolved at clade level"
	) {
		return "clade";
	}

	/*
	 * This includes values such as:
	 *
	 *   Mosaic
	 *   Partially unresolved - Mosaic
	 */
	if(lowerStatus.indexOf("mosaic") >= 0) {
		return "mosaic";
	}

	if(lowerStatus.indexOf("unresolved") >= 0) {
		return "unresolved";
	}

	return null;
}


// ============================================================================
// Load selected candidate rows
// ============================================================================

log(
	"Loading selected erv_locus_candidate rows"
);

var candidateRows =
	queryObjects([
		"list",
		"custom-table-row",
		"erv_locus_candidate",
		"id",
		"chrom",
		"strand",
		"start_position",
		"end_position",
		"status",
		"genes_simplified",
		"case_status",
		"curatedns"
	]);

var candidatesById = {};

var candidateRowsWithoutIds = 0;

var unrecognisedLocusStatuses = {};
var unrecognisedCaseStatuses = {};
var unrecognisedHighSupportValues = {};


_.each(
	candidateRows,
	function(row) {

		var candidateId =
			norm(
				row["id"]
			);

		if(candidateId === null) {
			candidateRowsWithoutIds++;
			return;
		}

		var status =
			norm(
				row["status"]
			);

		var caseStatus =
			norm(
				row["case_status"]
			);

		var curatedNs =
			norm(
				row["curatedns"]
			);

		var locusType =
			resolveLocusType(
				status
			);

		var taxonomicResolution =
			resolveTaxonomicResolution(
				caseStatus
			);

	   var isMosaic =
		   caseStatus !== null &&
		   caseStatus.toLowerCase().indexOf("mosaic") >= 0;

		var isHighSupport =
			normBoolean(
				curatedNs
			);


		if(
			status !== null &&
			locusType === null
		) {
			unrecognisedLocusStatuses[
				status
			] = true;
		}


		if(
			caseStatus !== null &&
			taxonomicResolution === null
		) {
			unrecognisedCaseStatuses[
				caseStatus
			] = true;
		}


		if(
			curatedNs !== null &&
			isHighSupport === null
		) {
			unrecognisedHighSupportValues[
				curatedNs
			] = true;
		}


		candidatesById[candidateId] = {

			id:
				candidateId,

			chrom:
				norm(
					row["chrom"]
				),

			strand:
				norm(
					row["strand"]
				),

			startPosition:
				normInt(
					row["start_position"]
				),

			endPosition:
				normInt(
					row["end_position"]
				),

			locusType:
				locusType,

			structuralProfile:
				norm(
					row["genes_simplified"]
				),

			taxonomicResolution:
				taxonomicResolution,

			isMosaic:
				isMosaic,
	
			isHighSupport:
				isHighSupport
		};
	}
);


log(
	"Loaded " +
	sortedKeys(candidatesById).length +
	" selected candidate rows"
);


// ============================================================================
// Load existing permanent locus IDs
// ============================================================================

var existingLocusRows =
	queryObjects([
		"list",
		"custom-table-row",
		"erv_locus",
		"id"
	]);

var existingLocusIds = {};

_.each(
	existingLocusRows,
	function(row) {

		var locusId =
			norm(
				row["id"]
			);

		if(locusId !== null) {
			existingLocusIds[
				locusId
			] = true;
		}
	}
);

log(
	"Loaded " +
	sortedKeys(existingLocusIds).length +
	" existing permanent erv_locus rows"
);


// ============================================================================
// Load imported sequences from configured locus sources
// ============================================================================

var sequenceRefsById = {};
var sourceSequenceCount = 0;

_.each(
	LOCUS_SOURCES,
	function(sourceName) {

		var sourceRows =
			queryObjects([
				"list",
				"sequence",
				"source.name",
				"sequenceID",
				"-w",
				"source.name = '" +
					escapeQuotes(
						sourceName
					) +
					"'",
				"-s",
				"sequenceID"
			]);

		log(
			"Found " +
			sourceRows.length +
			" sequences in source " +
			sourceName
		);

		sourceSequenceCount +=
			sourceRows.length;

		_.each(
			sourceRows,
			function(row) {

				var sequenceID =
					norm(
						row["sequenceID"]
					);

				var actualSourceName =
					norm(
						row["source.name"]
					);

				if(
					sequenceID === null ||
					actualSourceName === null
				) {
					return;
				}

				if(
					sequenceRefsById[
						sequenceID
					] === undefined
				) {
					sequenceRefsById[
						sequenceID
					] = [];
				}

				sequenceRefsById[
					sequenceID
				].push({
					sourceName:
						actualSourceName,
					sequenceID:
						sequenceID
				});
			}
		);
	}
);

log(
	"Loaded " +
	sourceSequenceCount +
	" imported locus sequence records"
);


// ============================================================================
// Identify duplicate and unmatched sequence IDs
// ============================================================================

var duplicateImportedSequenceIds = [];
var importedSequencesWithoutCandidates = [];
var candidateIdsWithoutSequences = [];

_.each(
	sortedKeys(sequenceRefsById),
	function(sequenceID) {

		var sequenceRefs =
			sequenceRefsById[
				sequenceID
			];

		if(sequenceRefs.length > 1) {

			var sourceNames = [];

			_.each(
				sequenceRefs,
				function(sequenceRef) {
					sourceNames.push(
						sequenceRef.sourceName
					);
				}
			);

			duplicateImportedSequenceIds.push(
				sequenceID +
					" [" +
					sourceNames.join(", ") +
					"]"
			);
		}

		if(!candidatesById[sequenceID]) {
			importedSequencesWithoutCandidates.push(
				sequenceID
			);
		}
	}
);


_.each(
	sortedKeys(candidatesById),
	function(candidateId) {

		if(!sequenceRefsById[candidateId]) {
			candidateIdsWithoutSequences.push(
				candidateId
			);
		}
	}
);


// ============================================================================
// Create permanent loci and link their sequences
// ============================================================================

var matchedCandidateCount = 0;

var createdLocusCount = 0;
var existingLocusCount = 0;

var linkedSequenceCount = 0;

var skippedDuplicateSequenceCount = 0;
var skippedMissingCandidateCount = 0;

var locusTypeCounts = {};
var structuralProfileCounts = {};
var taxonomicResolutionCounts = {};

var mosaicLocusCount = 0;

var highSupportCount = 0;
var nonHighSupportCount = 0;
var unknownHighSupportCount = 0;


_.each(
	sortedKeys(sequenceRefsById),
	function(sequenceID) {

		var sequenceRefs =
			sequenceRefsById[
				sequenceID
			];

		/*
		 * A permanent locus should be represented by exactly one
		 * imported sequence. Do not choose arbitrarily between
		 * duplicate source records.
		 */

		if(sequenceRefs.length !== 1) {
			skippedDuplicateSequenceCount++;
			return;
		}

		var candidate =
			candidatesById[
				sequenceID
			];

		if(!candidate) {
			skippedMissingCandidateCount++;
			return;
		}

		matchedCandidateCount++;

		var locusId =
			candidate.id;

		var locusAlreadyExists =
			existingLocusIds[
				locusId
			] === true;


		if(!locusAlreadyExists) {

			if(DRY_RUN) {

				log(
					"[DRY RUN] Would create " +
					"erv_locus/" +
					locusId
				);

			} else {

				glue.command([
					"create",
					"custom-table-row",
					"erv_locus",
					locusId
				]);
			}

			existingLocusIds[
				locusId
			] = true;

			createdLocusCount++;

		} else {

			existingLocusCount++;
		}


		/*
		 * Populate permanent locus metadata.
		 */

		if(!DRY_RUN) {
			glue.inMode(
				customRowPath(
					"erv_locus",
					locusId
				),
				function() {

					setFieldIfPresent(
						"host_species",
						HOST_SPECIES
					);

					setFieldIfPresent(
						"genome_build",
						GENOME_BUILD
					);

					setFieldIfPresent(
						"scaffold",
						candidate.chrom
					);

					setIntFieldIfPresent(
						"start_position",
						candidate.startPosition
					);

					setIntFieldIfPresent(
						"end_position",
						candidate.endPosition
					);

					setFieldIfPresent(
						"orientation",
						candidate.strand
					);

					setFieldIfPresent(
						"locus_type",
						candidate.locusType
					);

					setFieldIfPresent(
						"structural_profile",
						candidate.structuralProfile
					);

					setFieldIfPresent(
						"taxonomic_resolution",
						candidate.taxonomicResolution
					);

					setBooleanFieldIfPresent(
						"is_mosaic",
						candidate.isMosaic
					);

					setBooleanFieldIfPresent(
						"is_high_support",
						candidate.isHighSupport
					);

					/*
					 * curation_tier is deliberately not
					 * populated here.
					 */
				}
			);
		}


		incrementCount(
			locusTypeCounts,
			candidate.locusType
		);

		incrementCount(
			structuralProfileCounts,
			candidate.structuralProfile
		);

		incrementCount(
			taxonomicResolutionCounts,
			candidate.taxonomicResolution
		);

		if(candidate.isMosaic) {
			mosaicLocusCount++;
		}

		if(candidate.isHighSupport === true) {
			highSupportCount++;
		} else if(
			candidate.isHighSupport === false
		) {
			nonHighSupportCount++;
		} else {
			unknownHighSupportCount++;
		}


		/*
		 * Link the imported sequence directly to the permanent
		 * erv_locus row.
		 */

		var sequenceRef =
			sequenceRefs[0];

		if(DRY_RUN) {

			log(
				"[DRY RUN] Would link sequence " +
				sequenceRef.sourceName +
				"/" +
				sequenceRef.sequenceID +
				" -> erv_locus/" +
				locusId
			);

		} else {

			glue.inMode(
				"sequence/" +
					sequenceRef.sourceName +
					"/" +
					sequenceRef.sequenceID,
				function() {
					glue.command([
						"set",
						"link-target",
						"erv_locus",
						customRowPath(
							"erv_locus",
							locusId
						)
					]);
				}
			);
		}

		linkedSequenceCount++;
	}
);


// ============================================================================
// Summary
// ============================================================================

log("----- SUMMARY -----");

log(
	"Configured locus sources: " +
	LOCUS_SOURCES.length
);

log(
	"Selected candidate rows: " +
	sortedKeys(candidatesById).length
);

log(
	"Imported sequence records: " +
	sourceSequenceCount
);

log(
	"Distinct imported sequence IDs: " +
	sortedKeys(sequenceRefsById).length
);

log(
	"Candidates matched to exactly one sequence: " +
	matchedCandidateCount
);

log(
	"Permanent erv_locus rows created: " +
	createdLocusCount
);

log(
	"Permanent erv_locus rows already present: " +
	existingLocusCount
);

log(
	"Sequences linked to permanent loci: " +
	linkedSequenceCount
);

log(
	"Rows skipped because sequenceID occurred in multiple sources: " +
	skippedDuplicateSequenceCount
);

log(
	"Rows skipped because no candidate row was found: " +
	skippedMissingCandidateCount
);

log(
	"Candidate rows without IDs: " +
	candidateRowsWithoutIds
);


printCounts(
	"Locus types",
	locusTypeCounts
);

printCounts(
	"Structural profiles",
	structuralProfileCounts
);

printCounts(
	"Taxonomic resolutions",
	taxonomicResolutionCounts
);

log(
	"Mosaic loci: " +
	mosaicLocusCount
);

log(
	"High-support loci: " +
	highSupportCount
);

log(
	"Non-high-support loci: " +
	nonHighSupportCount
);

log(
	"Loci with unknown high-support status: " +
	unknownHighSupportCount
);


printLimitedValues(
	"Imported sequence IDs occurring in multiple sources",
	duplicateImportedSequenceIds
);

printLimitedValues(
	"Imported sequence IDs without a candidate row",
	importedSequencesWithoutCandidates
);

printLimitedValues(
	"Candidate IDs without an imported sequence",
	candidateIdsWithoutSequences
);

printLimitedValues(
	"Unrecognised source status values",
	sortedKeys(
		unrecognisedLocusStatuses
	)
);

printLimitedValues(
	"Unrecognised source case_status values",
	sortedKeys(
		unrecognisedCaseStatuses
	)
);

printLimitedValues(
	"Unrecognised curatedNS values",
	sortedKeys(
		unrecognisedHighSupportValues
	)
);


if(DRY_RUN) {
	log(
		"DRY_RUN was enabled; no project data were changed"
	);
}

log(
	"Finished promoting selected ERV locus candidates to permanent loci"
);
