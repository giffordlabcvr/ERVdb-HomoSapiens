// glue/build/curation/loadCuratedErvLoci.js
//
// Restore missing permanent ERV loci with recognised curator decisions.
//
// Run after loadErvLoci.js and before applyErvLocusCuratorDecisions.js.
//
// Curator decisions are resolved through the exact name mapping TSV.
// No heuristic matching or automatic fallback to parent lineages.
//
// Only restores a locus when:
//   1. Its curator decision maps to an existing erv_lineage.
//   2. The mapped entity is lineage, sublineage or erv_derived_repeat.
//   3. A corresponding erv_locus_candidate exists.
//   4. Exactly one imported sequence exists in LOCUS_SOURCES.
//   5. The permanent erv_locus row does not already exist.
//
// Does not create lineage associations.
// Does not populate Missillac identifiers.
// Does not alter existing permanent loci.
//
// Start with DRY_RUN = true.

var DRY_RUN = false;
var DETAIL_LIMIT = 100;

var HOST_SPECIES = "Homo sapiens";
var GENOME_BUILD = "hg19";

var DECISIONS_FILE =
    "tabular/curation/erv_curator_decisions.tsv";

var MAPPINGS_FILE =
    "tabular/locus/erv_locus_name_mappings.tsv";

var LOCUS_SOURCES = [
    "filtered_2026_10"
];

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function log(s) {
    glue.logInfo("" + s);
}

function norm(v) {
    if(v === null || v === undefined) return null;
    var s = ("" + v).trim();
    if(!s || /^(n\/a|na|n\/k|unknown|null|none)$/i.test(s))
        return null;
    return s;
}

function bool(v) {
    v = norm(v);
    if(v === null) return null;
    if(/^(true|yes|y|1)$/i.test(v)) return true;
    if(/^(false|no|n|0)$/i.test(v)) return false;
    return null;
}

function integer(v) {
    v = norm(v);
    if(v === null) return null;
    if(!/^-?\d+$/.test(v)) return null;
    return parseInt(v, 10);
}

function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
}

function path(table, id) {
    return "custom-table-row/" + table + "/" + id;
}

function query(cmd) {
    return glue.tableToObjects(glue.command(cmd));
}

function escapeQuotes(s) {
    return ("" + s)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}

function setField(name, value) {
    value = norm(value);
    if(value !== null) {
        glue.command(["set", "field", name, "" + value]);
    }
}

function setInteger(name, value) {
    if(value !== null) {
        glue.command(["set", "field", name, "" + value]);
    }
}

function setBoolean(name, value) {
    if(value !== null) {
        glue.command([
            "set", "field", name,
            value ? "true" : "false"
        ]);
    }
}

function readTsv(file, required) {
    var Files = Java.type("java.nio.file.Files");
    var Paths = Java.type("java.nio.file.Paths");
    var UTF8 = Java.type("java.nio.charset.StandardCharsets")
        .UTF_8;

    var lines = Files.readAllLines(Paths.get(file), UTF8);

    if(lines.size() === 0)
        throw new Error("Empty TSV: " + file);

    var headers = String(lines.get(0))
        .replace(/^\uFEFF/, "")
        .replace(/\r$/, "")
        .split("\t");

    required.forEach(function(h) {
        if(headers.indexOf(h) < 0)
            throw new Error(file + ": missing column " + h);
    });

    var result = [];

    for(var i = 1; i < lines.size(); i++) {
        var line = String(lines.get(i)).replace(/\r$/, "");
        if(!line.trim()) continue;

        var cells = line.split("\t");

        if(cells.length !== headers.length) {
            throw new Error(
                file + " line " + (i + 1) +
                ": column count mismatch"
            );
        }

        var row = {_line: i + 1};

        for(var j = 0; j < headers.length; j++) {
            row[headers[j]] = cells[j].trim();
        }

        result.push(row);
    }

    return result;
}

function show(title, values) {
    log(title + ": " + values.length);

    for(var i = 0; i < Math.min(values.length, DETAIL_LIMIT); i++)
        log("  " + values[i]);

    if(values.length > DETAIL_LIMIT)
        log("  ... " + (values.length - DETAIL_LIMIT) +
            " additional records");
}

function locusType(status) {
    status = norm(status);
    if(status === null) return null;
    if(status.toLowerCase() === "erv") return "erv";
    if(status.toLowerCase() === "ltr") return "solo_ltr";
    return null;
}

