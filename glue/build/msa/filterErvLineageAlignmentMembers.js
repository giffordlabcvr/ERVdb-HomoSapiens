/**
 * filterErvLineageAlignmentMembers.js
 *
 * Apply a member nucleotide coverage threshold to
 * human ERV lineage alignments, while protecting
 * curator-established lineage associations.
 *
 * Curator provenance:
 *   erv_locus_lineage_assoc.evidence = curator_decision
 *
 * Outputs:
 *   tabular/locus/qc/erv_lineage_alignment_coverage_audit.tsv
 *   tabular/locus/qc/erv_lineage_alignment_coverage_summary.tsv
 *
 * Rules:
 *   - Coverage >= threshold: RETAIN
 *   - Coverage < threshold, curator association:
 *       CURATOR_CONFLICT (retain)
 *   - Coverage < threshold, other association:
 *       REMOVE
 *   - Missing/ambiguous association:
 *       ASSOCIATION_CONFLICT (retain)
 *
 * DRY_RUN=true:
 *   Write audit and summary; no GLUE modifications.
 *
 * DRY_RUN=false:
 *   Remove eligible members using:
 *       remove member -m <sourceName> <sequenceID>
 *
 * This script does NOT:
 *   - Delete locus records
 *   - Delete locus-lineage associations
 *   - Change mosaic status
 *   - Modify Missillac assignments
 *
 * Intended build position:
 *   After provisional lineage alignments are generated,
 *   before classification reconciliation and Missillac
 *   assignment.
 */

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

var DRY_RUN = false;

var MIN_MEMBER_COVERAGE = 50.0;

var ALIGNMENT_PREFIX = "AL_LINEAGE_";

var LOCUS_SOURCE = "filtered_2026_10";

var LOCUS_ID_PREFIX = "RBRT";

var ASSOCIATION_TABLE = "erv_locus_lineage_assoc";

var CURATOR_EVIDENCE = "curator_decision";

var AUDIT_FILE =
    "tabular/locus/qc/" +
    "erv_lineage_alignment_coverage_audit.tsv";

var SUMMARY_FILE =
    "tabular/locus/qc/" +
    "erv_lineage_alignment_coverage_summary.tsv";

// Log only unusual records individually.
// Ordinary passing and failing records are in TSV.

var LOG_CONFLICTS = true;
var LOG_COVERAGE_ANOMALIES = true;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function log(message) {
    glue.logInfo(String(message));
}

function query(command) {
    return glue.tableToObjects(
        glue.command(command)
    );
}

function norm(value) {
    if(value === null || value === undefined) {
        return null;
    }

    var result = String(value).trim();

    if(result === "" || result === "-") {
        return null;
    }

    return result;
}

function percentage(n, total) {
    if(total === 0) {
        return "0.00";
    }

    return (100.0 * n / total).toFixed(2);
}

function readCoverage(value, description) {

    if(value === null ||
       value === undefined ||
       String(value).trim() === "") {

        throw new Error(
            "Missing coverage: " + description
        );
    }

    var number = Number(value);

    if(!isFinite(number) || number < 0) {
        throw new Error(
            "Invalid coverage: " +
            description + " = " + value
        );
    }

    // GLUE's calculated coverage can occasionally
    // exceed 100%, presumably because of overlapping
    // alignment segments.
    //
    // Preserve the original value and flag it.
    // Unique coverage is checked in a separate QC pass.

    return number;
}

function isHumanLocus(row) {

    var source = norm(
        row["sequence.source.name"]
    );

    var sequenceId = norm(
        row["sequence.sequenceID"]
    );

    return source === LOCUS_SOURCE &&
           sequenceId !== null &&
           sequenceId.indexOf(LOCUS_ID_PREFIX) === 0;
}

function alignmentNameForLineage(lineageId) {

    if(lineageId.indexOf("ERV-") !== 0) {
        return null;
    }

    return ALIGNMENT_PREFIX +
        lineageId.substring(4)
            .replace(/[^A-Za-z0-9]/g, "_");
}

function emptySummary() {
    return {
        checked: 0,
        passing: 0,
        failing: 0,
        protected: 0,
        conflicts: 0,
        anomalies: 0,
        removed: 0,
        failedRemovals: 0
    };
}

function addCount(summary, field) {
    summary[field]++;
}

// --------------------------------------------------
// TSV OUTPUT
// --------------------------------------------------

