
/**
 * selectErvLocusCandidates.js
 *
 * Select ERV locus candidates from the merged RBRT TSV.
 *
 * Selection evidence, in priority order:
 *
 *   1. phylogeny_name
 *   2. subgroup_out
 *   3. names
 *
 * Each field may contain multiple comma-separated names.
 * A locus is included if ANY name in ANY of these fields
 * resolves to a recognised ERV lineage, sublineage, ERVR,
 * or ERV-associated LTR lineage.
 *
 * Name resolution:
 *
 *   - Direct erv_lineage.id match
 *   - Direct ERV-associated ltr_lineage.id match
 *   - source_name -> erv_lineage_id via
 *     erv_locus_name_mappings.tsv
 *
 * The mapped erv_lineage_id must exist in erv_lineage.
 *
 * Exact matches take precedence over normalised matches.
 * Normalisation ignores case, spaces, hyphens and underscores.
 * Conflicting normalised mappings are fatal.
 *
 * names_decision is used for reporting, not selection.
 * No filtering by case or taxonomic resolution.
 *
 * Original input rows are written verbatim.
 */

var INPUT_FILE =
    "tabular/merge/HERVs-RBRT-name_new.tsv";

var MAPPINGS_FILE =
    "tabular/locus/erv_locus_name_mappings.tsv";

var OUTPUT_FILE =
    "tabular/locus/HERVs-RBRT-filtered.tsv";

var BUILD_DIR = "tabular/build/";

var SUMMARY_FILE =
    BUILD_DIR + "candidate_selection_summary.tsv";

var RAW_NAME_SUMMARY_FILE =
    BUILD_DIR + "candidate_selection_by_raw_name.tsv";

var NAMES_DECISION_SUMMARY_FILE =
    BUILD_DIR + "candidate_selection_by_names_decision.tsv";

var RAW_NAME_VS_DECISION_FILE =
    BUILD_DIR + "candidate_selection_raw_name_vs_decision.tsv";

var NAME_SET_SUMMARY_FILE =
    BUILD_DIR + "candidate_selection_by_name_set.tsv";

var MATCH_TYPE_FILE =
    BUILD_DIR + "candidate_selection_by_match_type.tsv";

var FIELD_SUMMARY_FILE =
    BUILD_DIR + "candidate_selection_by_evidence_field.tsv";

var PROGRESS_INTERVAL = 50000;

var BufferedReader = Java.type("java.io.BufferedReader");
var FileReader = Java.type("java.io.FileReader");
var BufferedWriter = Java.type("java.io.BufferedWriter");
var FileWriter = Java.type("java.io.FileWriter");

// ============================================================
// Helpers
// ============================================================

function log(message) {
    glue.logInfo("" + message);
}

function norm(value) {
    if(value === null || value === undefined)
        return null;

    var s = ("" + value).trim();

    if(!s || /^(n\/a|na|null|none)$/i.test(s))
        return null;

    return s;
}

function normaliseName(value) {
    var s = norm(value);

    if(s === null)
        return null;

    return s.toUpperCase().trim();
}

function percentage(part, total) {
    return total ? 100.0 * part / total : 0;
}

function listIds(table) {
    var rows = glue.tableToObjects(
        glue.command([
            "list", "custom-table-row", table, "id"
        ])
    );

    var result = {};

    _.each(rows, function(row) {
        var id = norm(row.id);

        if(id !== null)
            result[id] = true;
    });

    return result;
}

function saveTabular(file, rows, columns, resultName) {
    var dataRows = [];

    _.each(rows, function(row) {
        dataRows.push({
            value: _.map(columns, function(column) {
                var value = row[column];

                return value === undefined ? null : value;
            })
        });
    });

    var tabularData = {};

    tabularData[resultName] = {
        column: columns,
        row: dataRows
    };

    glue.inMode("module/tabularUtility", function() {
        glue.command({
            "save-tabular": {
                "fileName": file,
                "tabularData": tabularData
            }
        });
    });

    log("Wrote " + file + " (" + rows.length + " rows)");
}

