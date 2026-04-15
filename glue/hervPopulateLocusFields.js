// glue/hervPopulateLocusFields.js
//
// Populate selected erv_locus fields for imported human HERV loci.
//
// Current behavior:
// - Uses sequence source name to derive assignment_status and assignment_basis
// - Normalizes raw_classification into classification
// - Sets fixed values for locus_type, host_species, genome_build
// - Derives tax_level for certain broad classifications (e.g. Clade-I)
//
// Assumptions:
// - erv_locus.id == sequence.sequenceID
// - imported locus sequences live in sources such as:
//     fr_rt4_samerow
//     fr_samename
//     fr_only1id
//     r_rt4_phyloclade
// - raw_classification is already populated on erv_locus
//
// Safe to rerun: yes

var sources = ["fr_rt4_samerow", "fr_samename", "fr_only1id", "r_rt4_phyloclade"];
var DRY_RUN = false;

var DEFAULT_HOST_SPECIES = "Homo sapiens";
var DEFAULT_GENOME_BUILD = "hg19";
var DEFAULT_LOCUS_TYPE = "proviral";

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
    if(sourceName === "r_rt4_phyloclade") {
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
    if(sourceName === "r_rt4_phyloclade") {
        return "rt4_phyloclade";
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

        var classification = normalizeClassification(rawClassification);
        var taxLevel = inferTaxLevel(classification);
        var assignmentStatus = getAssignmentStatus(sourceName);
        var assignmentBasis = getAssignmentBasis(sourceName);

        if(!DRY_RUN) {
            glue.inMode("custom-table-row/erv_locus/" + locusId, function() {
                glue.command(["set", "field", "locus_type", DEFAULT_LOCUS_TYPE]);
                glue.command(["set", "field", "host_species", DEFAULT_HOST_SPECIES]);
                glue.command(["set", "field", "genome_build", DEFAULT_GENOME_BUILD]);

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
            " assignment_basis=" + assignmentBasis);

        updated++;
    });

    log("Completed source " + sourceName +
        ": updated=" + updated +
        ", skipped=" + skipped);
});