// legacyLocusImporter.js

var LOCUS_TABLE = "erv_locus";
var XREF_TABLE = "erv_locus_legacy_xref";
var AGE_CAL_TABLE = "erv_age_calibration";
var ORTHO_CAL_TABLE = "erv_age_calibration_orthology";

function esc(str) {
	if(str == null) { return ""; }
	return (""+str).replace(/'/g, "''");
}

function clean(str) {
	if(str == null) { return null; }
	var s = (""+str).replace(/^\s+|\s+$/g, "");
	if(s === "" || s.toLowerCase() === "null") {
		return null;
	}
	return s;
}

function boolArg(value) {
	if(value == null) { return false; }
	var s = (""+value).toLowerCase();
	return s === "true" || s === "t" || s === "yes" || s === "y" || s === "1";
}

function safeId(str) {
	return (""+str)
		.replace(/[^A-Za-z0-9_.-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function rowList(result) {
	if(result && result.listResult && result.listResult.row) {
		return result.listResult.row;
	}
	return [];
}

function getField(row, names) {
	for(var i = 0; i < names.length; i++) {
		var value = clean(row[names[i]]);
		if(value != null) { return value; }
	}
	return null;
}

function normaliseOrientation(value) {
	value = clean(value);
	if(value == null) { return null; }
	if(value === "positive" || value === "+" || value === "(+)") { return "+"; }
	if(value === "negative" || value === "-" || value === "(-)") { return "-"; }

	return value;
}




function overlapBp(aStart, aEnd, bStart, bEnd) {
	var s = Math.max(aStart, bStart);
	var e = Math.min(aEnd, bEnd);
	return e < s ? 0 : e - s + 1;
}

function customTableRowExists(tableName, rowId) {
	var rows = rowList(glue.command([
		"list", "custom-table-row", tableName,
		"-w", "id = '" + esc(rowId) + "'"
	]));
	return rows.length > 0;
}

function createCustomTableRowIfNeeded(tableName, rowId) {
	if(!customTableRowExists(tableName, rowId)) {
		glue.command(["create", "custom-table-row", tableName, rowId]);
	}
}

function setFieldIfNotNull(fieldName, value) {
	value = clean(value);
	if(value != null) {
		glue.command(["set", "field", fieldName, ""+value]);
	}
}

function normaliseLegacyRow(row) {

	var organism = getField(row, ["organism", "host_species"]);
	var assembly = getField(row, ["assembly", "genome_build"]);

	var approvedName = getField(row, ["approved_name"]);
	var approvedSymbol = getField(row, ["approved_symbol"]);

	var aliasSymbol = getField(row, [
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

	var sourceNumericId = getField(row, [
		"source_numeric_id",
		"mnenomic-number",
		"mnemonic-number",
		"numeric_id"
	]);

	var scaffold = getField(row, ["scaffold", "chromosome", "chr", "Chr"]);
	var start = parseInt(getField(row, ["start", "start_position", "extract_start", "Start"]));
	var end = parseInt(getField(row, ["end", "end_position", "extract_end", "End"]));

	var orientation = normaliseOrientation(getField(row, ["strand", "orientation", "Orientation"]));
	var extra = getField(row, ["extra", "source_note"]);

	var sourceBand = getField(row, [
		"source_band",
		"band",
		"Locus",
		"Chr. band",
		"chromosome_location"
	]);

	var orthology = getField(row, [
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

	if(legacyName == null) {
		if(approvedSymbol != null) {
			legacyName = approvedSymbol;
		} else if(approvedName != null) {
			legacyName = approvedName;
		} else if(legacyClassification != null && sourceNumericId != null) {
			legacyName = legacyClassification + "_" + sourceNumericId;
		} else {
			var parts = [];
			if(legacyClassification != null) { parts.push(legacyClassification); }
			if(sourceNumericId != null) { parts.push(sourceNumericId); }
			if(scaffold != null) { parts.push(scaffold); }
			if(!isNaN(start)) { parts.push(""+start); }
			if(!isNaN(end)) { parts.push(""+end); }
			legacyName = parts.join("_");
		}
	}

	if(extra != null) {
		legacyName = legacyName + "_" + extra;
	}

	return {
		legacyName: legacyName,
		hostSpecies: organism,
		genomeBuild: assembly,
		legacyClassification: legacyClassification,
		sourceNumericId: sourceNumericId,
		sourceAliases: aliasSymbol,
		sourceBand: sourceBand,
		sourceNote: extra,
		scaffold: scaffold,
		start: start,
		end: end,
		orientation: orientation,
		sourceOrthology: orthology
	};

}

function validateRowContext(normRow, hostSpecies, genomeBuild) {
	if(normRow.hostSpecies != null && normRow.hostSpecies !== hostSpecies) {
		throw "Input row host species '" + normRow.hostSpecies +
			"' does not match requested host species '" + hostSpecies + "'";
	}
	if(normRow.genomeBuild != null && normRow.genomeBuild !== genomeBuild) {
		throw "Input row assembly '" + normRow.genomeBuild +
			"' does not match requested assembly '" + genomeBuild + "'";
	}
}

function hashString(str) {
	var hash = 0;
	if(str == null) {
		str = "";
	}
	str = ""+str;
	for(var i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash) + str.charCodeAt(i);
		hash = hash & hash;
	}
	if(hash < 0) {
		hash = -hash;
	}
	return ""+hash;
}

function makeXrefId(legacySource, normRow, rowIndex) {
	var sourceHash = hashString(legacySource);
	var rowPart = "" + (rowIndex + 1);

	var coordPart = "";
	if(normRow.scaffold != null && !isNaN(normRow.start)) {
		coordPart = "_" + safeId(normRow.scaffold) + "_" + normRow.start;
	}

	var id = "lx_" + sourceHash + "_" + rowPart + coordPart;

	// GLUE custom table row IDs are short; keep safely below 50 chars.
	if(id.length > 45) {
		id = "lx_" + sourceHash + "_" + rowPart;
	}

	return id;
}

function findBestLocusMatch(normRow, hostSpecies, genomeBuild) {

	var whereClause =
		"host_species = '" + esc(hostSpecies) + "' and " +
		"genome_build = '" + esc(genomeBuild) + "' and " +
		"scaffold = '" + esc(normRow.scaffold) + "' and " +
		normRow.start + " <= end_position and " +
		normRow.end + " >= start_position";

	var result = glue.command([
		"list", "custom-table-row", LOCUS_TABLE,
		"--whereClause", whereClause,
		"id", "start_position", "end_position"
	]);

	var rows = rowList(result);

	if(rows.length === 0) {
		return {
			status: "unmatched",
			method: "coordinate_overlap",
			locusId: null,
			matchCount: 0
		};
	}

	var best = null;
	var bestOverlap = 0;

	for(var i = 0; i < rows.length; i++) {
		var values = rows[i].value;
		var locusId = values[0];
		var locusStart = parseInt(values[1]);
		var locusEnd = parseInt(values[2]);
		var ov = overlapBp(normRow.start, normRow.end, locusStart, locusEnd);

		if(ov > bestOverlap) {
			bestOverlap = ov;
			best = { locusId: locusId, overlap: ov };
		}
	}

	if(best == null) {
		return {
			status: "ambiguous",
			method: "coordinate_overlap",
			locusId: null,
			matchCount: rows.length
		};
	}

	return {
		status: rows.length === 1 ? "mapped" : "mapped_multiple_overlaps",
		method: "coordinate_overlap",
		locusId: best.locusId,
		matchCount: rows.length
	};
}

function createOrUpdateXref(xrefId, normRow, legacySource, pubmedId, hostSpecies, genomeBuild, match) {

	createCustomTableRowIfNeeded(XREF_TABLE, xrefId);

	glue.inMode("custom-table-row/" + XREF_TABLE + "/" + xrefId, function() {

		glue.command(["set", "field", "legacy_source", legacySource]);
		glue.command(["set", "field", "legacy_name", normRow.legacyName]);

		setFieldIfNotNull("pubmed_id", pubmedId);

		glue.command(["set", "field", "host_species", hostSpecies]);
		glue.command(["set", "field", "genome_build", genomeBuild]);
		glue.command(["set", "field", "scaffold", normRow.scaffold]);
		glue.command(["set", "field", "start_position", ""+normRow.start]);
		glue.command(["set", "field", "end_position", ""+normRow.end]);

		setFieldIfNotNull("orientation", normRow.orientation);
		setFieldIfNotNull("legacy_classification", normRow.legacyClassification);
		setFieldIfNotNull("source_numeric_id", normRow.sourceNumericId);
		setFieldIfNotNull("source_aliases", normRow.sourceAliases);
		setFieldIfNotNull("source_orthology", normRow.sourceOrthology);
		setFieldIfNotNull("source_note", normRow.sourceNote);
		setFieldIfNotNull("source_band", normRow.sourceBand);

		glue.command(["set", "field", "mapping_status", match.status]);
		glue.command(["set", "field", "mapping_method", match.method]);

		if(match.locusId != null) {
			glue.command([
				"set", "link-target",
				"erv_locus",
				"custom-table-row/erv_locus/" + match.locusId
			]);
		}
	});

	return xrefId;
}

function createOrUpdateOrthologyCalibration(normRow, legacySource, pubmedId, match, xrefId) {

	if(normRow.sourceOrthology == null || match.locusId == null) {
		return null;
	}

	var calId = safeId(
		"orthology_" +
		legacySource + "_" +
		normRow.scaffold + "_" +
		normRow.start + "_" +
		normRow.end + "_" +
		normRow.sourceOrthology
	);

	createCustomTableRowIfNeeded(AGE_CAL_TABLE, calId);

	glue.inMode("custom-table-row/" + AGE_CAL_TABLE + "/" + calId, function() {

		glue.command(["set", "field", "calibration_id", calId]);
		glue.command(["set", "field", "calibrated_entity_type", "erv_locus"]);
		glue.command(["set", "field", "method_type", "orthology"]);
		glue.command(["set", "field", "age_logic", "minimum"]);

		setFieldIfNotNull("pubmed_id", pubmedId);

		glue.command(["set", "field", "source_note", legacySource + ":" + normRow.legacyName]);
		glue.command(["set", "field", "confidence", "source_annotation"]);
		glue.command(["set", "field", "notes", "Derived from source orthology field: " + normRow.sourceOrthology]);

		glue.command(["set", "link-target", "erv_locus", "custom-table-row/erv_locus/" + match.locusId]);
	});

	var orthoId = calId + "_orthology";
	createCustomTableRowIfNeeded(ORTHO_CAL_TABLE, orthoId);

	glue.inMode("custom-table-row/" + ORTHO_CAL_TABLE + "/" + orthoId, function() {

		glue.command(["set", "field", "orthology_type", "shared_insertion"]);
		glue.command(["set", "field", "supporting_clade", normRow.sourceOrthology]);
		glue.command(["set", "field", "calibration_node", normRow.sourceOrthology]);
		glue.command(["set", "field", "calibration_source", legacySource]);
		glue.command(["set", "field", "orthology_evidence", "source_annotation"]);
		glue.command(["set", "field", "evidence_note", "Imported from xref " + xrefId]);

		glue.command(["set", "link-target", "erv_age_calibration","custom-table-row/erv_age_calibration/" + calId]);
	});

	return calId;
}

function loadLegacyLocusFile(inputPath, legacySource, pubmedId, hostSpecies, genomeBuild, createOrthologyCalibrations) {

	var createCalibrations = boolArg(createOrthologyCalibrations);

	var inputRows = [];
	glue.inMode("module/tabularUtility", function() {
		inputRows = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
	});

	var outputRows = [];

	for(var i = 0; i < inputRows.length; i++) {

		var normRow = normaliseLegacyRow(inputRows[i]);

		if(normRow.legacyName == null || normRow.scaffold == null || isNaN(normRow.start) || isNaN(normRow.end)) {
			glue.log("WARNING", "Skipping malformed legacy row at index " + i);
			continue;
		}

		validateRowContext(normRow, hostSpecies, genomeBuild);

		var match = findBestLocusMatch(normRow, hostSpecies, genomeBuild);
		var xrefId = makeXrefId(legacySource, normRow, i);

		createOrUpdateXref(
			xrefId,
			normRow,
			legacySource,
			pubmedId,
			hostSpecies,
			genomeBuild,
			match
		);

		var calibrationId = null;
		if(createCalibrations) {
			calibrationId = createOrUpdateOrthologyCalibration(
				normRow,
				legacySource,
				pubmedId,
				match,
				xrefId
			);
		}

		outputRows.push({
			legacy_source: legacySource,
			legacy_name: normRow.legacyName,
			scaffold: normRow.scaffold,
			start: normRow.start,
			end: normRow.end,
			source_orthology: normRow.sourceOrthology,
			mapping_status: match.status,
			mapping_method: match.method,
			matched_locus: match.locusId,
			match_count: match.matchCount,
			xref_id: xrefId,
			calibration_id: calibrationId
		});
	}

	return outputRows;
}

function clearLegacySource(legacySource) {

	var rows = rowList(glue.command([
		"list", "custom-table-row", XREF_TABLE,
		"-w", "legacy_source = '" + esc(legacySource) + "'",
		"id"
	]));

	for(var i = 0; i < rows.length; i++) {
		var rowId = rows[i].value[0];
		glue.command(["delete", "custom-table-row", XREF_TABLE, rowId]);
	}

	return [{
		legacy_source: legacySource,
		deleted_xref_rows: rows.length
	}];


}