function readTsv(file, requiredColumns) {
    var reader = new BufferedReader(new FileReader(file));

    try {
        var header = reader.readLine();

        if(header === null)
            throw new Error("Empty TSV: " + file);

        var columns = header
            .replace(/^\uFEFF/, "")
            .split("\t");

        _.each(requiredColumns, function(column) {
            if(columns.indexOf(column) < 0)
                throw new Error(
                    file + ": missing column " + column
                );
        });

        var result = [];
        var line;
        var lineNo = 1;

        while((line = reader.readLine()) !== null) {
            lineNo++;

            if(!line.trim())
                continue;

            var values = line.split("\t");
            var row = {_line: lineNo};

            _.each(columns, function(column, index) {
                row[column] = values[index] || "";
            });

            result.push(row);
        }

        return result;

    } finally {
        reader.close();
    }
}

function splitNames(value) {
    var s = norm(value);

    if(s === null)
        return [];

    var seen = {};
    var result = [];

    _.each(s.split(","), function(token) {
        var name = norm(token);

        if(name !== null && !seen[name]) {
            seen[name] = true;
            result.push(name);
        }
    });

    return result;
}

function nameSet(names) {
    if(names.length === 0)
        return "(none)";

    return names.slice().sort().join(" + ");
}

function increment(map, key, included) {
    if(!map[key])
        map[key] = {included: 0, excluded: 0};

    if(included)
        map[key].included++;
    else
        map[key].excluded++;
}

function summaryRows(map, keyColumn) {
    var result = [];

    _.each(_.keys(map), function(key) {
        var item = map[key];
        var row = {};

        row[keyColumn] = key;
        row.included_loci = item.included;
        row.excluded_loci = item.excluded;
        row.total_loci = item.included + item.excluded;

        result.push(row);
    });

    result.sort(function(a, b) {
        if(b.total_loci !== a.total_loci)
            return b.total_loci - a.total_loci;

        return a[keyColumn].localeCompare(b[keyColumn]);
    });

    return result;
}

// ============================================================
// 1. Build recognised ERV repertoire
// ============================================================

log("Loading recognised ERV lineages");

var ervIds = listIds("erv_lineage");
var ltrIds = listIds("ltr_lineage");

var recognisedNames = {};
var recognisedTypes = {};

_.each(_.keys(ervIds), function(id) {
    recognisedNames[id] = true;
    recognisedTypes[id] = "ERV";
});

var associations = glue.tableToObjects(
    glue.command([
        "list",
        "custom-table-row",
        "erv_lineage_ltr_assoc",
        "erv_lineage.id",
        "ltr_lineage.id"
    ])
);

var associatedLtrIds = {};

_.each(associations, function(row) {
    var ervId = norm(row["erv_lineage.id"]);
    var ltrId = norm(row["ltr_lineage.id"]);

    if(
        ervId !== null &&
        ltrId !== null &&
        ervIds[ervId] === true &&
        ltrIds[ltrId] === true
    ) {
        associatedLtrIds[ltrId] = true;
        recognisedNames[ltrId] = true;
        recognisedTypes[ltrId] = "ERV-associated LTR";
    }
});

log("ERV lineages/sublineages/ERVRs: " +
    _.keys(ervIds).length);

log("LTR lineages: " + _.keys(ltrIds).length);

log("ERV-associated LTR lineages: " +
    _.keys(associatedLtrIds).length);

// ============================================================
// 2. Load source-name mappings
// ============================================================

log("Loading locus name mappings from " + MAPPINGS_FILE);

var mappingRows = readTsv(MAPPINGS_FILE, [
    "source_name",
    "entity_type",
    "erv_lineage_id"
]);

var mappedNames = {};
var normalisedMappings = {};

var acceptedMappings = 0;
var rejectedMappings = 0;

