// glue/build/erv/ervDeclareReferences.js
//
// Declare ERV reference sequences from actual sequences in erv-* sources.
//
// Naming convention:
//   REF_<erv_lineage.id with non-alphanumerics removed or underscored>
//
// Assumptions:
// - sequence.erv_lineage is set for sequences to be used
// - one representative sequence per erv_lineage is expected at this build stage
// - if multiple sequences are linked to one lineage, choose deterministically

var DRY_RUN = false;

// -----------------------------------------------------------------------------
// Basic helpers
// -----------------------------------------------------------------------------

function norm(value) {
    if(value === null || value === undefined) {
        return null;
    }
    var s = ("" + value).trim();
    if(s === "") {
        return null;
    }
    var low = s.toLowerCase();
    if(low === "n/a" || low === "na" || low === "null" || low === "none") {
        return null;
    }
    return s;
}

function log(msg) {
    glue.log("INFO", msg);
}

function sanitizeRefSuffix(name) {
    return ("" + name).replace(/[^A-Za-z0-9]/g, "");
}

function refNameForLineageId(lineageId) {
    var clean = sanitizeRefSuffix(lineageId);
    if(clean === "") {
        throw "Could not derive reference name from erv_lineage.id: " + lineageId;
    }
    return "REF_" + clean;
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

function referenceExists(refName) {
    var rows = queryObjects([
        "list", "reference",
        "-w", "name = '" + escapeQuotes(refName) + "'"
    ]);
    return rows.length > 0;
}

// -----------------------------------------------------------------------------
// Load usable rows from sequence table
// -----------------------------------------------------------------------------

function loadReferenceRows() {
    return queryObjects([
        "list", "sequence",
        "sequenceID",
        "source.name",
        "erv_lineage.id",
        "erv_lineage.rv_species.rv_clade.id",
        "erv_lineage.rv_species.rv_genus.id",
        "-w", "source.name like 'erv-%'",
        "-s", "erv_lineage.rv_species.rv_clade.id,erv_lineage.rv_species.rv_genus.id,erv_lineage.id,sequenceID"
    ]);
}

function buildLineageToSequenceMap(rows) {
    var lineageToRows = {};

    _.each(rows, function(row) {
        var sequenceID = norm(row.sequenceID);
        var sourceName = norm(row["source.name"]);
        var lineageId = norm(row["erv_lineage.id"]);
        var cladeId = norm(row["erv_lineage.rv_species.rv_clade.id"]);
        var genusId = norm(row["erv_lineage.rv_species.rv_genus.id"]);

        // Ignore rows not linked through to a usable lineage
        if(sequenceID === null || sourceName === null || lineageId === null) {
            return;
        }

        if(!lineageToRows[lineageId]) {
            lineageToRows[lineageId] = [];
        }

        lineageToRows[lineageId].push({
            lineageId: lineageId,
            sequenceID: sequenceID,
            sourceName: sourceName,
            cladeId: cladeId,
            genusId: genusId
        });
    });

    return lineageToRows;
}

// -----------------------------------------------------------------------------
// Representative choice
// -----------------------------------------------------------------------------

function chooseRepresentative(rowList) {
    if(rowList.length === 1) {
        return rowList[0];
    }

    // Prefer exact sequenceID == lineageId if it occurs
    var exact = _.filter(rowList, function(row) {
        return row.sequenceID === row.lineageId;
    });
    if(exact.length === 1) {
        return exact[0];
    }

    // Otherwise choose lexicographically first source/sequence for deterministic behavior
    var sorted = rowList.slice().sort(function(a, b) {
        var aKey = a.sourceName + "/" + a.sequenceID;
        var bKey = b.sourceName + "/" + b.sequenceID;
        return aKey.localeCompare(bKey);
    });
    return sorted[0];
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

var sequenceRows = loadReferenceRows();
log("Loaded " + sequenceRows.length + " ERV sequence rows from erv-* sources");

var lineageToRows = buildLineageToSequenceMap(sequenceRows);
var lineageIds = _.keys(lineageToRows).sort();

_.each(lineageIds, function(lineageId) {
    var candidates = lineageToRows[lineageId];
    var chosen = chooseRepresentative(candidates);

    var refName = refNameForLineageId(lineageId);

    if(referenceExists(refName)) {
        log("Reference already exists: " + refName + " -> " + chosen.sourceName + "/" + chosen.sequenceID);
        return;
    }

	if(candidates.length > 1) {
		throw "Multiple ERV reference sequences found for lineage '" + lineageId + "'";
	}

    runCmd(["create", "reference", refName, chosen.sourceName, chosen.sequenceID]);
    log("Created " + refName + " from " + chosen.sourceName + "/" + chosen.sequenceID);
});