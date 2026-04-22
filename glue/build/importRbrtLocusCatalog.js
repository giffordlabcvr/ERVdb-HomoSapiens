// glue/build/herv/importRbrtLocusCatalog.js
//
// Create or update erv_locus rows directly from a large RBRT merge-table TSV,
// without requiring sequence rows.
//
// Intended use:
// - Catalogue-level import of the wider human HERV/LTR locus universe
// - Supports triage of the 500K set before any sequence extraction/loading
//
// Safe to rerun: yes
//
// Current behavior:
// - Creates missing erv_locus rows using RBRT idx as id
// - Populates positional and classification summary fields
// - Derives operational fields for triage/integration
// - Does NOT create sequence rows
//
// Expected columns (minimum):
//   idx
//   chrom
//   strand
//   start
//   end
//   names_decision
//   phylo_level
//   case
//   curatedNS
//   status
//
// Optional columns that may be present and can help later:
//   genes
//   genes_uniq
//   db_support
//   nsLTRdef
//
// Usage example:
//   project ervdb run script glue/build/herv/importRbrtLocusCatalog.js
//
// Configure INPUT_PATH below.

var INPUT_PATH = "tabular/dbm_merge/RBRT_513k.tsv";
var DRY_RUN = false;
var UPDATE_EXISTING = true;

var DEFAULT_HOST_SPECIES = "Homo sapiens";
var DEFAULT_GENOME_BUILD = "hg19";

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

function parseBooleanLike(value) {
    var s = norm(value);
    if(s == null) {
        return null;
    }
    var low = s.toLowerCase();
    if(low === "1" || low === "true" || low === "yes") {
        return true;
    }
    if(low === "0" || low === "false" || low === "no") {
        return false;
    }
    return null;
}

function parseInteger(value) {
    var s = norm(value);
    if(s == null) {
        return null;
    }
    if(!s.match(/^-?[0-9]+$/)) {
        return null;
    }
    return parseInt(s, 10);
}

function customRowExistsById(tableName, id) {
    var result = glue.command([
        "list", "custom-table-row", tableName,
        "-w", "id = '" + escapeQuotes(id) + "'"
    ]);
    return result.listResult != null &&
           result.listResult.row != null &&
           result.listResult.row.length > 0;
}

function createCustomRowIfMissing(tableName, id) {
    if(customRowExistsById(tableName, id)) {
        return false;
    }
    if(!DRY_RUN) {
        glue.command(["create", "custom-table-row", tableName, id]);
    }
    return true;
}

function normalizeClassification(rawClassification) {
    var raw = norm(rawClassification);
    if(raw == null) {
        return null;
    }

    var exactMap = {
        "HERV-K(HML2)": "HERV-K-HML2",
        "HERV-K(HML3)": "HERV-K-HML3",
        "HERV-K(HML4)": "HERV-K-HML4",
        "HERV-K(HML5)": "HERV-K-HML5",
        "HERV-K(HML6)": "HERV-K-HML6",
        "HERV-K(HML7)": "HERV-K-HML7",
        "HERV-K(HML8)": "HERV-K-HML8",
        "HERV-K(HML9)": "HERV-K-HML9",
        "HERV-K(HML10)": "HERV-K-HML10",
        "PRIMA41": "PRIMA-41",
        "PRIMAX": "PRIMA-X",
        "Clade I": "Clade-I",
        "Clade II": "Clade-II",
        "Clade III": "Clade-III"
    };

    if(exactMap[raw] != null) {
        return exactMap[raw];
    }

    var m = raw.match(/^HERV-K\(HML([0-9]+)\)$/i);
    if(m) {
        return "HERV-K-HML" + m[1];
    }

    m = raw.match(/^PRIMA([0-9]+)$/i);
    if(m) {
        return "PRIMA-" + m[1];
    }

    m = raw.match(/^PRIMA([A-Z])$/i);
    if(m) {
        return "PRIMA-" + m[1].toUpperCase();
    }

    m = raw.match(/^HERVK[-_]?HML([0-9]+)$/i);
    if(m) {
        return "HERV-K-HML" + m[1];
    }

    m = raw.match(/^Clade\s+([IVX]+)$/i);
    if(m) {
        return "Clade-" + m[1].toUpperCase();
    }

    return raw;
}

