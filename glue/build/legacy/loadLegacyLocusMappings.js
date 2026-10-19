/**
 * loadLegacyLocusMappings.js
 *
 * Load reconciled historical locus records into ERVdb.
 *
 * Input:
 *   tabular/legacy/legacy_loci_reconciled.tsv
 *   tabular/legacy/legacy_locus_component_mappings.tsv
 *
 * Tables:
 *   erv_locus_legacy_xref
 *   erv_locus_alias
 *
 * Responsibilities:
 *   - Preserve historical source records and provenance
 *   - Link accepted records to permanent ERVdb loci
 *   - Create searchable historical aliases
 *
 * Does NOT:
 *   - Reconcile genomic coordinates
 *   - Modify permanent loci
 *   - Assign or alter Missillac IDs
 *
 * Run:
 *   project ervdb run script glue/build/legacy/loadLegacyLocusMappings.js
 *
 * Nashorn-compatible JavaScript.
 */

var INPUT =
    "tabular/legacy/legacy_loci_reconciled.tsv";
var COMPONENT_INPUT =
    "tabular/legacy/legacy_locus_component_mappings.tsv";

// Run dry first; this importer does not delete obsolete xref rows.
var DRY_RUN = false;

var XREF_TABLE = "erv_locus_legacy_xref";
var ALIAS_TABLE = "erv_locus_alias";
var LOCUS_TABLE = "erv_locus";

var ACCEPTED_STATUSES = {
    mapped: true,
    mapped_best_match: true,
    mapped_partial: true
};

var XREF_FIELDS = [
    "legacy_source",
    "legacy_name",
    "pubmed_id",
    "host_species",
    "genome_build",
    "scaffold",
    "start_position",
    "end_position",
    "orientation",
    "legacy_classification",
    "source_numeric_id",
    "source_aliases",
    "source_orthology",
    "source_band",
    "source_note",
    "mapping_status",
    "mapping_method",
    "mapping_relationship"
];

var FIELD_LIMITS = {
    legacy_source: 50,
    legacy_name: 150,
    host_species: 50,
    genome_build: 50,
    scaffold: 100,
    orientation: 10,
    legacy_classification: 100,
    source_numeric_id: 50,
    source_aliases: 500,
    source_orthology: 100,
    source_band: 50,
    source_note: 200,
    mapping_status: 50,
    mapping_method: 50,
    mapping_relationship: 50
};


// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function str(value) {
    return value === null || value === undefined
        ? ""
        : String(value).trim();
}

function esc(value) {
    return str(value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}

function rowPath(table, id) {
    return "custom-table-row/" + table + "/" + id;
}

function rowsOf(result) {
    return glue.tableToObjects(result);
}

function loadTsv(path) {
    var rows;

    glue.inMode("module/tabularUtility", function() {
        rows = rowsOf(glue.command([
            "load-tabular", path
        ]));
    });

    return rows;
}

function exists(table, id) {
    return rowsOf(glue.command([
        "list", "custom-table-row", table,
        "-w", "id = '" + esc(id) + "'",
        "id"
    ])).length > 0;
}

function createIfAbsent(table, id) {
    if(exists(table, id)) {
        return false;
    }

    glue.command([
        "create", "custom-table-row", table, id
    ]);

    return true;
}

function setField(name, value) {
    value = str(value);

    if(value !== "") {
        glue.command([
            "set", "field", name, value
        ]);
    }
}

function setLink(name, table, id) {
    glue.command([
        "set", "link-target", name, rowPath(table, id)
    ]);
}

function hashString(value) {
    // Compatible with the original legacy importer.
    var hash = 0;

    for(var i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash)
             + value.charCodeAt(i);
        hash = hash | 0;
    }

    return "" + (hash >>> 0);
}

function aliasId(locus, source, name) {
    return "la_" + hashString(
        locus + "|" + source + "|" + name.toLowerCase()
    );
}

function xrefId(row, locusId, componentIndex) {
    // Preserve existing IDs for ordinary mappings and the first
    // component. Additional component rows have distinct stable IDs.
    var base = "lx_" + str(row.source_record_id);
    if(componentIndex === undefined || componentIndex === null ||
       componentIndex === 0) {
        return base;
    }
    return base + "__" + locusId;
}

function isAccepted(row) {
    return ACCEPTED_STATUSES[
        str(row.mapping_status)
    ] === true;
}

function splitAliases(value) {
    var values = str(value).split("|");
    var result = [];
    var seen = {};

    for(var i = 0; i < values.length; i++) {
        var name = str(values[i]);

        if(name === "") {
            continue;
        }

        var key = name.toLowerCase();

        if(!seen[key]) {
            seen[key] = true;
            result.push(name);
        }
    }

    return result;
}


// ------------------------------------------------------------
// Explicit curator component mappings
// ------------------------------------------------------------