_.each(mappingRows, function(row) {
    var sourceName = norm(row.source_name);
    var type = norm(row.entity_type);
    var target = norm(row.erv_lineage_id);

    if(type === "ervr")
        type = "erv_derived_repeat";

    var validType =
        type === "lineage" ||
        type === "sublineage" ||
        type === "erv_derived_repeat";

    if(
        sourceName === null ||
        target === null ||
        !validType ||
        ervIds[target] !== true
    ) {
        rejectedMappings++;
        return;
    }

    if(
        mappedNames[sourceName] !== undefined &&
        mappedNames[sourceName] !== target
    ) {
        throw new Error(
            "Conflicting mapping for " + sourceName +
            " at line " + row._line
        );
    }

    mappedNames[sourceName] = target;

    var key = normaliseName(sourceName);

    if(
        normalisedMappings[key] !== undefined &&
        normalisedMappings[key] !== target
    ) {
        throw new Error(
            "Conflicting normalised mappings for " +
            sourceName + " at line " + row._line +
            ": " + normalisedMappings[key] +
            " versus " + target
        );
    }

    normalisedMappings[key] = target;
    acceptedMappings++;
});

// Also allow normalised matching to direct canonical IDs.
// Check for conflicts with existing source-name mappings.

_.each(_.keys(recognisedNames), function(id) {
    var key = normaliseName(id);

    if(
        normalisedMappings[key] !== undefined &&
        normalisedMappings[key] !== id
    ) {
        throw new Error(
            "Normalised name collision for canonical ID " +
            id + ": maps to " + normalisedMappings[key]
        );
    }

    normalisedMappings[key] = id;
});

log("Accepted name mappings: " + acceptedMappings);
log("Rejected name mappings: " + rejectedMappings);

// ============================================================
// 3. Name resolution
// ============================================================

function resolveName(name) {
    if(recognisedNames[name] === true) {
        return {
            target: name,
            method: "direct"
        };
    }

    if(mappedNames[name] !== undefined) {
        return {
            target: mappedNames[name],
            method: "mapped"
        };
    }

    var key = normaliseName(name);

    if(
        key !== null &&
        normalisedMappings[key] !== undefined
    ) {
        return {
            target: normalisedMappings[key],
            method: "normalised"
        };
    }

    return null;
}

function evaluateNames(names) {
    var matches = [];

    _.each(names, function(name) {
        var resolved = resolveName(name);

        if(resolved !== null) {
            matches.push({
                source_name: name,
                target: resolved.target,
                method: resolved.method
            });
        }
    });

    return matches;
}

// ============================================================
// 4. Initialise counters
// ============================================================

var processedCount = 0;
var includedCount = 0;
var excludedCount = 0;

var rawNameCounts = {};
var decisionCounts = {};
var pairCounts = {};
var nameSetCounts = {};
var matchTypeCounts = {};
var fieldCounts = {};

// ============================================================
// 5. Stream merged locus TSV
// ============================================================

var reader = new BufferedReader(
    new FileReader(INPUT_FILE)
);

var writer = new BufferedWriter(
    new FileWriter(OUTPUT_FILE)
);