function normalizeMergeStatus(caseValue) {
    var s = norm(caseValue);
    if(s == null) {
        return null;
    }
    var low = s.toLowerCase();
    if(low === "fully resolved" || low === "fully_resolved") {
        return "fully_resolved";
    }
    if(low === "resolved") {
        return "resolved";
    }
    if(low === "unresolved") {
        return "unresolved";
    }
    return s.replace(/\s+/g, "_").toLowerCase();
}

function normalizeTaxLevel(phyloLevel) {
    var s = norm(phyloLevel);
    if(s == null) {
        return null;
    }
    var low = s.toLowerCase();
    if(low === "phylogeny.name") {
        return "name";
    }
    if(low === "name" || low === "subgroup" || low === "group" || low === "clade") {
        return low;
    }
    return s;
}

function deriveHasInternal(statusValue, curatedNsValue) {
    var curated = parseBooleanLike(curatedNsValue);
    if(curated === true) {
        return "true";
    }

    var status = norm(statusValue);
    if(status != null && status.toUpperCase() === "LTR") {
        return "false";
    }
    if(status != null && status.toUpperCase() === "ERV") {
        // first-pass assumption; can be refined later using genes/composition
        return "true";
    }
    return null;
}

function deriveIsMosaic(mergeStatus) {
    if(mergeStatus === "resolved") {
        return "true";
    }
    return "false";
}

function deriveCurationTier(curatedNsValue, statusValue) {
    var curated = parseBooleanLike(curatedNsValue);
    if(curated === true) {
        return "core";
    }

    var status = norm(statusValue);
    if(status != null && (status.toUpperCase() === "ERV" || status.toUpperCase() === "LTR")) {
        return "peripheral";
    }

    return "excluded";
}

function deriveLocusCategory(statusValue, hasInternal, isMosaic, curationTier) {
    if(curationTier === "excluded") {
        return "excluded_non_erv";
    }
    if(isMosaic === "true") {
        return "mosaic";
    }

    var status = norm(statusValue);
    if(status != null && status.toUpperCase() === "LTR") {
        return "solo_ltr";
    }
    if(status != null && status.toUpperCase() === "ERV") {
        if(hasInternal === "true") {
            return "proviral";
        }
        return "fragment";
    }
    return "fragment";
}

function deriveLocusType(locusCategory) {
    if(locusCategory === "mosaic") {
        return "composite";
    }
    if(locusCategory === "proviral") {
        return "proviral";
    }
    if(locusCategory === "solo_ltr") {
        return "solo_ltr";
    }
    if(locusCategory === "fragment") {
        return "fragment";
    }
    return null;
}

function chooseAssignmentStatus(mergeStatus, curationTier, locusCategory) {
    if(mergeStatus === "fully_resolved") {
        return "fully_resolved";
    }
    if(mergeStatus === "resolved") {
        return "resolved";
    }
    if(mergeStatus === "unresolved") {
        return "unresolved";
    }
    if(curationTier === "peripheral" && locusCategory === "solo_ltr") {
        return "partial";
    }
    return null;
}

function chooseAssignmentBasis(curationTier, statusValue) {
    var status = norm(statusValue);
    if(curationTier === "core") {
        return "dbm_merge_curated";
    }
    if(status != null && status.toUpperCase() === "LTR") {
        return "dbm_merge_ltr";
    }
    if(status != null && status.toUpperCase() === "ERV") {
        return "dbm_merge_erv";
    }
    return "dbm_merge";
}

function splitTsvLine(line) {
    // Simple TSV splitter, assuming no embedded tabs/newlines in fields.
    return line.split("\t");
}

function loadTable(path) {
    var loadResult = glue.command(["file-util", "load-tabular", path]);
    // If your GLUE build doesn’t support file-util load-tabular in this form,
    // replace this helper with your preferred local TSV-reading pattern.
    return loadResult;
}


//----------------------------------------------------------------------------




function getRowsFromLoadTabular(resultObj) {
    if(resultObj == null || resultObj.tabularResult == null || resultObj.tabularResult.row == null) {
        return [];
    }
    return resultObj.tabularResult.row;
}

function getHeaderMap(headerRow) {
    var map = {};
    for(var i = 0; i < headerRow.length; i++) {
        map[headerRow[i]] = i;
    }
    return map;
}