function resolution(status) {
    status = norm(status);
    if(status === null) return null;

    var s = status.toLowerCase();

    if(s === "fully resolved") return "lineage";
    if(s === "resolved at subgenus level") return "subgenus";
    if(s === "resolved at genus level") return "genus";
    if(s === "resolved at clade level") return "clade";
    if(s.indexOf("mosaic") >= 0) return "mosaic";
    if(s.indexOf("unresolved") >= 0) return "unresolved";

    return null;
}

function entityType(t) {
    if(t === "ervr") return "erv_derived_repeat";
    return t;
}

// ------------------------------------------------------------
// 1. Load recognised lineages
// ------------------------------------------------------------

log("Loading ERV lineage nomenclature");

var lineages = Object.create(null);

query([
    "list", "custom-table-row", "erv_lineage",
    "id", "entity_type"
]).forEach(function(row) {
    var id = norm(row.id);
    if(id !== null)
        lineages[id] = norm(row.entity_type);
});

log("Loaded " + Object.keys(lineages).length +
    " ERV lineages/sublineages/ERVRs");

// ------------------------------------------------------------
// 2. Load exact curator-name mappings
// ------------------------------------------------------------

var mappings = Object.create(null);
var mappingProblems = [];

var mappingRows = readTsv(MAPPINGS_FILE, [
    "source_name",
    "entity_type",
    "erv_lineage_id"
]);

mappingRows.forEach(function(row) {
    var name = norm(row.source_name);

    if(name === null) return;

    if(own(mappings, name)) {
        mappingProblems.push(
            "Duplicate source_name: " + name +
            " (line " + row._line + ")"
        );
        return;
    }

    mappings[name] = {
        target: norm(row.erv_lineage_id),
        type: entityType(norm(row.entity_type))
    };
});

if(mappingProblems.length)
    throw new Error(mappingProblems.join("\n"));

function resolveCuratorDecision(name) {
    name = norm(name);

    if(name === null) return null;

    var mapping = mappings[name];

    if(!mapping) return null;

    if(
        mapping.type !== "lineage" &&
        mapping.type !== "sublineage" &&
        mapping.type !== "erv_derived_repeat"
    ) {
        return null;
    }

    if(mapping.target === null) return null;

    if(!own(lineages, mapping.target)) return null;

    if(lineages[mapping.target] !== mapping.type)
        return null;

    return mapping.target;
}

log("Loaded " + Object.keys(mappings).length +
    " exact name mappings");

// ------------------------------------------------------------
// 3. Load curator decisions
// ------------------------------------------------------------

var decisions = readTsv(DECISIONS_FILE, [
    "sequenceID",
    "curator_decision"
]);

log("Loaded " + decisions.length + " curator-decision rows");

// ------------------------------------------------------------
// 4. Load candidate metadata
// ------------------------------------------------------------

var candidates = Object.create(null);

query([
    "list", "custom-table-row", "erv_locus_candidate",
    "id",
    "chrom",
    "strand",
    "start_position",
    "end_position",
    "status",
    "genes_simplified",
    "case_status",
    "curatedns"
]).forEach(function(row) {
    var id = norm(row.id);
    if(id !== null)
        candidates[id] = row;
});

log("Loaded " + Object.keys(candidates).length +
    " candidate loci");

// ------------------------------------------------------------
// 5. Load existing permanent locus IDs
// ------------------------------------------------------------

var existing = Object.create(null);

query([
    "list", "custom-table-row", "erv_locus", "id"
]).forEach(function(row) {
    var id = norm(row.id);
    if(id !== null)
        existing[id] = true;
});

log("Loaded " + Object.keys(existing).length +
    " permanent loci");

// ------------------------------------------------------------
// 6. Load imported sequences
// ------------------------------------------------------------

var sequences = Object.create(null);

LOCUS_SOURCES.forEach(function(source) {
    var rows = query([
        "list", "sequence",
        "source.name", "sequenceID",
        "-w", "source.name = '" +
            escapeQuotes(source) + "'",
        "-s", "sequenceID"
    ]);

    log("Source " + source + ": " + rows.length +
        " imported sequences");

    rows.forEach(function(row) {
        var id = norm(row.sequenceID);
        var sourceName = norm(row["source.name"]);

        if(id === null || sourceName === null) return;

        if(!own(sequences, id))
            sequences[id] = [];

        sequences[id].push({
            source: sourceName,
            id: id
        });
    });
});

// ------------------------------------------------------------
// 7. Build restoration plan
// ------------------------------------------------------------

var plan = [];
var planned = Object.create(null);

var excluded = [];
var missingCandidates = [];
var missingSequences = [];
var duplicateSequences = [];
var invalidCandidates = [];
var conflicts = [];

var blank = 0;
var alreadyPresent = 0;

