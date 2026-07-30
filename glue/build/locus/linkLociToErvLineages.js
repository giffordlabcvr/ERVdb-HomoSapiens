// glue/build/locus/hervLinkLociToErvLineages.js
//
// Link imported HERV loci to curated ERV proviral lineage concepts via
// erv_locus_lineage_assoc, using erv_locus.classification as the primary
// mapping input.
//
// In addition to creating/reusing lineage associations, this script writes a
// reproducible mapping audit and summary statistics describing the composition
// and current curation state of the imported ~8K HERV locus set.
//
// Assumptions:
// 1. Sequence rows are already linked to erv_locus rows.
// 2. erv_locus row ID == sequenceID.
// 3. erv_locus.classification contains the curated/cleaned mapping label.
// 4. erv_lineage rows already exist.
// 5. erv_lineage_alias rows may exist to support name resolution.
//
// Mapping strategy:
//   - try exact erv_lineage ID match;
//   - try systematic name normalisation;
//   - try erv_lineage_alias lookup using each candidate name.
//
// Output files are written beneath OUTPUT_DIR:
//   herv_locus_mapping_audit.tsv
//   herv_locus_mapping_summary.tsv
//   herv_locus_mapping_by_source.tsv
//   herv_locus_mapping_by_lineage.tsv
//   herv_locus_mapping_by_classification.tsv
//   herv_locus_mapping_by_tax_level.tsv
//   herv_locus_mapping_by_method.tsv
//   herv_locus_mapping_exceptions.tsv
//
// Notes:
//   - every input locus receives exactly one mapping_outcome in the audit;
//   - existing association rows are reused;
//   - duplicate alias mappings are treated as ambiguous and are not linked;
//   - broad/non-lineage classifications are retained in the audit but skipped;
//   - DRY_RUN suppresses database changes but still produces reports.

var File = Java.type("java.io.File");
var FileWriter = Java.type("java.io.FileWriter");
var BufferedWriter = Java.type("java.io.BufferedWriter");

var sources = [

    "filtered_2026_07",

    "fr_rt4_samerow",
    "fr_samename",
    "fr_only1id",
    "fr_harlequin",

    "r_rt4_phyloclade",
    "r_rt4_phylosubgroup",
    "r_rt4_phylogroup",
    "r_rt4_phyloname"
];

var DRY_RUN = false;
var WRITE_AUDIT = true;
var OUTPUT_DIR = "tabular/build/locus/lineage-mapping";

var LOCUS_FIELDS = [
    "raw_classification",
    "classification",
    "assignment_status",
    "assignment_basis",
    "tax_level",
    "is_mosaic",
    "locus_category",
    "curation_tier",
    "merge_status",
    "has_internal"
];

function log(msg) {
    glue.log("INFO", msg);
}

function warn(msg) {
    glue.log("WARNING", msg);
}

function norm(value) {
    if(value == null) {
        return null;
    }
    var s = ("" + value).trim();
    if(s === "") {
        return null;
    }
    var low = s.toLowerCase();
    if(low === "null" || low === "na" || low === "n/a" || low === "none") {
        return null;
    }
    return s;
}

function lower(value) {
    var v = norm(value);
    return v == null ? null : v.toLowerCase();
}

