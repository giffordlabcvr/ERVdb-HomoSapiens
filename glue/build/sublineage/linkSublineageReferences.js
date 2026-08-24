/**
 * Populate lineage-side custom tables from ERV/LTR sublineage reference sources.
 *
 * Behaviour:
 * - For source 'erv-sub':
 *     create/find erv_lineage rows and link sequences to them
 *     set entity_level = 'sublineage'
 * - For source 'ltr-sub':
 *     create/find ltr_lineage rows and link sequences to them
 *     set entity_level = 'sublineage'
 *
 * Assumes:
 * - sequence -> erv_lineage link exists
 * - sequence -> ltr_lineage link exists
 * - sequence mode path is sequence/<sourceName>/<sequenceID>
 */

function log(msg) {
	glue.logInfo(msg);
}

function escapeQuotes(value) {
	return value.replace(/'/g, "\\'");
}

function customRowExists(tableName, rowId) {
	var result = glue.command([
		"list", "custom-table-row", tableName,
		"-w", "id = '" + escapeQuotes(rowId) + "'"
	]);

	return result.listResult &&
		result.listResult.row &&
		result.listResult.row.length > 0;
}

function createCustomRowIfMissing(tableName, rowId) {
	if(!customRowExists(tableName, rowId)) {
		glue.command(["create", "custom-table-row", tableName, rowId]);
		log("Created " + tableName + "/" + rowId);
	}
}

function setFieldIfExists(tableName, rowId, fieldName, value) {
	try {
		glue.inMode("custom-table-row/" + tableName + "/" + rowId, function() {
			glue.command(["set", "field", fieldName, value]);
		});
	} catch(e) {
		// Field may not exist; ignore.
	}
}

function isErvSublineageSource(sourceName) {
	return sourceName === "erv-sub";
}

function isLtrSublineageSource(sourceName) {
	return sourceName === "ltr-sub";
}

function listSublineageReferenceSources() {
	var sourceObjs = glue.tableToObjects(glue.command(["list", "source"]));

	return _.chain(sourceObjs)
		.map(function(source) { return source.name; })
		.filter(function(sourceName) {
			return isErvSublineageSource(sourceName) ||
				isLtrSublineageSource(sourceName);
		})
		.sortBy(function(sourceName) { return sourceName; })
		.value();
}

function listSequenceIdsForSource(sourceName) {
	var result = glue.command([
		"list", "sequence",
		"-w", "source.name = '" + escapeQuotes(sourceName) + "'"
	]);

	return glue.getTableColumn(result, "sequenceID");
}

function processSource(sourceName) {

	var isLtrSource = isLtrSublineageSource(sourceName);

	var targetTable = isLtrSource ? "ltr_lineage" : "erv_lineage";
	var targetLink = isLtrSource ? "ltr_lineage" : "erv_lineage";
	var refType = isLtrSource ? "LTR_SUBLINEAGE" : "ERV_SUBLINEAGE";

	var seqIds = listSequenceIdsForSource(sourceName);

	log("Processing source " + sourceName +
		" (" + seqIds.length + " sequences; targetTable=" + targetTable + ")");

	_.each(seqIds, function(seqId) {

		createCustomRowIfMissing(targetTable, seqId);

		if(isLtrSource) {
			setFieldIfExists("ltr_lineage", seqId, "reftype", refType);
			setFieldIfExists("ltr_lineage", seqId, "entity_level", "sublineage");
		} else {
			setFieldIfExists("erv_lineage", seqId, "reftype", refType);
			setFieldIfExists("erv_lineage", seqId, "entity_level", "sublineage");
		}

		glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
			glue.command([
				"set", "link-target",
				targetLink,
				"custom-table-row/" + targetTable + "/" + seqId
			]);
		});
	});
}

// Run
var sublineageSources = listSublineageReferenceSources();

log("Found " + sublineageSources.length + " sublineage reference sources");

_.each(sublineageSources, processSource);
