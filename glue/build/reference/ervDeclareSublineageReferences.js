// glue/build/sublineage/ervDeclareSublineageReferences.js
//
// Declare references for:
//
//   1. ERV sublineage reference sequences in source erv_sub
//   2. LTR lineages associated with ERV sublineages in source ltr_sub
//
// Naming conventions:
//
//   ERV references:
//     REF_<sequenceID sanitized>
//
//   Sublineage-associated LTR references:
//     LTR_REF_<sequenceID sanitized>
//
// Examples:
//
//   erv_sub/HERV-39
//     -> REF_HERV39
//
//   ltr_sub/LTR19B
//     -> LTR_REF_LTR19B
//
// Important distinction:
//
//   sequenceID identifies the representative sequence and determines the
//   reference name.
//
//   erv_lineage.id identifies the canonical ERV sublineage entity.
//
//   ltr_lineage.id identifies the associated LTR-lineage entity.
//
// Only sequences that have been linked to an erv_lineage or ltr_lineage row
// are eligible to become references.
//
// Assumptions:
//
//   - sequence.erv_lineage is set for ERV sublineage reference sequences
//   - sequence.ltr_lineage is set for sublineage-associated LTR sequences
//   - one representative sequence per ERV or LTR lineage is expected

var DRY_RUN = false;

// -----------------------------------------------------------------------------
// Basic helpers
// -----------------------------------------------------------------------------

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

function log(message) {
	glue.logInfo(message);
}

function sanitizeRefSuffix(value) {

	value =
		norm(value);

	if(value === null) {
		return "";
	}

	return value.replace(
		/[^A-Za-z0-9]/g,
		""
	);
}

function escapeQuotes(value) {

	return (
		"" + value
	)
		.replace(
			/\\/g,
			"\\\\"
		)
		.replace(
			/'/g,
			"\\'"
		);
}

