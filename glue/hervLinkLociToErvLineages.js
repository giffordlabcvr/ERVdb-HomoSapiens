// glue/hervLinkLociToErvLineages.js
//
// Link HERV loci to ERV internal lineages via erv_locus_lineage_assoc.
//
// Assumptions:
// 1. sequence rows are already linked to erv_locus rows
// 2. erv_locus row ID == sequenceID
// 3. erv_locus.raw_classification contains an imported lineage label
// 4. erv_lineage rows already exist
// 5. optional: erv_lineage_alias rows may exist to support name resolution
//
// Matching strategy:
//   - try exact erv_lineage ID match
//   - try systematic name normalization
//   - try erv_lineage_alias lookup using candidate names
//
// Notes:
//   - loci with blank / null raw_classification are skipped
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

function candidateLineageIds(importedId) {
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

    var raw = norm(importedId);
    if(raw == null) {
        return candidates;
    }

    // exact
    addCandidate(raw);

    // HERV-K(HML2) -> HERV-K-HML2
    var hmlMatch = raw.match(/^HERV-K\(HML([0-9]+)\)$/i);
    if(hmlMatch) {
        addCandidate("HERV-K-HML" + hmlMatch[1]);
    }

    // Generic bracket flattening: X(Y) -> X-Y
    addCandidate(raw.replace(/\(([^\)]+)\)/g, "-$1").replace(/--+/g, "-"));

    // PRIMA41 -> PRIMA-41
    var primaNum = raw.match(/^PRIMA([0-9]+)$/i);
    if(primaNum) {
        addCandidate("PRIMA-" + primaNum[1]);
    }

    // PRIMAX -> PRIMA-X
    var primaLetter = raw.match(/^PRIMA([A-Z])$/i);
    if(primaLetter) {
        addCandidate("PRIMA-" + primaLetter[1].toUpperCase());
    }

    // HERVK-HML2 / HERVK_HML2 -> HERV-K-HML2
    var hervk = raw.match(/^HERVK[-_]?HML([0-9]+)$/i);
    if(hervk) {
        addCandidate("HERV-K-HML" + hervk[1]);
    }

    return candidates;
}

function resolveErvLineageId(importedId) {
    var candidates = candidateLineageIds(importedId);
    var i, aliasMatch;

    // direct erv_lineage ID match
    for(i = 0; i < candidates.length; i++) {
        if(customRowExistsById("erv_lineage", candidates[i])) {
            return candidates[i];
        }
    }

    // alias lookup
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

    _.each(seqIds, function(seqId) {

        var locusId = seqId;

        // Check locus exists
        if(!customRowExistsById("erv_locus", locusId)) {
            log("Skipping " + sourceName + "/" + seqId + ": no erv_locus row found");
            return;
        }

        // Read imported lineage label from erv_locus.raw_classification
        var importedLineageId = norm(
            getSingleFieldValue(
                "erv_locus",
                "id = '" + escapeQuotes(locusId) + "'",
                "raw_classification"
            )
        );

        if(importedLineageId == null) {
            log("Skipping " + sourceName + "/" + seqId + ": no raw_classification set on erv_locus");
            return;
        }

        // Resolve to canonical erv_lineage ID
        var resolvedLineageId = resolveErvLineageId(importedLineageId);
        if(resolvedLineageId == null) {
            log("Skipping " + sourceName + "/" + seqId +
                ": target erv_lineage '" + importedLineageId + "' not found after normalization");
            return;
        }

        if(resolvedLineageId !== importedLineageId) {
            log("Resolved lineage '" + importedLineageId + "' -> '" + resolvedLineageId + "'");
        }

        // Create or reuse association row
        var assocId = safeAssocId(locusId, resolvedLineageId);
        var assocExists = customRowExistsById("erv_locus_lineage_assoc", assocId);

        if(!assocExists) {
            if(!DRY_RUN) {
                glue.command(["create", "custom-table-row", "erv_locus_lineage_assoc", assocId]);
            }
            log((DRY_RUN ? "[DRY RUN] Would create " : "Created ") +
                "erv_locus_lineage_assoc row: " + assocId);
        }

        // Link association row to locus + lineage
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
                glue.command(["set", "field", "evidence", "imported_raw_classification"]);
                glue.command(["set", "field", "confidence", "high"]);
            });
        }

        log((DRY_RUN ? "[DRY RUN] Would link " : "Linked ") +
            locusId + " -> " + resolvedLineageId);
    });
});