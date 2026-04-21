// glue/hervPopulateLocusFields.js
//
// Populate selected erv_locus fields for imported human HERV loci.
//
// Intended use:
// - Current primary use is the curated human HERV 8K set
// - Assumes erv_locus rows already exist and are linked to sequence rows
// - Assumes raw_classification has already been loaded by side-data import
// - Safe to rerun: yes
//
// Current responsibilities:
// - Set fixed locus metadata (host_species, genome_build)
// - Normalize raw_classification into classification
// - Populate assignment_status and assignment_basis from source
// - Populate merge_status where it can be inferred from source
// - Populate new operational fields:
//     locus_category
//     curation_tier
//     has_internal
//     is_mosaic
// - Populate tax_level from existing value or infer it from classification
//
// Notes:
// - This script is currently source-driven because the 8K import route
//   already partitions loci into meaningful subsets.
// - Later, when broader non-8K sets are loaded, this logic can be extended
//   to rely more on merge-derived fields rather than source names.

var sources = [
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

function getAssignmentStatus(sourceName) {
    if(sourceName === "fr_rt4_samerow" || sourceName === "fr_samename") {
        return "fully_resolved";
    }
    if(sourceName === "fr_only1id") {
        return "partial";
    }
    if(
        sourceName === "fr_harlequin" ||
        sourceName === "r_rt4_phyloclade" ||
        sourceName === "r_rt4_phylosubgroup" ||
        sourceName === "r_rt4_phylogroup" ||
        sourceName === "r_rt4_phyloname"
    ) {
        return "resolved";
    }
    return null;
}

function getAssignmentBasis(sourceName) {
    if(sourceName === "fr_rt4_samerow") {
        return "rt4_samerow";
    }
    if(sourceName === "fr_samename") {
        return "samename";
    }
    if(sourceName === "fr_only1id") {
        return "only1id";
    }
    if(sourceName === "fr_harlequin") {
        return "harlequin";
    }
    if(sourceName === "r_rt4_phyloclade") {
        return "rt4_phyloclade";
    }
    if(sourceName === "r_rt4_phylosubgroup") {
        return "rt4_phylosubgroup";
    }
    if(sourceName === "r_rt4_phylogroup") {
        return "rt4_phylogroup";
    }
    if(sourceName === "r_rt4_phyloname") {
        return "rt4_phyloname";
    }
    return null;
}

function getMergeStatus(sourceName) {
    if(sourceName === "fr_rt4_samerow" || sourceName === "fr_samename") {
        return "fully_resolved";
    }
    if(sourceName === "fr_only1id") {
        return "fully_resolved";
    }
    if(
        sourceName === "fr_harlequin" ||
        sourceName === "r_rt4_phyloclade" ||
        sourceName === "r_rt4_phylosubgroup" ||
        sourceName === "r_rt4_phylogroup" ||
        sourceName === "r_rt4_phyloname"
    ) {
        return "resolved";
    }
    return null;
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

function inferTaxLevel(classification) {
    var c = norm(classification);
    if(c == null) {
        return null;
    }

    if(c === "Clade-I" || c === "Clade-II" || c === "Clade-III") {
        return "clade";
    }

    return null;
}

function deriveHasInternal(sourceName) {
    // Current 8K import route is intended to represent confident non-solo-LTR
    // HERV loci, so a first-pass assumption of internal sequence is acceptable.
    // This can later be replaced with merge-table-driven logic.
    return "true";
}

function deriveIsMosaic(sourceName) {
    if(sourceName === "fr_harlequin") {
        return "true";
    }
    if(
        sourceName === "r_rt4_phyloclade" ||
        sourceName === "r_rt4_phylosubgroup" ||
        sourceName === "r_rt4_phylogroup" ||
        sourceName === "r_rt4_phyloname"
    ) {
        return "true";
    }
    return "false";
}

function deriveLocusCategory(sourceName, isMosaic, hasInternal) {
    if(isMosaic === "true") {
        return "mosaic";
    }
    if(hasInternal === "true") {
        return "proviral";
    }
    return null;
}

function deriveCurationTier(sourceName) {
    // All current sources contribute to the curated 8K HERV set.
    return "core";
}

function chooseLocusType(locusCategory, hasInternal, isMosaic) {
    // Keep this conservative. For now, loci in the curated 8K are mostly
    // treated as proviral unless they are explicitly mosaic.
    if(locusCategory === "mosaic") {
        return "composite";
    }
    if(hasInternal === "true") {
        return "proviral";
    }
    return null;
}

function chooseStructureStatus(locusCategory, assignmentStatus) {
    // Leave mostly unset for now. The current inputs do not define structural
    // completeness in a clean enough way to force a vocabulary here.
    return null;
}

function chooseTaxLevel(existingTaxLevel, classification) {
    var existing = norm(existingTaxLevel);
    if(existing != null) {
        var low = existing.toLowerCase();
        if(
            low === "clade" ||
            low === "group" ||
            low === "subgroup" ||
            low === "phylogeny.name" ||
            low === "name"
        ) {
            if(low === "phylogeny.name") {
                return "name";
            }
            return low;
        }
        return existing;
    }
    return inferTaxLevel(classification);
}

_.each(sources, function(sourceName) {

    log("Processing source: " + sourceName);

    var seqIds = sequenceIdsForSource(sourceName);
    var updated = 0;
    var skipped = 0;

    _.each(seqIds, function(seqId) {

        var locusId = seqId;

        if(!customRowExistsById("erv_locus", locusId)) {
            log("Skipping " + sourceName + "/" + seqId + ": no erv_locus row found");
            skipped++;
            return;
        }

        var rawClassification = norm(
            getSingleFieldValue(
                "erv_locus",
                "id = '" + escapeQuotes(locusId) + "'",
                "raw_classification"
            )
        );

        var existingTaxLevel = norm(
            getSingleFieldValue(
                "erv_locus",
                "id = '" + escapeQuotes(locusId) + "'",
                "tax_level"
            )
        );

        var classification = normalizeClassification(rawClassification);
        var taxLevel = chooseTaxLevel(existingTaxLevel, classification);
        var assignmentStatus = getAssignmentStatus(sourceName);
        var assignmentBasis = getAssignmentBasis(sourceName);
        var mergeStatus = getMergeStatus(sourceName);

        var hasInternal = deriveHasInternal(sourceName);
        var isMosaic = deriveIsMosaic(sourceName);
        var locusCategory = deriveLocusCategory(sourceName, isMosaic, hasInternal);
        var curationTier = deriveCurationTier(sourceName);

        var locusType = chooseLocusType(locusCategory, hasInternal, isMosaic);
        var structureStatus = chooseStructureStatus(locusCategory, assignmentStatus);

        if(!DRY_RUN) {
            glue.inMode("custom-table-row/erv_locus/" + locusId, function() {
                glue.command(["set", "field", "host_species", DEFAULT_HOST_SPECIES]);
                glue.command(["set", "field", "genome_build", DEFAULT_GENOME_BUILD]);

                if(locusType != null) {
                    glue.command(["set", "field", "locus_type", locusType]);
                }
                if(structureStatus != null) {
                    glue.command(["set", "field", "structure_status", structureStatus]);
                }
                if(locusCategory != null) {
                    glue.command(["set", "field", "locus_category", locusCategory]);
                }
                if(curationTier != null) {
                    glue.command(["set", "field", "curation_tier", curationTier]);
                }
                if(mergeStatus != null) {
                    glue.command(["set", "field", "merge_status", mergeStatus]);
                }
                if(hasInternal != null) {
                    glue.command(["set", "field", "has_internal", hasInternal]);
                }
                if(isMosaic != null) {
                    glue.command(["set", "field", "is_mosaic", isMosaic]);
                }

                if(assignmentStatus != null) {
                    glue.command(["set", "field", "assignment_status", assignmentStatus]);
                }
                if(assignmentBasis != null) {
                    glue.command(["set", "field", "assignment_basis", assignmentBasis]);
                }
                if(classification != null) {
                    glue.command(["set", "field", "classification", classification]);
                }
                if(taxLevel != null) {
                    glue.command(["set", "field", "tax_level", taxLevel]);
                }
            });
        }

        log((DRY_RUN ? "[DRY RUN] Would update " : "Updated ") +
            locusId +
            " classification=" + classification +
            " tax_level=" + taxLevel +
            " assignment_status=" + assignmentStatus +
            " assignment_basis=" + assignmentBasis +
            " merge_status=" + mergeStatus +
            " locus_category=" + locusCategory +
            " curation_tier=" + curationTier +
            " has_internal=" + hasInternal +
            " is_mosaic=" + isMosaic +
            " locus_type=" + locusType);

        updated++;
    });

    log("Completed source " + sourceName +
        ": updated=" + updated +
        ", skipped=" + skipped);
});