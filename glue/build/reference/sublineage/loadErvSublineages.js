/**
 * glue/build/reference/sublineage/loadErvSublineages.js
 *
 * Load curated ERV sublineage and related records from
 * tabular/reference/sublineage/herv_sublineage_data.tsv.
 *
 * lineage_id identifies an erv_lineage record.
 * sequenceID identifies its sequence in source erv-sub and is used as
 * the erv_lineage_reference row ID.
 */

var INPUT_PATH =
    "tabular/reference/sublineage/herv_sublineage_data.tsv";

var ERV_SOURCE = "erv-sub";

var REFERENCE_ROLES = ["canonical", "alternative"];
var REFERENCE_STATUSES =
    ["draft", "active", "superseded", "withdrawn"];
var DERIVATION_METHODS = [
    "representative_locus",
    "consensus",
    "ancestral_reconstruction",
    "synthetic_reconstruction",
    "unknown"
];
var REPRESENTED_FORMS = [
    "proviral_genome",
    "env_less_genome",
    "transcript_derived_genome",
    "unresolved"
];
var REFERENCE_COMPLETENESS_VALUES =
    ["complete", "fragmentary", "unknown"];
var FRAGMENT_EXTENTS =
    ["five_prime", "three_prime", "internal", "envelope", "other", "unknown"];


function log(message) {
    glue.logInfo(message);
}

function norm(value) {
    if(value === null || value === undefined) {
        return null;
    }

    var text = ("" + value).trim();

    if(text === "") {
        return null;
    }

    var lower = text.toLowerCase();

    if(
        lower === "n/a" ||
        lower === "na" ||
        lower === "null" ||
        lower === "none"
    ) {
        return null;
    }

    return text;
}

