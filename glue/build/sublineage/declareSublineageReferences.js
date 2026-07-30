// glue/build/sublineage/ervDeclareSublineageReferences.js
//
// Declare reference sequences for ERV and LTR sublineage references.
//
// Naming convention:
//   ERV sublineage refs: REF_<erv_lineage.id sanitized>
//   LTR sublineage refs: LTR_REF_<ltr_lineage.id sanitized>
//
// Assumptions:
// - sequence.erv_lineage is set for ERV sublineage reference sequences
// - sequence.ltr_lineage is set for LTR sublineage reference sequences
// - sublineage ERV rows are stored in erv_lineage with entity_level = 'sublineage'
// - one representative sequence per lineage/LTR lineage is expected

var DRY_RUN = false;

// -----------------------------------------------------------------------------
// Basic helpers
// -----------------------------------------------------------------------------

function norm(value) {
	if(value === null || value === undefined) {
		return null;
	}
	var s = ("" + value).trim();
	if(s === "") {
		return null;
	}
	var low = s.toLowerCase();
	if(low === "n/a" || low === "na" || low === "null" || low === "none") {
		return null;
	}
	return s;
}

function log(msg) {
	glue.log("INFO", msg);
}

function sanitizeRefSuffix(name) {
	return ("" + name).replace(/[^A-Za-z0-9]/g, "");
}

function escapeQuotes(value) {
	return ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function queryObjects(cmdWords) {
	return glue.tableToObjects(glue.command(cmdWords));
}

function runCmd(cmdWords) {
	if(DRY_RUN) {
		log("[DRY RUN] " + cmdWords.join(" "));
		return null;
	}
	return glue.command(cmdWords);
}

function referenceExists(refName) {
	var rows = queryObjects([
		"list", "reference",
		"-w", "name = '" + escapeQuotes(refName) + "'"
	]);
	return rows.length > 0;
}

function refNameForLineageId(prefix, lineageId) {
	var clean = sanitizeRefSuffix(lineageId);
	if(clean === "") {
		throw "Could not derive reference name from lineage id: " + lineageId;
	}
	return prefix + clean;
}

// -----------------------------------------------------------------------------
// Generic declaration logic
// -----------------------------------------------------------------------------

function buildLineageToSequenceMap(rows, lineageField) {
	var lineageToRows = {};

	_.each(rows, function(row) {
		var sequenceID = norm(row.sequenceID);
		var sourceName = norm(row["source.name"]);
		var lineageId = norm(row[lineageField]);

		if(sequenceID === null || sourceName === null || lineageId === null) {
			return;
		}

		if(!lineageToRows[lineageId]) {
			lineageToRows[lineageId] = [];
		}

		lineageToRows[lineageId].push({
			lineageId: lineageId,
			sequenceID: sequenceID,
			sourceName: sourceName
		});
	});

	return lineageToRows;
}

function chooseRepresentative(rowList) {
	if(rowList.length === 1) {
		return rowList[0];
	}

	var exact = _.filter(rowList, function(row) {
		return row.sequenceID === row.lineageId;
	});
	if(exact.length === 1) {
		return exact[0];
	}

	var sorted = rowList.slice().sort(function(a, b) {
		var aKey = a.sourceName + "/" + a.sequenceID;
		var bKey = b.sourceName + "/" + b.sequenceID;
		return aKey.localeCompare(bKey);
	});
	return sorted[0];
}

function declareReferences(config) {
	var rows = queryObjects(config.query);
	log("Loaded " + rows.length + " " + config.label + " sequence rows");

	var lineageToRows = buildLineageToSequenceMap(rows, config.lineageField);
	var lineageIds = _.keys(lineageToRows).sort();

	_.each(lineageIds, function(lineageId) {
		var candidates = lineageToRows[lineageId];

		if(candidates.length > 1) {
			throw "Multiple " + config.label + " reference sequences found for lineage '" + lineageId + "'";
		}

		var chosen = chooseRepresentative(candidates);
		var refName = refNameForLineageId(config.refPrefix, lineageId);

		if(referenceExists(refName)) {
			log("Reference already exists: " + refName + " -> " +
				chosen.sourceName + "/" + chosen.sequenceID);
			return;
		}

		runCmd(["create", "reference", refName, chosen.sourceName, chosen.sequenceID]);
		log("Created " + refName + " from " + chosen.sourceName + "/" + chosen.sequenceID);
	});
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

declareReferences({
	label: "ERV sublineage",
	refPrefix: "REF_",
	lineageField: "erv_lineage.id",
	query: [
		"list", "sequence",
		"sequenceID",
		"source.name",
		"erv_lineage.id",
		"-w", "source.name like 'erv-refseqs-%-sub'",
		"-s", "erv_lineage.id,sequenceID"
	]
});

declareReferences({
	label: "LTR sublineage",
	refPrefix: "LTR_REF_",
	lineageField: "ltr_lineage.id",
	query: [
		"list", "sequence",
		"sequenceID",
		"source.name",
		"ltr_lineage.id",
		"-w", "source.name like 'ltr_refseqs_erv%_sublineage'",
		"-s", "ltr_lineage.id,sequenceID"
	]
});