function writeTsv(path, headers, rows) {

    var Paths = Java.type("java.nio.file.Paths");
    var Files = Java.type("java.nio.file.Files");

    var StandardCharsets = Java.type(
        "java.nio.charset.StandardCharsets"
    );

    var ArrayList = Java.type(
        "java.util.ArrayList"
    );

    var outputPath = Paths.get(path);

    var parent = outputPath.getParent();

    if(parent !== null) {
        Files.createDirectories(parent);
    }

    var lines = new ArrayList();

    lines.add(headers.join("\t"));

    rows.forEach(function(row) {

        var values = headers.map(function(header) {

            var value = row[header];

            if(value === null ||
               value === undefined) {
                return "";
            }

            return String(value)
                .replace(/[\t\r\n]/g, " ");
        });

        lines.add(values.join("\t"));
    });

    Files.write(
        outputPath,
        lines,
        StandardCharsets.UTF_8
    );
}

var AUDIT_HEADERS = [
    "alignment_name",
    "source_name",
    "sequence_id",
    "lineage_id",
    "association_id",
    "association_role",
    "evidence",
    "confidence",
    "reference_coverage_pct",
    "member_coverage_pct",
    "coverage_threshold_pct",
    "coverage_anomaly",
    "planned_action",
    "execution_status",
    "error_message"
];

var SUMMARY_HEADERS = [
    "alignment_name",
    "checked",
    "passing",
    "failing",
    "protected",
    "conflicts",
    "anomalies",
    "removed",
    "failed_removals"
];

// --------------------------------------------------
// ASSOCIATION LOOKUP
// --------------------------------------------------

function loadAssociations() {

    log("Loading locus-lineage associations...");

    var rows = query([
        "list",
        "custom-table-row",
        ASSOCIATION_TABLE,
        "id",
        "erv_locus.id",
        "erv_lineage.id",
        "association_role",
        "evidence",
        "confidence"
    ]);

    var byLocus = {};

    rows.forEach(function(row) {

        var locusId = norm(
            row["erv_locus.id"]
        );

        var lineageId = norm(
            row["erv_lineage.id"]
        );

        if(locusId === null ||
           lineageId === null) {
            return;
        }

        if(!byLocus[locusId]) {
            byLocus[locusId] = [];
        }

        byLocus[locusId].push({
            id: norm(row.id),
            lineageId: lineageId,
            alignmentName:
                alignmentNameForLineage(lineageId),
            role: norm(row.association_role),
            evidence: norm(row.evidence),
            confidence: norm(row.confidence)
        });
    });

    log("Loaded " + rows.length +
        " locus-lineage association records");

    return byLocus;
}

function matchingAssociations(
    associationsByLocus,
    locusId,
    alignmentName
) {

    var associations =
        associationsByLocus[locusId] || [];

    return associations.filter(function(a) {
        return a.alignmentName === alignmentName;
    });
}

// --------------------------------------------------
// ALIGNMENT COMMANDS
// --------------------------------------------------

function listAlignments() {

    return query([
        "list",
        "alignment",
        "--whereClause",
        "name like '" + ALIGNMENT_PREFIX + "%'",
        "name"
    ]);
}

function showStatistics(alignmentName) {

    var result;

    glue.inMode(
        "alignment/" + alignmentName,
        function() {
            result = query([
                "show", "statistics"
            ]);
        }
    );

    return result;
}

function removeAlignmentMember(
    alignmentName,
    sourceName,
    sequenceId
) {

    glue.inMode(
        "alignment/" + alignmentName,
        function() {
            glue.command([
                "remove",
                "member",
                "-m",
                sourceName,
                sequenceId
            ]);
        }
    );
}

// --------------------------------------------------
// CLASSIFICATION OF A MEMBER
// --------------------------------------------------

