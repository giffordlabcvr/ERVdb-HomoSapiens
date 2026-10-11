
/**
 * reportUnalignedErvLocusMembers.js
 *
 * Examine nucleotide coverage of human ERV loci in
 * lineage-level alignments.
 *
 * Coverage categories (member sequence coverage):
 *
 *   NO_ALIGNMENT        0%
 *   VERY_LOW_COVERAGE   >0% and <25%
 *   LOW_COVERAGE        >=25% and <50%
 *   PARTIAL_COVERAGE    >=50% and <75%
 *   ACCEPTABLE_COVERAGE >=75%
 *
 * Reports:
 *   1. Global coverage summary
 *   2. Per-alignment coverage summary
 *   3. Detailed report of members below 50% coverage
 *   4. Separate summary of zero-coverage members
 *
 * READ-ONLY.
 *
 * Run from project mode:
 *
 *   run script glue/build/locus/reportUnalignedErvLocusMembers.js
 */

var ALIGNMENT_PREFIX = "AL_LINEAGE";
var LOCUS_SOURCE = "filtered_2026_10";
var LOCUS_ID_PREFIX = "RBRT";

var DETAIL_THRESHOLD = 50.0;
var VERY_LOW_THRESHOLD = 25.0;
var PARTIAL_THRESHOLD = 75.0;

var CATEGORIES = [
    "NO_ALIGNMENT",
    "VERY_LOW_COVERAGE",
    "LOW_COVERAGE",
    "PARTIAL_COVERAGE",
    "ACCEPTABLE_COVERAGE"
];

function log(message) {
    glue.logInfo(String(message));
}

function makeCounts() {
    var counts = {};
    CATEGORIES.forEach(function(category) {
        counts[category] = 0;
    });
    return counts;
}

function classifyCoverage(value) {

    var coverage = Number(value);

    if (coverage === 0) {
        return "NO_ALIGNMENT";
    }

    if (coverage < VERY_LOW_THRESHOLD) {
        return "VERY_LOW_COVERAGE";
    }

    if (coverage < DETAIL_THRESHOLD) {
        return "LOW_COVERAGE";
    }

    if (coverage < PARTIAL_THRESHOLD) {
        return "PARTIAL_COVERAGE";
    }

    return "ACCEPTABLE_COVERAGE";
}

function formatNumber(value) {
    return Number(value).toFixed(2);
}

function percent(part, total) {
    if (total === 0) {
        return "0.00";
    }
    return formatNumber(100.0 * part / total);
}

function isLocus(row) {

    var source = String(
        row["sequence.source.name"] || ""
    );

    var id = String(
        row["sequence.sequenceID"] || ""
    );

    return source === LOCUS_SOURCE &&
           id.indexOf(LOCUS_ID_PREFIX) === 0;
}

function getAlignments() {

    return glue.tableToObjects(
        glue.command([
            "list", "alignment",
            "--whereClause",
            "name like '" + ALIGNMENT_PREFIX + "%'",
            "name"
        ])
    );
}

function getStatistics(alignmentName) {

    var result;

    glue.inMode("alignment/" + alignmentName, function() {
        result = glue.tableToObjects(
            glue.command(["show", "statistics"])
        );
    });

    return result;
}

function printCounts(counts, total) {

    CATEGORIES.forEach(function(category) {

        log(
            "  " + category +
            ": " + counts[category] +
            " (" +
            percent(counts[category], total) +
            "%)"
        );
    });
}

