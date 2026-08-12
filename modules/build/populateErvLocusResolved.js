// populateErvLocusResolved.js
//
// Populate the canonical/resolved ERV locus table from the staging tables:
//
//   erv_locus_candidate
//   erv_locus_candidate_name
//
// The set of loci to populate is defined by:
//
//   sequence.sequence_kind = 'erv_locus'
//
// For each such sequence:
//
//   1. Find erv_locus_candidate using the RBRT sequence ID.
//   2. Find the corresponding erv_locus_candidate_name.
//   3. Create/update erv_locus_resolved using the same RBRT ID.
//   4. Populate Sean-facing locus fields.
//   5. Derive resolved Clade / Group / Subgroup.
//   6. Link sequence -> erv_locus_resolved.
//   7. Link erv_locus_resolved -> erv_lineage where applicable.
//   8. Commit and refresh context periodically.
//
// Constants:
//   host_species = Homo sapiens
//   genome_build = hg19


var CANDIDATE_TABLE = "erv_locus_candidate";
var NAME_TABLE = "erv_locus_candidate_name";
var RESOLVED_TABLE = "erv_locus_resolved";
var LINEAGE_TABLE = "erv_lineage";

var HOST_SPECIES = "Homo sapiens";
var GENOME_BUILD = "hg19";


// ------------------------------------------------------------
// Utility functions
// ------------------------------------------------------------