function escapeQuotes(value) {
    return ("" + value).replace(/'/g, "\\'");
}

function customRowPath(tableName, rowId) {
    return "custom-table-row/" + tableName + "/" + rowId;
}

function loadTsv(path) {
    var rows;

    glue.inMode("module/tabularUtility", function() {
        rows = glue.tableToObjects(
            glue.command(["load-tabular", path])
        );
    });

    return rows;
}

function listCustomRows(tableName, rowId, columns) {
    var command = [
        "list",
        "custom-table-row",
        tableName
    ];

    Array.prototype.push.apply(command, columns);

    command.push(
        "-w",
        "id = '" + escapeQuotes(rowId) + "'"
    );

    return glue.tableToObjects(glue.command(command));
}

function ensureCustomRow(tableName, rowId) {
    rowId = norm(rowId);

    if(rowId === null) {
        return false;
    }

    if(listCustomRows(tableName, rowId, ["id"]).length > 0) {
        return false;
    }

    glue.command([
        "create",
        "custom-table-row",
        tableName,
        rowId
    ]);

    log("Created " + tableName + "/" + rowId);
    return true;
}

function sequenceExists(sourceName, sequenceID) {
    return glue.tableToObjects(
        glue.command([
            "list",
            "sequence",
            "source.name",
            "sequenceID",
            "-w",
            "source.name = '" +
                escapeQuotes(sourceName) +
                "' and sequenceID = '" +
                escapeQuotes(sequenceID) +
                "'"
        ])
    ).length > 0;
}

function setStringFieldIfPresent(fieldName, value) {
    value = norm(value);

    if(value !== null) {
        glue.command(["set", "field", fieldName, value]);
    }
}

function setIntegerFieldIfPresent(fieldName, value) {
    value = norm(value);

    if(value === null) {
        return;
    }

    if(!/^-?\d+$/.test(value)) {
        throw new Error(
            "Invalid integer '" + value + "' for " + fieldName
        );
    }

    glue.command(["set", "field", fieldName, value]);
}

function setBooleanFieldIfPresent(fieldName, value) {
    value = norm(value);

    if(value === null) {
        return;
    }

    var upper = value.toUpperCase();

    if(upper !== "TRUE" && upper !== "FALSE") {
        throw new Error(
            "Invalid Boolean '" + value + "' for " + fieldName
        );
    }

    glue.command([
        "set",
        "field",
        fieldName,
        upper === "TRUE" ? "true" : "false"
    ]);
}

function setControlledFieldIfPresent(
    fieldName,
    value,
    allowedValues
) {
    value = norm(value);

    if(value === null) {
        return;
    }

    if(allowedValues.indexOf(value) === -1) {
        throw new Error(
            "Invalid " + fieldName + " '" + value +
            "'; expected: " + allowedValues.join(", ")
        );
    }

    setStringFieldIfPresent(fieldName, value);
}

function setLinkIfPresent(linkName, tableName, rowId) {
    rowId = norm(rowId);

    if(rowId !== null) {
        glue.command([
            "set",
            "link-target",
            linkName,
            customRowPath(tableName, rowId)
        ]);
    }
}


// ---------------------------------------------------------------------------
// Load and validate before making changes
// ---------------------------------------------------------------------------

var rows = loadTsv(INPUT_PATH);

log(
    "Loaded " + rows.length +
    " ERV sublineage rows from " + INPUT_PATH
);

log("Preflight: validating ERV identifiers and references");

var seenLineageIds = {};
var seenReferenceIds = {};
var newLineageCount = 0;
var existingLineageCount = 0;

_.each(rows, function(row) {
    var lineageId = norm(row["lineage_id"]);
    var sequenceID = norm(row["sequenceID"]);
    var entityType = norm(row["entity_type"]);

    if(lineageId === null) {
        throw new Error(
            "Missing lineage_id: " + JSON.stringify(row)
        );
    }

    if(entityType === null) {
        throw new Error(
            "Missing entity_type for '" + lineageId + "'"
        );
    }

    if(seenLineageIds[lineageId]) {
        throw new Error(
            "Duplicate lineage_id '" + lineageId + "'"
        );
    }

    seenLineageIds[lineageId] = true;

    if(sequenceID !== null) {
        if(seenReferenceIds[sequenceID]) {
            throw new Error(
                "Duplicate sequenceID '" + sequenceID + "'"
            );
        }

        seenReferenceIds[sequenceID] = true;

        if(!sequenceExists(ERV_SOURCE, sequenceID)) {
            throw new Error(
                "Reference sequence " + ERV_SOURCE + "/" +
                sequenceID + " not found for '" + lineageId + "'"
            );
        }
    }

    var existing = listCustomRows(
        "erv_lineage",
        lineageId,
        ["id", "entity_type", "legacy_name"]
    );

    if(existing.length > 1) {
        throw new Error(
            "Multiple erv_lineage rows found for '" +
            lineageId + "'"
        );
    }

    if(existing.length === 0) {
        newLineageCount++;
        return;
    }

    var existingType = norm(existing[0].entity_type);

    if(
        existingType !== null &&
        existingType !== entityType
    ) {
        throw new Error(
            "Cannot load '" + lineageId +
            "' as entity_type '" + entityType +
            "': the existing erv_lineage has entity_type '" +
            existingType + "'"
        );
    }

    existingLineageCount++;
});

log(
    "Preflight successful: " + newLineageCount +
    " new IDs; " + existingLineageCount +
    " existing IDs"
);


// ---------------------------------------------------------------------------
// Pass 1: create lineage, reference and taxonomy rows
// ---------------------------------------------------------------------------

_.each(rows, function(row) {
    var lineageId = norm(row["lineage_id"]);
    var sequenceID = norm(row["sequenceID"]);

    ensureCustomRow("erv_lineage", lineageId);

    if(sequenceID !== null) {
        ensureCustomRow(
            "erv_lineage_reference",
            sequenceID
        );
    }

    ensureCustomRow(
        "rv_major_clade",
        row["major_clade"]
    );
    ensureCustomRow(
        "rv_minor_clade",
        row["minor_clade"]
    );
    ensureCustomRow("rv_genus", row["genus"]);
    ensureCustomRow("rv_subgenus", row["subgenus"]);
});

log("Created/verified lineage, reference and taxonomy rows");


// ---------------------------------------------------------------------------
// Pass 2: establish relationships between taxonomy ranks
// ---------------------------------------------------------------------------

_.each(rows, function(row) {
    var majorCladeId = norm(row["major_clade"]);
    var minorCladeId = norm(row["minor_clade"]);
    var genusId = norm(row["genus"]);
    var subgenusId = norm(row["subgenus"]);

    if(subgenusId !== null && genusId !== null) {
        glue.inMode(
            customRowPath("rv_subgenus", subgenusId),
            function() {
                setLinkIfPresent(
                    "rv_genus",
                    "rv_genus",
                    genusId
                );
            }
        );
    }

    if(genusId !== null && minorCladeId !== null) {
        glue.inMode(
            customRowPath("rv_genus", genusId),
            function() {
                setLinkIfPresent(
                    "rv_minor_clade",
                    "rv_minor_clade",
                    minorCladeId
                );
            }
        );
    }

    if(minorCladeId !== null && majorCladeId !== null) {
        glue.inMode(
            customRowPath("rv_minor_clade", minorCladeId),
            function() {
                setLinkIfPresent(
                    "rv_major_clade",
                    "rv_major_clade",
                    majorCladeId
                );
            }
        );
    }
});

log("Established taxonomy-rank relationships");


// ---------------------------------------------------------------------------
// Pass 3: populate lineage and reference metadata
// ---------------------------------------------------------------------------

var referencesLinked = 0;
var rowsWithoutSequence = 0;

_.each(rows, function(row) {
    var lineageId = norm(row["lineage_id"]);
    var sequenceID = norm(row["sequenceID"]);

    glue.inMode(
        customRowPath("erv_lineage", lineageId),
        function() {
            setStringFieldIfPresent(
                "legacy_name",
                row["legacy_name"]
            );
            setStringFieldIfPresent(
                "legacy_full_name",
                row["legacy_full_name"]
            );
            setStringFieldIfPresent(
                "entity_type",
                row["entity_type"]
            );
            setStringFieldIfPresent(
                "status",
                row["status"]
            );
            setStringFieldIfPresent(
                "parent_lineage",
                row["parent_lineage"]
            );
            setStringFieldIfPresent(
                "description",
                row["description"]
            );
            setStringFieldIfPresent(
                "notes",
                row["notes"]
            );

            setBooleanFieldIfPresent(
                "human_erv",
                row["human_erv"]
            );

            setLinkIfPresent(
                "rv_major_clade",
                "rv_major_clade",
                row["major_clade"]
            );
            setLinkIfPresent(
                "rv_minor_clade",
                "rv_minor_clade",
                row["minor_clade"]
            );
            setLinkIfPresent(
                "rv_genus",
                "rv_genus",
                row["genus"]
            );
            setLinkIfPresent(
                "rv_subgenus",
                "rv_subgenus",
                row["subgenus"]
            );
        }
    );

    if(sequenceID === null) {
        rowsWithoutSequence++;
        return;
    }

    glue.inMode(
        customRowPath(
            "erv_lineage_reference",
            sequenceID
        ),
        function() {
            setControlledFieldIfPresent(
                "reference_role",
                row["reference_role"],
                REFERENCE_ROLES
            );
            setControlledFieldIfPresent(
                "reference_status",
                row["reference_status"],
                REFERENCE_STATUSES
            );
            setControlledFieldIfPresent(
                "derivation_method",
                row["derivation_method"],
                DERIVATION_METHODS
            );
            setControlledFieldIfPresent(
                "represented_form",
                row["represented_form"],
                REPRESENTED_FORMS
            );
            setControlledFieldIfPresent(
                "reference_completeness",
                row["reference_completeness"],
                REFERENCE_COMPLETENESS_VALUES
            );
            setControlledFieldIfPresent(
                "fragment_extent",
                row["fragment_extent"],
                FRAGMENT_EXTENTS
            );

            setIntegerFieldIfPresent(
                "num_input_sequences",
                row["num_seqs"]
            );
            setIntegerFieldIfPresent(
                "architecture_level",
                row["architecture_level"]
            );
            setIntegerFieldIfPresent(
                "coding_level",
                row["coding_level"]
            );
            setIntegerFieldIfPresent(
                "validation_level",
                row["validation_level"]
            );

            setStringFieldIfPresent(
                "accession",
                row["accession"]
            );
            setStringFieldIfPresent(
                "pubmed_id",
                row["pubmed_id"]
            );

            setLinkIfPresent(
                "erv_lineage",
                "erv_lineage",
                lineageId
            );
        }
    );

    glue.inMode(
        "sequence/" + ERV_SOURCE + "/" + sequenceID,
        function() {
            glue.command([
                "set",
                "link-target",
                "erv_lineage_reference",
                customRowPath(
                    "erv_lineage_reference",
                    sequenceID
                )
            ]);
        }
    );

    referencesLinked++;
});

log(
    "Linked " + referencesLinked +
    " ERV sublineage reference sequences"
);
log(
    rowsWithoutSequence +
    " records had no reference sequence"
);
log("ERV sublineage loading complete");

