// glue/build/erv/ervBuildAlignmentTree.js
//
// Extend the constrained alignment tree with ERV reference sequences using
// sequence-linked retrovirus taxonomy.
//
// Hierarchy:
//   rv_clade -> rv_genus -> rv_subgenus -> erv_lineage
//
// Notes:
// - intended for erv-refseqs-* sources
// - extends a backbone tree already built from XRVs
// - clade roots and shared backbone genera/subgenera are expected to exist already
// - ERV-specific extension genera/subgenera are declared from INPUT_PATH when missing
// - each erv_lineage row is assumed to correspond to a unique reference sequence
//   which should constrain its lineage-level alignment
// - multiple erv_lineage rows may share the same rv_species assignment
// - sets displayName and clade_category on each alignment

var DRY_RUN = false;
var SOURCE_NAME_PATTERN = "erv-refseqs-%";
var INPUT_PATH = "tabular/erv/erv_clade_refseqs.tsv";

// -----------------------------------------------------------------------------
// Load ERV extension refs from TSV
// -----------------------------------------------------------------------------

var refMaps = loadRefMaps();
var refNameByGenus = refMaps.refNameByGenus;
var refNameBySubgenus = refMaps.refNameBySubgenus;

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

var existingAlignmentIndex = loadExistingAlignmentIndex();
var lineageTaxRows = loadLineageTaxRows();
var taxIndex = buildTaxIndex(lineageTaxRows);

buildAlignmentTree(taxIndex);
log("ERV alignment tree build complete.");

// -----------------------------------------------------------------------------
// Build tree
// -----------------------------------------------------------------------------

function buildAlignmentTree(taxIndex) {

    _.each(taxIndex.cladeIds, function(cladeId) {
        buildCladeRoot(cladeId);
    });

    _.each(taxIndex.cladeIds, function(cladeId) {
        var genusIds = taxIndex.generaByClade[cladeId] || [];
        _.each(genusIds, function(genusId) {
            buildGenusAlignment(cladeId, genusId);
        });
    });

    _.each(_.keys(taxIndex.subgeneraByGenus).sort(), function(genusId) {
        var subgenusIds = taxIndex.subgeneraByGenus[genusId] || [];
        _.each(subgenusIds, function(subgenusId) {
            buildSubgenusAlignment(genusId, subgenusId);
        });
    });

    _.each(_.keys(taxIndex.lineagesBySubgenus).sort(), function(subgenusId) {
        var lineageRows = taxIndex.lineagesBySubgenus[subgenusId] || [];
        _.each(lineageRows, function(lineage) {
            buildLineageAlignmentUnderSubgenus(subgenusId, lineage);
        });
    });

    _.each(_.keys(taxIndex.directLineagesByGenus).sort(), function(genusId) {
        var lineageRows = taxIndex.directLineagesByGenus[genusId] || [];
        _.each(lineageRows, function(lineage) {
            buildLineageAlignmentUnderGenus(genusId, lineage);
        });
    });
}

function buildCladeRoot(cladeId) {
    var alignmentName = cladeAlignmentName(cladeId);

    requireExistingAlignment(alignmentName, "clade '" + cladeId + "'");

    var whereClause = seqWhere([
        "source.name like '" + escapeQuotes(SOURCE_NAME_PATTERN) + "'",
        "erv_lineage.rv_species.rv_clade.id = '" + escapeQuotes(cladeId) + "'"
    ]);

    inAlignment(alignmentName, function() {
        setField("displayName", cladeId);
        setField("clade_category", "clade");
        addMembers(whereClause);
    });
}

