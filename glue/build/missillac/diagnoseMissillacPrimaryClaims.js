// glue/build/missillac/diagnoseMissillacPrimaryClaims.js
//
// Assign Missillac identifiers to permanent ERV loci.
//
// Numbering precedence:
//   1. compiled_human_erv_loci_hg19
//   2. wang_hervh_hg19 (ERV-1.Zeta.HF.H.1 only)
//   3. De novo allocation in genomic order
//
// Eligibility:
//   - Exactly one distinct ERV-lineage association
//   - locus_type = erv or solo_ltr
//
// Writes:
//   erv_locus.orthology_group
//   erv_locus.missillac_id
//
// This is a bootstrap allocator. A persistent registry will
// subsequently protect previously issued and retired IDs.

var DRY_RUN = true;
var DETAIL_PRIMARY_ISSUES = true;

var LOCUS_TABLE = "erv_locus";
var ASSOC_TABLE = "erv_locus_lineage_assoc";
var XREF_TABLE = "erv_locus_legacy_xref";

var PRIMARY_SOURCE = "compiled_human_erv_loci_hg19";
var SECONDARY_SOURCE = "wang_hervh_hg19";
var SECONDARY_LINEAGE = "ERV-1.Zeta.HF.H.1";


// ============================================================
// Utilities
// ============================================================

function log(message) {
    glue.logInfo(message);
}

function query(command) {
    return glue.tableToObjects(glue.command(command));
}

function norm(value) {
    if(value === null || value === undefined) {
        return null;
    }

    var s = String(value).trim();

    if(s === "" || /^(null|none|na|n\/a|-)$/i.test(s)) {
        return null;
    }

    return s;
}

function positiveInt(value) {
    var s = norm(value);

    if(s === null || !/^\d+$/.test(s)) {
        return null;
    }

    var n = Number(s);

    return isFinite(n) &&
        Math.floor(n) === n &&
        n > 0 &&
        n <= 9007199254740991
        ? n : null;
}

function extractWangNumber(name) {
    name = norm(name);

    if(name === null) {
        return null;
    }

    var match = /^HERVH_(\d+)$/i.exec(name);

    return match ? positiveInt(match[1]) : null;
}

function makeMissillacId(lineage, number, type) {
    return lineage + "-" + number +
        (type === "solo_ltr" ? "(LTR)" : "");
}

function addToMap(map, key, value) {
    if(!map[key]) {
        map[key] = [];
    }

    map[key].push(value);
}

function uniqueNumbers(claims) {
    var seen = {};

    claims.forEach(function(claim) {
        seen[String(claim.number)] = claim.number;
    });

    return Object.keys(seen).map(function(key) {
        return seen[key];
    });
}

function chromosomeRank(scaffold) {
    var s = norm(scaffold);

    if(s === null) {
        return 1000;
    }

    s = s.replace(/^chr/i, "").toUpperCase();

    if(s === "X") return 23;
    if(s === "Y") return 24;
    if(s === "M" || s === "MT") return 25;

    if(/^\d+$/.test(s)) {
        return Number(s);
    }

    return 1000;
}

function compareText(a, b) {
    a = a || "";
    b = b || "";

    return a < b ? -1 : (a > b ? 1 : 0);
}

function genomicSort(a, b) {
    var c = compareText(a.host_species, b.host_species);
    if(c !== 0) return c;

    c = compareText(a.genome_build, b.genome_build);
    if(c !== 0) return c;

    c = chromosomeRank(a.scaffold) -
        chromosomeRank(b.scaffold);
    if(c !== 0) return c;

    c = compareText(a.scaffold, b.scaffold);
    if(c !== 0) return c;

    c = a.start_position - b.start_position;
    if(c !== 0) return c;

    c = a.end_position - b.end_position;
    if(c !== 0) return c;

    return compareText(a.locus_id, b.locus_id);
}


// ============================================================
// 1. Load permanent loci
// ============================================================

log("Loading permanent ERV loci");

var locusRows = query([
    "list", "custom-table-row", LOCUS_TABLE,
    "id",
    "host_species",
    "genome_build",
    "scaffold",
    "start_position",
    "end_position",
    "locus_type",
    "orthology_group",
    "missillac_id",
    "-s", "id"
]);

var loci = {};

locusRows.forEach(function(row) {
    var id = norm(row.id);

    if(id === null) return;

    loci[id] = {
        locus_id: id,
        host_species: norm(row.host_species),
        genome_build: norm(row.genome_build),
        scaffold: norm(row.scaffold),
        start_position: Number(row.start_position) || 0,
        end_position: Number(row.end_position) || 0,
        locus_type: norm(row.locus_type),
        existing_group: positiveInt(row.orthology_group),
        existing_id: norm(row.missillac_id)
    };
});

