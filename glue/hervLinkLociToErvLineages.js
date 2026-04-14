// glue/hervLinkLociToErvLineages.js
//
// Link HERV loci to ERV internal lineages via erv_locus_lineage_assoc,
// using erv_locus.classification as the driver.
//
// Assumptions:
// 1. sequence rows are already linked to erv_locus rows
// 2. erv_locus row ID == sequenceID
// 3. erv_locus.classification contains a cleaned lineage label
// 4. erv_lineage rows already exist
// 5. optional: erv_lineage_alias rows may exist to support name resolution
//
// Matching strategy:
//   - try exact erv_lineage ID match
//   - try systematic name normalization
//   - try erv_lineage_alias lookup using candidate names
//
// Notes:
//   - loci with blank / null classification are skipped
//   - loci whose classification is broad/non-lineage (e.g. mosaic) are skipped
//   - loci whose target erv_lineage cannot be resolved are reported and skipped
//   - existing association rows are reused

var sources = ["fr_rt4_samerow", "fr_samename"];
var DRY_RUN = false;

function log(msg) {
    glue.logInfo(msg);
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

function escapeQuotes(value) {
    return ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getListRows(resultObj) {
    if(resultObj == null || resultObj.listResult == null || resultObj.listResult.row == null) {
        return [];
    }
    return resultObj.listResult.row;
}

function getColumnIndex(resultObj, columnName) {
    if(resultObj == null || resultObj.listResult == null || resultObj.listResult.column == null) {
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
    var result = glue.command(["list", "custom-table-row", tableName, "-w", whereClause]);
    return getListRows(result).length > 0;
}

function customRowExistsById(tableName, id) {
    return rowExists(tableName, "id = '" + escapeQuotes(id) + "'");
}

function getSingleFieldValue(tableName, whereClause, fieldName) {
    var result = glue.command([
        "list", "custom-table-row", tableName,
        "-w", whereClause,
        fieldName
    ]);
    var rows = getListRows(result);
    if(rows.length !== 1) {
        return null;
    }
    var colIndex = getColumnIndex(result, fieldName);
    if(colIndex < 0) {
        return null;
    }
    return getCell(rows[0], colIndex);
}

function sequenceIdsForSource(sourceName) {
    var result = glue.command([
        "list", "sequence",
        "-w", "source.name = '" + escapeQuotes(sourceName) + "'",
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

function findLineageByAlias(aliasName) {
    var result = glue.command([
        "list", "custom-table-row", "erv_lineage_alias",
        "-w", "alias_name = '" + escapeQuotes(aliasName) + "'",
        "erv_lineage.id"
    ]);
    var rows = getListRows(result);
    if(rows.length < 1) {
        return null;
    }
    var colIndex = getColumnIndex(result, "erv_lineage.id");
    if(colIndex < 0) {
        return null;
    }
    return norm(getCell(rows[0], colIndex));
}

function candidateLineageIds(classification) {
    var candidates = [];
    var seen = {};

    function addCandidate(value) {
        var v = norm(value);
        if(v == null) {
            return;
        }
        if(!seen[v]) {
            seen[v] = true;
            candidates.push(v);
        }
    }

    var raw = norm(classification);
    if(raw == null) {
        return candidates;
    }

    // exact
    addCandidate(raw);

    // generic bracket flattening
    addCandidate(raw.replace(/\(([^\)]+)\)/g, "-$1").replace(/--+/g, "-"));

    // HERV-K(HML2) / HERVK-HML2 / HERVK_HML2 -> HERV-K-HML2
    var m = raw.match(/^HERV-K\(HML([0-9]+)\)$/i);
    if(m) {
        addCandidate("HERV-K-HML" + m[1]);
    }

    m = raw.match(/^HERVK[-_]?HML([0-9]+)$/i);
    if(m) {
        addCandidate("HERV-K-HML" + m[1]);
    }

    // PRIMA41 / PRIMAX
    m = raw.match(/^PRIMA([0-9]+)$/i);
    if(m) {
        addCandidate("PRIMA-" + m[1]);
    }

    m = raw.match(/^PRIMA([A-Z])$/i);
    if(m) {
        addCandidate("PRIMA-" + m[1].toUpperCase());
    }

    return candidates;
}

function isNonLineageClassification(classification) {
    var c = norm(classification);
    if(c == null) {
        return true;
    }
    var low = c.toLowerCase();
    return (
        low === "mosaic" ||
        low === "unresolved" ||
        low === "unknown" ||
        low === "other"
    );
}

function resolveErvLineageId(classification) {
    var candidates = candidateLineageIds(classification);
    var i, aliasMatch;

    for(i = 0; i < candidates.length; i++) {
        if(customRowExistsById("erv_lineage", candidates[i])) {
            return candidates[i];
        }
    }

    for(i = 0; i < candidates.length; i++) {
        aliasMatch = findLineageByAlias(candidates[i]);
        if(aliasMatch != null && customRowExistsById("erv_lineage", aliasMatch)) {
            return aliasMatch;
        }
    }

    return null;
}

_.each(sources, function(sourceName) {

    log("Processing source: " + sourceName);

    var seqIds = sequenceIdsForSource(sourceName);
    var linkedCount = 0;
    var skippedCount = 0;

    _.each(seqIds, function(seqId) {

        var locusId = seqId;

        if(!customRowExistsById("erv_locus", locusId)) {
            log("Skipping " + sourceName + "/" + seqId + ": no erv_locus row found");
            skippedCount++;
            return;
        }

        var classification = norm(
            getSingleFieldValue(
                "erv_locus",
                "id = '" + escapeQuotes(locusId) + "'",
                "classification"
            )
        );

        if(classification == null) {
            log("Skipping " + sourceName + "/" + seqId + ": no classification set on erv_locus");
            skippedCount++;
            return;
        }

        if(isNonLineageClassification(classification)) {
            log("Skipping " + sourceName + "/" + seqId +
                ": classification '" + classification + "' is not a specific erv_lineage");
            skippedCount++;
            return;
        }

        var resolvedLineageId = resolveErvLineageId(classification);
        if(resolvedLineageId == null) {
            log("Skipping " + sourceName + "/" + seqId +
                ": target erv_lineage '" + classification + "' not found after normalization");
            skippedCount++;
            return;
        }

        if(resolvedLineageId !== classification) {
            log("Resolved lineage '" + classification + "' -> '" + resolvedLineageId + "'");
        }

        var assocId = safeAssocId(locusId, resolvedLineageId);
        var assocExists = customRowExistsById("erv_locus_lineage_assoc", assocId);

        if(!assocExists) {
            if(!DRY_RUN) {
                glue.command(["create", "custom-table-row", "erv_locus_lineage_assoc", assocId]);
            }
            log((DRY_RUN ? "[DRY RUN] Would create " : "Created ") +
                "erv_locus_lineage_assoc row: " + assocId);
        }

        if(!DRY_RUN) {
            glue.inMode("custom-table-row/erv_locus_lineage_assoc/" + assocId, function() {
                glue.command([
                    "set", "link-target", "erv_locus",
                    "custom-table-row/erv_locus/" + locusId
                ]);
                glue.command([
                    "set", "link-target", "erv_lineage",
                    "custom-table-row/erv_lineage/" + resolvedLineageId
                ]);
                glue.command(["set", "field", "association_role", "primary"]);
                glue.command(["set", "field", "evidence", "classification"]);
            });
        }

        log((DRY_RUN ? "[DRY RUN] Would link " : "Linked ") +
            locusId + " -> " + resolvedLineageId);

        linkedCount++;
    });

    log("Completed source " + sourceName +
        ": linked=" + linkedCount +
        ", skipped=" + skippedCount);
});