function buildGenusAlignment(cladeId, genusId) {
    var parentAlignmentName = cladeAlignmentName(cladeId);
    var childAlignmentName = genusAlignmentName(genusId);

    requireExistingAlignment(parentAlignmentName, "parent clade alignment for genus '" + genusId + "'");

    var refName = getRefNameIfNeeded(childAlignmentName, refNameByGenus, genusId, "genus");
    if(refName !== null) {
        extractChildIfMissing(parentAlignmentName, childAlignmentName, refName);
    } else {
        requireExistingAlignment(childAlignmentName, "genus '" + genusId + "'");
    }

    var whereClause = memberWhere([
        "source.name like '" + escapeQuotes(SOURCE_NAME_PATTERN) + "'",
        "erv_lineage.rv_species.rv_genus.id = '" + escapeQuotes(genusId) + "'"
    ]);

    demoteMembers(parentAlignmentName, childAlignmentName, whereClause);

    inAlignment(childAlignmentName, function() {
        setField("displayName", genusId);
        setField("clade_category", "genus");
    });
}

function buildSubgenusAlignment(genusId, subgenusId) {
    var parentAlignmentName = genusAlignmentName(genusId);
    var childAlignmentName = subgenusAlignmentName(subgenusId);

    requireExistingAlignment(parentAlignmentName, "parent genus alignment for subgenus '" + subgenusId + "'");

    var refName = getRefNameIfNeeded(childAlignmentName, refNameBySubgenus, subgenusId, "subgenus");
    if(refName !== null) {
        extractChildIfMissing(parentAlignmentName, childAlignmentName, refName);
    } else {
        requireExistingAlignment(childAlignmentName, "subgenus '" + subgenusId + "'");
    }

    var whereClause = memberWhere([
        "source.name like '" + escapeQuotes(SOURCE_NAME_PATTERN) + "'",
        "erv_lineage.rv_subgenus.id = '" + escapeQuotes(subgenusId) + "'"
    ]);

    demoteMembers(parentAlignmentName, childAlignmentName, whereClause);

    inAlignment(childAlignmentName, function() {
        setField("displayName", subgenusId);
        setField("clade_category", "subgenus");
    });
}

function buildLineageAlignmentUnderSubgenus(subgenusId, lineage) {
    var parentAlignmentName = subgenusAlignmentName(subgenusId);
    var childAlignmentName = lineageAlignmentName(lineage);

    requireExistingAlignment(parentAlignmentName, "parent subgenus alignment for lineage '" + lineage.id + "'");

    var refName = refNameForLineage(lineage);

    extractChildIfMissing(parentAlignmentName, childAlignmentName, refName);

    var whereClause = memberWhere([
        "source.name like '" + escapeQuotes(SOURCE_NAME_PATTERN) + "'",
        "erv_lineage.id = '" + escapeQuotes(lineage.id) + "'"
    ]);

    demoteMembers(parentAlignmentName, childAlignmentName, whereClause);

    inAlignment(childAlignmentName, function() {
        setField("displayName", lineageDisplayName(lineage));
        setField("clade_category", "lineage");
    });
}

function buildLineageAlignmentUnderGenus(genusId, lineage) {
    var parentAlignmentName = genusAlignmentName(genusId);
    var childAlignmentName = lineageAlignmentName(lineage);

    requireExistingAlignment(parentAlignmentName, "parent genus alignment for lineage '" + lineage.id + "'");

    var refName = refNameForLineage(lineage);

    extractChildIfMissing(parentAlignmentName, childAlignmentName, refName);

    var whereClause = memberWhere([
        "source.name like '" + escapeQuotes(SOURCE_NAME_PATTERN) + "'",
        "erv_lineage.id = '" + escapeQuotes(lineage.id) + "'"
    ]);

    demoteMembers(parentAlignmentName, childAlignmentName, whereClause);

    inAlignment(childAlignmentName, function() {
        setField("displayName", lineageDisplayName(lineage));
        setField("clade_category", "lineage");
    });
}

// -----------------------------------------------------------------------------
// Taxonomy loading from sequence table
// -----------------------------------------------------------------------------

