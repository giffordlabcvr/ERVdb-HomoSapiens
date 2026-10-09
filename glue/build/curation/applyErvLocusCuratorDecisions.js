//
// glue/build/curation/applyErvLocusCuratorDecisions.js
//
// Apply curator-selected ERV lineage associations to
// existing erv_locus records.
//
// Curator decisions override initial whole-locus ERV
// lineage associations. They do not modify locus-level
// classification, including mosaic status.
//
// Name resolution uses only:
//   1. Canonical erv_lineage.id values
//   2. tabular/locus/erv_locus_name_mappings.tsv
//
// Missing loci are skipped and reported.
// Historical classifications explicitly excluded from
// ERVdb are skipped and reported.
//
// Invalid or ambiguous decisions for included loci
// remain fatal preflight errors.
//
// All changes are validated before writing.
//

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

var INPUT_FILE =
    "tabular/curation/erv_curator_decisions.tsv";

var MAPPINGS_FILE =
    "tabular/locus/erv_locus_name_mappings.tsv";

var MISSING_EXTRACTION_IDS_FILE =
    "tabular/locus/extracted.fna.missing_ids.tsv";

var DRY_RUN = false;

var LOCUS_TABLE = "erv_locus";
var LINEAGE_TABLE = "erv_lineage";
var ASSOC_TABLE = "erv_locus_lineage_assoc";

var ASSOCIATION_ROLE = "primary";
var ASSOCIATION_EVIDENCE = "curator_decision";
var ASSOCIATION_CONFIDENCE = "high";

// Historical repeat classifications deliberately excluded
// from the current ERVdb reference set because they lack
// detectable retroviral homology in internal regions.
//
// These names must not generate lineage associations.

var EXCLUDED_CURATOR_NAMES = {
    "MER-61": "no_internal_erv_homology",
    "MER-4": "no_internal_erv_homology",
    "HERV-39": "no_internal_erv_homology"
};

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

