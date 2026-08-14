/*
 * lineageSummaryExporter.js
 *
 * Generate a compact summary table of ERV lineages for the NAR paper.
 *
 * Output columns:
 *
 *   Lineage
 *   Classification
 *   Aliases
 *   LTRs
 *   Proviral loci
 *   Solo LTR loci
 *
 * Solo LTRs are identified from erv_locus_candidate_name.missillac_id:
 *
 *   ERV-1.Zeta.FRD.1-358(LTR)  -> solo LTR
 *   ERV-1.Zeta.FRD.1-354       -> proviral locus
 */


function previewLineageSummary() {

    /*
     * ------------------------------------------------------------
     * Load lineages
     * ------------------------------------------------------------
     */

    var lineageResult = glue.command([
        "list", "custom-table-row", "erv_lineage",
        "-s", "standard_id",
        "id",
        "standard_id",
        "rv_clade.id",
        "rv_genus.id",
        "rv_subgenus.id"
    ]);

    lineageResult.listResult.column = [
        "id",
        "standardId",
        "clade",
        "group",
        "subgroup"
    ];

    var lineages = glue.tableToObjects(lineageResult);


    /*
     * ------------------------------------------------------------
     * Load aliases
     * ------------------------------------------------------------
     */

    var aliasResult = glue.command([
        "list", "custom-table-row", "erv_lineage_alias",
        "erv_lineage.id",
        "alias_name"
    ]);

    aliasResult.listResult.column = [
        "lineageId",
        "aliasName"
    ];

    var aliasRows = glue.tableToObjects(aliasResult);

    var aliasesByLineage = {};

    for(var i = 0; i < aliasRows.length; i++) {

        var aliasRow = aliasRows[i];

        if(aliasRow.lineageId == null || aliasRow.aliasName == null) {
            continue;
        }

        if(aliasesByLineage[aliasRow.lineageId] == null) {
            aliasesByLineage[aliasRow.lineageId] = [];
        }

        addUnique(
            aliasesByLineage[aliasRow.lineageId],
            aliasRow.aliasName
        );
    }


    /*
     * ------------------------------------------------------------
     * Load associated LTR lineages
     * ------------------------------------------------------------
     */

    var ltrResult = glue.command([
        "list", "custom-table-row", "erv_lineage_ltr_assoc",
        "erv_lineage.id",
        "ltr_lineage.original_name"
    ]);

    ltrResult.listResult.column = [
        "lineageId",
        "ltrName"
    ];

    var ltrRows = glue.tableToObjects(ltrResult);

    var ltrsByLineage = {};

    for(var i = 0; i < ltrRows.length; i++) {

        var ltrRow = ltrRows[i];

        if(ltrRow.lineageId == null || ltrRow.ltrName == null) {
            continue;
        }

        if(ltrsByLineage[ltrRow.lineageId] == null) {
            ltrsByLineage[ltrRow.lineageId] = [];
        }

        addUnique(
            ltrsByLineage[ltrRow.lineageId],
            ltrRow.ltrName
        );
    }


    /*
     * ------------------------------------------------------------
     * Load staged locus names and count proviral / solo-LTR loci
     * ------------------------------------------------------------
     */

    var locusResult = glue.command([
        "list", "custom-table-row", "erv_locus_candidate_name",
        "standard_id",
        "missillac_id"
    ]);

    locusResult.listResult.column = [
        "standardId",
        "missillacId"
    ];

    var locusRows = glue.tableToObjects(locusResult);

    var countsByLineage = {};

    for(var i = 0; i < locusRows.length; i++) {

        var locusRow = locusRows[i];

        if(locusRow.standardId == null ||
                locusRow.missillacId == null) {
            continue;
        }

        if(countsByLineage[locusRow.standardId] == null) {
            countsByLineage[locusRow.standardId] = {
                proviral: 0,
                soloLtr: 0
            };
        }

        if(endsWith(locusRow.missillacId, "(LTR)")) {
            countsByLineage[locusRow.standardId].soloLtr++;
        } else {
            countsByLineage[locusRow.standardId].proviral++;
        }
    }


    /*
     * ------------------------------------------------------------
     * Assemble output objects
     * ------------------------------------------------------------
     */

    var outputRows = [];

    for(var i = 0; i < lineages.length; i++) {

        var lineage = lineages[i];

        /*
         * Classification
         */
        var classificationParts = [];

        if(lineage.clade != null && lineage.clade != "") {
            classificationParts.push(lineage.clade);
        }

        if(lineage.group != null && lineage.group != "") {
            classificationParts.push(lineage.group);
        }

        if(lineage.subgroup != null && lineage.subgroup != "") {
            classificationParts.push(lineage.subgroup);
        }

        var classification = classificationParts.join(", ");


        /*
         * Aliases
         */
        var aliases = aliasesByLineage[lineage.id];

        if(aliases == null) {
            aliases = [];
        }

        aliases.sort();

        var aliasesString = aliases.join(", ");


        /*
         * Linked LTRs
         */
        var ltrs = ltrsByLineage[lineage.id];

        if(ltrs == null) {
            ltrs = [];
        }

        ltrs.sort();

        var ltrsString = ltrs.join(", ");


        /*
         * Locus counts
         */
        var proviralCount = 0;
        var soloLtrCount = 0;

        var counts = countsByLineage[lineage.standardId];

        if(counts != null) {
            proviralCount = counts.proviral;
            soloLtrCount = counts.soloLtr;
        }


        /*
         * tableFromObjectsResultType expects an array
         * containing ordinary JavaScript objects.
         */
        outputRows.push({
            "Lineage": lineage.standardId,
            "Classification": classification,
            "Aliases": aliasesString,
            "LTRs": ltrsString,
            "Proviral loci": proviralCount,
            "Solo LTR loci": soloLtrCount
        });
    }

    return outputRows;
}