function esc(str) {
	if(str == null) {
		return "";
	}
	return ("" + str).replace(/'/g, "''");
}


function clean(value) {

	if(value == null) {
		return null;
	}

	var s = ("" + value).replace(/^\s+|\s+$/g, "");

	if(
		s === "" ||
		s === "-" ||
		s.toLowerCase() === "null"
	) {
		return null;
	}

	return s;
}


function rowList(result) {

	if(result && result.listResult && result.listResult.row) {
		return result.listResult.row;
	}

	return [];
}


function setFieldIfNotNull(fieldName, value) {

	value = clean(value);

	if(value != null) {
		glue.command([
			"set", "field",
			fieldName,
			"" + value
		]);
	}
}


function setIntegerFieldIfNotNull(fieldName, value) {

	value = clean(value);

	if(value != null) {
		glue.command([
			"set", "field",
			fieldName,
			"" + value
		]);
	}
}


// ------------------------------------------------------------
// Custom-table row helpers
// ------------------------------------------------------------

function customTableRowExists(tableName, rowId) {

	var rows = rowList(glue.command([
		"list", "custom-table-row", tableName,
		"-w", "id = '" + esc(rowId) + "'",
		"id"
	]));

	return rows.length > 0;
}


function createCustomTableRowIfNeeded(tableName, rowId) {

	if(!customTableRowExists(tableName, rowId)) {

		glue.command([
			"create", "custom-table-row",
			tableName,
			rowId
		]);

		return true;
	}

	return false;
}


// ------------------------------------------------------------
// Candidate lookup
// ------------------------------------------------------------

function getCandidate(candidateId) {

	var rows = rowList(glue.command([
		"list", "custom-table-row", CANDIDATE_TABLE,
		"-w", "id = '" + esc(candidateId) + "'",
		"id",
		"chrom",
		"start_position",
		"end_position",
		"strand",
		"length",
		"status",
		"names",
		"names_decision",
		"case_status",
		"digs_ids",
		"repbase_ids",
		"retrotector_ids",
		"clade_out",
		"group_out",
		"subgroup_out",
		"makes_mosaic"
	]));

	if(rows.length === 0) {
		return null;
	}

	if(rows.length > 1) {
		throw "More than one " + CANDIDATE_TABLE +
			" row found for " + candidateId;
	}

	var v = rows[0].value;

	return {
		id: clean(v[0]),
		chrom: clean(v[1]),
		start_position: clean(v[2]),
		end_position: clean(v[3]),
		strand: clean(v[4]),
		length: clean(v[5]),
		status: clean(v[6]),
		names: clean(v[7]),
		names_decision: clean(v[8]),
		case_status: clean(v[9]),
		digs_ids: clean(v[10]),
		repbase_ids: clean(v[11]),
		retrotector_ids: clean(v[12]),
		clade_out: clean(v[13]),
		group_out: clean(v[14]),
		subgroup_out: clean(v[15]),
		makes_mosaic: clean(v[16])
	};
}


// ------------------------------------------------------------
// Candidate-name lookup
//
// Prefer candidate_id, since that is the intended staging-table
// relationship.
//
// Fall back to id because some existing exports indicate that the
// RBRT identifier may also have been used directly as the row ID.
// ------------------------------------------------------------

function getCandidateName(candidateId) {

	var rows = rowList(glue.command([
		"list", "custom-table-row", NAME_TABLE,
		"-w", "candidate_id = '" + esc(candidateId) + "'",
		"id",
		"candidate_id",
		"missillac_id",
		"resolved_lineage_id",
		"resolution_status",
		"raw_name",
		"standard_id"
	]));

	if(rows.length === 0) {

		rows = rowList(glue.command([
			"list", "custom-table-row", NAME_TABLE,
			"-w", "id = '" + esc(candidateId) + "'",
			"id",
			"candidate_id",
			"missillac_id",
			"resolved_lineage_id",
			"resolution_status",
			"raw_name",
			"standard_id"
		]));
	}

	if(rows.length === 0) {
		return null;
	}

	if(rows.length > 1) {
		throw "More than one " + NAME_TABLE +
			" row found for candidate " + candidateId;
	}

	var v = rows[0].value;

	return {
		id: clean(v[0]),
		candidate_id: clean(v[1]),
		missillac_id: clean(v[2]),
		resolved_lineage_id: clean(v[3]),
		resolution_status: clean(v[4]),
		raw_name: clean(v[5]),
		standard_id: clean(v[6])
	};
}


// ------------------------------------------------------------
// Lineage taxonomy
// ------------------------------------------------------------

function getLineage(lineageId) {

	lineageId = clean(lineageId);

	if(lineageId == null) {
		return null;
	}

	var rows = rowList(glue.command([
		"list", "custom-table-row", LINEAGE_TABLE,
		"-w", "id = '" + esc(lineageId) + "'",
		"id",
		"entity_level",
		"rv_clade.id",
		"rv_genus.id",
		"rv_subgenus.id"
	]));

	if(rows.length === 0) {
		return null;
	}

	if(rows.length > 1) {
		throw "More than one " + LINEAGE_TABLE +
			" row found for " + lineageId;
	}

	var v = rows[0].value;

	return {
		id: clean(v[0]),
		entity_level: clean(v[1]),
		clade: clean(v[2]),
		genus: clean(v[3]),
		subgenus: clean(v[4])
	};
}


function cladeName(value) {

	value = clean(value);

	if(value == null) {
		return null;
	}

	if(/^Clade\s+/i.test(value)) {
		return value;
	}

	return "Clade " + value;
}


function groupName(value) {

	value = clean(value);

	if(value == null) {
		return null;
	}

	var groupMap = {
		"Alpharetrovirus": "Alpha",
		"Betaretrovirus": "Beta",
		"Gammaretrovirus": "Gamma",
		"Deltaretrovirus": "Delta",
		"Epsilonretrovirus": "Epsilon",
		"Etaretrovirus": "Eta",
		"Thetaretrovirus": "Theta",
		"Zetaretrovirus": "Zeta",
		"Kapparetrovirus": "Kappa",
		"Lambdaretrovirus": "Lambda",
		"Rhoretrovirus": "Rho",
		"Unclassified": null
	};

	if(groupMap[value] !== undefined) {
		return groupMap[value];
	}

	return value;
}


// ------------------------------------------------------------
// Helpers for partially resolved cases
// ------------------------------------------------------------

function uniqueValues(value) {

	value = clean(value);

	if(value == null) {
		return [];
	}

	var parts = value.split(",");
	var seen = {};
	var result = [];

	for(var i = 0; i < parts.length; i++) {

		var part = clean(parts[i]);

		if(part == null) {
			continue;
		}

		if(part.toUpperCase() === "NA") {
			continue;
		}

		if(!seen[part]) {
			seen[part] = true;
			result.push(part);
		}
	}

	return result;
}


function singleUniqueValue(value) {

	var values = uniqueValues(value);

	if(values.length === 1) {
		return values[0];
	}

	return null;
}


// ------------------------------------------------------------
// Interpret case_status.
//
// Current examples include:
//
//   Fully resolved
//   Resolved at clade level
//   Resolved at subgenus level
//
// We retain the original case_status in the output table, but use
// this function to determine how much taxonomy should be populated.
// ------------------------------------------------------------

function resolutionLevel(caseStatus) {

	var status = clean(caseStatus);

	if(status == null) {
		return "unresolved";
	}

	status = status.toLowerCase();

	if(status.indexOf("fully resolved") >= 0) {
		return "lineage";
	}

	if(status.indexOf("subgenus") >= 0 ||
	   status.indexOf("subgroup") >= 0) {
		return "subgroup";
	}

	if(status.indexOf("genus") >= 0 ||
	   status.indexOf("group") >= 0) {
		return "group";
	}

	if(status.indexOf("clade") >= 0) {
		return "clade";
	}

	return "unresolved";
}


// ------------------------------------------------------------
// Resolve Clade / Group / Subgroup for one candidate.
// ------------------------------------------------------------

function resolveTaxonomy(candidate, candidateName) {

	var result = {
		clade: null,
		group: null,
		subgroup: null,
		lineage: null
	};

	var level = resolutionLevel(candidate.case_status);

	var lineageId = null;

	if(candidateName != null) {
		lineageId = clean(candidateName.resolved_lineage_id);
	}

	var lineage = null;

	if(lineageId != null) {
		lineage = getLineage(lineageId);
	}


	// --------------------------------------------------------
	// Preferred route: taxonomy from resolved lineage.
	// --------------------------------------------------------

	if(lineage != null) {

		result.lineage = lineage;

		if(
			level === "lineage" ||
			level === "subgroup" ||
			level === "group" ||
			level === "clade"
		) {
			result.clade = cladeName(lineage.clade);
		}

		if(
			level === "lineage" ||
			level === "subgroup" ||
			level === "group"
		) {
			result.group = groupName(lineage.genus);
		}

		if(
			level === "lineage" ||
			level === "subgroup"
		) {
			result.subgroup = clean(lineage.subgenus);
		}

		return result;
	}


	// --------------------------------------------------------
	// Fallback for partially resolved cases which do not have
	// a concrete resolved_lineage_id.
	//
	// Only retain a value when the staging evidence contains
	// exactly one unique taxon at the resolved level.
	// --------------------------------------------------------

	if(level === "clade") {

		result.clade =
			singleUniqueValue(candidate.clade_out);

	} else if(level === "group") {

		result.clade =
			singleUniqueValue(candidate.clade_out);

		result.group =
			singleUniqueValue(candidate.group_out);

	} else if(level === "subgroup") {

		result.clade =
			singleUniqueValue(candidate.clade_out);

		result.group =
			singleUniqueValue(candidate.group_out);

		result.subgroup =
			singleUniqueValue(candidate.subgroup_out);
	}

	return result;
}


// ------------------------------------------------------------
// Populate one erv_locus_resolved record.
// ------------------------------------------------------------

function populateResolvedLocus(sequenceId, candidate, candidateName) {

	var created = createCustomTableRowIfNeeded(
		RESOLVED_TABLE,
		sequenceId
	);

	var taxonomy = resolveTaxonomy(
		candidate,
		candidateName
	);


	glue.inMode(
		"custom-table-row/" + RESOLVED_TABLE + "/" + sequenceId,
		function() {

			// --------------------------------------------------
			// Identifiers
			// --------------------------------------------------

			if(candidateName != null) {

				setFieldIfNotNull(
					"missillac_id",
					candidateName.missillac_id
				);

				setFieldIfNotNull(
					"lineage_id",
					candidateName.resolved_lineage_id
				);
			}


			// --------------------------------------------------
			// Coordinates
			// --------------------------------------------------

			setFieldIfNotNull(
				"chromosome",
				candidate.chrom
			);

			setIntegerFieldIfNotNull(
				"start_position",
				candidate.start_position
			);

			setIntegerFieldIfNotNull(
				"end_position",
				candidate.end_position
			);

			setFieldIfNotNull(
				"strand",
				candidate.strand
			);

			setIntegerFieldIfNotNull(
				"length",
				candidate.length
			);


			// --------------------------------------------------
			// Classification
			// --------------------------------------------------

			setFieldIfNotNull(
				"category",
				candidate.status
			);

			// names_decision is the curated classification decision.
			setFieldIfNotNull(
				"taxonomic_resolution",
				candidate.names_decision
			);

			setFieldIfNotNull(
				"case_status",
				candidate.case_status
			);


			// --------------------------------------------------
			// Source support
			// --------------------------------------------------

			// supporting_datasets deliberately left unset for now.

			setFieldIfNotNull(
				"digs_ids",
				candidate.digs_ids
			);

			setFieldIfNotNull(
				"repbase_ids",
				candidate.repbase_ids
			);

			setFieldIfNotNull(
				"retrotector_ids",
				candidate.retrotector_ids
			);


			// --------------------------------------------------
			// Resolved taxonomy
			// --------------------------------------------------

			setFieldIfNotNull(
				"clade",
				taxonomy.clade
			);

			setFieldIfNotNull(
				"group_name",
				taxonomy.group
			);

			setFieldIfNotNull(
				"subgroup",
				taxonomy.subgroup
			);


			// --------------------------------------------------
			// Host / assembly
			// --------------------------------------------------

			glue.command([
				"set", "field",
				"host_species",
				HOST_SPECIES
			]);

			glue.command([
				"set", "field",
				"genome_build",
				GENOME_BUILD
			]);


			// --------------------------------------------------
			// Link resolved locus -> lineage.
			// Only set this where there is a concrete lineage row.
			// --------------------------------------------------

			if(taxonomy.lineage != null) {

				glue.command([
					"set", "link-target",
					"erv_lineage",
					"custom-table-row/" +
						LINEAGE_TABLE + "/" +
						taxonomy.lineage.id
				]);
			}
		}
	);


	return created;
}


// ------------------------------------------------------------
// Link sequence -> erv_locus_resolved.
//
// GLUE sequence mode requires both source name and sequence ID.
// ------------------------------------------------------------

function linkSequenceToResolvedLocus(
	sourceName,
	sequenceId,
	resolvedLocusId
) {

	glue.inMode(
		"sequence/" + sourceName + "/" + sequenceId,
		function() {

			glue.command([
				"set", "link-target",
				"erv_locus_resolved",
				"custom-table-row/" +
					RESOLVED_TABLE + "/" +
					resolvedLocusId
			]);
		}
	);
}


// ------------------------------------------------------------
// Main migration function.
//
// batchSize:
//   number of loci between commit/new-context operations.
//   If omitted or invalid, defaults to 500.
// ------------------------------------------------------------

function populateErvLocusResolved(batchSize) {

	batchSize = parseInt(batchSize);

	if(isNaN(batchSize) || batchSize <= 0) {
		batchSize = 500;
	}


	// --------------------------------------------------------
	// Get the authoritative set of ERV-locus sequences.
	//
	// This intentionally retrieves only source + sequence ID,
	// keeping the initial result small.
	// --------------------------------------------------------

	var sequenceRows = rowList(glue.command([
		"list", "sequence",
		"-w", "sequence_kind = 'erv_locus'",
		"-s", "sequenceID",
		"source.name",
		"sequenceID"
	]));


	var processed = 0;
	var created = 0;
	var updated = 0;
	var missingCandidate = 0;
	var missingCandidateName = 0;


	glue.log(
		"INFO",
		"Found " + sequenceRows.length +
		" sequences with sequence_kind = 'erv_locus'"
	);


	for(var i = 0; i < sequenceRows.length; i++) {

		var values = sequenceRows[i].value;

		var sourceName = clean(values[0]);
		var sequenceId = clean(values[1]);

		if(sequenceId == null) {
			continue;
		}


		var candidate = getCandidate(sequenceId);


		// ----------------------------------------------------
		// A sequence without a staging candidate cannot be
		// populated safely. Warn and continue.
		// ----------------------------------------------------

		if(candidate == null) {

			missingCandidate++;

			glue.log(
				"WARNING",
				"No " + CANDIDATE_TABLE +
				" record found for sequence " +
				sequenceId
			);

			continue;
		}


		var candidateName =
			getCandidateName(sequenceId);


		if(candidateName == null) {

			missingCandidateName++;

			glue.log(
				"WARNING",
				"No " + NAME_TABLE +
				" record found for candidate " +
				sequenceId
			);
		}


		// ----------------------------------------------------
		// Populate / update resolved locus.
		// ----------------------------------------------------

		var wasCreated = populateResolvedLocus(
			sequenceId,
			candidate,
			candidateName
		);


		if(wasCreated) {
			created++;
		} else {
			updated++;
		}


		// ----------------------------------------------------
		// Link the sequence to the canonical locus record.
		// ----------------------------------------------------

		linkSequenceToResolvedLocus(
			sourceName,
			sequenceId,
			sequenceId
		);


		processed++;


		// ----------------------------------------------------
		// Keep Cayenne / GLUE object context under control.
		// ----------------------------------------------------

		if(processed % batchSize === 0) {

			glue.command(["commit"]);
			glue.command(["new-context"]);

			glue.log(
				"INFO",
				"Processed " + processed +
				" / " + sequenceRows.length +
				" ERV locus sequences"
			);
		}
	}


	// Final commit for remainder.
	glue.command(["commit"]);


	glue.log(
		"INFO",
		"Finished populating " +
		RESOLVED_TABLE +
		": processed=" + processed +
		", created=" + created +
		", updated=" + updated +
		", missingCandidate=" + missingCandidate +
		", missingCandidateName=" + missingCandidateName
	);


	// Return only a one-row summary so we don't create another
	// enormous table result in memory.
	return [{
		sequence_rows: sequenceRows.length,
		processed: processed,
		created: created,
		updated: updated,
		missing_candidate: missingCandidate,
		missing_candidate_name: missingCandidateName
	}];
}
