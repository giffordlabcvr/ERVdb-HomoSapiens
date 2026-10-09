// glue/build/curation/applyErvLocusCuratorDecisions.js
//
// Apply curator-selected ERV lineage classifications to existing
// erv_locus records.
//
// Input TSV columns used:
//   sequenceID
//   curator_decision
//
// Run after loadErvLocusLineageAssociations.js and before
// loadErvLocusLtrAssociations.js.
//
// Blank curator decisions are ignored.
//
// Nonblank decisions override existing whole-locus lineage
// associations. Region-specific component associations are
// protected against automatic replacement.
//
// The script validates all proposed changes before writing.

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

var INPUT_FILE =
    "tabular/curation/erv_curator_decisions.tsv";

var DRY_RUN = true;

var LOCUS_TABLE = "erv_locus";
var LINEAGE_TABLE = "erv_lineage";
var ALIAS_TABLE = "erv_lineage_alias";
var ASSOC_TABLE = "erv_locus_lineage_assoc";

var ASSOCIATION_ROLE = "primary";
var ASSOCIATION_EVIDENCE = "curator_decision";
var ASSOCIATION_CONFIDENCE = "high";


// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------

function log(message) {
    glue.logInfo(message);
}

function norm(value) {
    if(value === null || value === undefined) {
        return null;
    }

    var s = String(value).trim();

    if(
        s === "" ||
        /^(null|none|n\/a|na|unknown|-)$/i.test(s)
    ) {
        return null;
    }

    return s;
}

function query(command) {
    return glue.tableToObjects(glue.command(command));
}

function rowPath(table, id) {
    return "custom-table-row/" + table + "/" + id;
}

function sanitiseId(value) {
    return String(value).replace(
        /[^A-Za-z0-9._-]/g,
        "_"
    );
}

function associationId(locusId, lineageId) {
    return sanitiseId(
        locusId + "__" + lineageId
    );
}

function setField(table, id, field, value) {
    glue.inMode(rowPath(table, id), function() {
        glue.command([
            "set", "field", field, String(value)
        ]);
    });
}

function setLink(table, id, linkName, targetTable, targetId) {
    glue.inMode(rowPath(table, id), function() {
        glue.command([
            "set", "link-target",
            linkName,
            rowPath(targetTable, targetId)
        ]);
    });
}

function readTsv(path) {
    var Paths = Java.type("java.nio.file.Paths");
    var Files = Java.type("java.nio.file.Files");
    var StandardCharsets =
        Java.type("java.nio.charset.StandardCharsets");

    var lines = Files.readAllLines(
        Paths.get(path),
        StandardCharsets.UTF_8
    );

    if(lines.size() === 0) {
        throw new Error("Empty TSV: " + path);
    }

    var headers = String(lines.get(0))
        .replace(/^\uFEFF/, "")
        .split("\t");

    var rows = [];

    for(var i = 1; i < lines.size(); i++) {
        var line = String(lines.get(i));

        if(line.trim() === "") {
            continue;
        }

        var cells = line.split("\t");
        var row = {};

        headers.forEach(function(header, index) {
            row[header] =
                index < cells.length ? cells[index] : "";
        });

        row._line = i + 1;
        rows.push(row);
    }

    return {
        headers: headers,
        rows: rows
    };
}


// ------------------------------------------------------------
// Lineage name resolution
// ------------------------------------------------------------
//
// Use exact canonical IDs, legacy names and aliases.
//
// A normalised lookup is allowed only when it identifies
// exactly one lineage.
//
// No fuzzy or substring matching is performed.
// ------------------------------------------------------------

function normaliseName(value) {
    value = norm(value);

    if(value === null) {
        return null;
    }

    return value
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]+/g, "")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}

var exactNames = {};
var normalisedNames = {};

function addName(map, name, lineageId) {
    if(name === null || lineageId === null) {
        return;
    }

    if(!map[name]) {
        map[name] = {};
    }

    map[name][lineageId] = true;
}

function resolveFromMap(map, key) {
    if(key === null || !map[key]) {
        return {
            status: "missing"
        };
    }

    var ids = Object.keys(map[key]);

    if(ids.length !== 1) {
        return {
            status: "ambiguous",
            candidates: ids
        };
    }

    return {
        status: "resolved",
        lineage_id: ids[0]
    };
}

function resolveLineage(name) {
    name = norm(name);

    if(name === null) {
        return { status: "missing" };
    }

    var exact = resolveFromMap(exactNames, name);

    if(exact.status !== "missing") {
        return exact;
    }

    return resolveFromMap(
        normalisedNames,
        normaliseName(name)
    );
}

function registerName(name, lineageId) {
    name = norm(name);

    if(name === null) {
        return;
    }

    addName(exactNames, name, lineageId);

    addName(
        normalisedNames,
        normaliseName(name),
        lineageId
    );
}


// ------------------------------------------------------------
// 1. Load canonical lineage names
// ------------------------------------------------------------

