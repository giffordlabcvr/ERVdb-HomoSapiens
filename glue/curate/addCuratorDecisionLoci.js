// glue/curate/addCuratorDecisionLoci.js
//
// Add loci with curator decisions as provisional members of their
// proposed ERV lineage alignments.
//
// Does not change erv_locus, erv_lineage, or locus-lineage associations.
// Run after ervBuildAlignmentTree.js and after importing the RBRT sequences.

var DRY_RUN = true;

var DECISIONS_PATH = "tabular/locus/erv_curator_decisions.tsv";
var LOCUS_SOURCE = "filtered_2026_07"; // Change to the source containing RBRT sequences.

// -----------------------------------------------------------------------------
// Read decisions and build reference-name -> lineage-ID lookup
// -----------------------------------------------------------------------------

var decisions = loadTabular(DECISIONS_PATH);
var referenceRows = queryObjects([
    "list", "sequence",
    "sequenceID",
    "erv_lineage.id",
    "-w",
    "sequence_kind = 'erv_ref' and erv_lineage.id != null"
]);

var lineageByReferenceName = {};
var ambiguousReferenceNames = {};

_.each(referenceRows, function(row) {
    var name = clean(row.sequenceID);
    var lineageId = clean(row["erv_lineage.id"]);

    if(name === null || lineageId === null) {
        return;
    }

    if(
        lineageByReferenceName.hasOwnProperty(name) &&
        lineageByReferenceName[name] !== lineageId
    ) {
        ambiguousReferenceNames[name] = true;
    } else {
        lineageByReferenceName[name] = lineageId;
    }
});

var alignmentNames = {};
_.each(queryObjects(["list", "alignment", "name"]), function(row) {
    alignmentNames[row.name] = true;
});

var sequenceNames = {};
_.each(
    queryObjects([
        "list", "sequence",
        "sequenceID",
        "-w", "source.name = '" + quote(LOCUS_SOURCE) + "'"
    ]),
    function(row) {
        sequenceNames[row.sequenceID] = true;
    }
);

// Validate the complete input before adding any members.
var proposed = [];
var errors = [];
var seen = {};

_.each(decisions, function(row, index) {
    var sequenceID = clean(row.sequenceID);
    var decision = clean(row.curator_decision);

    if(decision === null) {
        return;
    }

    var line = index + 2;

    if(sequenceID === null) {
        errors.push("Line " + line + ": missing sequenceID");
        return;
    }

    if(seen.hasOwnProperty(sequenceID)) {
        errors.push(
            "Line " + line + ": duplicate sequenceID " + sequenceID
        );
        return;
    }
    seen[sequenceID] = true;

    if(!sequenceNames.hasOwnProperty(sequenceID)) {
        errors.push(
            "Line " + line + ": sequence not found in source " +
            LOCUS_SOURCE + ": " + sequenceID
        );
        return;
    }

    if(ambiguousReferenceNames.hasOwnProperty(decision)) {
        errors.push(
            "Line " + line + ": ambiguous reference name " + decision
        );
        return;
    }

    var lineageId = lineageByReferenceName[decision];

    if(lineageId === undefined) {
        errors.push(
            "Line " + line +
            ": curator_decision does not identify an ERV reference " +
            "linked to a lineage: " + decision
        );
        return;
    }

    var alignmentName = lineageAlignmentName(lineageId);

    if(!alignmentNames.hasOwnProperty(alignmentName)) {
        errors.push(
            "Line " + line + ": alignment does not exist: " +
            alignmentName
        );
        return;
    }

    proposed.push({
        sequenceID: sequenceID,
        curatorDecision: decision,
        lineageId: lineageId,
        alignmentName: alignmentName
    });
});

if(errors.length > 0) {
    _.each(errors, function(error) {
        log("ERROR: " + error);
    });
    throw "Validation failed for " + errors.length +
        " curator decision row(s); no members were added.";
}

// -----------------------------------------------------------------------------
// Add provisional members
// -----------------------------------------------------------------------------

var added = 0;
var existing = 0;
var byLineage = {};

_.each(proposed, function(item) {
    var memberClause =
        "sequence.source.name = '" + quote(LOCUS_SOURCE) + "'" +
        " and sequence.sequenceID = '" +
        quote(item.sequenceID) + "'";

    var sequenceClause =
        "source.name = '" + quote(LOCUS_SOURCE) + "'" +
        " and sequenceID = '" +
        quote(item.sequenceID) + "'";

    var alreadyPresent;

    glue.inMode("/alignment/" + item.alignmentName, function() {
        alreadyPresent = queryObjects([
            "list", "member",
            "sequence.sequenceID",
            "-w", memberClause
        ]).length > 0;

        if(!alreadyPresent && !DRY_RUN) {
            glue.command([
                "add", "member",
                "--whereClause", sequenceClause
            ]);
        }
    });

    if(alreadyPresent) {
        existing++;
    } else {
        added++;
    }

    if(!byLineage.hasOwnProperty(item.lineageId)) {
        byLineage[item.lineageId] = {
            alignment: item.alignmentName,
            newMembers: 0,
            existingMembers: 0
        };
    }

    if(alreadyPresent) {
        byLineage[item.lineageId].existingMembers++;
    } else {
        byLineage[item.lineageId].newMembers++;
    }

    // This log is also an explicit provenance manifest for tree annotation.
    log(
        (alreadyPresent ? "EXISTING" :
            (DRY_RUN ? "WOULD_ADD" : "ADDED")) +
        "\t" + item.sequenceID +
        "\t" + item.curatorDecision +
        "\t" + item.lineageId +
        "\t" + item.alignmentName +
        "\tCURATOR_PROVISIONAL"
    );
});

_.each(_.keys(byLineage).sort(), function(lineageId) {
    var summary = byLineage[lineageId];
    log(
        "SUMMARY\t" + lineageId +
        "\t" + summary.alignment +
        "\tnew=" + summary.newMembers +
        "\texisting=" + summary.existingMembers
    );
});

log(
    "Finished: " + proposed.length + " decisions; " +
    added + (DRY_RUN ? " would be added" : " added") +
    "; " + existing + " already present."
);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function loadTabular(path) {
    var rows;

    glue.inMode("module/tabularUtility", function() {
        rows = glue.tableToObjects(
            glue.command(["load-tabular", path])
        );
    });

    return rows;
}

function queryObjects(commandWords) {
    return glue.tableToObjects(glue.command(commandWords));
}

function lineageAlignmentName(lineageId) {
    var suffix = ("" + lineageId)
        .replace(/^ERV-/i, "")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+/, "")
        .replace(/_+$/, "");

    if(suffix === "") {
        throw "Cannot derive alignment name from " + lineageId;
    }

    return "AL_LINEAGE_" + suffix;
}

function clean(value) {
    if(value === null || value === undefined) {
        return null;
    }

    var result = ("" + value).replace(/^\s+|\s+$/g, "");
    return result.length === 0 ? null : result;
}

function quote(value) {
    return ("" + value).replace(/'/g, "''");
}

function log(message) {
    glue.log("INFO", message);
}