log("Loaded " + Object.keys(loci).length + " loci");


// ============================================================
// 2. Load lineage associations
// ============================================================

log("Loading ERV-lineage associations");

var assocRows = query([
    "list", "custom-table-row", ASSOC_TABLE,
    "erv_locus.id",
    "erv_lineage.id",
    "-s", "erv_locus.id,erv_lineage.id"
]);

var lineagesByLocus = {};

assocRows.forEach(function(row) {
    var locusId = norm(row["erv_locus.id"]);
    var lineageId = norm(row["erv_lineage.id"]);

    if(locusId === null || lineageId === null) return;

    if(!lineagesByLocus[locusId]) {
        lineagesByLocus[locusId] = {};
    }

    lineagesByLocus[locusId][lineageId] = true;
});

log("Loaded " + assocRows.length + " association rows");


// ============================================================
// 3. Determine eligible loci
// ============================================================

var eligibleByLineage = {};

var stats = {
    total: Object.keys(loci).length,
    eligible: 0,
    noLineage: 0,
    multipleLineages: 0,
    invalidType: 0,

    primaryClaims: 0,
    secondaryClaims: 0,
    primaryAssigned: 0,
    secondaryAssigned: 0,

    primaryAmbiguous: 0,
    primaryCollisions: 0,
    secondaryAmbiguous: 0,
    secondaryCollisions: 0,
    secondaryBlocked: 0,

    newAssigned: 0,
    unchanged: 0,
    changed: 0,
    unassigned: 0
};

Object.keys(loci).sort().forEach(function(id) {
    var locus = loci[id];

    var lineageMap = lineagesByLocus[id] || {};
    var lineageIds = Object.keys(lineageMap);

    if(lineageIds.length === 0) {
        stats.noLineage++;
        return;
    }

    if(lineageIds.length !== 1) {
        stats.multipleLineages++;
        return;
    }

    var type = locus.locus_type === null
        ? null : locus.locus_type.toLowerCase();

    if(type !== "erv" && type !== "solo_ltr") {
        stats.invalidType++;
        return;
    }

    locus.locus_type = type;
    locus.lineage_id = lineageIds[0];

    addToMap(
        eligibleByLineage,
        locus.lineage_id,
        locus
    );

    stats.eligible++;
});

log("Eligible loci: " + stats.eligible);


// ============================================================
// 4. Load legacy numbering claims
// ============================================================

// Each source is loaded independently.
// Wang identifiers may be stored only in legacy_name,
// e.g. HERVH_1207.

function loadClaims(source, isWang) {
    log("Loading numbering claims: " + source);

    var where =
        "legacy_source = '" + source +
        "' and mapping_status = 'mapped'";

    if(!isWang) {
        where += " and source_numeric_id != null";
    }

    var rows = query([
        "list", "custom-table-row", XREF_TABLE,
        "id",
        "legacy_name",
        "source_numeric_id",
        "erv_locus.id",
        "-w", where,
        "-s", "erv_locus.id"
    ]);

    var claimsByLocus = {};
    var usable = 0;

    rows.forEach(function(row) {
        var locusId = norm(row["erv_locus.id"]);

        if(locusId === null) return;

        var number = positiveInt(row.source_numeric_id);

        if(isWang && number === null) {
            number = extractWangNumber(row.legacy_name);
        }

        if(number === null) return;

        addToMap(claimsByLocus, locusId, {
            number: number,
            xref_id: norm(row.id),
            legacy_name: norm(row.legacy_name)
        });

        usable++;
    });

    log(
        source + ": " + rows.length +
        " mapped records, " + usable +
        " usable numbering claims"
    );

    return claimsByLocus;
}

var primaryClaims = loadClaims(PRIMARY_SOURCE, false);
var secondaryClaims = loadClaims(SECONDARY_SOURCE, true);


// ============================================================
// 5. Resolve and reserve numbers
// ============================================================

var assignments = [];
var issues = [];

function issue(type, lineage, number, locusIds) {
    issues.push({
        type: type,
        lineage: lineage,
        number: number,
        loci: locusIds
    });
}

function resolveClaim(claims) {
    if(!claims || claims.length === 0) {
        return { status: "none", number: null };
    }

    var numbers = uniqueNumbers(claims);

    if(numbers.length !== 1) {
        return { status: "ambiguous", number: null };
    }

    return { status: "valid", number: numbers[0] };
}

