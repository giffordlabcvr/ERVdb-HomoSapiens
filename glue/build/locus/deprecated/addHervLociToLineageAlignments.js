// glue/addErvLociToLineageAlignments.js
//
// Add erv_locus rows into AL_LINEAGE_* alignments based on erv_locus.classification.
//
// Assumptions:
// - each erv_locus.classification corresponds to a lineage alignment named:
//     AL_LINEAGE_<classification with non-alphanumerics removed>
// - erv_locus rows are linked to sequences which can be added as alignment members
// - lineage alignments have already been declared
//
// Example:
//   HERV-T      -> AL_LINEAGE_HERVT
//   HERV-K-HML2 -> AL_LINEAGE_HERVKHML2

var DRY_RUN = false;

function log(msg) {
    glue.log("INFO", msg);
}

function norm(value) {
    if(value === null || value === undefined) {
        return null;
    }
    var s = ("" + value).trim();
    if(s === "" || s === "-" || s.toLowerCase() === "n/a") {
        return null;
    }
    return s;
}

function sanitizeRefSuffix(name) {
    return ("" + name).replace(/[^A-Za-z0-9]/g, "");
}

function lineageAlignmentName(classification) {
    return "AL_LINEAGE_" + sanitizeRefSuffix(classification);
}

function escapeQuotes(value) {
    return ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function queryObjects(cmdWords) {
    return glue.tableToObjects(glue.command(cmdWords));
}

function runCmd(cmdWords) {
    if(DRY_RUN) {
        log("[DRY RUN] " + cmdWords.join(" "));
        return null;
    }
    return glue.command(cmdWords);
}

function alignmentExists(alignmentName) {
    var rows = queryObjects([
        "list", "alignment",
        "-w", "name = '" + escapeQuotes(alignmentName) + "'"
    ]);
    return rows.length > 0;
}

function loadUniqueClassifications() {
    var rows = queryObjects([
        "list", "custom-table-row", "erv_locus",
        "classification",
        "-s", "classification"
    ]);

    var seen = {};
    var classifications = [];

    _.each(rows, function(row) {
        var classification = norm(row.classification);
        if(classification === null) {
            return;
        }
        if(!seen[classification]) {
            seen[classification] = true;
            classifications.push(classification);
        }
    });

    classifications.sort();
    return classifications;
}

function addMembersToLineageAlignment(classification) {
    var alignmentName = lineageAlignmentName(classification);

    if(!alignmentExists(alignmentName)) {
        log("Skipping classification '" + classification +
            "': alignment does not exist -> " + alignmentName);
        return;
    }

    var whereClause = "erv_locus.classification = '" + escapeQuotes(classification) + "'";

    glue.inMode("/alignment/" + alignmentName, function() {
        runCmd(["add", "member", "--whereClause", whereClause]);
    });

    log("Added members for classification '" + classification +
        "' to alignment " + alignmentName);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

var classifications = loadUniqueClassifications();
log("Loaded " + classifications.length + " unique erv_locus classifications");

_.each(classifications, function(classification) {
    addMembersToLineageAlignment(classification);
});

log("Finished adding erv_locus members to lineage alignments.");