function evaluateMember(
    row,
    alignmentName,
    associationsByLocus
) {

    var sequenceId = String(
        row["sequence.sequenceID"]
    );

    var memberCoverage = readCoverage(
        row.memberNtCoveragePercent,
        alignmentName + "/" +
        sequenceId + " member coverage"
    );

    var referenceCoverage = readCoverage(
        row.referenceNtCoveragePercent,
        alignmentName + "/" +
        sequenceId + " reference coverage"
    );

    var matches = matchingAssociations(
        associationsByLocus,
        sequenceId,
        alignmentName
    );

    var association =
        matches.length === 1 ? matches[0] : null;

    var coverageAnomaly =
        memberCoverage > 100 ||
        referenceCoverage > 100;

    var plannedAction;

    if(matches.length !== 1) {

        // Do not assume an alignment membership is
        // supported by a particular association.
        // These cases require separate investigation.
        // CURATOR_CONFLICT means remove and record the overturned curator assignment.

        plannedAction = "ASSOCIATION_CONFLICT";

    } else if(memberCoverage >= MIN_MEMBER_COVERAGE) {

        plannedAction = "RETAIN";

    } else if(
        association.evidence === CURATOR_EVIDENCE
    ) {

        plannedAction = "CURATOR_CONFLICT";

    } else {

        plannedAction = "REMOVE";
    }

    return {
        alignment_name: alignmentName,
        source_name: LOCUS_SOURCE,
        sequence_id: sequenceId,

        lineage_id:
            association ? association.lineageId : "",

        association_id:
            association ? association.id : "",

        association_role:
            association ? association.role : "",

        evidence:
            association ? association.evidence : "",

        confidence:
            association ? association.confidence : "",

        reference_coverage_pct:
            referenceCoverage.toFixed(4),

        member_coverage_pct:
            memberCoverage.toFixed(4),

        coverage_threshold_pct:
            MIN_MEMBER_COVERAGE,

        coverage_anomaly:
            coverageAnomaly ? "TRUE" : "FALSE",

        planned_action: plannedAction,

        execution_status: "NOT_ATTEMPTED",

        error_message: ""
    };
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------

function main() {

    if(!isFinite(MIN_MEMBER_COVERAGE) ||
       MIN_MEMBER_COVERAGE <= 0 ||
       MIN_MEMBER_COVERAGE > 100) {

        throw new Error(
            "Invalid MIN_MEMBER_COVERAGE"
        );
    }

    if(DRY_RUN !== true && DRY_RUN !== false) {
        throw new Error(
            "DRY_RUN must be boolean true or false"
        );
    }

    log("============================================");
    log("ERV LINEAGE ALIGNMENT COVERAGE FILTER");
    log("============================================");

    log("Minimum member coverage: " +
        MIN_MEMBER_COVERAGE + "%");

    log("Locus source: " + LOCUS_SOURCE);

    log("Mode: " +
        (DRY_RUN ? "DRY RUN" : "APPLY FILTER"));

    log("Curator evidence: " + CURATOR_EVIDENCE);

    log("");

    // ----------------------------------------------
    // PASS 1: READ ASSOCIATIONS AND ALIGNMENTS
    // ----------------------------------------------

    var associationsByLocus =
        loadAssociations();

    var alignments = listAlignments();

    var auditRows = [];
    var summaries = {};
    var alignmentOrder = [];

    var skippedAlignments = 0;
    var examinedAlignments = 0;

    alignments.forEach(function(alignment) {

        var alignmentName = alignment.name;

        var statistics =
            showStatistics(alignmentName);

        // Preserve the existing behaviour:
        // skip reference-only singleton alignments.

        if(statistics.length <= 1) {
            skippedAlignments++;
            return;
        }

        examinedAlignments++;

        var summary = emptySummary();

        summaries[alignmentName] = summary;
        alignmentOrder.push(alignmentName);

        statistics.forEach(function(row) {

            if(!isHumanLocus(row)) {
                return;
            }

            var result = evaluateMember(
                row,
                alignmentName,
                associationsByLocus
            );

            auditRows.push(result);

            addCount(summary, "checked");

            if(
                Number(result.member_coverage_pct) <
                MIN_MEMBER_COVERAGE
            ) {
                addCount(summary, "failing");
            } else {
                addCount(summary, "passing");
            }

            if(
                result.planned_action ===
                "CURATOR_CONFLICT"
            ) {
                addCount(summary, "protected");

                if(LOG_CONFLICTS) {
                    log(
                        "CURATOR CONFLICT: " +
                        result.sequence_id +
                        " / " +
                        result.lineage_id +
                        " coverage=" +
                        result.member_coverage_pct +
                        "%"
                    );
                }
            }

            if(
                result.planned_action ===
                "ASSOCIATION_CONFLICT"
            ) {
                addCount(summary, "conflicts");

                if(LOG_CONFLICTS) {
                    log(
                        "ASSOCIATION CONFLICT: " +
                        result.sequence_id +
                        " / " +
                        alignmentName
                    );
                }
            }

            if(
                result.coverage_anomaly === "TRUE"
            ) {
                addCount(summary, "anomalies");

                if(LOG_COVERAGE_ANOMALIES) {
                    log(
                        "COVERAGE ANOMALY: " +
                        result.sequence_id +
                        " / " +
                        alignmentName +
                        " member=" +
                        result.member_coverage_pct +
                        "% reference=" +
                        result.reference_coverage_pct +
                        "%"
                    );
                }
            }
        });
    });

    // ----------------------------------------------
    // PASS 2: SAVE THE PRE-FILTER AUDIT
    // ----------------------------------------------

    // Write before making any changes. This ensures
    // the planned decisions are recorded even if
    // execution subsequently fails.

    writeTsv(
        AUDIT_FILE,
        AUDIT_HEADERS,
        auditRows
    );

    log("");
    log("Pre-filter audit written: " + AUDIT_FILE);

    // ----------------------------------------------
    // PASS 3: APPLY FILTER
    // ----------------------------------------------
	
	var removalCandidates = auditRows.filter(
		function(row) {
			return row.planned_action === "REMOVE" ||
				   row.planned_action === "CURATOR_CONFLICT";
		}
	);


    var removed = 0;
    var failedRemovals = 0;
    var executionError = null;

    if(!DRY_RUN) {

        log("");
        log("Removing low-coverage members...");

        for(
            var i = 0;
            i < removalCandidates.length;
            i++
        ) {

            var candidate = removalCandidates[i];

            try {

                removeAlignmentMember(
                    candidate.alignment_name,
                    candidate.source_name,
                    candidate.sequence_id
                );

                candidate.execution_status = "REMOVED";

                removed++;

                summaries[
                    candidate.alignment_name
                ].removed++;

            } catch(error) {

                candidate.execution_status = "FAILED";

                candidate.error_message =
                    String(error);

                failedRemovals++;

                summaries[
                    candidate.alignment_name
                ].failedRemovals++;

                executionError = error;

                log(
                    "REMOVAL FAILED: " +
                    candidate.alignment_name +
                    " / " +
                    candidate.sequence_id +
                    " : " + error
                );

                // Stop rather than continue after an
                // unexpected modification error.
                break;
            }
        }
    }

    // ----------------------------------------------
    // PASS 4: SAVE FINAL AUDIT AND SUMMARY
    // ----------------------------------------------

    // Also runs on partial execution failure.
    // Unattempted removals remain NOT_ATTEMPTED.

    writeTsv(
        AUDIT_FILE,
        AUDIT_HEADERS,
        auditRows
    );

    var summaryRows = [];

    alignmentOrder.forEach(function(name) {

        var s = summaries[name];

        summaryRows.push({
            alignment_name: name,
            checked: s.checked,
            passing: s.passing,
            failing: s.failing,
            protected: s.protected,
            conflicts: s.conflicts,
            anomalies: s.anomalies,
            removed: s.removed,
            failed_removals: s.failedRemovals
        });
    });

    writeTsv(
        SUMMARY_FILE,
        SUMMARY_HEADERS,
        summaryRows
    );

    // ----------------------------------------------
    // PASS 5: GLOBAL SUMMARY
    // ----------------------------------------------

    var total = auditRows.length;

    var belowThreshold = auditRows.filter(
        function(row) {
            return Number(
                row.member_coverage_pct
            ) < MIN_MEMBER_COVERAGE;
        }
    ).length;

    var curatorConflicts = auditRows.filter(
        function(row) {
            return row.planned_action ===
                "CURATOR_CONFLICT";
        }
    ).length;

    var associationConflicts = auditRows.filter(
        function(row) {
            return row.planned_action ===
                "ASSOCIATION_CONFLICT";
        }
    ).length;

    var anomalies = auditRows.filter(
        function(row) {
            return row.coverage_anomaly === "TRUE";
        }
    ).length;

    var zeroCoverage = auditRows.filter(
        function(row) {
            return Number(
                row.member_coverage_pct
            ) === 0;
        }
    ).length;

    var uniqueAffected = {};

    auditRows.forEach(function(row) {

        if(
            row.planned_action === "REMOVE" ||
            row.planned_action === "CURATOR_CONFLICT"
        ) {
            uniqueAffected[row.sequence_id] = true;
        }
    });

    log("");
    log("============================================");
    log("COVERAGE FILTER SUMMARY");
    log("============================================");

    log("Lineage alignments: " +
        alignments.length);

    log("Skipped singleton alignments: " +
        skippedAlignments);

    log("Alignments examined: " +
        examinedAlignments);

    log("Human memberships examined: " + total);

    log("Below " + MIN_MEMBER_COVERAGE +
        "% coverage: " + belowThreshold);

    log("Below-threshold percentage: " +
        percentage(belowThreshold, total) + "%");

    log("Zero-coverage members: " +
        zeroCoverage);

    log("Removal candidates: " +
        removalCandidates.length);
	
	log("Curator-assigned failures: " +
		curatorConflicts);
    
    log("Association conflicts: " +
        associationConflicts);

    log("Coverage anomalies (>100%): " +
        anomalies);

    log("Unique affected loci: " +
        Object.keys(uniqueAffected).length);

    log("Successfully removed: " + removed);

    log("Failed removals: " + failedRemovals);

    log("");
    log("Audit: " + AUDIT_FILE);
    log("Summary: " + SUMMARY_FILE);

    if(executionError !== null) {

        throw new Error(
            "Coverage filtering stopped after " +
            removed + " removals. " +
            "Audit saved. Original error: " +
            executionError
        );
    }

    if(DRY_RUN) {

        log("DRY RUN complete. No GLUE changes made.");

    } else {

        log(
            "Coverage filtering complete. " +
            "Association reconciliation is still required."
        );
    }
}

main();