function escapeQuotes(value) {
    return ("" + value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}

function tsv(value) {
    if(value == null) {
        return "";
    }
    return ("" + value)
        .replace(/\t/g, " ")
        .replace(/\r?\n/g, " ");
}

function getListRows(resultObj) {
    if(resultObj == null ||
            resultObj.listResult == null ||
            resultObj.listResult.row == null) {
        return [];
    }
    return resultObj.listResult.row;
}

function getColumnIndex(resultObj, columnName) {
    if(resultObj == null ||
            resultObj.listResult == null ||
            resultObj.listResult.column == null) {
        return -1;
    }

    var columns = resultObj.listResult.column;

    for(var i = 0; i < columns.length; i++) {
        if(columns[i] === columnName) {
            return i;
        }
    }

    return -1;
}

function getCell(rowObj, colIndex) {
    if(rowObj == null || rowObj.value == null) {
        return null;
    }

    if(colIndex < 0 || colIndex >= rowObj.value.length) {
        return null;
    }

    return rowObj.value[colIndex];
}

function rowExists(tableName, whereClause) {
    var result = glue.command([
        "list",
        "custom-table-row",
        tableName,
        "-w",
        whereClause
    ]);

    return getListRows(result).length > 0;
}

function customRowExistsById(tableName, id) {
    return rowExists(
        tableName,
        "id = '" + escapeQuotes(id) + "'"
    );
}

function getSingleCustomRow(tableName, whereClause, fieldNames) {
    var args = [
        "list",
        "custom-table-row",
        tableName,
        "-w",
        whereClause
    ];

    var i;

    for(i = 0; i < fieldNames.length; i++) {
        args.push(fieldNames[i]);
    }

    var result = glue.command(args);
    var rows = getListRows(result);

    if(rows.length !== 1) {
        return null;
    }

    var out = {};

    for(i = 0; i < fieldNames.length; i++) {
        var colIndex = getColumnIndex(result, fieldNames[i]);

        out[fieldNames[i]] =
            colIndex < 0 ? null : getCell(rows[0], colIndex);
    }

    return out;
}

function sequenceIdsForSource(sourceName) {
    var result = glue.command([
        "list",
        "sequence",
        "-w",
        "source.name = '" + escapeQuotes(sourceName) + "'",
        "sequenceID"
    ]);

    var rows = getListRows(result);
    var colIndex = getColumnIndex(result, "sequenceID");
    var seqIds = [];

    for(var i = 0; i < rows.length; i++) {
        seqIds.push(getCell(rows[i], colIndex));
    }

    return seqIds;
}

function safeAssocId(locusId, lineageId) {
    return (locusId + "__" + lineageId)
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .substring(0, 100);
}

function uniquePush(array, value) {
    for(var i = 0; i < array.length; i++) {
        if(array[i] === value) {
            return;
        }
    }

    array.push(value);
}

function findLineagesByAlias(aliasName) {
    var result = glue.command([
        "list",
        "custom-table-row",
        "erv_lineage_alias",
        "-w",
        "alias_name = '" + escapeQuotes(aliasName) + "'",
        "erv_lineage.id"
    ]);

    var rows = getListRows(result);
    var colIndex = getColumnIndex(result, "erv_lineage.id");
    var matches = [];

    if(colIndex < 0) {
        return matches;
    }

    for(var i = 0; i < rows.length; i++) {
        var lineageId = norm(getCell(rows[i], colIndex));

        if(lineageId != null) {
            uniquePush(matches, lineageId);
        }
    }

    return matches;
}

function candidateLineageIds(classification) {
    var candidates = [];
    var seen = {};

    function addCandidate(value, method) {
        var v = norm(value);

        if(v == null) {
            return;
        }

        if(!seen[v]) {
            seen[v] = true;

            candidates.push({
                value: v,
                method: method
            });
        }
    }

    var raw = norm(classification);

    if(raw == null) {
        return candidates;
    }

    addCandidate(raw, "exact_id");

    var flattened = raw
        .replace(/\(([^\)]+)\)/g, "-$1")
        .replace(/--+/g, "-");

    if(flattened !== raw) {
        addCandidate(flattened, "normalised_id");
    }

    var m = raw.match(/^HERV-K\(HML([0-9]+)\)$/i);

    if(m) {
        addCandidate(
            "HERV-K-HML" + m[1],
            "normalised_id"
        );
    }

    m = raw.match(/^HERVK[-_]?HML([0-9]+)$/i);

    if(m) {
        addCandidate(
            "HERV-K-HML" + m[1],
            "normalised_id"
        );
    }

    m = raw.match(/^PRIMA([0-9]+)$/i);

    if(m) {
        addCandidate(
            "PRIMA-" + m[1],
            "normalised_id"
        );
    }

    m = raw.match(/^PRIMA([A-Z])$/i);

    if(m) {
        addCandidate(
            "PRIMA-" + m[1].toUpperCase(),
            "normalised_id"
        );
    }

    return candidates;
}

function classifyNonLineage(classification, locusData) {
    var c = lower(classification);
    var mosaic = lower(locusData.is_mosaic);
    var assignmentStatus = lower(locusData.assignment_status);

    if(
        mosaic === "true" ||
        mosaic === "yes" ||
        mosaic === "1" ||
        assignmentStatus === "mosaic" ||
        c === "mosaic"
    ) {
        return "mosaic_pending";
    }

    if(
        c === "unresolved" ||
        assignmentStatus === "unresolved"
    ) {
        return "unresolved";
    }

    if(
        c === "unknown" ||
        c === "other"
    ) {
        return "broad_classification";
    }

    return null;
}

