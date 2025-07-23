var inputPath = "tabular/legacy-list.tsv";
var tableObjs = [];

// Track used legacy keys to enforce uniqueness
var legacyKeys = {};

glue.inMode("module/tabularUtility", function() {
    tableObjs = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
});

tableObjs.forEach(function(locus) {

    var mnemonic = locus["mnenomic-number"];
    var scaffold = locus["scaffold"].trim();
    var start = parseInt(locus["extract_start"]);
    var end = parseInt(locus["extract_end"]);

    var whereClause =
        "scaffold = '" + scaffold + "' and " +
        start + " <= end_position and " +
        end + " >= start_position";

    var result = glue.command([
        "list", "custom-table-row", "locus_data",
        "--whereClause", whereClause
    ]);

    if ("listResult" in result && "row" in result.listResult) {
        var matches = result.listResult.row;

        if (matches.length === 0) {
            glue.log("WARNING", "No overlapping loci found for: " + JSON.stringify(locus));
        } else {
            var internalID = matches[0].value[0];

            // Determine the source name by finding the sequence that uses this locus
            var seqResult = glue.command([
                "list", "sequence", "source.name",
                "-w", "sequenceID = '" + internalID + "'"
            ]);

            var sourceName = seqResult.listResult.row[0].value[0];

            // Get mod_classification from sequence table
            var lineageCode = null;
            var modClassResult = glue.command([
                "list", "sequence", "mod_classification",
                "-w", "sequenceID = '" + internalID + "' and source.name = '" + sourceName + "'"
            ]);

            if ("listResult" in modClassResult && "row" in modClassResult.listResult && modClassResult.listResult.row.length > 0) {
                var modClassification = modClassResult.listResult.row[0].value[0];
                if (modClassification && modClassification.trim() !== "") {
                    lineageCode = modClassification.trim();
                } else {
                    lineageCode = locus["erv-taxonomic-component"];
                    glue.log("WARNING", "mod_classification is blank for " + internalID + "; falling back to input value: " + lineageCode);
                }
            } else {
                lineageCode = locus["erv-taxonomic-component"];
                glue.log("WARNING", "Could not retrieve mod_classification for " + internalID + "; falling back to input value: " + lineageCode);
            }

            lineageCode = lineageCode.replace(/-/g, "");
            var legacyKey = lineageCode + ":" + mnemonic;

            if (legacyKeys[legacyKey]) {
                glue.log("WARNING", "Skipping duplicate legacy ID: " + legacyKey + " (would become ERV-" + lineageCode + "." + mnemonic + "-HomSap)");
                return;
            }

            legacyKeys[legacyKey] = true;

            var newSeqID = "ERV-" + lineageCode + "." + mnemonic + "-HomSap";
            glue.log("INFO", "Assigning legacy ID " + newSeqID + " to internal ID: " + internalID);

            glue.inMode("custom-table-row/locus_data/" + internalID, function() {

                // Alias assignment
                var approvedSymbol = locus["approved_symbol"];
                var aliasSymbolsRaw = locus["alias_symbol"];
                var aliasSet = {};

                if (approvedSymbol && approvedSymbol.trim() !== "") {
                    aliasSet[approvedSymbol.trim()] = true;
                }

                if (aliasSymbolsRaw && aliasSymbolsRaw.trim() !== "") {
                    var aliasParts = aliasSymbolsRaw.split(",");
                    aliasParts.forEach(function(symbol) {
                        var trimmed = symbol.trim();
                        if (trimmed !== "") {
                            aliasSet[trimmed] = true;
                        }
                    });
                }

                var allAliases = Object.keys(aliasSet).join(", ");
                if (allAliases !== "") {
                    glue.command(["set", "field", "aliases", allAliases]);
                } else {
                    glue.log("FINE", "No alias symbols to set for " + newSeqID);
                }

                // HGNC ID
                var hgncVal = locus["hgnc_id"];
                if (hgncVal) {
                    glue.command(["set", "field", "hgnc_id", hgncVal]);
                }

                // Set fields
                glue.command(["set", "field", "erv_locus_id", newSeqID]);
                glue.command(["set", "field", "assignment_status", "legacy_assigned"]);
                glue.command(["set", "field", "lineage_id", lineageCode]);
                glue.command(["set", "field", "numeric_id", mnemonic]);
            });
        }

    } else {
        glue.log("WARNING", "Unexpected response structure: " + JSON.stringify(result));
    }
});
