
/**
 * reconcileLegacyLoci.js
 *
 * Historical annotation -> permanent ERVdb locus reconciliation.
 * Read-only with respect to GLUE. Nashorn-compatible.
 *
 * Run:
 * project ervdb run script glue/build/legacy/reconcileLegacyLoci.js
 */

var INPUT = "tabular/legacy/legacy_loci_normalised.tsv";
var OUTPUT = "tabular/legacy/legacy_loci_reconciled.tsv";
var LOCUS_TABLE = "erv_locus";

// Permissive acceptance based on containment, but
// candidate ranking based on reciprocal overlap.
var MIN_COVERAGE = 0.50;
var STRONG_COVERAGE = 0.90;
var MIN_RECIPROCAL_GAP = 0.20;
var MIN_OVERLAP_RATIO = 1.50;

var OUTPUT_COLUMNS = [
    "source_record_id", "legacy_source", "source_row_number",
    "legacy_name", "host_species", "genome_build", "scaffold",
    "start_position", "end_position", "orientation",
    "legacy_classification", "source_numeric_id",
    "source_aliases", "source_orthology", "source_band",
    "source_note", "approved_name", "approved_symbol",
    "hgnc_id", "pubmed_id", "aliases",
    "mapping_status", "mapping_method", "match_basis",
    "matched_locus", "match_count", "overlap_bp",
    "source_overlap_fraction", "locus_overlap_fraction",
    "reciprocal_overlap", "best_coverage_fraction",
    "orientation_matches", "runner_up_locus",
    "runner_up_reciprocal_overlap",
    "runner_up_coverage_fraction", "candidate_loci",
    "curator_decision", "curator_locus", "curator_note"
];

function str(v) {
    return v === null || v === undefined
        ? "" : String(v).trim();
}