function resolveErvLineage(classification) {
    var candidates = candidateLineageIds(classification);
    var i;

    for(i = 0; i < candidates.length; i++) {
        if(
            customRowExistsById(
                "erv_lineage",
                candidates[i].value
            )
        ) {
            return {
                status: "resolved",
                lineageId: candidates[i].value,
                method: candidates[i].method,
                matchedValue: candidates[i].value,
                message: null
            };
        }
    }

    var aliasLineages = [];
    var aliasInputs = [];

    for(i = 0; i < candidates.length; i++) {
        var matches = findLineagesByAlias(
            candidates[i].value
        );

        for(var j = 0; j < matches.length; j++) {
            if(
                customRowExistsById(
                    "erv_lineage",
                    matches[j]
                )
            ) {
                uniquePush(aliasLineages, matches[j]);
                uniquePush(aliasInputs, candidates[i].value);
            }
        }
    }

    if(aliasLineages.length === 1) {
        return {
            status: "resolved",
            lineageId: aliasLineages[0],
            method: "alias",
            matchedValue: aliasInputs.join(","),
            message: null
        };
    }

    if(aliasLineages.length > 1) {
        return {
            status: "ambiguous_alias",
            lineageId: null,
            method: "alias",
            matchedValue: aliasInputs.join(","),
            message:
                "Alias candidates map to multiple lineages: " +
                aliasLineages.join(",")
        };
    }

    return {
        status: "not_found",
        lineageId: null,
        method: "none",
        matchedValue: null,
        message: "No erv_lineage ID or alias matched"
    };
}

function increment(map, key, amount) {
    var k = norm(key);

    if(k == null) {
        k = "(missing)";
    }

    var n = amount == null ? 1 : amount;

    if(map[k] == null) {
        map[k] = 0;
    }

    map[k] += n;
}

function incrementNested(map, key1, key2, amount) {
    var k1 = norm(key1);
    var k2 = norm(key2);

    if(k1 == null) {
        k1 = "(missing)";
    }

    if(k2 == null) {
        k2 = "(missing)";
    }

    if(map[k1] == null) {
        map[k1] = {};
    }

    increment(map[k1], k2, amount);
}

function sortedKeys(map) {
    var keys = [];

    for(var key in map) {
        if(map.hasOwnProperty(key)) {
            keys.push(key);
        }
    }

    keys.sort();

    return keys;
}

function sortedKeysByCountDesc(map) {
    var keys = sortedKeys(map);

    keys.sort(function(a, b) {
        var diff = map[b] - map[a];

        if(diff !== 0) {
            return diff;
        }

        if(a < b) {
            return -1;
        }

        if(a > b) {
            return 1;
        }

        return 0;
    });

    return keys;
}

function pct(count, total) {
    if(total == null || total === 0) {
        return "0.00";
    }

    return (
        Math.round((10000.0 * count) / total) / 100.0
    ).toFixed(2);
}

function ensureOutputDirectory() {
    var outputDir = new File(OUTPUT_DIR);

    if(outputDir.exists()) {
        if(!outputDir.isDirectory()) {
            throw new Error(
                "Output path exists but is not a directory: " +
                OUTPUT_DIR
            );
        }

        return;
    }

    if(!outputDir.mkdirs()) {
        throw new Error(
            "Unable to create output directory: " +
            OUTPUT_DIR
        );
    }
}

function writeTsv(fileName, headers, rows) {
    ensureOutputDirectory();

    var outputFile = new File(
        OUTPUT_DIR + File.separator + fileName
    );

    var writer = null;

    try {
        writer = new BufferedWriter(
            new FileWriter(outputFile)
        );

        writer.write(headers.join("\t"));
        writer.newLine();

        for(var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var values = [];

            for(var j = 0; j < headers.length; j++) {
                values.push(tsv(row[headers[j]]));
            }

            writer.write(values.join("\t"));
            writer.newLine();
        }
    } finally {
        if(writer != null) {
            writer.close();
        }
    }

    log(
        "Wrote " +
        rows.length +
        " rows to " +
        outputFile.getPath()
    );
}

function simpleCountRows(map, keyHeader, totalForPercentage) {
    var rows = [];
    var countKeys = sortedKeysByCountDesc(map);

    for(var k = 0; k < countKeys.length; k++) {
        var row = {};

        row[keyHeader] = countKeys[k];
        row.count = map[countKeys[k]];
        row.percentage = pct(
            map[countKeys[k]],
            totalForPercentage
        );

        rows.push(row);
    }

    return rows;
}

