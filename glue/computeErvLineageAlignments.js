// glue/computeErvLineageAlignments.js
//
// Compute ERV lineage alignments for the subset of lineages that are actually
// represented in erv_locus.classification.
//
// Rules:
// - if erv_lineage.consensus_orfs = YES, use rvCompoundAligner
// - otherwise use rvCompoundAlignerNoOrfs
// - specific lineage overrides may force a different aligner
//
// Assumptions:
// - erv_locus.classification values correspond to erv_lineage.id values
// - lineage alignments are named:
//     AL_LINEAGE_<classification with non-alphanumerics removed>
// - only locus-backed classifications should be computed

var DRY_RUN = false;

// -----------------------------------------------------------------------------
// Explicit module overrides
// -----------------------------------------------------------------------------

var alignerOverrideByLineageId = {
    "HERV-L": "rvCompoundAlignerNoEnv"
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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

function lineageAlignmentName(lineageId) {
    return "AL_LINEAGE_" + sanitizeRefSuffix(lineageId);
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

// -----------------------------------------------------------------------------
// Data loading
// -----------------------------------------------------------------------------

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

function loadLineageInfo(lineageId) {
    var rows = queryObjects([
        "list", "custom-table-row", "erv_lineage",
        "id", "consensus_orfs",
        "-w", "id = '" + escapeQuotes(lineageId) + "'"
    ]);

    if(rows.length === 0) {
        return null;
    }
    if(rows.length > 1) {
        throw "Duplicate erv_lineage rows found for id '" + lineageId + "'";
    }

    return {
        id: norm(rows[0].id),
        consensus_orfs: norm(rows[0].consensus_orfs)
    };
}

// -----------------------------------------------------------------------------
// Aligner selection
// -----------------------------------------------------------------------------

function chooseAlignerModule(lineageRow) {
    var lineageId = lineageRow.id;

    if(alignerOverrideByLineageId.hasOwnProperty(lineageId)) {
        return alignerOverrideByLineageId[lineageId];
    }

    if(lineageRow.consensus_orfs === "YES") {
        return "rvCompoundAligner";
    }

    return "rvCompoundAlignerNoOrfs";
}

// -----------------------------------------------------------------------------
// Main action
// -----------------------------------------------------------------------------

function computeLineageAlignmentForClassification(classification) {
    var lineageRow = loadLineageInfo(classification);

    if(lineageRow === null) {
        log("Skipping classification '" + classification + "': no matching erv_lineage row");
        return;
    }

    var alignmentName = lineageAlignmentName(classification);

    if(!alignmentExists(alignmentName)) {
        log("Skipping classification '" + classification +
            "': alignment does not exist -> " + alignmentName);
        return;
    }

    var moduleName = chooseAlignerModule(lineageRow);

    runCmd(["compute", "alignment", alignmentName, moduleName]);
    log("Computed " + alignmentName + " using " + moduleName);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

var classifications = loadUniqueClassifications();
log("Loaded " + classifications.length + " unique erv_locus classifications");

_.each(classifications, function(classification) {
    computeLineageAlignmentForClassification(classification);
});

log("Finished computing ERV lineage alignments for locus-backed classifications.");