log("Loading ERV lineage nomenclature");

var lineageRows = query([
    "list", "custom-table-row", LINEAGE_TABLE,
    "id",
    "legacy_name",
    "legacy_full_name"
]);

var validLineages = {};

lineageRows.forEach(function(row) {
    var id = norm(row.id);

    if(id === null) return;

    validLineages[id] = true;

    registerName(id, id);
    registerName(row.legacy_name, id);
    registerName(row.legacy_full_name, id);
});

var aliasRows = query([
    "list", "custom-table-row", ALIAS_TABLE,
    "alias_name",
    "erv_lineage.id"
]);

aliasRows.forEach(function(row) {
    var id = norm(row["erv_lineage.id"]);

    if(id !== null && validLineages[id]) {
        registerName(row.alias_name, id);
    }
});

log("Loaded " + lineageRows.length + " ERV lineages");
log("Loaded " + aliasRows.length + " lineage aliases");


// ------------------------------------------------------------
// 2. Load existing loci
// ------------------------------------------------------------

var locusRows = query([
    "list", "custom-table-row", LOCUS_TABLE,
    "id",
    "taxonomic_resolution"
]);

var loci = {};

locusRows.forEach(function(row) {
    var id = norm(row.id);

    if(id !== null) {
        loci[id] = {
            id: id,
            taxonomic_resolution:
                norm(row.taxonomic_resolution)
        };
    }
});

log("Loaded " + locusRows.length + " ERV loci");


// ------------------------------------------------------------
// 3. Load existing lineage associations
// ------------------------------------------------------------

var assocRows = query([
    "list", "custom-table-row", ASSOC_TABLE,
    "id",
    "erv_locus.id",
    "erv_lineage.id",
    "association_role",
    "evidence",
    "confidence",
    "region_start",
    "region_end"
]);

var associationsByLocus = {};

assocRows.forEach(function(row) {
    var locusId = norm(row["erv_locus.id"]);

    if(locusId === null) return;

    if(!associationsByLocus[locusId]) {
        associationsByLocus[locusId] = [];
    }

    associationsByLocus[locusId].push({
        id: norm(row.id),
        lineage_id: norm(row["erv_lineage.id"]),
        role: norm(row.association_role),
        evidence: norm(row.evidence),
        confidence: norm(row.confidence),
        region_start: norm(row.region_start),
        region_end: norm(row.region_end)
    });
});

log(
    "Loaded " + assocRows.length +
    " existing locus-lineage associations"
);


// ------------------------------------------------------------
// 4. Read curator decisions
// ------------------------------------------------------------

log("Reading curator decisions from " + INPUT_FILE);

var tsv = readTsv(INPUT_FILE);

if(
    tsv.headers.indexOf("sequenceID") < 0 ||
    tsv.headers.indexOf("curator_decision") < 0
) {
    throw new Error(
        "Curator TSV must contain sequenceID " +
        "and curator_decision columns"
    );
}

var decisions = [];
var errors = [];
var seenLoci = {};

var stats = {
    rows: tsv.rows.length,
    blank: 0,
    decisions: 0,
    missingLoci: 0,
    unresolvedNames: 0,
    ambiguousNames: 0,
    protectedAssociations: 0,
    unchanged: 0,
    created: 0,
    replaced: 0,
    metadataUpdates: 0
};

tsv.rows.forEach(function(row) {
    var locusId = norm(row.sequenceID);
    var decision = norm(row.curator_decision);

    if(decision === null) {
        stats.blank++;
        return;
    }

    stats.decisions++;

    if(locusId === null) {
        errors.push(
            "Line " + row._line +
            ": missing sequenceID"
        );
        return;
    }

    if(seenLoci[locusId]) {
        errors.push(
            "Duplicate curator decision for " + locusId
        );
        return;
    }

    seenLoci[locusId] = true;

    if(!loci[locusId]) {
        stats.missingLoci++;

        errors.push(
            "Line " + row._line +
            ": locus not found: " + locusId
        );

        return;
    }

    var resolution = resolveLineage(decision);

    if(resolution.status !== "resolved") {
        if(resolution.status === "ambiguous") {
            stats.ambiguousNames++;
        } else {
            stats.unresolvedNames++;
        }

        errors.push(
            "Line " + row._line +
            ": cannot resolve curator_decision '" +
            decision + "' for " + locusId +
            " (" + resolution.status + ")" +
            (resolution.candidates
                ? ": " + resolution.candidates.join(", ")
                : "")
        );

        return;
    }

    decisions.push({
        locus_id: locusId,
        raw_name: decision,
        lineage_id: resolution.lineage_id
    });
});


// ------------------------------------------------------------
// 5. Plan association changes
// ------------------------------------------------------------

var plans = [];

