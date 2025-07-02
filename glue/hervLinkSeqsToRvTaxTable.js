/**
 * This script links ERV locus sequences to taxonomy rows in `rv_taxonomy`,
 * based on lineage-level classifications (i.e. `Level == 'Lineage'`).
 *
 * It assumes:
 * - `sequenceID` refers to an ERV locus
 * - `Classification` contains the name of the ERV lineage (and matches the `rv_taxonomy` row ID)
 */

var inputPath = "tabular/herv_locus_data.tsv";
var tableObjs = [];

// Load TSV data using tabularUtility module
glue.inMode("module/tabularUtility", function() {
    tableObjs = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
});

// Counters
var linkedCount = 0;
var missingCount = 0;

_.each(tableObjs, function(row) {
    var level = row.Level || "";
    var classification = row.Classification;
    var sequenceID = row.sequenceID;

    if(level === "Lineage" && classification && sequenceID) {
        // Check that the taxonomy row exists with row ID == classification
        try {
            glue.command(["show", "custom-table-row", "rv_taxonomy", classification]);
        } catch (e) {
            glue.log("WARNING", "Missing taxonomy entry for lineage: '" + classification +
                               "' (sequenceID: " + sequenceID + ")");
            missingCount++;
            return;
        }

        // Link the locus sequence to the taxonomy row
        try {
            glue.inMode("sequence/" + sequenceID, function() {
                glue.command([
                    "set", "link-target",
                    "rv_taxonomy", "custom-table-row/rv_taxonomy/" + classification
                ]);
            });
            linkedCount++;
        } catch (e) {
            glue.log("WARNING", "Failed to link locus sequence: " + sequenceID +
                                 " to taxonomy row: " + classification);
            missingCount++;
        }
    }
});

glue.log("INFO", "Linking complete. Sequences linked: " + linkedCount + ", skipped: " + missingCount);
