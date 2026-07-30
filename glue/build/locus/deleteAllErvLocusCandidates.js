// glue/build/locus/deleteAllErvLocusCandidates.js
//
// Delete every row from the erv_locus_candidate custom table.

var TABLE_NAME = "erv_locus_candidate";
var DRY_RUN = false;

function log(msg) {
    glue.logInfo(msg);
}

var result = glue.command([
    "list",
    "custom-table-row",
    TABLE_NAME
]);

var rows = result.listResult.row || [];

log("Found " + rows.length + " rows.");

_.each(rows, function(row) {

    var rowId = row.value[0]; // first column is id

    if(DRY_RUN) {
        log("Would delete: " + rowId);
    } else {
        glue.command([
            "delete",
            "custom-table-row",
            TABLE_NAME,
            rowId
        ]);
    }

});

if(DRY_RUN) {
    log("Dry run complete.");
} else {
    log("Deleted " + rows.length + " rows.");
}