function getField(values, headerMap, fieldName) {
    var idx = headerMap[fieldName];
    if(idx == null || idx < 0 || idx >= values.length) {
        return null;
    }
    return values[idx];
}

function setFieldIfNotNull(fieldName, value) {
    if(value != null) {
        glue.command(["set", "field", fieldName, "" + value]);
    }
}

var loadResult = loadTable(INPUT_PATH);
var rows = getRowsFromLoadTabular(loadResult);

if(rows.length < 2) {
    throw "No data rows found in " + INPUT_PATH;
}

var headerValues = rows[0].value;
var headerMap = getHeaderMap(headerValues);

var createdCount = 0;
var updatedCount = 0;
var skippedCount = 0;

for(var i = 1; i < rows.length; i++) {
    var values = rows[i].value;

    var locusId = norm(getField(values, headerMap, "idx"));
    if(locusId == null) {
        log("Skipping row " + i + ": missing idx");
        skippedCount++;
        continue;
    }

    var scaffold = norm(getField(values, headerMap, "chrom"));
    var orientation = norm(getField(values, headerMap, "strand"));
    var startPosition = parseInteger(getField(values, headerMap, "start"));
    var endPosition = parseInteger(getField(values, headerMap, "end"));
    var rawClassification = norm(getField(values, headerMap, "names_decision"));
    var classification = normalizeClassification(rawClassification);
    var taxLevel = normalizeTaxLevel(getField(values, headerMap, "phylo_level"));
    var mergeStatus = normalizeMergeStatus(getField(values, headerMap, "case"));

    var curatedNsValue = getField(values, headerMap, "curatedNS");
    var statusValue = getField(values, headerMap, "status");

    var hasInternal = deriveHasInternal(statusValue, curatedNsValue);
    var isMosaic = deriveIsMosaic(mergeStatus);
    var curationTier = deriveCurationTier(curatedNsValue, statusValue);
    var locusCategory = deriveLocusCategory(statusValue, hasInternal, isMosaic, curationTier);
    var locusType = deriveLocusType(locusCategory);
    var assignmentStatus = chooseAssignmentStatus(mergeStatus, curationTier, locusCategory);
    var assignmentBasis = chooseAssignmentBasis(curationTier, statusValue);

    var existed = customRowExistsById("erv_locus", locusId);
    if(!existed) {
        if(!DRY_RUN) {
            glue.command(["create", "custom-table-row", "erv_locus", locusId]);
        }
        createdCount++;
    } else {
        if(!UPDATE_EXISTING) {
            skippedCount++;
            continue;
        }
        updatedCount++;
    }

    if(!DRY_RUN) {
        glue.inMode("custom-table-row/erv_locus/" + locusId, function() {
            setFieldIfNotNull("host_species", DEFAULT_HOST_SPECIES);
            setFieldIfNotNull("genome_build", DEFAULT_GENOME_BUILD);
            setFieldIfNotNull("scaffold", scaffold);
            if(startPosition != null) {
                glue.command(["set", "field", "start_position", "" + startPosition]);
            }
            if(endPosition != null) {
                glue.command(["set", "field", "end_position", "" + endPosition]);
            }
            setFieldIfNotNull("orientation", orientation);

            setFieldIfNotNull("raw_classification", rawClassification);
            setFieldIfNotNull("classification", classification);
            setFieldIfNotNull("tax_level", taxLevel);
            setFieldIfNotNull("merge_status", mergeStatus);

            setFieldIfNotNull("assignment_status", assignmentStatus);
            setFieldIfNotNull("assignment_basis", assignmentBasis);

            setFieldIfNotNull("curation_tier", curationTier);
            setFieldIfNotNull("has_internal", hasInternal);
            setFieldIfNotNull("is_mosaic", isMosaic);
            setFieldIfNotNull("locus_category", locusCategory);
            setFieldIfNotNull("locus_type", locusType);
        });
    }

    log((DRY_RUN ? "[DRY RUN] Would import " : "Imported ") +
        locusId +
        " category=" + locusCategory +
        " tier=" + curationTier +
        " merge_status=" + mergeStatus +
        " classification=" + classification +
        " tax_level=" + taxLevel);
}

log("Completed RBRT locus catalogue import: created=" + createdCount +
    ", updated=" + updatedCount +
    ", skipped=" + skippedCount);