function associationId(locusId, lineageId) {
    return String(locusId + "__" + lineageId)
        .replace(/[^A-Za-z0-9._-]/g, "_");
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

function requireColumns(tsv, columns, path) {
    columns.forEach(function(column) {
        if(tsv.headers.indexOf(column) < 0) {
            throw new Error(
                "Missing column '" + column +
                "' in " + path
            );
        }
    });
}

// ------------------------------------------------------------
// Optional extracted-FASTA missing ID inventory
// ------------------------------------------------------------

function loadMissingExtractionIds(path) {
    var Paths = Java.type("java.nio.file.Paths");
    var Files = Java.type("java.nio.file.Files");
    var StandardCharsets =
        Java.type("java.nio.charset.StandardCharsets");

    var filePath = Paths.get(path);
    var ids = {};

    if(!Files.exists(filePath)) {
        log("No extraction missing-ID file: " + path);
        return ids;
    }

    var lines = Files.readAllLines(
        filePath,
        StandardCharsets.UTF_8
    );

    if(lines.size() === 0) {
        log("Extraction missing-ID file is empty: " + path);
        return ids;
    }

    // Support either:
    //   - one RBRT ID per line
    //   - a TSV with a recognised ID column
    //
    // Do not treat an unrecognised header as a locus ID.

    var first = String(lines.get(0))
        .replace(/^\uFEFF/, "")
        .split("\t");

    var columns = [
        "sequenceID",
        "sequence_id",
        "locus_id",
        "missing_id",
        "id"
    ];

    var idIndex = -1;

    for(var j = 0; j < first.length; j++) {
        if(columns.indexOf(first[j].trim()) >= 0) {
            idIndex = j;
            break;
        }
    }

    var start = 0;

    if(idIndex >= 0) {
        start = 1;
    } else if(
        first.length === 1 &&
        /^RBRT[0-9]+$/.test(first[0].trim())
    ) {
        idIndex = 0;
    } else {
        throw new Error(
            "Cannot identify locus ID column in " +
            path +
            "; expected sequenceID, sequence_id, " +
            "locus_id, missing_id, id, or a " +
            "headerless list of RBRT IDs"
        );
    }

    for(var i = start; i < lines.size(); i++) {
        var line = String(lines.get(i));

        if(!line.trim()) {
            continue;
        }

        var cells = line.split("\t");
        var id = norm(cells[idIndex]);

        if(id !== null) {
            ids[id] = true;
        }
    }

    log(
        "Loaded " + Object.keys(ids).length +
        " IDs missing from extracted FASTA"
    );

    return ids;
}

// ------------------------------------------------------------
// 1. Load canonical ERV lineage identifiers
// ------------------------------------------------------------

log("Loading canonical ERV lineages");

var lineageRows = query([
    "list", "custom-table-row", LINEAGE_TABLE,
    "id",
    "entity_type"
]);

var validLineages = {};
var lineageTypes = {};

lineageRows.forEach(function(row) {
    var id = norm(row.id);
    var type = norm(row.entity_type);

    if(id === null) {
        return;
    }

    lineageTypes[id] = type;

    if(
        type === "lineage" ||
        type === "sublineage" ||
        type === "erv_derived_repeat"
    ) {
        validLineages[id] = true;
    }
});

log(
    "Loaded " + Object.keys(validLineages).length +
    " active ERV lineage entities"
);

// ------------------------------------------------------------
// 2. Load explicit locus name mappings
// ------------------------------------------------------------

log("Reading name mappings from " + MAPPINGS_FILE);

var mappingTsv = readTsv(MAPPINGS_FILE);

requireColumns(
    mappingTsv,
    [
        "source_name",
        "entity_type",
        "erv_lineage_id"
    ],
    MAPPINGS_FILE
);

// A source name may map to more than one lineage.
// Preserve this information so ambiguity is explicit.

var nameMappings = {};
var mappingRowsAccepted = 0;
var mappingRowsSkipped = 0;

mappingTsv.rows.forEach(function(row) {
    var name = norm(row.source_name);
    var id = norm(row.erv_lineage_id);
    var type = norm(row.entity_type);

    if(type === "ervr") {
        type = "erv_derived_repeat";
    }

    if(
        name === null ||
        id === null ||
        !validLineages[id] ||
        (
            type !== "lineage" &&
            type !== "sublineage" &&
            type !== "erv_derived_repeat"
        )
    ) {
        mappingRowsSkipped++;
        return;
    }

    if(!nameMappings[name]) {
        nameMappings[name] = {};
    }

    nameMappings[name][id] = true;
    mappingRowsAccepted++;
});

log("Accepted mapping rows: " + mappingRowsAccepted);
log("Skipped mapping rows: " + mappingRowsSkipped);

// ------------------------------------------------------------
// 3. Resolve curator decisions
// ------------------------------------------------------------

function resolveLineage(name) {
    name = norm(name);

    if(name === null) {
        return {
            status: "missing"
        };
    }

    // Canonical IDs take precedence.

    if(validLineages[name]) {
        return {
            status: "resolved",
            lineage_id: name
        };
    }

    var mapped = nameMappings[name];

    if(!mapped) {
        return {
            status: "missing"
        };
    }

    var ids = Object.keys(mapped);

    if(ids.length === 1) {
        return {
            status: "resolved",
            lineage_id: ids[0]
        };
    }

    return {
        status: "ambiguous",
        candidates: ids.sort()
    };
}

// ------------------------------------------------------------
// 4. Load existing ERV loci
// ------------------------------------------------------------

log("Loading existing ERV loci");

var locusRows = query([
    "list", "custom-table-row", LOCUS_TABLE,
    "id"
]);

var loci = {};

locusRows.forEach(function(row) {
    var id = norm(row.id);

    if(id !== null) {
        loci[id] = true;
    }
});

log("Loaded " + locusRows.length + " ERV loci");

// ------------------------------------------------------------
// 5. Load existing lineage associations
// ------------------------------------------------------------

log("Loading existing locus-lineage associations");

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
var associationIds = {};

assocRows.forEach(function(row) {
    var locusId = norm(row["erv_locus.id"]);
    var id = norm(row.id);

    if(id !== null) {
        associationIds[id] = true;
    }

    if(locusId === null) {
        return;
    }

    if(!associationsByLocus[locusId]) {
        associationsByLocus[locusId] = [];
    }

    associationsByLocus[locusId].push({
        id: id,
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

// Read optional extraction inventory once,
// before curator validation.

var missingExtractionIds =
    loadMissingExtractionIds(
        MISSING_EXTRACTION_IDS_FILE
    );

// ------------------------------------------------------------
// 6. Read and validate curator decisions
// ------------------------------------------------------------

log("Reading curator decisions from " + INPUT_FILE);

var tsv = readTsv(INPUT_FILE);

requireColumns(
    tsv,
    [
        "sequenceID",
        "curator_decision"
    ],
    INPUT_FILE
);

var decisions = [];
var errors = [];
var skipped = [];
var seenLoci = {};

var stats = {
    rows: tsv.rows.length,
    blank: 0,
    nonblank: 0,
    missingLoci: 0,
    knownExtractionMissing: 0,
    unexpectedMissing: 0,
    excludedClassifications: 0,
    unresolvedNames: 0,
    ambiguousNames: 0,
    unchanged: 0,
    created: 0,
    replaced: 0,
    updated: 0
};

tsv.rows.forEach(function(row) {
    var locusId = norm(row.sequenceID);
    var decision = norm(row.curator_decision);

    if(decision === null) {
        stats.blank++;
        return;
    }

    stats.nonblank++;

    if(locusId === null) {
        errors.push(
            "Line " + row._line +
            ": missing sequenceID"
        );
        return;
    }

    if(seenLoci[locusId]) {
        errors.push(
            "Line " + row._line +
            ": duplicate curator decision for " +
            locusId
        );
        return;
    }

    seenLoci[locusId] = true;

    // Decisions for loci outside the selected dataset
    // are not applicable to this build.

    if(!loci[locusId]) {
        stats.missingLoci++;

        var extractionMissing =
            missingExtractionIds[locusId] === true;

        if(extractionMissing) {
            stats.knownExtractionMissing++;
        } else {
            stats.unexpectedMissing++;

            skipped.push({
                line: row._line,
                locus_id: locusId,
                decision: decision,
                reason: "locus_not_selected"
            });
        }

        return;
    }

    // --------------------------------------------------------
    // Explicit biological exclusions
    // --------------------------------------------------------
    //
    // These repeat classifications were deliberately removed
    // from the ERV reference set because their internal regions
    // lack detectable retroviral homology.
    //
    // They must not be resolved as ERV lineages, must not
    // generate associations, and must not cause preflight
    // failure.
    //
    // Their exclusion is recorded separately from genuine
    // missing or ambiguous classification names.
    //

    if(
        Object.prototype.hasOwnProperty.call(
            EXCLUDED_CURATOR_NAMES,
            decision
        )
    ) {
        stats.excludedClassifications++;

        skipped.push({
            line: row._line,
            locus_id: locusId,
            decision: decision,
            reason: EXCLUDED_CURATOR_NAMES[decision]
        });

        return;
    }

    // --------------------------------------------------------
    // Resolve included curator decisions
    // --------------------------------------------------------

    var resolution = resolveLineage(decision);

    if(resolution.status !== "resolved") {
        if(resolution.status === "ambiguous") {
            stats.ambiguousNames++;
        } else {
            stats.unresolvedNames++;
        }

        errors.push(
            "Line " + row._line +
            ": cannot resolve '" + decision +
            "' for " + locusId +
            " (" + resolution.status + ")" +
            (
                resolution.candidates
                    ? ": " +
                      resolution.candidates.join(", ")
                    : ""
            )
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
// 7. Plan curator overrides
// ------------------------------------------------------------

var plans = [];

decisions.forEach(function(decision) {
    var locusId = decision.locus_id;
    var lineageId = decision.lineage_id;

    var existing =
        associationsByLocus[locusId] || [];

    // Curator decisions replace the initial lineage
    // assignment. No mosaic interpretation is made.

    var matching = existing.filter(function(a) {
        return a.lineage_id === lineageId;
    });

    if(matching.length > 1) {
        errors.push(
            "Locus " + locusId +
            ": duplicate associations to " +
            lineageId
        );

        return;
    }

    var retained =
        matching.length === 1
            ? matching[0]
            : null;

    var obsolete = existing.filter(function(a) {
        return retained === null ||
            a.id !== retained.id;
    });

    // These associations should not have region
    // coordinates at this stage of the build.
    //
    // Unexpected coordinates indicate a schema or
    // build-order problem, not a mosaic to reinterpret.

    var regionSpecific = existing.filter(function(a) {
        return a.region_start !== null ||
            a.region_end !== null;
    });

    if(regionSpecific.length > 0) {
        errors.push(
            "Locus " + locusId +
            ": unexpected region-specific associations " +
            "before curator overrides"
        );

        return;
    }

    var desiredId = associationId(
        locusId,
        lineageId
    );

    if(
        retained === null &&
        associationIds[desiredId]
    ) {
        errors.push(
            "Association ID collision: " + desiredId
        );

        return;
    }

    var needsUpdate =
        retained === null ||
        retained.role !== ASSOCIATION_ROLE ||
        retained.evidence !== ASSOCIATION_EVIDENCE ||
        retained.confidence !== ASSOCIATION_CONFIDENCE;

    if(
        obsolete.length === 0 &&
        !needsUpdate
    ) {
        stats.unchanged++;
        return;
    }

    if(retained === null) {
        stats.created++;
    } else if(needsUpdate) {
        stats.updated++;
    }

    if(obsolete.length > 0) {
        stats.replaced++;
    }

    plans.push({
        locus_id: locusId,
        lineage_id: lineageId,
        raw_name: decision.raw_name,
        retained_id: retained ? retained.id : null,
        new_id: desiredId,
        obsolete: obsolete,
        needs_update: needsUpdate
    });
});

// ------------------------------------------------------------
// 8. Preflight summary
// ------------------------------------------------------------

log("==============================================");
log("ERV locus curator decisions");
log("==============================================");

log(
    "TSV rows:                  " +
    stats.rows
);

log(
    "Blank decisions:           " +
    stats.blank
);

log(
    "Nonblank decisions:        " +
    stats.nonblank
);

log(
    "Applicable decisions:      " +
    decisions.length
);

log(
    "Unchanged:                 " +
    stats.unchanged
);

log(
    "New associations:          " +
    stats.created
);

log(
    "Existing associations updated: " +
    stats.updated
);

log(
    "Assignments replaced:      " +
    stats.replaced
);

log("----------------------------------------------");

log(
    "Missing loci (skipped):    " +
    stats.missingLoci
);

log(
    "  Extraction-missing IDs: " +
    stats.knownExtractionMissing
);

log(
    "  Other missing IDs:      " +
    stats.unexpectedMissing
);

log(
    "Excluded classifications: " +
    stats.excludedClassifications
);

log(
    "Unresolved names:          " +
    stats.unresolvedNames
);

log(
    "Ambiguous names:           " +
    stats.ambiguousNames
);

log(
    "Preflight errors:          " +
    errors.length
);

// ------------------------------------------------------------
// Report skipped records
// ------------------------------------------------------------

// Group deliberate exclusions by historical name.
// Avoid printing hundreds of individual MER-61 messages.

var excludedSkipCounts = {};

skipped.forEach(function(item) {
    if(item.reason === "no_internal_erv_homology") {
        excludedSkipCounts[item.decision] =
            (excludedSkipCounts[item.decision] || 0) + 1;

        return;
    }

    log(
        "SKIP: Line " + item.line +
        " " + item.locus_id +
        " [" + item.decision + "]" +
        " reason=" + item.reason
    );
});

Object.keys(excludedSkipCounts)
    .sort()
    .forEach(function(name) {
        log(
            "SKIP EXCLUDED: " + name +
            " count=" + excludedSkipCounts[name] +
            " reason=no_internal_erv_homology"
        );
    });

// ------------------------------------------------------------
// Abort if genuine preflight errors remain
// ------------------------------------------------------------

if(errors.length > 0) {
    errors.forEach(function(message) {
        log("ERROR: " + message);
    });

    throw new Error(
        "Curator decision preflight failed with " +
        errors.length +
        " error(s). No changes written."
    );
}

// ------------------------------------------------------------
// Report planned curator assignments
// ------------------------------------------------------------

plans.forEach(function(plan) {
    log(
        "CURATE " + plan.locus_id +
        " -> " + plan.lineage_id +
        " [" + plan.raw_name + "]" +
        " remove=" + plan.obsolete.length
    );
});

// ------------------------------------------------------------
// 9. Apply curator decisions
// ------------------------------------------------------------

if(DRY_RUN) {
    log("DRY RUN: no database changes made");
} else {
    log(
        "Applying " + plans.length +
        " curator updates"
    );

    plans.forEach(function(plan) {

        // Create the new association if necessary.

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

        // Apply the curator-selected lineage and metadata.

        if(plan.needs_update) {
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

        // Remove superseded initial associations.

        plan.obsolete.forEach(function(a) {
            glue.command([
                "delete",
                "custom-table-row",
                ASSOC_TABLE,
                a.id
            ]);
        });
    });

    log("Curator decisions applied successfully");
}

log("==============================================");