decisions.forEach(function(decision) {
    var locusId = decision.locus_id;
    var lineageId = decision.lineage_id;

    var existing =
        associationsByLocus[locusId] || [];

    // Do not overwrite region-specific mosaic components.
    var protectedRows = existing.filter(function(a) {
        return (
            a.region_start !== null ||
            a.region_end !== null
        );
    });

    if(protectedRows.length > 0) {
        stats.protectedAssociations++;

        errors.push(
            "Locus " + locusId +
            " has region-specific lineage associations; " +
            "manual review required"
        );

        return;
    }

    var desiredId = associationId(
        locusId,
        lineageId
    );

    var matching = existing.filter(function(a) {
        return a.lineage_id === lineageId;
    });

    // Multiple associations to the same lineage should
    // not be silently consolidated.
    if(matching.length > 1) {
        errors.push(
            "Locus " + locusId +
            " has duplicate associations to " +
            lineageId
        );
        return;
    }

    var retained =
        matching.length === 1 ? matching[0] : null;

    var obsolete = existing.filter(function(a) {
        return !retained || a.id !== retained.id;
    });

    var needsMetadata =
        loci[locusId].taxonomic_resolution !== "lineage";

    var needsAssociationUpdate =
        retained === null ||
        retained.role !== ASSOCIATION_ROLE ||
        retained.evidence !== ASSOCIATION_EVIDENCE ||
        retained.confidence !== ASSOCIATION_CONFIDENCE;

    if(
        obsolete.length === 0 &&
        !needsAssociationUpdate &&
        !needsMetadata
    ) {
        stats.unchanged++;
        return;
    }

    if(retained === null) {
        stats.created++;
    }

    if(obsolete.length > 0) {
        stats.replaced++;
    }

    if(needsMetadata) {
        stats.metadataUpdates++;
    }

    plans.push({
        locus_id: locusId,
        lineage_id: lineageId,
        raw_name: decision.raw_name,
        retained_id: retained ? retained.id : null,
        new_id: desiredId,
        obsolete: obsolete,
        needs_association_update:
            needsAssociationUpdate,
        needs_metadata: needsMetadata
    });
});


// ------------------------------------------------------------
// 6. Preflight summary
// ------------------------------------------------------------

log("==============================================");
log("ERV locus curator decisions");
log("==============================================");

log("TSV rows:                  " + stats.rows);
log("Blank decisions:           " + stats.blank);
log("Nonblank decisions:        " + stats.decisions);
log("Unchanged:                 " + stats.unchanged);
log("New associations:          " + stats.created);
log("Associations replaced:     " + stats.replaced);
log("Resolution updates:        " + stats.metadataUpdates);

log("----------------------------------------------");

log("Missing loci:              " + stats.missingLoci);
log("Unresolved names:          " + stats.unresolvedNames);
log("Ambiguous names:           " + stats.ambiguousNames);
log("Protected associations:    " + stats.protectedAssociations);
log("Preflight errors:          " + errors.length);

if(errors.length > 0) {
    errors.forEach(function(message) {
        log("ERROR: " + message);
    });

    throw new Error(
        "Curator decision preflight failed with " +
        errors.length + " error(s). No changes written."
    );
}

plans.forEach(function(plan) {
    log(
        "CURATE " + plan.locus_id +
        " -> " + plan.lineage_id +
        " [" + plan.raw_name + "]" +
        " remove=" + plan.obsolete.length
    );
});


// ------------------------------------------------------------
// 7. Apply decisions
// ------------------------------------------------------------

if(DRY_RUN) {
    log("DRY RUN: no database changes made");
} else {

    log("Applying " + plans.length + " curator updates");

    plans.forEach(function(plan) {

        // Create the desired association before removing
        // superseded whole-locus associations.
        if(plan.retained_id === null) {
            glue.command([
                "create",
                "custom-table-row",
                ASSOC_TABLE,
                plan.new_id
            ]);
        }

        var targetId =
            plan.retained_id || plan.new_id;

        if(plan.needs_association_update) {
            setLink(
                ASSOC_TABLE,
                targetId,
                "erv_locus",
                LOCUS_TABLE,
                plan.locus_id
            );

            setLink(
                ASSOC_TABLE,
                targetId,
                "erv_lineage",
                LINEAGE_TABLE,
                plan.lineage_id
            );

            setField(
                ASSOC_TABLE,
                targetId,
                "association_role",
                ASSOCIATION_ROLE
            );

            setField(
                ASSOC_TABLE,
                targetId,
                "evidence",
                ASSOCIATION_EVIDENCE
            );

            setField(
                ASSOC_TABLE,
                targetId,
                "confidence",
                ASSOCIATION_CONFIDENCE
            );
        }

        plan.obsolete.forEach(function(a) {
            glue.command([
                "delete",
                "custom-table-row",
                ASSOC_TABLE,
                a.id
            ]);
        });

        if(plan.needs_metadata) {
            setField(
                LOCUS_TABLE,
                plan.locus_id,
                "taxonomic_resolution",
                "lineage"
            );
        }
    });

    log("Curator decisions applied successfully");
}

log("==============================================");