var auditRows = [];
var exceptionRows = [];

var totalInput = 0;

var overallOutcomeCounts = {};
var sourceCounts = {};
var sourceOutcomeCounts = {};
var lineageCounts = {};
var classificationCounts = {};
var taxLevelCounts = {};
var mappingMethodCounts = {};
var assignmentStatusCounts = {};
var associationActionCounts = {};
var locusCategoryCounts = {};
var mosaicValueCounts = {};

function recordAudit(audit) {
    auditRows.push(audit);

    totalInput++;

    increment(
        overallOutcomeCounts,
        audit.mapping_outcome
    );

    increment(
        sourceCounts,
        audit.source_name
    );

    incrementNested(
        sourceOutcomeCounts,
        audit.source_name,
        audit.mapping_outcome
    );

    increment(
        classificationCounts,
        audit.classification
    );

    increment(
        taxLevelCounts,
        audit.tax_level
    );

    increment(
        mappingMethodCounts,
        audit.mapping_method
    );

    increment(
        assignmentStatusCounts,
        audit.assignment_status
    );

    increment(
        associationActionCounts,
        audit.association_action
    );

    increment(
        locusCategoryCounts,
        audit.locus_category
    );

    increment(
        mosaicValueCounts,
        audit.is_mosaic
    );

    if(audit.resolved_lineage_id != null) {
        increment(
            lineageCounts,
            audit.resolved_lineage_id
        );
    }

    if(audit.mapping_outcome !== "resolved_lineage") {
        exceptionRows.push(audit);
    }
}