function queryObjects(commandWords) {

	return glue.tableToObjects(
		glue.command(commandWords)
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

	return glue.command(commandWords);
}

function referenceExists(referenceName) {

	var rows =
		queryObjects([
			"list",
			"reference",
			"-w",
			"name = '" +
				escapeQuotes(referenceName) +
				"'"
		]);

	return rows.length > 0;
}

function referenceNameForSequence(
	prefix,
	sequenceID
) {

	var cleanSequenceID =
		sanitizeRefSuffix(sequenceID);

	if(cleanSequenceID === "") {
		throw (
			"Could not derive reference name from sequence ID: " +
			sequenceID
		);
	}

	return (
		prefix +
		cleanSequenceID
	);
}

// -----------------------------------------------------------------------------
// Group linked sequences by lineage
// -----------------------------------------------------------------------------

function buildLineageToSequenceMap(
	rows,
	lineageField
) {

	var lineageToSequences = {};
	var incompleteRows = [];
	var unlinkedSequences = [];

	_.each(
		rows,
		function(row) {

			var sequenceID =
				norm(
					row["sequenceID"]
				);

			var sourceName =
				norm(
					row["source.name"]
				);

			var lineageId =
				norm(
					row[lineageField]
				);

			if(
				sequenceID === null ||
				sourceName === null
			) {
				incompleteRows.push(row);
				return;
			}

			if(lineageId === null) {
				unlinkedSequences.push({
					sourceName: sourceName,
					sequenceID: sequenceID
				});

				return;
			}

			if(!lineageToSequences[lineageId]) {
				lineageToSequences[lineageId] = [];
			}

			lineageToSequences[lineageId].push({
				lineageId: lineageId,
				sequenceID: sequenceID,
				sourceName: sourceName
			});
		}
	);

	return {
		lineageToSequences: lineageToSequences,
		incompleteRows: incompleteRows,
		unlinkedSequences: unlinkedSequences
	};
}

// -----------------------------------------------------------------------------
// Generic reference-declaration logic
// -----------------------------------------------------------------------------

function declareReferences(config) {

	var rows =
		queryObjects(
			config.query
		);

	log(
		"Loaded " +
		rows.length +
		" " +
		config.label +
		" sequence rows"
	);

	var mappingResult =
		buildLineageToSequenceMap(
			rows,
			config.lineageField
		);

	var lineageToSequences =
		mappingResult.lineageToSequences;

	var lineageIds =
		_.keys(
			lineageToSequences
		).sort();

	var referencesCreated = 0;
	var referencesExisting = 0;

	_.each(
		lineageIds,
		function(lineageId) {

			var candidates =
				lineageToSequences[lineageId];

			if(candidates.length > 1) {

				var candidateNames =
					_.map(
						candidates,
						function(candidate) {
							return (
								candidate.sourceName +
								"/" +
								candidate.sequenceID
							);
						}
					).join(", ");

				throw (
					"Multiple " +
					config.label +
					" reference sequences found for lineage '" +
					lineageId +
					"': " +
					candidateNames
				);
			}

			var chosen =
				candidates[0];

			/*
			 * Reference names are deliberately derived from sequenceID,
			 * not lineageId.
			 *
			 * This preserves stable reference names while allowing
			 * erv_lineage.id to use canonical ERVdb identifiers.
			 */

			var referenceName =
				referenceNameForSequence(
					config.refPrefix,
					chosen.sequenceID
				);

			if(referenceExists(referenceName)) {

				referencesExisting++;

				log(
					"Reference already exists: " +
					referenceName +
					" -> " +
					chosen.sourceName +
					"/" +
					chosen.sequenceID +
					" [" +
					lineageId +
					"]"
				);

				return;
			}

			runCommand([
				"create",
				"reference",
				referenceName,
				chosen.sourceName,
				chosen.sequenceID
			]);

			referencesCreated++;

			log(
				"Created " +
					referenceName +
					" from " +
					chosen.sourceName +
					"/" +
					chosen.sequenceID +
					" [" +
					lineageId +
					"]"
			);
		}
	);

	log(
		"----- " +
		config.label +
		" SUMMARY -----"
	);

	log(
		"Source sequence rows: " +
		rows.length
	);

	log(
		"Linked lineage entities: " +
		lineageIds.length
	);

	log(
		"References created: " +
		referencesCreated
	);

	log(
		"References already present: " +
		referencesExisting
	);

	log(
		"Unlinked source sequences skipped: " +
		mappingResult.unlinkedSequences.length
	);

	_.each(
		mappingResult.unlinkedSequences,
		function(sequence) {
			log(
				"  " +
				sequence.sourceName +
				"/" +
				sequence.sequenceID
			);
		}
	);

	log(
		"Incomplete sequence rows skipped: " +
		mappingResult.incompleteRows.length
	);
}

// -----------------------------------------------------------------------------
// Declare ERV sublineage references
// -----------------------------------------------------------------------------

declareReferences({
    label: "ERV sublineage",
    refPrefix: "REF_",
    lineageField: "erv_lineage_reference.erv_lineage.id",
    query: [
        "list", "sequence",
        "sequenceID",
        "source.name",
        "erv_lineage_reference.erv_lineage.id",
        "-w",
        "source.name = 'erv_sub' and " +
            "erv_lineage_reference.reference_role = 'canonical' and " +
            "erv_lineage_reference.reference_status = 'active'",
        "-s",
        "erv_lineage_reference.erv_lineage.id,sequenceID"
    ]
});

// -----------------------------------------------------------------------------
// Declare references for sublineage-associated LTR lineages
// -----------------------------------------------------------------------------

declareReferences({
    label: "LTR sublineage",
    refPrefix: "LTR_REF_",
    lineageField: "ltr_lineage_reference.ltr_lineage.id",
    query: [
        "list", "sequence",
        "sequenceID",
        "source.name",
        "ltr_lineage_reference.ltr_lineage.id",
        "-w",
        "source.name = 'ltr_sub' and " +
            "ltr_lineage_reference.reference_role = 'canonical' and " +
            "ltr_lineage_reference.reference_status = 'active'",
        "-s",
        "ltr_lineage_reference.ltr_lineage.id,sequenceID"
    ]
});


log(
	"Sublineage-layer reference declaration complete"
);
