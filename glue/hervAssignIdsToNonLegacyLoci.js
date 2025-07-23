// Step 1: Index already-used numbers by cleaned mod_classification
var usedNumbersByLineage = {};

var existing = glue.command([
  "list", "sequence", "sequenceID", "locus_data.erv_locus_id", "mod_classification",
  "-w", "locus_data.assignment_status = 'legacy_assigned'"
]);

existing.listResult.row.forEach(function(row) {
    var locusID = row.value[1];
    var lineage = row.value[2];

    var cleanLineage = lineage.replace(/[^A-Za-z0-9]/g, "");

    var match = locusID.match(/^ERV-[^-\.]+\.([0-9]+)-HomSap$/);
    if (match) {
        var num = parseInt(match[1]);
        if (!(cleanLineage in usedNumbersByLineage)) {
            usedNumbersByLineage[cleanLineage] = {};
        }
        usedNumbersByLineage[cleanLineage][num] = true;
    }
});

// Step 2: Assign to unassigned sequences
var toAssign = glue.command([
  "list", "sequence", "sequenceID", "source.name", "mod_classification",
  "-w", "source.name = 'homo_sapiens' and mod_classification != null and (locus_data.assignment_status != 'legacy_assigned' or locus_data.assignment_status = null)"
]);


toAssign.listResult.row.forEach(function(row) {
    try {
        var sequenceID = row.value[0];
        var sourceName = row.value[1];
        var modClassification = row.value[2];

        var cleanLineage = modClassification.replace(/[^A-Za-z0-9]/g, "");

        if (!(cleanLineage in usedNumbersByLineage)) {
            usedNumbersByLineage[cleanLineage] = {};
        }

        // Find next unused number
        var counter = 1;
        while (usedNumbersByLineage[cleanLineage][counter]) {
            counter++;
        }
        usedNumbersByLineage[cleanLineage][counter] = true;

		lineageCode = modClassification.replace(/-/g, "");
        var newLocusID = "ERV-" + lineageCode + "." + counter + "-HomSap";

        glue.log("INFO", "Assigning: " + sequenceID + " → " + newLocusID);

	   // Set locus ID fields, aliases and HGNC ID on locus_data row
		glue.inMode("custom-table-row/locus_data/" + sequenceID, function() {
	
			glue.command(["set", "field", "erv_locus_id", newLocusID]);
			glue.command(["set", "field", "assignment_status", "assigned"]);
			glue.command(["set", "field", "lineage_id", modClassification]);
			glue.command(["set", "field", "numeric_id", counter]);


		});

    } catch (e) {
        glue.log("WARNING", "Failed to process sequence " + row.value[0] + ": " + e);
    }
});