function exportLineageSummary(fileName) {

    /*
     * Get the same array of objects used by the preview function.
     */
    var summaryRows = previewLineageSummary();

    var columns = [
        "Lineage",
        "Classification",
        "Aliases",
        "LTRs",
        "Proviral loci",
        "Solo LTR loci"
    ];

    /*
     * Convert our objects into the standard GLUE table-result
     * representation expected by save-tabular.
     */
    var rows = [];

    for(var i = 0; i < summaryRows.length; i++) {

        var summary = summaryRows[i];

        rows.push({
            "value": [
                summary["Lineage"],
                summary["Classification"],
                summary["Aliases"],
                summary["LTRs"],
                summary["Proviral loci"],
                summary["Solo LTR loci"]
            ]
        });
    }

    /*
     * save-tabular expects tabularData to contain exactly one
     * child element. Here we call that child "lineageSummary".
     *
     * The child contains the conventional GLUE table-result
     * column / row structure.
     */
    var tabularData = {
        "lineageSummary": {
            "column": columns,
            "row": rows
        }
    };

    var saveResult;

    glue.inMode("module/tabularUtility", function() {

        saveResult = glue.command({
            "save-tabular": {
                "fileName": fileName,
                "tabularData": tabularData
            }
        });

    });

    return summaryRows;
}


function allLineageSummariesAsObjects() {

    return {
        allLineageSummariesAsObjects: {
            lineages: glue.tableToObjects(
                previewLineageSummary()
            )
        }
    };

}



/*
 * ------------------------------------------------------------
 * Utility functions
 * ------------------------------------------------------------
 */


function addUnique(array, value) {

    for(var i = 0; i < array.length; i++) {

        if(array[i] == value) {
            return;
        }

    }

    array.push(value);
}



function endsWith(value, suffix) {

    if(value == null || suffix == null) {
        return false;
    }

    if(suffix.length > value.length) {
        return false;
    }

    return value.substring(
        value.length - suffix.length
    ) == suffix;
}



function makeRows(rows) {

    var resultRows = [];

    for(var i = 0; i < rows.length; i++) {

        resultRows.push({
            value: rows[i]
        });

    }

    return resultRows;
}