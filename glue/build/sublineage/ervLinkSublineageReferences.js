/**
 * Populate lineage-side custom tables from ERV reference sources.
 *
 * Behaviour:
 * - For sources matching 'erv-refseqs-*' except 'erv-refseqs-ltr':
 *     create/find erv_lineage rows and link sequences to them
 * - For source 'erv-refseqs-ltr':
 *     create/find ltr_lineage rows and link sequences to them
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

function listErvReferenceSources() {
    var sourceObjs = glue.tableToObjects(glue.command(["list", "source"]));

    return _.chain(sourceObjs)
        .map(function(source) { return source.name; })
        .filter(function(sourceName) {
            return /^erv-refseqs-/.test(sourceName);
        })
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
    var isLtrSource = (sourceName === "erv-refseqs-ltr");
    var targetTable = isLtrSource ? "ltr_lineage" : "erv_lineage";
    var targetLink = isLtrSource ? "ltr_lineage" : "erv_lineage";
    var refType = isLtrSource ? "LTR" : "ERV";

    var seqIds = listSequenceIdsForSource(sourceName);

    log("Processing source " + sourceName +
        " (" + seqIds.length + " sequences; targetTable=" + targetTable + ")");

    _.each(seqIds, function(seqId) {
        createCustomRowIfMissing(targetTable, seqId);

        // Optional: populate reftype if field exists on target table
        glue.inMode("custom-table-row/" + targetTable + "/" + seqId, function() {
            try {
                glue.command(["set", "field", "reftype", refType]);
            } catch (e) {
                // ignore if field absent or not wanted yet
            }
        });

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
var ervSources = listErvReferenceSources();
_.each(ervSources, processSource);