function loadLineageTaxRows() {
    var baseRows = queryObjects([
        "list", "sequence",
        "sequenceID",
        "erv_lineage.id",
        "erv_lineage.rv_species.id",
        "erv_lineage.rv_species.rv_clade.id",
        "erv_lineage.rv_species.rv_genus.id",
        "-w", "source.name like '" + escapeQuotes(SOURCE_NAME_PATTERN) + "'",
        "-s", "erv_lineage.rv_species.rv_clade.id,erv_lineage.rv_species.rv_genus.id,erv_lineage.id"
    ]);

    var subgenusRows = queryObjects([
        "list", "sequence",
        "sequenceID",
        "erv_lineage.id",
        "erv_lineage.rv_species.id",
        "erv_lineage.rv_subgenus.id",
        "-w", "source.name like '" + escapeQuotes(SOURCE_NAME_PATTERN) + "' and erv_lineage.rv_subgenus.id != null",
        "-s", "erv_lineage.id"
    ]);

    var lineageRowsById = {};
    var subgenusByLineageId = {};

    _.each(baseRows, function(row) {
        var lineageId = normTaxValue(row["erv_lineage.id"]);
        var speciesId = normTaxValue(row["erv_lineage.rv_species.id"]);
        var cladeId = normTaxValue(row["erv_lineage.rv_species.rv_clade.id"]);
        var genusId = normTaxValue(row["erv_lineage.rv_species.rv_genus.id"]);
        var sequenceID = normTaxValue(row.sequenceID);

        if(lineageId === null || speciesId === null || cladeId === null || genusId === null || sequenceID === null) {
            return;
        }

        if(lineageRowsById[lineageId]) {
            throw "Multiple ERV reference sequences found for lineage '" + lineageId + "'";
        }

        lineageRowsById[lineageId] = {
            id: lineageId,
            sequenceID: sequenceID,
            "rv_species.id": speciesId,
            "rv_clade.id": cladeId,
            "rv_genus.id": genusId,
            "rv_subgenus.id": null
        };
    });

    _.each(subgenusRows, function(row) {
        var lineageId = normTaxValue(row["erv_lineage.id"]);
        var subgenusId = normTaxValue(row["erv_lineage.rv_subgenus.id"]);

        if(lineageId === null || subgenusId === null) {
            return;
        }

        if(subgenusByLineageId[lineageId] && subgenusByLineageId[lineageId] !== subgenusId) {
            throw "Conflicting subgenus assignments found for lineage '" + lineageId + "'";
        }

        subgenusByLineageId[lineageId] = subgenusId;
    });

    _.each(_.keys(lineageRowsById), function(lineageId) {
        if(subgenusByLineageId.hasOwnProperty(lineageId)) {
            lineageRowsById[lineageId]["rv_subgenus.id"] = subgenusByLineageId[lineageId];
        }
    });

    return _.map(_.keys(lineageRowsById).sort(), function(lineageId) {
        return lineageRowsById[lineageId];
    });
}