function main() {

    var alignments = getAlignments();

    var totalAlignments = 0;
    var skippedAlignments = 0;
    var examinedAlignments = 0;
    var examinedLoci = 0;
    var affectedAlignments = 0;

    var globalCounts = makeCounts();
    var alignmentSummaries = [];
    var detailRows = [];
    var zeroCoverageRows = [];

    var uniqueLoci = {};

    log("============================================");
    log("ERV LINEAGE ALIGNMENT COVERAGE VALIDATION");
    log("============================================");
    log("Alignment prefix: " + ALIGNMENT_PREFIX);
    log("Locus source: " + LOCUS_SOURCE);
    log("Detailed report threshold: <" +
        DETAIL_THRESHOLD + "%");
    log("Mode: READ-ONLY");
    log("");

    alignments.forEach(function(alignment) {

        var alignmentName = alignment.name;

        totalAlignments++;

        var statistics = getStatistics(alignmentName);

        // Skip alignments with only one member.
        if (statistics.length <= 1) {
            skippedAlignments++;
            return;
        }

        examinedAlignments++;

        var counts = makeCounts();
        var locusCount = 0;

        statistics.forEach(function(row) {

            if (!isLocus(row)) {
                return;
            }

            var locusId = String(
                row["sequence.sequenceID"]
            );

            var referenceCoverage =
                Number(row.referenceNtCoveragePercent);

            var memberCoverage =
                Number(row.memberNtCoveragePercent);

            // Fail rather than silently misclassify
            // missing or malformed coverage values.
            if (isNaN(referenceCoverage) ||
                isNaN(memberCoverage) ||
                row.referenceNtCoveragePercent === null ||
                row.memberNtCoveragePercent === null ||
                row.referenceNtCoveragePercent === undefined ||
                row.memberNtCoveragePercent === undefined) {

                throw new Error(
                    "Invalid coverage statistics for " +
                    locusId + " in " + alignmentName
                );
            }

            var category =
                classifyCoverage(memberCoverage);

            locusCount++;
            examinedLoci++;

            counts[category]++;
            globalCounts[category]++;

            uniqueLoci[locusId] = true;

            if (memberCoverage < DETAIL_THRESHOLD) {

                detailRows.push({
                    alignment: alignmentName,
                    source: LOCUS_SOURCE,
                    locusId: locusId,
                    referenceCoverage: referenceCoverage,
                    memberCoverage: memberCoverage,
                    category: category
                });
            }

            if (category === "NO_ALIGNMENT") {

                zeroCoverageRows.push({
                    alignment: alignmentName,
                    source: LOCUS_SOURCE,
                    locusId: locusId
                });
            }
        });

        if (counts.NO_ALIGNMENT > 0) {
            affectedAlignments++;
        }

        alignmentSummaries.push({
            name: alignmentName,
            total: locusCount,
            counts: counts
        });
    });

    // -----------------------------------------
    // GLOBAL SUMMARY
    // -----------------------------------------

    log("");
    log("============================================");
    log("GLOBAL SUMMARY");
    log("============================================");

    log("Total lineage alignments: " + totalAlignments);
    log("Skipped (one member): " + skippedAlignments);
    log("Alignments examined: " + examinedAlignments);
    log("Human locus memberships examined: " + examinedLoci);
    log("Unique human loci examined: " +
        Object.keys(uniqueLoci).length);
    log("");

    printCounts(globalCounts, examinedLoci);

    log("");
    log("Members below " + DETAIL_THRESHOLD + "%: " +
        detailRows.length +
        " (" +
        percent(detailRows.length, examinedLoci) +
        "%)");

    log("Alignments with zero-coverage members: " +
        affectedAlignments);

    log("Zero-coverage memberships: " +
        zeroCoverageRows.length);

    // -----------------------------------------
    // PER-ALIGNMENT SUMMARY
    // -----------------------------------------

    log("");
    log("============================================");
    log("PER-ALIGNMENT COVERAGE SUMMARY");
    log("============================================");

    log(
        "alignment_name\t" +
        "locus_members\t" +
        "no_alignment\t" +
        "very_low\t" +
        "low\t" +
        "partial\t" +
        "acceptable\t" +
        "below_50_percent\t" +
        "below_50_pct"
    );

    alignmentSummaries.forEach(function(summary) {

        var counts = summary.counts;

        var below50 =
            counts.NO_ALIGNMENT +
            counts.VERY_LOW_COVERAGE +
            counts.LOW_COVERAGE;

        log(
            summary.name + "\t" +
            summary.total + "\t" +
            counts.NO_ALIGNMENT + "\t" +
            counts.VERY_LOW_COVERAGE + "\t" +
            counts.LOW_COVERAGE + "\t" +
            counts.PARTIAL_COVERAGE + "\t" +
            counts.ACCEPTABLE_COVERAGE + "\t" +
            below50 + "\t" +
            percent(below50, summary.total)
        );
    });

    // -----------------------------------------
    // DETAILED REPORT
    // -----------------------------------------

    log("");
    log("============================================");
    log("MEMBERS BELOW " + DETAIL_THRESHOLD + "% COVERAGE");
    log("============================================");

    log(
        "alignment_name\t" +
        "source_name\t" +
        "sequence_id\t" +
        "reference_coverage_percent\t" +
        "member_coverage_percent\t" +
        "category"
    );

    detailRows.sort(function(a, b) {

        if (a.alignment < b.alignment) return -1;
        if (a.alignment > b.alignment) return 1;

        if (a.memberCoverage !== b.memberCoverage) {
            return a.memberCoverage - b.memberCoverage;
        }

        if (a.locusId < b.locusId) return -1;
        if (a.locusId > b.locusId) return 1;

        return 0;
    });

    detailRows.forEach(function(row) {

        log(
            row.alignment + "\t" +
            row.source + "\t" +
            row.locusId + "\t" +
            formatNumber(row.referenceCoverage) + "\t" +
            formatNumber(row.memberCoverage) + "\t" +
            row.category
        );
    });

    // -----------------------------------------
    // ZERO-COVERAGE SUMMARY
    // -----------------------------------------

    log("");
    log("============================================");
    log("ZERO-COVERAGE MEMBERS");
    log("============================================");

    var zeroByAlignment = {};
    var zeroUniqueLoci = {};

    zeroCoverageRows.forEach(function(row) {

        if (!zeroByAlignment[row.alignment]) {
            zeroByAlignment[row.alignment] = 0;
        }

        zeroByAlignment[row.alignment]++;
        zeroUniqueLoci[row.locusId] = true;
    });

    Object.keys(zeroByAlignment).sort().forEach(
        function(alignmentName) {

            log(
                alignmentName + "\t" +
                zeroByAlignment[alignmentName]
            );
        }
    );

    log("");
    log("Total zero-coverage memberships: " +
        zeroCoverageRows.length);

    log("Unique zero-coverage loci: " +
        Object.keys(zeroUniqueLoci).length);

    log("");
    log("Validation completed. No changes made.");
}

main();