Object.keys(eligibleByLineage).sort().forEach(function(lineage) {
    var items = eligibleByLineage[lineage];

    items.sort(genomicSort);

    var used = {};
    var assigned = {};
    var blocked = {};

    // --------------------------------------------------------
    // 5A. Resolve primary claims
    // --------------------------------------------------------

    var primaryByNumber = {};

    items.forEach(function(item) {
        var claims = primaryClaims[item.locus_id] || [];

        stats.primaryClaims += claims.length;

        var result = resolveClaim(claims);

        if(result.status === "ambiguous") {
            blocked[item.locus_id] = true;
            stats.primaryAmbiguous++;

            issue(
                "ambiguous_primary",
                lineage,
                null,
                [item.locus_id]
            );

            return;
        }

        if(result.status === "valid") {
            addToMap(
                primaryByNumber,
                String(result.number),
                item
            );
        }
    });

    // --------------------------------------------------------
    // 5B. Reserve uncontested primary numbers
    // --------------------------------------------------------

    Object.keys(primaryByNumber).forEach(function(key) {
        var claimants = primaryByNumber[key];

        if(claimants.length !== 1) {
            stats.primaryCollisions++;

            claimants.forEach(function(item) {
                blocked[item.locus_id] = true;
            });

            issue(
                "primary_collision",
                lineage,
                Number(key),
                claimants.map(function(item) {
                    return item.locus_id;
                })
            );

            // Prevent secondary or de novo allocation from
            // recycling this disputed primary number.
            used[key] = true;
            return;
        }

        var item = claimants[0];

        assigned[item.locus_id] = {
            number: Number(key),
            source: PRIMARY_SOURCE
        };

        used[key] = true;
        stats.primaryAssigned++;
    });

    // --------------------------------------------------------
    // 5C. Resolve secondary Wang claims
    // --------------------------------------------------------

    if(lineage === SECONDARY_LINEAGE) {
        var wangByNumber = {};

        items.forEach(function(item) {
            if(blocked[item.locus_id]) return;
            if(assigned[item.locus_id]) return;

            var claims =
                secondaryClaims[item.locus_id] || [];

            stats.secondaryClaims += claims.length;

            var result = resolveClaim(claims);

            if(result.status === "ambiguous") {
                stats.secondaryAmbiguous++;

                issue(
                    "ambiguous_wang",
                    lineage,
                    null,
                    [item.locus_id]
                );

                return;
            }

            if(result.status === "valid") {
                addToMap(
                    wangByNumber,
                    String(result.number),
                    item
                );
            }
        });

        // ----------------------------------------------------
        // 5D. Reserve uncontested Wang numbers
        // ----------------------------------------------------

        Object.keys(wangByNumber).forEach(function(key) {
            var claimants = wangByNumber[key];

            if(used[key]) {
                stats.secondaryBlocked += claimants.length;

                issue(
                    "wang_number_reserved",
                    lineage,
                    Number(key),
                    claimants.map(function(item) {
                        return item.locus_id;
                    })
                );

                return;
            }

            if(claimants.length !== 1) {
                stats.secondaryCollisions++;

                issue(
                    "wang_collision",
                    lineage,
                    Number(key),
                    claimants.map(function(item) {
                        return item.locus_id;
                    })
                );

                // Disputed Wang numbers are not reused
                // for de novo allocation.
                used[key] = true;
                return;
            }

            var item = claimants[0];

            assigned[item.locus_id] = {
                number: Number(key),
                source: SECONDARY_SOURCE
            };

            used[key] = true;
            stats.secondaryAssigned++;
        });
    }

    // --------------------------------------------------------
    // 5E. Allocate remaining numbers
    // --------------------------------------------------------

    var nextNumber = 1;

    function allocateNumber() {
        while(used[String(nextNumber)]) {
            nextNumber++;
        }

        var result = nextNumber;

        used[String(result)] = true;
        nextNumber++;

        return result;
    }

    items.forEach(function(item) {
        if(blocked[item.locus_id]) {
            stats.unassigned++;
            return;
        }

        var assignment = assigned[item.locus_id];

        if(!assignment) {
            assignment = {
                number: allocateNumber(),
                source: "genomic_order"
            };

            stats.newAssigned++;
        }

        var missillacId = makeMissillacId(
            lineage,
            assignment.number,
            item.locus_type
        );

        var unchanged =
            item.existing_group === assignment.number &&
            item.existing_id === missillacId;

        if(unchanged) {
            stats.unchanged++;
        } else {
            stats.changed++;
        }

        assignments.push({
            locus_id: item.locus_id,
            lineage_id: lineage,
            number: assignment.number,
            missillac_id: missillacId,
            source: assignment.source,
            unchanged: unchanged,
            existing_id: item.existing_id
        });
    });
});