sources.forEach(function(sourceName) {
    var seqIds = sequenceIdsForSource(sourceName);

    log(
        "Processing source " +
        sourceName +
        " (" +
        seqIds.length +
        " sequences)"
    );

    var sourceLinked = 0;
    var sourceSkipped = 0;

    seqIds.forEach(function(seqId) {
        var locusId = seqId;

        var baseAudit = {
            source_name: sourceName,
            locus_id: locusId,

            raw_classification: null,
            classification: null,
            assignment_status: null,
            assignment_basis: null,
            tax_level: null,
            is_mosaic: null,
            locus_category: null,
            curation_tier: null,
            merge_status: null,
            has_internal: null,

            mapping_outcome: null,
            mapping_method: null,
            matched_value: null,
            resolved_lineage_id: null,

            association_id: null,
            association_action: "none",

            message: null
        };

        var locusData = getSingleCustomRow(
            "erv_locus",
            "id = '" + escapeQuotes(locusId) + "'",
            LOCUS_FIELDS
        );

        if(locusData == null) {
            baseAudit.mapping_outcome = "missing_locus";
            baseAudit.mapping_method = "none";
            baseAudit.message =
                "No unique erv_locus row found";

            recordAudit(baseAudit);
            sourceSkipped++;

            warn(
                "Skipping " +
                sourceName +
                "/" +
                seqId +
                ": no unique erv_locus row found"
            );

            return;
        }

        for(var fieldName in locusData) {
            if(locusData.hasOwnProperty(fieldName)) {
                baseAudit[fieldName] =
                    norm(locusData[fieldName]);
            }
        }

        var classification =
            norm(locusData.classification);

        if(classification == null) {
            baseAudit.mapping_outcome =
                "missing_classification";

            baseAudit.mapping_method = "none";
            baseAudit.message =
                "No classification set on erv_locus";

            recordAudit(baseAudit);
            sourceSkipped++;

            warn(
                "Skipping " +
                sourceName +
                "/" +
                seqId +
                ": no classification set on erv_locus"
            );

            return;
        }

        var nonLineageOutcome =
            classifyNonLineage(
                classification,
                locusData
            );

        if(nonLineageOutcome != null) {
            baseAudit.mapping_outcome =
                nonLineageOutcome;

            baseAudit.mapping_method = "none";
            baseAudit.message =
                "Classification is not a specific erv_lineage";

            recordAudit(baseAudit);
            sourceSkipped++;

            log(
                "Skipping " +
                sourceName +
                "/" +
                seqId +
                ": classification '" +
                classification +
                "' is not a specific erv_lineage"
            );

            return;
        }

        var resolution =
            resolveErvLineage(classification);

        if(resolution.status === "ambiguous_alias") {
            baseAudit.mapping_outcome =
                "ambiguous_alias";

            baseAudit.mapping_method =
                resolution.method;

            baseAudit.matched_value =
                resolution.matchedValue;

            baseAudit.message =
                resolution.message;

            recordAudit(baseAudit);
            sourceSkipped++;

            warn(
                "Skipping " +
                sourceName +
                "/" +
                seqId +
                ": " +
                resolution.message
            );

            return;
        }

        if(resolution.status !== "resolved") {
            baseAudit.mapping_outcome =
                "lineage_not_found";

            baseAudit.mapping_method =
                resolution.method;

            baseAudit.matched_value =
                resolution.matchedValue;

            baseAudit.message =
                resolution.message;

            recordAudit(baseAudit);
            sourceSkipped++;

            warn(
                "Skipping " +
                sourceName +
                "/" +
                seqId +
                ": target erv_lineage '" +
                classification +
                "' not found after normalisation"
            );

            return;
        }

        var resolvedLineageId =
            resolution.lineageId;

        if(resolvedLineageId !== classification) {
            log(
                "Resolved lineage '" +
                classification +
                "' -> '" +
                resolvedLineageId +
                "' using " +
                resolution.method
            );
        }

        var assocId = safeAssocId(
            locusId,
            resolvedLineageId
        );

        var assocExists = customRowExistsById(
            "erv_locus_lineage_assoc",
            assocId
        );

        var associationAction =
            assocExists
                ? "reused"
                : (
                    DRY_RUN
                        ? "would_create"
                        : "created"
                );

        if(!assocExists) {
            if(!DRY_RUN) {
                glue.command([
                    "create",
                    "custom-table-row",
                    "erv_locus_lineage_assoc",
                    assocId
                ]);
            }

            log(
                (
                    DRY_RUN
                        ? "[DRY RUN] Would create "
                        : "Created "
                ) +
                "erv_locus_lineage_assoc row: " +
                assocId
            );
        }

        if(!DRY_RUN) {
            glue.inMode(
                "custom-table-row/" +
                "erv_locus_lineage_assoc/" +
                assocId,

                function() {
                    glue.command([
                        "set",
                        "link-target",
                        "erv_locus",
                        "custom-table-row/erv_locus/" +
                        locusId
                    ]);

                    glue.command([
                        "set",
                        "link-target",
                        "erv_lineage",
                        "custom-table-row/erv_lineage/" +
                        resolvedLineageId
                    ]);

                    glue.command([
                        "set",
                        "field",
                        "association_role",
                        "primary"
                    ]);

                    glue.command([
                        "set",
                        "field",
                        "evidence",
                        "classification"
                    ]);
                }
            );
        }

        log(
            (
                DRY_RUN
                    ? "[DRY RUN] Would link "
                    : "Linked "
            ) +
            locusId +
            " -> " +
            resolvedLineageId
        );

        baseAudit.mapping_outcome =
            "resolved_lineage";

        baseAudit.mapping_method =
            resolution.method;

        baseAudit.matched_value =
            resolution.matchedValue;

        baseAudit.resolved_lineage_id =
            resolvedLineageId;

        baseAudit.association_id =
            assocId;

        baseAudit.association_action =
            associationAction;

        baseAudit.message = null;

        recordAudit(baseAudit);
        sourceLinked++;
    });

    log(
        "Completed source " +
        sourceName +
        ": total=" +
        seqIds.length +
        ", linked=" +
        sourceLinked +
        ", skipped=" +
        sourceSkipped
    );
});

var auditHeaders = [
    "source_name",
    "locus_id",

    "raw_classification",
    "classification",
    "assignment_status",
    "assignment_basis",
    "tax_level",
    "is_mosaic",
    "locus_category",
    "curation_tier",
    "merge_status",
    "has_internal",

    "mapping_outcome",
    "mapping_method",
    "matched_value",
    "resolved_lineage_id",

    "association_id",
    "association_action",

    "message"
];

if(WRITE_AUDIT) {
    writeTsv(
        "herv_locus_mapping_audit.tsv",
        auditHeaders,
        auditRows
    );
}

writeTsv(
    "herv_locus_mapping_exceptions.tsv",
    auditHeaders,
    exceptionRows
);

var summaryRows = [];