function buildTaxIndex(lineageRows) {
    var taxIndex = {
        cladeIds: [],
        generaByClade: {},
        subgeneraByGenus: {},
        lineagesBySubgenus: {},
        directLineagesByGenus: {}
    };

    var seenClade = {};
    var seenGenusByClade = {};
    var seenSubgenusByGenus = {};

    _.each(lineageRows, function(lineage) {
        var cladeId = normTaxValue(lineage["rv_clade.id"]);
        var genusId = normTaxValue(lineage["rv_genus.id"]);
        var subgenusId = normTaxValue(lineage["rv_subgenus.id"]);

        if(cladeId !== null && !seenClade[cladeId]) {
            seenClade[cladeId] = true;
            taxIndex.cladeIds.push(cladeId);
        }

        if(cladeId !== null && genusId !== null) {
            if(!taxIndex.generaByClade[cladeId]) {
                taxIndex.generaByClade[cladeId] = [];
                seenGenusByClade[cladeId] = {};
            }
            if(!seenGenusByClade[cladeId][genusId]) {
                seenGenusByClade[cladeId][genusId] = true;
                taxIndex.generaByClade[cladeId].push(genusId);
            }
        }

        if(genusId !== null && subgenusId !== null) {
            if(!taxIndex.subgeneraByGenus[genusId]) {
                taxIndex.subgeneraByGenus[genusId] = [];
                seenSubgenusByGenus[genusId] = {};
            }
            if(!seenSubgenusByGenus[genusId][subgenusId]) {
                seenSubgenusByGenus[genusId][subgenusId] = true;
                taxIndex.subgeneraByGenus[genusId].push(subgenusId);
            }

            if(!taxIndex.lineagesBySubgenus[subgenusId]) {
                taxIndex.lineagesBySubgenus[subgenusId] = [];
            }
            taxIndex.lineagesBySubgenus[subgenusId].push(lineage);
        }

        if(genusId !== null && subgenusId === null) {
            if(!taxIndex.directLineagesByGenus[genusId]) {
                taxIndex.directLineagesByGenus[genusId] = [];
            }
            taxIndex.directLineagesByGenus[genusId].push(lineage);
        }
    });

    taxIndex.cladeIds.sort();

    _.each(_.keys(taxIndex.generaByClade), function(cladeId) {
        taxIndex.generaByClade[cladeId].sort();
    });

    _.each(_.keys(taxIndex.subgeneraByGenus), function(genusId) {
        taxIndex.subgeneraByGenus[genusId].sort();
    });

    _.each(_.keys(taxIndex.lineagesBySubgenus), function(subgenusId) {
        taxIndex.lineagesBySubgenus[subgenusId].sort(function(a, b) {
            return a.id.localeCompare(b.id);
        });
    });

    _.each(_.keys(taxIndex.directLineagesByGenus), function(genusId) {
        taxIndex.directLineagesByGenus[genusId].sort(function(a, b) {
            return a.id.localeCompare(b.id);
        });
    });

    return taxIndex;
}

// -----------------------------------------------------------------------------
// Existing alignment index
// -----------------------------------------------------------------------------

function loadExistingAlignmentIndex() {
    var rows = queryObjects([
        "list", "alignment",
        "name", "parent.name", "refSequence.name"
    ]);

    var byName = {};
    _.each(rows, function(row) {
        byName[row.name] = {
            name: row.name,
            parentName: row["parent.name"],
            refName: row["refSequence.name"]
        };
    });
    return byName;
}

// -----------------------------------------------------------------------------
// Load reference mappings from TSV
// -----------------------------------------------------------------------------

function loadRefMaps() {
    var taxRows;

    glue.inMode("module/tabularUtility", function() {
        taxRows = glue.tableToObjects(glue.command(["load-tabular", INPUT_PATH]));
    });

    var refNameByGenus = {};
    var refNameBySubgenus = {};

    _.each(taxRows, function(row) {
        var taxonomicLevel = normTaxValue(row["taxonomic_level"]);
        var genusId = normTaxValue(row["genus"]);
        var name = normTaxValue(row["name"]);
        var refName = normTaxValue(row["ref_name"]);

        if(taxonomicLevel === null || name === null || refName === null) {
            return;
        }

        if(taxonomicLevel === "genus") {
            if(refNameByGenus[name] && refNameByGenus[name] !== refName) {
                throw "Conflicting ref_name for genus '" + name + "'";
            }
            refNameByGenus[name] = refName;
            return;
        }

        if(taxonomicLevel === "subgenus") {
            if(genusId === null) {
                throw "Subgenus row lacks genus";
            }
            if(refNameBySubgenus[name] && refNameBySubgenus[name] !== refName) {
                throw "Conflicting ref_name for subgenus '" + name + "'";
            }
            refNameBySubgenus[name] = refName;
            return;
        }

        throw "Unrecognized taxonomic_level in ERV ref TSV: " + taxonomicLevel;
    });

    return {
        refNameByGenus: refNameByGenus,
        refNameBySubgenus: refNameBySubgenus
    };
}

