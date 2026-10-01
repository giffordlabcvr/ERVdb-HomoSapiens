// glue/export/exportErvAgeCalibrationsForNavigator.js

var OUTPUT_PATH = "web-app/erv_navigator_age_calibrations.tsv";

var PARENT_FIELDS = [
	"id",
	"calibration_id",
	"calibrated_entity_type",
	"method_type",
	"age_logic",
	"age_mya",
	"age_younger_bound_mya",
	"age_older_bound_mya",
	"pubmed_id",
	"source_note",
	"confidence",
	"notes"
];

var LTR_FIELDS = [
	"id",
	"reported_locus_name",
	"observed_divergence",
	"corrected_divergence",
	"divergence_units"
];

var EXPORT_FIELDS = [
	"calibration_id",
	"lineage_id",
	"calibrated_entity_type",
	"method_type",
	"age_logic",
	"age_mya",
	"age_younger_bound_mya",
	"age_older_bound_mya",
	"pubmed_id",
	"source_note",
	"confidence",
	"reported_locus_name",
	"observed_divergence",
	"corrected_divergence",
	"divergence_units",
	"notes"
];

function tableRows(tableName, fields) {
	return glue.tableToObjects(
		glue.command(["list", "custom-table-row", tableName].concat(fields))
	);
}

function norm(value) {
	if(value === null || value === undefined) return "";
	var s = "" + value;
	if(s === "-") return "";
	return s;
}

function tsvEscape(value) {
	value = norm(value);
	value = value.replace(/\t/g, " ");
	value = value.replace(/\r?\n/g, " ");
	return value;
}

function indexById(rows) {
	var map = {};
	_.each(rows, function(row) {
		map[row["id"]] = row;
	});
	return map;
}

function inferLineageId(calibrationId) {
	if(calibrationId.indexOf("LTRCLOCK_") === 0) {
		return calibrationId.substring("LTRCLOCK_".length);
	}
	if(calibrationId.indexOf("ORTHO_") === 0) {
		return calibrationId.substring("ORTHO_".length);
	}
	return "";
}

var parentRows = tableRows("erv_age_calibration", PARENT_FIELDS);
var ltrRows = tableRows("erv_age_calibration_ltr_clock", LTR_FIELDS);
var ltrById = indexById(ltrRows);

var FileWriter = Java.type("java.io.FileWriter");
var BufferedWriter = Java.type("java.io.BufferedWriter");

var writer = new BufferedWriter(new FileWriter(OUTPUT_PATH));

writer.write(EXPORT_FIELDS.join("\t"));
writer.newLine();

_.each(parentRows, function(parent) {

	var calId = norm(parent["calibration_id"]);
	if(calId === "") {
		calId = norm(parent["id"]);
	}

	var ltr = ltrById[parent["id"]] || {};

	var out = {
		"calibration_id": calId,
		"lineage_id": inferLineageId(calId),
		"calibrated_entity_type": parent["calibrated_entity_type"],
		"method_type": parent["method_type"],
		"age_logic": parent["age_logic"],
		"age_mya": parent["age_mya"],
		"age_younger_bound_mya": parent["age_younger_bound_mya"],
		"age_older_bound_mya": parent["age_older_bound_mya"],
		"pubmed_id": parent["pubmed_id"],
		"source_note": parent["source_note"],
		"confidence": parent["confidence"],
		"reported_locus_name": ltr["reported_locus_name"],
		"observed_divergence": ltr["observed_divergence"],
		"corrected_divergence": ltr["corrected_divergence"],
		"divergence_units": ltr["divergence_units"],
		"notes": parent["notes"]
	};

	writer.write(_.map(EXPORT_FIELDS, function(fieldName) {
		return tsvEscape(out[fieldName]);
	}).join("\t"));
	writer.newLine();
});

writer.close();

glue.logInfo("Exported " + parentRows.length + " ERV age calibration rows to " + OUTPUT_PATH);