decisions.forEach(function(row) {
    var id = norm(row.sequenceID);
    var decision = norm(row.curator_decision);

    if(decision === null) {
        blank++;
        return;
    }

    // Crucial: resolve the decision BEFORE restoring anything.
    var target = resolveCuratorDecision(decision);

    if(target === null) {
        excluded.push(
            (id || "[no ID]") + " [" + decision + "]"
        );
        return;
    }

    if(id === null) {
        conflicts.push("Blank sequenceID at line " + row._line);
        return;
    }

    if(own(existing, id)) {
        alreadyPresent++;
        return;
    }

    if(own(planned, id)) {
        if(planned[id] !== target)
            conflicts.push(
                id + ": conflicting targets " +
                planned[id] + " / " + target
            );
        return;
    }

    planned[id] = target;

    var candidate = candidates[id];

    if(!candidate) {
        missingCandidates.push(id + " [" + decision + "]");
        return;
    }

    var refs = sequences[id];

    if(!refs || refs.length === 0) {
        missingSequences.push(id + " [" + decision + "]");
        return;
    }

    if(refs.length !== 1) {
        duplicateSequences.push(id + " [" + decision + "]");
        return;
    }

    var type = locusType(candidate.status);

    if(type === null) {
        invalidCandidates.push(
            id + ": unrecognised status " + candidate.status
        );
        return;
    }

    var start = integer(candidate.start_position);
    var end = integer(candidate.end_position);

    if(
        norm(candidate.chrom) === null ||
        start === null ||
        end === null ||
        start > end
    ) {
        invalidCandidates.push(
            id + ": invalid genomic coordinates"
        );
        return;
    }

    plan.push({
        id: id,
        target: target,
        decision: decision,
        candidate: candidate,
        sequence: refs[0],
        locusType: type,
        start: start,
        end: end
    });
});

// ------------------------------------------------------------
// 8. Preflight report
// ------------------------------------------------------------

log("==================================================");
log("Curated ERV locus restoration");
log("==================================================");

log("Curator decision rows:       " + decisions.length);
log("Blank curator decisions:     " + blank);
log("Already present:             " + alreadyPresent);
log("Excluded/unrecognised:       " + excluded.length);
log("Missing candidate rows:      " + missingCandidates.length);
log("Missing imported sequences:  " + missingSequences.length);
log("Duplicate imported seqs:     " + duplicateSequences.length);
log("Invalid candidate metadata:  " + invalidCandidates.length);
log("Conflicting decisions:       " + conflicts.length);
log("Loci eligible for creation:  " + plan.length);

show("Excluded/unrecognised decisions", excluded);
show("Missing candidate rows", missingCandidates);
show("Missing imported sequences", missingSequences);
show("Duplicate imported sequences", duplicateSequences);
show("Invalid candidates", invalidCandidates);
show("Conflicting decisions", conflicts);

show(
    "Loci to restore",
    plan.map(function(p) {
        return p.id + " [" + p.decision + "] -> " + p.target;
    })
);

// ------------------------------------------------------------
// 9. Write permanent locus records
// ------------------------------------------------------------

if(DRY_RUN) {

    log("DRY RUN: no changes written.");

} else {

    if(conflicts.length || duplicateSequences.length ||
       invalidCandidates.length) {
        throw new Error(
            "Preflight contains conflicting or invalid records. " +
            "No changes written."
        );
    }

    var created = 0;
    var linked = 0;

    plan.forEach(function(p) {
        var c = p.candidate;

        glue.command([
            "create", "custom-table-row", "erv_locus", p.id
        ]);

        glue.inMode(path("erv_locus", p.id), function() {
            setField("host_species", HOST_SPECIES);
            setField("genome_build", GENOME_BUILD);
            setField("scaffold", c.chrom);
            setInteger("start_position", p.start);
            setInteger("end_position", p.end);
            setField("orientation", c.strand);
            setField("locus_type", p.locusType);
            setField("structural_profile", c.genes_simplified);
            setField(
                "taxonomic_resolution",
                resolution(c.case_status)
            );
            setBoolean(
                "is_mosaic",
                norm(c.case_status) !== null &&
                c.case_status.toLowerCase().indexOf("mosaic") >= 0
            );
            setBoolean("is_high_support", bool(c.curatedns));
        });

        created++;

        glue.inMode(
            "sequence/" + p.sequence.source + "/" + p.sequence.id,
            function() {
                glue.command([
                    "set", "link-target", "erv_locus",
                    path("erv_locus", p.id)
                ]);
            }
        );

        linked++;
    });

    log("Permanent loci created: " + created);
    log("Sequences linked: " + linked);
}

log("Finished curated ERV locus restoration");
