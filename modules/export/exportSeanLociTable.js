// exportSeanLociTable.js
//
// Build and export the ERV locus table requested for ERV Navigator.
//
// Data sources:
//   erv_locus_candidate
//   erv_locus_candidate_name
//   erv_lineage
//
// Output columns:
//   RBRT_ID
//   Missillac_ID
//   Lineage_ID
//   Chromosome
//   Start
//   End
//   Strand
//   Length
//   Category
//   Taxonomic_Resolution
//   Case_Status
//   Supporting_Datasets
//   DIGS_IDs
//   Repbase_IDs
//   Retrotector_IDs
//   Clade
//   Group
//   Subgroup
//   Host_Species
//   Genome_Build
//
// Notes:
// - Supporting_Datasets is currently left blank.
// - Host_Species is fixed as Homo sapiens.
// - Genome_Build is fixed as hg19.
// - Fully resolved taxonomy is taken from erv_lineage.
// - Partially resolved loci use only the taxonomic level actually
//   resolved, e.g. clade-level loci receive Clade only.
// - Candidate clade_out / group_out / subgroup_out fields are used
//   only as a fallback for partially resolved cases with no
//   resolved_lineage_id.


var CANDIDATE_TABLE = "erv_locus_candidate";
var NAME_TABLE = "erv_locus_candidate_name";
var LINEAGE_TABLE = "erv_lineage";

var HOST_SPECIES = "Homo sapiens";
var GENOME_BUILD = "hg19";


// ------------------------------------------------------------
// Utility functions
// ------------------------------------------------------------

function clean(value) {

	if(value == null) {
		return null;
	}

	var s = "" + value;
	s = s.replace(/^\s+|\s+$/g, "");

	if(s === "" || s === "-") {
		return null;
	}

	return s;
}


function out(value) {

	value = clean(value);

	if(value == null) {
		return "";
	}

	return value;
}


function rowList(result) {

	if(result && result.listResult && result.listResult.row) {
		return result.listResult.row;
	}

	return [];
}


// ------------------------------------------------------------
// Taxonomy formatting
// ------------------------------------------------------------

function cladeName(rvCladeId) {

	rvCladeId = clean(rvCladeId);

	if(rvCladeId == null) {
		return "";
	}

	if(/^Clade\s+/i.test(rvCladeId)) {
		return rvCladeId;
	}

	return "Clade " + rvCladeId;
}


function groupName(rvGenusId) {

	rvGenusId = clean(rvGenusId);

	if(rvGenusId == null) {
		return "";
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

		"Unclassified": ""
	};

	if(groupMap[rvGenusId] != null) {
		return groupMap[rvGenusId];
	}

	// Preserve unexpected values rather than silently losing them.
	return rvGenusId;
}


// ------------------------------------------------------------
// Handle composite candidate classification fields
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

	return "";
}


// ------------------------------------------------------------
// Determine assignment resolution
// ------------------------------------------------------------

function resolutionLevel(namesDecision, resolutionStatus) {

	var decision = out(namesDecision).toLowerCase();
	var status = out(resolutionStatus).toLowerCase();

	if(decision.indexOf("clade") >= 0) {
		return "clade";
	}

	if(decision.indexOf("subgroup") >= 0) {
		return "subgroup";
	}

	if(decision.indexOf("group") >= 0) {
		return "group";
	}

	if(decision.indexOf("fully resolved") >= 0) {
		return "lineage";
	}

	if(status === "resolved") {
		return "lineage";
	}

	if(status.indexOf("clade") >= 0) {
		return "clade";
	}

	if(status.indexOf("subgroup") >= 0) {
		return "subgroup";
	}

	if(status.indexOf("group") >= 0) {
		return "group";
	}

	return "unresolved";
}


// ------------------------------------------------------------
// Build candidate-name lookup
// ------------------------------------------------------------

function loadCandidateNames() {

	var rows = rowList(glue.command([
		"list", "custom-table-row", NAME_TABLE,
		"id",
		"candidate_id",
		"missillac_id",
		"resolved_lineage_id",
		"resolution_status"
	]));

	var lookup = {};

	for(var i = 0; i < rows.length; i++) {

		var v = rows[i].value;

		var rowId = clean(v[0]);
		var candidateId = clean(v[1]);

		// Current data appear to use the RBRT candidate ID as the
		// name-record row ID in many cases.
		if(candidateId == null) {
			candidateId = rowId;
		}

		lookup[candidateId] = {
			id: rowId,
			candidate_id: candidateId,
			missillac_id: clean(v[2]),
			resolved_lineage_id: clean(v[3]),
			resolution_status: clean(v[4])
		};
	}

	return lookup;
}


// ------------------------------------------------------------
// Build lineage taxonomy lookup
// ------------------------------------------------------------

function loadLineages() {

	var rows = rowList(glue.command([
		"list", "custom-table-row", LINEAGE_TABLE,
		"id",
		"standard_id",
		"entity_level",
		"rv_clade.id",
		"rv_genus.id",
		"rv_subgenus.id"
	]));

	var lookup = {};

	for(var i = 0; i < rows.length; i++) {

		var v = rows[i].value;

		var lineageId = clean(v[0]);

		if(lineageId == null) {
			continue;
		}

		lookup[lineageId] = {
			id: lineageId,
			standard_id: clean(v[1]),
			entity_level: clean(v[2]),
			clade: clean(v[3]),
			genus: clean(v[4]),
			subgenus: clean(v[5])
		};
	}

	return lookup;
}