try {
    var header = reader.readLine();

    if(header === null)
        throw new Error("Empty input: " + INPUT_FILE);

    var columns = header
        .replace(/^\uFEFF/, "")
        .split("\t");

    var namesIndex = columns.indexOf("names");
    var subgroupIndex = columns.indexOf("subgroup_out");
    var phylogenyIndex = columns.indexOf("phylogeny_name");
    var decisionIndex = columns.indexOf("names_decision");

    if(namesIndex < 0)
        throw new Error("Missing names column");

    if(subgroupIndex < 0)
        throw new Error("Missing subgroup_out column");

    if(phylogenyIndex < 0)
        throw new Error("Missing phylogeny_name column");

    if(decisionIndex < 0)
        throw new Error("Missing names_decision column");

    writer.write(header);
    writer.newLine();

    log("Streaming loci from " + INPUT_FILE);
    log("Selection priority: phylogeny_name > subgroup_out > names");

    var line;

    while((line = reader.readLine()) !== null) {
        processedCount++;

        var values = line.split("\t");

        var phylogenyNames =
            splitNames(values[phylogenyIndex]);

        var subgroupNames =
            splitNames(values[subgroupIndex]);

        var rawNames =
            splitNames(values[namesIndex]);

        // Evaluate all three fields independently.

        var phylogenyMatches =
            evaluateNames(phylogenyNames);

        var subgroupMatches =
            evaluateNames(subgroupNames);

        var rawMatches =
            evaluateNames(rawNames);

        // Select the highest-priority field with
        // at least one recognised match.

        var selectedMatches = [];
        var evidenceField = "none";

        if(phylogenyMatches.length > 0) {
            selectedMatches = phylogenyMatches;
            evidenceField = "phylogeny_name";

        } else if(subgroupMatches.length > 0) {
            selectedMatches = subgroupMatches;
            evidenceField = "subgroup_out";

        } else if(rawMatches.length > 0) {
            selectedMatches = rawMatches;
            evidenceField = "names";
        }

        var included = selectedMatches.length > 0;

        // Classify how the winning field matched.

        var hasDirect = false;
        var hasMapped = false;
        var hasNormalised = false;

        _.each(selectedMatches, function(match) {
            if(match.method === "direct")
                hasDirect = true;

            if(match.method === "mapped")
                hasMapped = true;

            if(match.method === "normalised")
                hasNormalised = true;
        });

        var matchType;

        if(!included) {
            matchType = "unrecognised";

        } else if(hasDirect && (hasMapped || hasNormalised)) {
            matchType = "direct_and_mapped";

        } else if(hasDirect) {
            matchType = "direct_only";

        } else if(hasMapped && hasNormalised) {
            matchType = "mapped_and_normalised";

        } else if(hasMapped) {
            matchType = "mapped_only";

        } else {
            matchType = "normalised_only";
        }

        increment(matchTypeCounts, matchType, included);
        increment(fieldCounts, evidenceField, included);

        if(included) {
            writer.write(line);
            writer.newLine();
            includedCount++;
        } else {
            excludedCount++;
        }

        // ----------------------------------------------------
        // Audit by individual raw name
        // ----------------------------------------------------

        if(rawNames.length === 0) {
            increment(rawNameCounts, "(none)", included);
        } else {
            _.each(rawNames, function(name) {
                increment(rawNameCounts, name, included);
            });
        }

        // ----------------------------------------------------
        // Audit by names_decision
        // ----------------------------------------------------

        var decision = norm(values[decisionIndex]);

        if(decision === null)
            decision = "(none)";

        increment(decisionCounts, decision, included);

        // ----------------------------------------------------
        // Raw name versus names_decision
        // ----------------------------------------------------

        var namesForPairs =
            rawNames.length ? rawNames : ["(none)"];

        _.each(namesForPairs, function(name) {
            increment(
                pairCounts,
                name + "\t" + decision,
                included
            );
        });

        // ----------------------------------------------------
        // Audit by complete raw-name set
        // ----------------------------------------------------

        increment(
            nameSetCounts,
            nameSet(rawNames),
            included
        );

        if(processedCount % PROGRESS_INTERVAL === 0) {
            log(
                "Processed " + processedCount +
                ": " + includedCount + " included, " +
                excludedCount + " excluded"
            );
        }
    }

} finally {
    reader.close();
    writer.close();
}

// ============================================================
// 6. Overall summary
// ============================================================

saveTabular(
    SUMMARY_FILE,
    [
        {
            status: "included",
            count: includedCount,
            percent: percentage(includedCount, processedCount)
        },
        {
            status: "excluded",
            count: excludedCount,
            percent: percentage(excludedCount, processedCount)
        },
        {
            status: "total",
            count: processedCount,
            percent: 100.0
        }
    ],
    ["status", "count", "percent"],
    "candidateSelectionSummary"
);

// ============================================================
// 7. Match-type audit
// ============================================================

var matchRows = [];

_.each(_.keys(matchTypeCounts).sort(), function(type) {
    matchRows.push({
        match_type: type,
        included_loci: matchTypeCounts[type].included,
        excluded_loci: matchTypeCounts[type].excluded
    });
});

saveTabular(
    MATCH_TYPE_FILE,
    matchRows,
    ["match_type", "included_loci", "excluded_loci"],
    "candidateSelectionByMatchType"
);

