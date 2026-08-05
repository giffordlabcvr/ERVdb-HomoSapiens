// glue/build/locus/applyErvLocusCandidateNames.js
//
// Dry-run Missillac naming pass for filtered ERV/LTR candidate loci.
//
// Reads:
//   erv_locus_candidate
//   erv_lineage
//   erv_lineage_alias
//
// Writes:
//   erv_locus_candidate_name
//
// Logic:
//   - if case_status = Mosaic:
//       standard_id = Mosaic
//       resolution_status = mosaic
//   - if case_status = Resolved at clade level:
//       standard_id = normalised names_decision, e.g. Clade-I
//       resolution_status = resolved_category
//   - otherwise:
//       resolve names_decision to erv_lineage by:
//         1. erv_lineage.id
//         2. erv_lineage.standard_id
//         3. erv_lineage_alias.alias_name
//   - number sequentially within each standard_id by genomic order
//
// No links are created.

function norm(value) {
	if(value === null || value === undefined) {
		return null;
	}
	var s = ("" + value).trim();
	if(s === "") {
		return null;
	}
	var low = s.toLowerCase();
	if(low === "n/a" || low === "na" || low === "null" || low === "none" || s === "-") {
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

function customRowPath(tableName, rowId) {
	return "custom-table-row/" + tableName + "/" + rowId;
}

function ensureRow(tableName, rowId) {
	try {
		glue.command(["create", "custom-table-row", tableName, rowId]);
		return true;
	} catch(e) {
		return false;
	}
}

function setFieldIfPresent(fieldName, value) {
	value = norm(value);
	if(value !== null) {
		glue.command(["set", "field", fieldName, value]);
	}
}

function setIntFieldIfPresent(fieldName, value) {
	value = normInt(value);
	if(value !== null) {
		glue.command(["set", "field", fieldName, "" + value]);
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
	if(chrom === "M" || chrom === "MT") {
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

// --------------------------------------------------
// Build lineage resolution maps
// --------------------------------------------------

var lineageById = {};
var lineageByStandardId = {};

var lineageRows = glue.tableToObjects(glue.command([
	"list", "custom-table-row", "erv_lineage",
	"id", "standard_id"
]));

_.each(lineageRows, function(row) {
	var id = norm(row["id"]);
	var standardId = norm(row["standard_id"]);

	if(id !== null) {
		lineageById[id] = {
			resolved_lineage_id: id,
			standard_id: standardId !== null ? standardId : id
		};
	}

	if(standardId !== null && id !== null) {
		lineageByStandardId[standardId] = {
			resolved_lineage_id: id,
			standard_id: standardId
		};
	}
});

var lineageByAlias = {};

var aliasRows = glue.tableToObjects(glue.command([
	"list", "custom-table-row", "erv_lineage_alias",
	"id", "alias_name", "erv_lineage.id", "erv_lineage.standard_id"
]));

_.each(aliasRows, function(row) {
	var aliasName = norm(row["alias_name"]);
	var lineageId = norm(row["erv_lineage.id"]);
	var standardId = norm(row["erv_lineage.standard_id"]);

	if(aliasName !== null && lineageId !== null) {
		lineageByAlias[aliasName] = {
			resolved_lineage_id: lineageId,
			standard_id: standardId !== null ? standardId : lineageId
		};
	}
});

function resolveLineage(rawName, caseStatus) {

	rawName = norm(rawName);
	caseStatus = norm(caseStatus);

	if(caseStatus === "Mosaic") {
		return {
			source: "case_status.mosaic",
			raw_name: rawName,
			resolved_lineage_id: null,
			standard_id: "Mosaic",
			resolution_status: "mosaic",
			notes: "Mosaic locus; numbered in shared Mosaic category"
		};
	}

	if(caseStatus === "Resolved at clade level") {
		var categoryId = normaliseCategoryName(rawName);
		if(categoryId !== null) {
			return {
				source: "case_status.clade_level",
				raw_name: rawName,
				resolved_lineage_id: null,
				standard_id: categoryId,
				resolution_status: "resolved_category",
				notes: "Resolved at clade level; numbered within clade-level category"
			};
		}
	}

	if(rawName === null) {
		return null;
	}

	if(lineageById[rawName]) {
		return {
			source: "erv_lineage.id",
			raw_name: rawName,
			resolved_lineage_id: lineageById[rawName].resolved_lineage_id,
			standard_id: lineageById[rawName].standard_id,
			resolution_status: "resolved",
			notes: "Resolved via erv_lineage.id"
		};
	}

	if(lineageByStandardId[rawName]) {
		return {
			source: "erv_lineage.standard_id",
			raw_name: rawName,
			resolved_lineage_id: lineageByStandardId[rawName].resolved_lineage_id,
			standard_id: lineageByStandardId[rawName].standard_id,
			resolution_status: "resolved",
			notes: "Resolved via erv_lineage.standard_id"
		};
	}

	if(lineageByAlias[rawName]) {
		return {
			source: "erv_lineage_alias.alias_name",
			raw_name: rawName,
			resolved_lineage_id: lineageByAlias[rawName].resolved_lineage_id,
			standard_id: lineageByAlias[rawName].standard_id,
			resolution_status: "resolved",
			notes: "Resolved via erv_lineage_alias.alias_name"
		};
	}

	return null;
}

// --------------------------------------------------
// Load candidate rows
// --------------------------------------------------

var candidateRows = glue.tableToObjects(glue.command([
	"list", "custom-table-row", "erv_locus_candidate",
	"id", "names_decision", "case_status", "chrom", "start_position", "end_position"
]));

var resolvedByStandardId = {};
var unresolved = [];

_.each(candidateRows, function(row) {

	var candidateId = norm(row["id"]);
	var rawName = norm(row["names_decision"]);
	var caseStatus = norm(row["case_status"]);

	if(candidateId === null) {
		return;
	}

	var resolved = resolveLineage(rawName, caseStatus);

	if(resolved === null) {
		unresolved.push({
			candidate_id: candidateId,
			raw_name: rawName,
			case_status: caseStatus
		});
		return;
	}

	var standardId = resolved.standard_id;

	if(!resolvedByStandardId[standardId]) {
		resolvedByStandardId[standardId] = [];
	}

	resolvedByStandardId[standardId].push({
		candidate_id: candidateId,
		raw_name: rawName,
		naming_source: resolved.source,
		resolved_lineage_id: resolved.resolved_lineage_id,
		standard_id: standardId,
		resolution_status: resolved.resolution_status,
		notes: resolved.notes,
		chrom: norm(row["chrom"]),
		start_position: normInt(row["start_position"]),
		end_position: normInt(row["end_position"])
	});
});

glue.logInfo("Loaded candidate rows: " + candidateRows.length);
glue.logInfo("Unresolved candidates: " + unresolved.length);

// --------------------------------------------------
// Write unresolved rows
// --------------------------------------------------

_.each(unresolved, function(item) {

	ensureRow("erv_locus_candidate_name", item.candidate_id);

	glue.inMode(customRowPath("erv_locus_candidate_name", item.candidate_id), function() {
		setFieldIfPresent("candidate_id", item.candidate_id);
		setFieldIfPresent("naming_source", "names_decision");
		setFieldIfPresent("raw_name", item.raw_name);
		setFieldIfPresent("resolution_status", "unresolved");
		setFieldIfPresent("notes", "Could not resolve names_decision to lineage/category");
	});
});

// --------------------------------------------------
// Number and write resolved rows
// --------------------------------------------------

var namedCount = 0;

_.each(Object.keys(resolvedByStandardId).sort(), function(standardId) {

	var items = resolvedByStandardId[standardId];

	items.sort(function(a, b) {
		var cr = chrRank(a.chrom) - chrRank(b.chrom);
		if(cr !== 0) {
			return cr;
		}
		var sp = (a.start_position || 0) - (b.start_position || 0);
		if(sp !== 0) {
			return sp;
		}
		var ep = (a.end_position || 0) - (b.end_position || 0);
		if(ep !== 0) {
			return ep;
		}
		return a.candidate_id < b.candidate_id ? -1 : (a.candidate_id > b.candidate_id ? 1 : 0);
	});

	for(var i = 0; i < items.length; i++) {
		var item = items[i];
		var locusNumber = i + 1;
		var missillacId = standardId + "-" + locusNumber;

		ensureRow("erv_locus_candidate_name", item.candidate_id);

		glue.inMode(customRowPath("erv_locus_candidate_name", item.candidate_id), function() {
			setFieldIfPresent("candidate_id", item.candidate_id);
			setFieldIfPresent("naming_source", item.naming_source);
			setFieldIfPresent("raw_name", item.raw_name);
			setFieldIfPresent("resolved_lineage_id", item.resolved_lineage_id);
			setFieldIfPresent("standard_id", item.standard_id);
			setIntFieldIfPresent("locus_number", locusNumber);
			setFieldIfPresent("missillac_id", missillacId);
			setFieldIfPresent("resolution_status", item.resolution_status);
			setFieldIfPresent("notes", item.notes);
		});

		namedCount++;

		if(namedCount % 10000 === 0) {
			glue.logInfo("Named " + namedCount + " candidates");
		}
	}
});

glue.logInfo("Candidate Missillac naming pass complete");
glue.logInfo("Named candidates: " + namedCount);
glue.logInfo("Unresolved candidates written: " + unresolved.length);