// ------------------------------------------------------------
// Build complete Sean-format locus table
// ------------------------------------------------------------

function buildSeanLociObjects() {

	var nameByCandidateId = loadCandidateNames();
	var lineageById = loadLineages();

	var candidateRows = rowList(glue.command([
		"list", "custom-table-row", CANDIDATE_TABLE,
		"-s", "id",
		"id",
		"chrom",
		"start_position",
		"end_position",
		"strand",
		"length",
		"status",
		"names_decision",
		"case_status",
		"digs_ids",
		"repbase_ids",
		"retrotector_ids",
		"clade_out",
		"group_out",
		"subgroup_out"
	]));

	var outputRows = [];

	for(var i = 0; i < candidateRows.length; i++) {

		var v = candidateRows[i].value;

		var candidate = {
			id: clean(v[0]),
			chrom: clean(v[1]),
			start_position: clean(v[2]),
			end_position: clean(v[3]),
			strand: clean(v[4]),
			length: clean(v[5]),
			status: clean(v[6]),
			names_decision: clean(v[7]),
			case_status: clean(v[8]),
			digs_ids: clean(v[9]),
			repbase_ids: clean(v[10]),
			retrotector_ids: clean(v[11]),
			clade_out: clean(v[12]),
			group_out: clean(v[13]),
			subgroup_out: clean(v[14])
		};


		var nameRecord = nameByCandidateId[candidate.id];

		var missillacId = "";
		var resolvedLineageId = "";
		var resolutionStatus = "";

		if(nameRecord != null) {

			missillacId = out(nameRecord.missillac_id);
			resolvedLineageId = out(nameRecord.resolved_lineage_id);
			resolutionStatus = out(nameRecord.resolution_status);
		}


		var level = resolutionLevel(
			candidate.names_decision,
			resolutionStatus
		);


		var clade = "";
		var group = "";
		var subgroup = "";


		// --------------------------------------------------------
		// Preferred route:
		// taxonomy from the assigned erv_lineage record.
		// --------------------------------------------------------

		var lineage = null;

		if(resolvedLineageId !== "") {
			lineage = lineageById[resolvedLineageId];
		}


		if(lineage != null) {

			if(
				level === "lineage" ||
				level === "subgroup" ||
				level === "group" ||
				level === "clade"
			) {
				clade = cladeName(lineage.clade);
			}


			if(
				level === "lineage" ||
				level === "subgroup" ||
				level === "group"
			) {
				group = groupName(lineage.genus);
			}


			if(
				level === "lineage" ||
				level === "subgroup"
			) {
				subgroup = out(lineage.subgenus);
			}
		}


		// --------------------------------------------------------
		// Fallback for partially resolved loci without an assigned
		// lineage ID.
		//
		// Only accept a taxonomic value when all contributing
		// candidate classifications agree on one unique value.
		// --------------------------------------------------------

		if(lineage == null) {

			if(level === "clade") {

				clade = singleUniqueValue(candidate.clade_out);

			} else if(level === "group") {

				clade = singleUniqueValue(candidate.clade_out);
				group = singleUniqueValue(candidate.group_out);

			} else if(level === "subgroup") {

				clade = singleUniqueValue(candidate.clade_out);
				group = singleUniqueValue(candidate.group_out);
				subgroup = singleUniqueValue(candidate.subgroup_out);
			}
		}


		outputRows.push({

			RBRT_ID: out(candidate.id),

			Missillac_ID: missillacId,

			Lineage_ID: resolvedLineageId,

			Chromosome: out(candidate.chrom),

			Start: out(candidate.start_position),

			End: out(candidate.end_position),

			Strand: out(candidate.strand),

			Length: out(candidate.length),

			Category: out(candidate.status),

			Taxonomic_Resolution: out(candidate.names_decision),

			Case_Status: out(candidate.case_status),

			Supporting_Datasets: "",

			DIGS_IDs: out(candidate.digs_ids),

			Repbase_IDs: out(candidate.repbase_ids),

			Retrotector_IDs: out(candidate.retrotector_ids),

			Clade: clade,

			Group: group,

			Subgroup: subgroup,

			Host_Species: HOST_SPECIES,

			Genome_Build: GENOME_BUILD
		});
	}

	return outputRows;
}


// ------------------------------------------------------------
// Preview
//
// Returned via <tableFromObjectsResultType/> in the module config.
// This may be inconvenient for the complete dataset because GLUE's
// console renderer struggles with a very wide table, but remains useful
// for testing.
// ------------------------------------------------------------

function previewSeanLociTable() {

	return buildSeanLociObjects();
}


// ------------------------------------------------------------
// Export
//
// Invoke previewSeanLociTable through the module itself so that GLUE
// converts the object array into a proper table result, then pass that
// table result directly to tabularUtility save-tabular.
// ------------------------------------------------------------

function exportSeanLociTable(fileName) {

	var tableResult;

	glue.inMode("module/exportSeanLociTable", function() {

		tableResult = glue.command([
			"invoke-function",
			"previewSeanLociTable"
		]);
	});


	var saveResult;

	glue.inMode("module/tabularUtility", function() {

		saveResult = glue.command({
			"save-tabular": {
				"fileName": fileName,
				"tabularData": tableResult
			}
		});
	});


	return saveResult;
}