// ============================================================
// 8. Evidence-field audit
// ============================================================

var fieldRows = [];

_.each(_.keys(fieldCounts).sort(), function(field) {
    fieldRows.push({
        evidence_field: field,
        included_loci: fieldCounts[field].included,
        excluded_loci: fieldCounts[field].excluded,
        total_loci:
            fieldCounts[field].included +
            fieldCounts[field].excluded
    });
});

saveTabular(
    FIELD_SUMMARY_FILE,
    fieldRows,
    [
        "evidence_field",
        "included_loci",
        "excluded_loci",
        "total_loci"
    ],
    "candidateSelectionByEvidenceField"
);

// ============================================================
// 9. Raw-name summary
// ============================================================

var rawRows = summaryRows(
    rawNameCounts,
    "raw_name"
);

_.each(rawRows, function(row) {
    var name = row.raw_name;
    var resolved = resolveName(name);

    if(recognisedTypes[name] !== undefined) {
        row.recognised_type = recognisedTypes[name];

    } else if(resolved !== null) {
        row.recognised_type =
            "Mapped ERV name (" + resolved.method + ")";

    } else {
        row.recognised_type = "";
    }
});

saveTabular(
    RAW_NAME_SUMMARY_FILE,
    rawRows,
    [
        "raw_name",
        "recognised_type",
        "included_loci",
        "excluded_loci",
        "total_loci"
    ],
    "candidateSelectionByRawName"
);

// ============================================================
// 10. names_decision summary
// ============================================================

saveTabular(
    NAMES_DECISION_SUMMARY_FILE,
    summaryRows(decisionCounts, "names_decision"),
    [
        "names_decision",
        "included_loci",
        "excluded_loci",
        "total_loci"
    ],
    "candidateSelectionByNamesDecision"
);

// ============================================================
// 11. Raw name versus names_decision
// ============================================================

var pairRows = [];

_.each(_.keys(pairCounts), function(key) {
    var parts = key.split("\t");
    var counts = pairCounts[key];

    pairRows.push({
        raw_name: parts[0],
        names_decision: parts[1],
        included_loci: counts.included,
        excluded_loci: counts.excluded,
        total_loci: counts.included + counts.excluded
    });
});

pairRows.sort(function(a, b) {
    if(b.total_loci !== a.total_loci)
        return b.total_loci - a.total_loci;

    var c = a.raw_name.localeCompare(b.raw_name);

    return c !== 0
        ? c
        : a.names_decision.localeCompare(b.names_decision);
});

saveTabular(
    RAW_NAME_VS_DECISION_FILE,
    pairRows,
    [
        "raw_name",
        "names_decision",
        "included_loci",
        "excluded_loci",
        "total_loci"
    ],
    "candidateSelectionRawNameVsDecision"
);

// ============================================================
// 12. Raw-name-set summary
// ============================================================

saveTabular(
    NAME_SET_SUMMARY_FILE,
    summaryRows(nameSetCounts, "name_set"),
    [
        "name_set",
        "included_loci",
        "excluded_loci",
        "total_loci"
    ],
    "candidateSelectionByNameSet"
);

// ============================================================
// 13. Final report
// ============================================================

log("==============================================");
log("ERV locus candidate selection complete");
log("==============================================");

log("Total loci:    " + processedCount);
log("Included loci: " + includedCount);
log("Excluded loci: " + excludedCount);

log("----------------------------------------------");
log("Selection by evidence field:");

_.each(_.keys(fieldCounts).sort(), function(field) {
    log(
        field + ": " +
        fieldCounts[field].included + " included, " +
        fieldCounts[field].excluded + " excluded"
    );
});

log("----------------------------------------------");
log("Selection by match type:");

_.each(_.keys(matchTypeCounts).sort(), function(type) {
    log(
        type + ": " +
        matchTypeCounts[type].included + " included, " +
        matchTypeCounts[type].excluded + " excluded"
    );
});

log("----------------------------------------------");
log("Output: " + OUTPUT_FILE);
log("Finished.");