// -----------------------------------------------------------------------------
// Where-clause helpers
// -----------------------------------------------------------------------------

function seqWhere(parts) {
    return _.compact(parts).join(" and ");
}

function memberWhere(parts) {
    return _.map(_.compact(parts), function(part) {
        return "sequence." + part;
    }).join(" and ");
}

// -----------------------------------------------------------------------------
// Naming helpers
// -----------------------------------------------------------------------------

function cladeAlignmentName(cladeId) {
    return "AL_ROOT_CLADE_" + sanitizeId(cladeId);
}

function genusAlignmentName(genusId) {
    return "AL_GENUS_" + sanitizeId(genusId);
}

function subgenusAlignmentName(subgenusId) {
    return "AL_SUBGENUS_" + sanitizeId(subgenusId);
}

function lineageAlignmentName(lineageObj) {
    return "AL_LINEAGE_" + sanitizeRefSuffix(lineageObj.id);
}

function lineageDisplayName(lineageObj) {
    return lineageObj.id;
}

function sanitizeRefSuffix(name) {
    return ("" + name).replace(/[^A-Za-z0-9]/g, "");
}

function refNameForLineage(lineageObj) {
    return "REF_" + sanitizeRefSuffix(lineageObj.sequenceID);
}

// -----------------------------------------------------------------------------
// Alignment helpers
// -----------------------------------------------------------------------------

function requireExistingAlignment(alignmentName, description) {
    if(!alignmentExists(alignmentName)) {
        throw "Expected existing alignment missing for " + description + ": " + alignmentName;
    }
}

function getRefNameIfNeeded(alignmentName, mapObj, key, levelName) {
    if(alignmentExists(alignmentName)) {
        return null;
    }
    var refName = mapObj[key];
    if(!refName) {
        throw levelName + " alignment '" + alignmentName +
            "' is missing and no ERV extension ref is configured for '" + key + "'";
    }
    return refName;
}

function extractChildIfMissing(parentAlignmentName, childAlignmentName, refName) {
    if(alignmentExists(childAlignmentName)) {
        log("Child alignment already exists: " + childAlignmentName);
        return;
    }
    inAlignment(parentAlignmentName, function() {
        runCmd(["extract", "child", childAlignmentName, "-r", refName]);
    });
    existingAlignmentIndex[childAlignmentName] = {
        name: childAlignmentName,
        parentName: parentAlignmentName,
        refName: refName
    };
}

function demoteMembers(parentAlignmentName, childAlignmentName, whereClause) {
    inAlignment(parentAlignmentName, function() {
        runCmd(["demote", "member", childAlignmentName, "--whereClause", whereClause]);
    });
}

function addMembers(whereClause) {
    runCmd(["add", "member", "--whereClause", whereClause]);
}

function inAlignment(alignmentName, fn) {
    glue.inMode("/alignment/" + alignmentName, fn);
}

function setField(fieldName, value) {
    runCmd(["set", "field", fieldName, value]);
}

// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------

function normTaxValue(value) {
    if(value === null || value === undefined) {
        return null;
    }
    var s = ("" + value).trim();
    if(s === "" || s === "-" || s.toLowerCase() === "n/a") {
        return null;
    }
    return s;
}

function sanitizeId(value) {
    return ("" + value).replace(/[^A-Za-z0-9._-]/g, "_");
}

function escapeQuotes(value) {
    return ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function alignmentExists(alignmentName) {
    return existingAlignmentIndex.hasOwnProperty(alignmentName);
}

function log(msg) {
    glue.log("INFO", msg);
}

function runCmd(cmdWords) {
    if(DRY_RUN) {
        log("[DRY RUN] " + cmdWords.join(" "));
        return null;
    }
    return glue.command(cmdWords);
}

function queryObjects(cmdWords) {
    return glue.tableToObjects(glue.command(cmdWords));
}