function loadComponentMappings(rows, sourceRows) {
    var sourceById = {};
    for(var i = 0; i < sourceRows.length; i++) {
        sourceById[str(sourceRows[i].source_record_id)] = sourceRows[i];
    }

    var groups = {};
    var seen = {};
    var errors = [];
    var acceptedRelationships = {
        ervdb_component: true,
        legacy_component: true,
        equivalent: true,
        overlap: true
    };

    for(var j = 0; j < rows.length; j++) {
        var r = rows[j];
        var id = str(r.source_record_id);
        var locus = str(r.erv_locus_id);
        var relationship = str(r.mapping_relationship);
        var label = "Component mapping row " + (j + 2) + ": ";

        if(!id || !sourceById[id]) {
            errors.push(label + "unknown source_record_id: " + id);
        }
        if(!/^RBRT[0-9]+$/.test(locus)) {
            errors.push(label + "invalid erv_locus_id: " + locus);
        }
        if(!acceptedRelationships[relationship]) {
            errors.push(label + "invalid mapping_relationship: " + relationship);
        }
        var key = id + "|" + locus;
        if(seen[key]) {
            errors.push(label + "duplicate source/locus pair: " + key);
        }
        seen[key] = true;
        if(!groups[id]) {
            groups[id] = [];
        }
        groups[id].push({
            locus: locus,
            relationship: relationship
        });
    }

    Object.keys(groups).forEach(function(id) {
        groups[id].sort(function(a, b) {
            return a.locus < b.locus ? -1 : (a.locus > b.locus ? 1 : 0);
        });
    });

    if(errors.length) {
        errors.slice(0, 30).forEach(function(e) {
            glue.log("WARNING", e);
        });
        throw new Error("Invalid component mappings: " + errors.length);
    }
    return groups;
}

function mappingsFor(row, componentGroups) {
    var id = str(row.source_record_id);
    if(componentGroups[id]) {
        return componentGroups[id];
    }
    if(isAccepted(row)) {
        return [{ locus: str(row.matched_locus), relationship: "" }];
    }
    return [];
}

// ------------------------------------------------------------
// Input validation
// ------------------------------------------------------------

function validateRows(rows, componentGroups) {
    var errors = [];
    var seen = {};

    var required = [
        "source_record_id",
        "legacy_source",
        "legacy_name",
        "host_species",
        "genome_build",
        "scaffold",
        "start_position",
        "end_position",
        "mapping_status"
    ];

    var validStatuses = {
        mapped: true,
        mapped_best_match: true,
        mapped_partial: true,
        ambiguous: true,
        unmatched: true,
        low_coverage: true
    };

    for(var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var label = "Input row " + (i + 2) + ": ";

        for(var j = 0; j < required.length; j++) {
            var field = required[j];

            if(str(row[field]) === "") {
                errors.push(label + "missing " + field);
            }
        }

        var recordId = str(row.source_record_id);

        if(recordId !== "") {
            if(!/^[A-Za-z0-9_-]+$/.test(recordId)) {
                errors.push(label + "unsafe source_record_id");
            }

            if(seen[recordId]) {
                errors.push(label + "duplicate source_record_id");
            }

            seen[recordId] = true;
        }

        var status = str(row.mapping_status);

        if(!validStatuses[status]) {
            errors.push(label + "unknown status: " + status);
        }

        if(isAccepted(row) && !componentGroups[recordId] &&
           str(row.matched_locus) === "") {
            errors.push(
                label + "accepted mapping has no matched_locus"
            );
        }

        var start = Number(row.start_position);
        var end = Number(row.end_position);

        if(!isFinite(start) || !isFinite(end) ||
           Math.floor(start) !== start ||
           Math.floor(end) !== end ||
           start < 1 || end < start) {
            errors.push(label + "invalid coordinates");
        }

        for(var fieldName in FIELD_LIMITS) {
            if(str(row[fieldName]).length >
               FIELD_LIMITS[fieldName]) {
                errors.push(
                    label + fieldName + " exceeds schema width"
                );
            }
        }

        var aliases = splitAliases(row.aliases);

        for(var k = 0; k < aliases.length; k++) {
            if(aliases[k].length > 150) {
                errors.push(label + "alias exceeds 150 characters");
            }
        }

        var pubmed = str(row.pubmed_id);

        if(pubmed !== "" && !/^[0-9]+$/.test(pubmed)) {
            errors.push(label + "invalid pubmed_id");
        }

        // Never silently overwrite a manual decision.
        if(str(row.curator_decision) !== "" ||
           str(row.curator_locus) !== "") {
            errors.push(
                label + "curator override requires review"
            );
        }
    }

    if(errors.length > 0) {
        for(var n = 0; n < Math.min(errors.length, 30); n++) {
            glue.log("WARNING", errors[n]);
        }

        throw new Error(
            "Legacy mapping validation failed: " +
            errors.length + " errors"
        );
    }

    glue.logInfo(
        "Input validation passed: " + rows.length + " rows"
    );
}