// ============================================================
// 6. Pre-write consistency checks
// ============================================================

// These are basic safeguards, not a replacement for
// validateMissillacAssignments.js.

var seenIds = {};
var seenGroups = {};
var duplicateErrors = [];

assignments.forEach(function(a) {
    if(seenIds[a.missillac_id]) {
        duplicateErrors.push(
            "Duplicate ID: " + a.missillac_id
        );
    }

    seenIds[a.missillac_id] = true;

    // Solo LTR and internal ERV loci share a numbering
    // namespace within each lineage.
    var groupKey = a.lineage_id + "|" + a.number;

    if(seenGroups[groupKey]) {
        duplicateErrors.push(
            "Duplicate lineage/group: " + groupKey
        );
    }

    seenGroups[groupKey] = true;
});

if(duplicateErrors.length > 0) {
    throw new Error(
        "Invalid proposed Missillac assignments:\n" +
        duplicateErrors.join("\n")
    );
}


// ============================================================
// 7. Report proposed changes
// ============================================================

log("==================================================");
log("Missillac locus naming summary");
log("==================================================");

log("Permanent loci examined:       " + stats.total);
log("Eligible loci:                 " + stats.eligible);
log("No lineage:                    " + stats.noLineage);
log("Multiple lineages:             " + stats.multipleLineages);
log("Unsupported locus type:        " + stats.invalidType);

log("--------------------------------------------------");
log("Numbering");
log("--------------------------------------------------");

log("Primary assignments:          " + stats.primaryAssigned);
log("Wang HERV-H assignments:       " + stats.secondaryAssigned);
log("De novo assignments:          " + stats.newAssigned);

log("--------------------------------------------------");
log("Conflicts");
log("--------------------------------------------------");

log("Ambiguous primary claims:      " + stats.primaryAmbiguous);
log("Primary number collisions:     " + stats.primaryCollisions);
log("Ambiguous Wang claims:         " + stats.secondaryAmbiguous);
log("Wang number collisions:        " + stats.secondaryCollisions);
log("Wang numbers blocked:          " + stats.secondaryBlocked);
log("Eligible loci left unassigned: " + stats.unassigned);

log("--------------------------------------------------");
log("Changes");
log("--------------------------------------------------");

log("Assignments unchanged:         " + stats.unchanged);
log("Assignments changed/new:       " + stats.changed);
log("Assignments proposed:          " + assignments.length);

// Explain the individual mapped legacy records behind primary conflicts.
// Diagnostic only: this does not alter allocation logic or the database.
function describePrimaryClaims(locusId) {
    var claims = primaryClaims[locusId] || [];
    if(claims.length === 0) {
        log("  CLAIM locus=" + locusId + " (none)");
        return;
    }
    claims.forEach(function(c) {
        log("  CLAIM locus=" + locusId +
            " xref_id=" + (c.xref_id || "(none)") +
            " legacy_name=" + (c.legacy_name || "(none)") +
            " source_numeric_id=" + c.number);
    });
}

issues.forEach(function(x) {
    log(
        "ISSUE " + x.type +
        " lineage=" + x.lineage +
        " number=" + x.number +
        " loci=" + x.loci.join(",")
    );
    if(DETAIL_PRIMARY_ISSUES &&
            (x.type === "ambiguous_primary" || x.type === "primary_collision")) {
        x.loci.forEach(describePrimaryClaims);
    }
});

// Show a limited sample of changes during dry runs.

if(DRY_RUN) {
    var shown = 0;

    assignments.forEach(function(a) {
        if(a.unchanged || shown >= 50) return;

        log(
            "CHANGE " + a.locus_id +
            ": " + (a.existing_id || "(none)") +
            " -> " + a.missillac_id +
            " [" + a.source + "]"
        );

        shown++;
    });
}


// ============================================================
// 8. Write assignments
// ============================================================

if(DRY_RUN) {
    log("DRY RUN: no database changes made");
} else {
    log("Writing " + assignments.length + " assignments");

    assignments.forEach(function(a, index) {
        if(a.unchanged) return;

        glue.inMode(
            "/custom-table-row/" +
            LOCUS_TABLE + "/" + a.locus_id,
            function() {
                glue.command([
                    "set", "field",
                    "orthology_group",
                    String(a.number)
                ]);

                glue.command([
                    "set", "field",
                    "missillac_id",
                    a.missillac_id
                ]);
            }
        );

        if((index + 1) % 10000 === 0) {
            log("Processed " + (index + 1) + " assignments");
        }
    });

    log("Missillac naming completed");
}

log("==================================================");
