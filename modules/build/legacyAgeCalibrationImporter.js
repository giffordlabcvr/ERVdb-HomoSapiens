// legacyAgeCalibrationImporter.js
//
// Import Grandi HML6 age estimates after locus xrefs have already been loaded.
//
// Expected dates table columns include:
//   legacy_name
//   source_band
//   divergence between LTRs
//   LTR vs LTR Age
//   Mean Divergences
//   gene vs consensus age
//   age avg
//   Standard Deviation
//   %SD
//
// Requires prior xrefs:
//   erv_locus_legacy_xref.legacy_source = grandi_hml6_hg19

var XREF_TABLE = "erv_locus_legacy_xref";
var AGE_CAL_TABLE = "erv_age_calibration";
var LTR_CLOCK_TABLE = "erv_age_calibration_ltr_clock";
var CONS_CLOCK_TABLE = "erv_age_calibration_consensus_clock";

function esc(str) {
	if(str == null) { return ""; }
	return (""+str).replace(/'/g, "''");
}

function clean(str) {
	if(str == null) { return null; }
	var s = (""+str).replace(/^\s+|\s+$/g, "");
	if(s === "" || s.toLowerCase() === "null" || s === "-") {
		return null;
	}
	return s;
}

function safeId(str) {
	return (""+str)
		.replace(/[^A-Za-z0-9_.-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function parseDoubleOrNull(value) {
	value = clean(value);
	if(value == null) { return null; }
	value = value.replace(/,/g, "");
	var d = parseFloat(value);
	return isNaN(d) ? null : d;
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

function createCustomTableRowIfNeeded(tableName, rowId) {
	var rows = rowList(glue.command([
		"list", "custom-table-row", tableName,
		"-w", "id = '" + esc(rowId) + "'",
		"id"
	]));
	if(rows.length === 0) {
		glue.command(["create", "custom-table-row", tableName, rowId]);
	}
}

function setFieldIfNotNull(fieldName, value) {
	value = clean(value);
	if(value != null) {
		glue.command(["set", "field", fieldName, ""+value]);
	}
}

function setDoubleFieldIfNotNull(fieldName, value) {
	if(value != null) {
		glue.command(["set", "field", fieldName, ""+value]);
	}
}

function getMappedXref(legacySource, legacyName, sourceBand) {

	var rows = rowList(glue.command([
		"list", "custom-table-row", XREF_TABLE,
		"-w",
		"legacy_source = '" + esc(legacySource) + "' and legacy_name = '" + esc(legacyName) + "'",
		"id", "mapping_status", "source_band", "erv_locus.id"
	]));

	if(rows.length !== 1) {
		throw "Expected exactly one xref for " + legacySource + ":" + legacyName +
			", found " + rows.length;
	}

	var values = rows[0].value;

	var xrefId = values[0];
	var mappingStatus = values[1];
	var xrefSourceBand = values[2];
	var ervLocusId = values[3];

	if(mappingStatus !== "mapped") {
		throw "Xref " + xrefId + " is not mapped; mapping_status=" + mappingStatus;
	}

	if(ervLocusId == null || ervLocusId === "") {
		throw "Xref " + xrefId + " has no linked erv_locus";
	}

	if(sourceBand != null && xrefSourceBand != null && sourceBand !== xrefSourceBand) {
		throw "Source band mismatch for " + legacyName +
			": dates table has " + sourceBand +
			", xref has " + xrefSourceBand;
	}

	return {
		xrefId: xrefId,
		ervLocusId: ervLocusId
	};
}

function makeCalibrationId(prefix, legacySource, legacyName) {
	var id = safeId(prefix + "_" + legacySource + "_" + legacyName);
	if(id.length > 45) {
		id = safeId(prefix + "_" + legacyName);
	}
	if(id.length > 45) {
		id = id.substring(0, 45);
	}
	return id;
}

function createParentCalibration(calId, ervLocusId, pubmedId, methodType, ageMya, sourceNote, confidence, notes) {

	createCustomTableRowIfNeeded(AGE_CAL_TABLE, calId);

	glue.inMode("custom-table-row/" + AGE_CAL_TABLE + "/" + calId, function() {

		glue.command(["set", "field", "calibration_id", calId]);
		glue.command(["set", "field", "calibrated_entity_type", "erv_locus"]);
		glue.command(["set", "field", "method_type", methodType]);
		glue.command(["set", "field", "age_logic", "point_estimate"]);

		setDoubleFieldIfNotNull("age_mya", ageMya);
		setFieldIfNotNull("pubmed_id", pubmedId);
		setFieldIfNotNull("source_note", sourceNote);
		setFieldIfNotNull("confidence", confidence);
		setFieldIfNotNull("notes", notes);

		glue.command([
			"set", "link-target",
			"erv_locus",
			"custom-table-row/erv_locus/" + ervLocusId
		]);
	});
}

function createLtrClockDetails(calId, legacyName, ltrDivergence) {

	var detailId = calId + "_detail";

	createCustomTableRowIfNeeded(LTR_CLOCK_TABLE, detailId);

	glue.inMode("custom-table-row/" + LTR_CLOCK_TABLE + "/" + detailId, function() {

		glue.command(["set", "field", "locus_identifier", legacyName]);
		setDoubleFieldIfNotNull("ltr_divergence", ltrDivergence);
		glue.command(["set", "field", "substitution_rate", "0.002"]);
		glue.command(["set", "field", "rate_units", "substitutions/site/Myr"]);
		glue.command(["set", "field", "correction_model", "Kimura two-parameter"]);
		glue.command(["set", "field", "clock_note", "T = D / 0.2 / 2; CpG dinucleotides excluded"]);

		glue.command([
			"set", "link-target",
			"erv_age_calibration",
			"custom-table-row/erv_age_calibration/" + calId
		]);
	});
}

function createConsensusClockDetails(calId, legacyName, meanDivergence, note) {

	var detailId = calId + "_detail";

	createCustomTableRowIfNeeded(CONS_CLOCK_TABLE, detailId);

	glue.inMode("custom-table-row/" + CONS_CLOCK_TABLE + "/" + detailId, function() {

		glue.command(["set", "field", "query_identifier", legacyName]);
		glue.command(["set", "field", "consensus_identifier", "Grandi_HML6_type_subtype_consensus"]);
		setDoubleFieldIfNotNull("divergence_from_consensus", meanDivergence);
		glue.command(["set", "field", "substitution_rate", "0.002"]);
		glue.command(["set", "field", "rate_units", "substitutions/site/Myr"]);
		glue.command(["set", "field", "correction_model", "Kimura two-parameter"]);
		glue.command(["set", "field", "clock_note", note]);

		glue.command([
			"set", "link-target",
			"erv_age_calibration",
			"custom-table-row/erv_age_calibration/" + calId
		]);
	});
}

function importGrandiHml6Dates(inputPath, legacySource, pubmedId) {

	var inputRows = [];
	glue.inMode("module/tabularUtility", function() {
		inputRows = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
	});

	var outputRows = [];

	for(var i = 0; i < inputRows.length; i++) {

		var row = inputRows[i];

		var legacyName = getField(row, ["legacy_name", "legacyName"]);
		var sourceBand = getField(row, ["source_band", "band"]);

		if(legacyName == null) {
			glue.log("WARNING", "Skipping row " + i + ": no legacy_name");
			continue;
		}

		var mapped = getMappedXref(legacySource, legacyName, sourceBand);

		var ltrDiv = parseDoubleOrNull(getField(row, ["divergence between LTRs"]));
		var ltrAge = parseDoubleOrNull(getField(row, ["LTR vs LTR Age"]));

		var meanDiv = parseDoubleOrNull(getField(row, ["Mean Divergences"]));
		var consensusAge = parseDoubleOrNull(getField(row, ["gene vs consensus age"]));

		var compositeAge = parseDoubleOrNull(getField(row, ["age avg"]));
		var compositeSd = parseDoubleOrNull(getField(row, ["Standard Deviation"]));
		var compositePctSd = parseDoubleOrNull(getField(row, ["%SD"]));

		var created = [];

		if(ltrAge != null) {
			var ltrCalId = makeCalibrationId("age_ltr", legacySource, legacyName);

			createParentCalibration(
				ltrCalId,
				mapped.ervLocusId,
				pubmedId,
				"paired_ltr_clock",
				ltrAge,
				legacySource + ":" + legacyName + ":LTR-LTR",
				"source_estimate",
				"Paired LTR molecular clock estimate from Grandi HML6 table"
			);

			createLtrClockDetails(ltrCalId, legacyName, ltrDiv);
			created.push(ltrCalId);
		}

		if(consensusAge != null) {
			var consCalId = makeCalibrationId("age_cons", legacySource, legacyName);

			var consNote =
				"T = D / 0.2 using mean gene divergence from HML6 type/subtype consensus";

			createParentCalibration(
				consCalId,
				mapped.ervLocusId,
				pubmedId,
				"consensus_clock",
				consensusAge,
				legacySource + ":" + legacyName + ":consensus",
				"source_estimate",
				consNote
			);

			createConsensusClockDetails(consCalId, legacyName, meanDiv, consNote);
			created.push(consCalId);
		}

		if(compositeAge != null && compositePctSd != null && compositePctSd <= 25.0) {
			var compCalId = makeCalibrationId("age_comp", legacySource, legacyName);

			var compNotes =
				"Author final age estimate averaged across methods; SD=" +
				compositeSd + "; percent SD=" + compositePctSd;

			createParentCalibration(
				compCalId,
				mapped.ervLocusId,
				pubmedId,
				"composite_molecular_clock",
				compositeAge,
				legacySource + ":" + legacyName + ":composite",
				"authors_preferred",
				compNotes
			);

			created.push(compCalId);
		}

		outputRows.push({
			legacy_source: legacySource,
			legacy_name: legacyName,
			source_band: sourceBand,
			xref_id: mapped.xrefId,
			erv_locus_id: mapped.ervLocusId,
			created_calibrations: created.join(",")
		});
	}

	return outputRows;
}