summaryRows.push({
    metric_group: "run",
    metric: "total_input_loci",
    count: totalInput,
    percentage: "100.00"
});

summaryRows.push({
    metric_group: "run",
    metric: "dry_run",
    count: DRY_RUN ? 1 : 0,
    percentage: ""
});

var keys =
    sortedKeysByCountDesc(overallOutcomeCounts);

var i;

for(i = 0; i < keys.length; i++) {
    summaryRows.push({
        metric_group: "mapping_outcome",
        metric: keys[i],
        count: overallOutcomeCounts[keys[i]],
        percentage: pct(
            overallOutcomeCounts[keys[i]],
            totalInput
        )
    });
}

function appendSummaryMap(groupName, map) {
    var mapKeys = sortedKeysByCountDesc(map);

    for(var x = 0; x < mapKeys.length; x++) {
        summaryRows.push({
            metric_group: groupName,
            metric: mapKeys[x],
            count: map[mapKeys[x]],
            percentage: pct(
                map[mapKeys[x]],
                totalInput
            )
        });
    }
}

appendSummaryMap(
    "mapping_method",
    mappingMethodCounts
);

appendSummaryMap(
    "association_action",
    associationActionCounts
);

appendSummaryMap(
    "assignment_status",
    assignmentStatusCounts
);

appendSummaryMap(
    "locus_category",
    locusCategoryCounts
);

appendSummaryMap(
    "is_mosaic",
    mosaicValueCounts
);

writeTsv(
    "herv_locus_mapping_summary.tsv",
    [
        "metric_group",
        "metric",
        "count",
        "percentage"
    ],
    summaryRows
);

var sourceRows = [];

keys = sortedKeys(sourceCounts);

for(i = 0; i < keys.length; i++) {
    var sourceName = keys[i];
    var outcomes =
        sourceOutcomeCounts[sourceName] || {};

    var outcomeKeys =
        sortedKeysByCountDesc(outcomes);

    for(var j = 0; j < outcomeKeys.length; j++) {
        sourceRows.push({
            source_name: sourceName,
            mapping_outcome: outcomeKeys[j],
            count: outcomes[outcomeKeys[j]],
            percentage_within_source: pct(
                outcomes[outcomeKeys[j]],
                sourceCounts[sourceName]
            )
        });
    }
}

writeTsv(
    "herv_locus_mapping_by_source.tsv",
    [
        "source_name",
        "mapping_outcome",
        "count",
        "percentage_within_source"
    ],
    sourceRows
);

var resolvedTotal =
    overallOutcomeCounts.resolved_lineage || 0;

writeTsv(
    "herv_locus_mapping_by_lineage.tsv",
    [
        "erv_lineage_id",
        "count",
        "percentage"
    ],
    simpleCountRows(
        lineageCounts,
        "erv_lineage_id",
        resolvedTotal
    )
);

writeTsv(
    "herv_locus_mapping_by_classification.tsv",
    [
        "classification",
        "count",
        "percentage"
    ],
    simpleCountRows(
        classificationCounts,
        "classification",
        totalInput
    )
);

writeTsv(
    "herv_locus_mapping_by_tax_level.tsv",
    [
        "tax_level",
        "count",
        "percentage"
    ],
    simpleCountRows(
        taxLevelCounts,
        "tax_level",
        totalInput
    )
);

writeTsv(
    "herv_locus_mapping_by_method.tsv",
    [
        "mapping_method",
        "count",
        "percentage"
    ],
    simpleCountRows(
        mappingMethodCounts,
        "mapping_method",
        totalInput
    )
);

log(
    "============================================================"
);

log(
    "HERV locus lineage mapping summary"
);

log(
    "============================================================"
);

log(
    "Total input loci: " +
    totalInput
);

keys =
    sortedKeysByCountDesc(overallOutcomeCounts);

for(i = 0; i < keys.length; i++) {
    log(
        "  " +
        keys[i] +
        ": " +
        overallOutcomeCounts[keys[i]] +
        " (" +
        pct(
            overallOutcomeCounts[keys[i]],
            totalInput
        ) +
        "%)"
    );
}

log(
    "Recognised lineages represented: " +
    sortedKeys(lineageCounts).length
);

log(
    "Unique classifications observed: " +
    sortedKeys(classificationCounts).length
);

log(
    "Exceptions requiring review: " +
    exceptionRows.length
);

log(
    "Reports written beneath: " +
    OUTPUT_DIR
);