// ------------------------------------------------------------
// Create historical cross-reference
// ------------------------------------------------------------

function loadXref(row, mapping, componentIndex) {
    var id = xrefId(row, mapping ? mapping.locus : null, componentIndex);
    var created = createIfAbsent(XREF_TABLE, id);

    glue.inMode(rowPath(XREF_TABLE, id), function() {
        for(var i = 0; i < XREF_FIELDS.length; i++) {
            var field = XREF_FIELDS[i];
            if(field === "mapping_relationship") {
                setField(field, mapping ? mapping.relationship : "");
            }
            else if(field === "mapping_status" && mapping) {
                setField(field, "mapped");
            }
            else if(field === "mapping_method" && mapping &&
                    mapping.relationship !== "") {
                setField(field, "curator");
            }
            else {
                setField(field, row[field]);
            }
        }

        if(mapping) {
            setLink("erv_locus", LOCUS_TABLE, mapping.locus);
        }
    });

    return created;
}


// ------------------------------------------------------------
// Create searchable locus alias
// ------------------------------------------------------------

function loadAlias(locusId, source, name) {
    var id = aliasId(locusId, source, name);

    if(!createIfAbsent(ALIAS_TABLE, id)) {
        return false;
    }

    glue.inMode(rowPath(ALIAS_TABLE, id), function() {
        setField("alias_name", name);
        setField("alias_source", source);

        setLink(
            "erv_locus",
            LOCUS_TABLE,
            locusId
        );
    });

    return true;
}


// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

var input = loadTsv(INPUT);

glue.logInfo(
    "Loaded " + input.length + " reconciled legacy records"
);

var componentRows = loadTsv(COMPONENT_INPUT);
var componentGroups = loadComponentMappings(componentRows, input);
validateRows(input, componentGroups);

var summary = {
    input_records: input.length,
    accepted_records: 0,
    unresolved_records: 0,
    proposed_aliases: 0,
    xrefs_created: 0,
    aliases_created: 0,
    component_source_records: Object.keys(componentGroups).length,
    component_links: componentRows.length
};

var aliases = {};
var acceptedLoci = {};

for(var i = 0; i < input.length; i++) {
    var row = input[i];
    var mappings = mappingsFor(row, componentGroups);
    if(mappings.length) {
        summary.accepted_records++;
        var source = str(row.legacy_source);
        var names = splitAliases(row.aliases);
        for(var m = 0; m < mappings.length; m++) {
            var locus = mappings[m].locus;
            acceptedLoci[locus] = true;
            for(var j = 0; j < names.length; j++) {
                var name = names[j];
                var id = aliasId(locus, source, name);
                if(!aliases[id]) {
                    aliases[id] = {
                        locus: locus, source: source, name: name
                    };
                }
            }
        }
    }
    else {
        summary.unresolved_records++;
    }
}

summary.proposed_aliases = Object.keys(aliases).length;

glue.logInfo(
    "Preflight summary: " + JSON.stringify(summary)
);

glue.logInfo(
    "Distinct matched loci: " +
    Object.keys(acceptedLoci).length
);

if(DRY_RUN) {
    glue.logInfo(
        "DRY RUN: no database records changed"
    );
}
else {
    // Validate that target loci exist before writing.
    var missing = [];

    Object.keys(acceptedLoci).forEach(function(id) {
        if(!exists(LOCUS_TABLE, id)) {
            missing.push(id);
        }
    });

    if(missing.length > 0) {
        throw new Error(
            "Missing permanent loci: " +
            missing.slice(0, 20).join(", ") +
            " (total " + missing.length + ")"
        );
    }

    // First preserve every historical record.
    for(var r = 0; r < input.length; r++) {
        var row = input[r];
        var mappings = mappingsFor(row, componentGroups);
        if(mappings.length === 0) {
            if(loadXref(row, null, null)) {
                summary.xrefs_created++;
            }
        }
        else {
            for(var m = 0; m < mappings.length; m++) {
                if(loadXref(row, mappings[m], m)) {
                    summary.xrefs_created++;
                }
            }
        }

        if((r + 1) % 500 === 0) {
            glue.logInfo(
                "Loaded cross-references " +
                (r + 1) + " / " + input.length
            );
        }
    }

    // Then create distinct searchable aliases.
    var keys = Object.keys(aliases).sort();

    for(var a = 0; a < keys.length; a++) {
        var alias = aliases[keys[a]];

        if(loadAlias(
            alias.locus,
            alias.source,
            alias.name
        )) {
            summary.aliases_created++;
        }

        if((a + 1) % 500 === 0) {
            glue.logInfo(
                "Processed aliases " +
                (a + 1) + " / " + keys.length
            );
        }
    }

    glue.logInfo(
        "Legacy mapping import complete"
    );
}

glue.logInfo(
    "Final summary: " + JSON.stringify(summary)
);