function quote(v) {
    return str(v).replace(/\\/g, "\\\\")
                 .replace(/'/g, "\\'");
}

function integer(v) {
    var n = Number(str(v));
    return isFinite(n) && Math.floor(n) === n ? n : NaN;
}

function fraction(v) {
    return v === null || v === undefined
        ? "" : v.toFixed(6);
}

function strand(v) {
    var s = str(v).toLowerCase();
    if(s === "+" || s === "positive" || s === "forward")
        return "+";
    if(s === "-" || s === "negative" || s === "reverse")
        return "-";
    return "";
}

function overlap(a, b, c, d) {
    return Math.max(
        0,
        Math.min(b, d) - Math.max(a, c) + 1
    );
}

function tabularRows(path) {
    var result;
    glue.inMode("module/tabularUtility", function() {
        result = glue.tableToObjects(
            glue.command(["load-tabular", path])
        );
    });
    return result;
}

// ------------------------------------------------------------
// Score individual candidate loci
// ------------------------------------------------------------

function scoreCandidate(source, candidate) {
    var a = integer(source.start_position);
    var b = integer(source.end_position);
    var c = integer(candidate.start_position);
    var d = integer(candidate.end_position);

    if(!(c > 0 && d >= c)) return null;

    var bp = overlap(a, b, c, d);
    if(bp === 0) return null;

    var sf = bp / (b - a + 1);
    var lf = bp / (d - c + 1);

    var sourceStrand = strand(source.orientation);
    var locusStrand = strand(candidate.orientation);

    return {
        id: str(candidate.id),
        overlap: bp,
        sourceFraction: sf,
        locusFraction: lf,
        reciprocal: Math.min(sf, lf),
        coverage: Math.max(sf, lf),
        orientationMatch:
            sourceStrand && locusStrand
                ? sourceStrand === locusStrand
                : null,
        boundaryDifference:
            Math.abs(a - c) + Math.abs(b - d)
    };
}

// ------------------------------------------------------------
// Rank candidates by reciprocal overlap
// ------------------------------------------------------------

function compareMatches(a, b) {
    if(a.reciprocal !== b.reciprocal)
        return b.reciprocal - a.reciprocal;

    if(a.overlap !== b.overlap)
        return b.overlap - a.overlap;

    if(a.boundaryDifference !== b.boundaryDifference)
        return a.boundaryDifference - b.boundaryDifference;

    return a.id < b.id ? -1 :
           a.id > b.id ? 1 : 0;
}

// ------------------------------------------------------------
// Classify the best candidate
// ------------------------------------------------------------

function classifyMatch(best, second) {
    if(!best) return "unmatched";

    if(best.coverage < MIN_COVERAGE)
        return "low_coverage";

    if(!second)
        return best.coverage >= STRONG_COVERAGE
            ? "mapped" : "mapped_partial";

    var reciprocalGap =
        best.reciprocal - second.reciprocal;

    var overlapRatio =
        best.overlap / second.overlap;

    // A substantial reciprocal advantage OR a substantially
    // larger absolute overlap is sufficient.
    //
    // The best candidate has already been ranked by
    // reciprocal overlap.
    var dominant =
        reciprocalGap >= MIN_RECIPROCAL_GAP ||
        (
            best.reciprocal > second.reciprocal &&
            overlapRatio >= MIN_OVERLAP_RATIO
        );

    if(!dominant) return "ambiguous";

    return best.coverage >= STRONG_COVERAGE
        ? "mapped_best_match" : "mapped_partial";
}

// ------------------------------------------------------------
// Reconcile one source record
// ------------------------------------------------------------

function reconcile(row) {
    var start = integer(row.start_position);
    var end = integer(row.end_position);

    if(!(start > 0 && end >= start))
        throw Error(
            "Invalid source coordinates: " +
            row.source_record_id
        );

    var where = [
        "scaffold = '" + quote(row.scaffold) + "'",
        "end_position >= " + start,
        "start_position <= " + end,
        "host_species = '" + quote(row.host_species) + "'",
        "genome_build = '" + quote(row.genome_build) + "'"
    ].join(" and ");

    var candidates = glue.tableToObjects(
        glue.command([
            "list", "custom-table-row", LOCUS_TABLE,
            "-w", where,
            "id", "start_position", "end_position",
            "orientation"
        ])
    );

    var scored = [];

    for(var i = 0; i < candidates.length; i++) {
        var hit = scoreCandidate(row, candidates[i]);
        if(hit) scored.push(hit);
    }

    scored.sort(compareMatches);

    var best = scored.length ? scored[0] : null;
    var second = scored.length > 1 ? scored[1] : null;
    var status = classifyMatch(best, second);

    var basis = "";

    if(best) {
        if(best.reciprocal >= STRONG_COVERAGE)
            basis = "reciprocal_overlap";
        else if(best.sourceFraction >= STRONG_COVERAGE)
            basis = "source_contained";
        else if(best.locusFraction >= STRONG_COVERAGE)
            basis = "locus_contained";
        else
            basis = "partial_overlap";
    }

    return {
        mapping_status: status,
        mapping_method: "coordinate_overlap",
        match_basis: basis,
        matched_locus: best ? best.id : "",
        match_count: scored.length,
        overlap_bp: best ? best.overlap : "",
        source_overlap_fraction:
            best ? fraction(best.sourceFraction) : "",
        locus_overlap_fraction:
            best ? fraction(best.locusFraction) : "",
        reciprocal_overlap:
            best ? fraction(best.reciprocal) : "",
        best_coverage_fraction:
            best ? fraction(best.coverage) : "",
        orientation_matches:
            best && best.orientationMatch !== null
                ? String(best.orientationMatch) : "",
        runner_up_locus: second ? second.id : "",
        runner_up_reciprocal_overlap:
            second ? fraction(second.reciprocal) : "",
        runner_up_coverage_fraction:
            second ? fraction(second.coverage) : "",
        candidate_loci: scored.map(function(c) {
            return c.id + ":" +
                fraction(c.coverage) + ":" +
                fraction(c.reciprocal);
        }).join("|"),
        curator_decision: "",
        curator_locus: "",
        curator_note: ""
    };
}

// ------------------------------------------------------------
// Write reconciliation TSV
// ------------------------------------------------------------

function tsvCell(v) {
    var value = str(v);

    if(/[\t\r\n]/.test(value))
        throw Error(
            "Embedded tab or newline: " +
            value.substring(0, 50)
        );

    return value;
}

function writeTsv(path, rows) {
    var File = Java.type("java.io.File");
    var BufferedWriter = Java.type("java.io.BufferedWriter");
    var FileWriter = Java.type("java.io.FileWriter");

    var file = new File(path);
    var parent = file.getParentFile();

    if(parent !== null && !parent.exists())
        throw Error("Output directory missing: " + parent);

    var writer = new BufferedWriter(new FileWriter(file));

    try {
        writer.write(OUTPUT_COLUMNS.join("\t"));
        writer.newLine();

        for(var i = 0; i < rows.length; i++) {
            var row = rows[i];
            writer.write(
                OUTPUT_COLUMNS.map(function(key) {
                    return tsvCell(row[key]);
                }).join("\t")
            );
            writer.newLine();
        }
    } finally {
        writer.close();
    }

    glue.logInfo(
        "Reconciliation TSV: " + file.getAbsolutePath()
    );
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

var inputRows = tabularRows(INPUT);
var output = [];
var summary = {};

for(var i = 0; i < inputRows.length; i++) {
    var source = inputRows[i];

    if(!str(source.source_record_id) ||
       !str(source.legacy_source))
        throw Error(
            "Missing source identifier in input row " + (i + 2)
        );

    var result = reconcile(source);
    var combined = {};

    Object.keys(source).forEach(function(key) {
        combined[key] = source[key];
    });

    Object.keys(result).forEach(function(key) {
        combined[key] = result[key];
    });

    output.push(combined);

    summary[result.mapping_status] =
        (summary[result.mapping_status] || 0) + 1;

    if((i + 1) % 500 === 0)
        glue.logInfo(
            "Reconciled " + (i + 1) +
            " / " + inputRows.length
        );
}

writeTsv(OUTPUT, output);

glue.logInfo(
    "Legacy reconciliation summary: " +
    JSON.stringify(summary)
);

glue.logInfo(
    "Total input/output records: " +
    inputRows.length + " / " + output.length
);
