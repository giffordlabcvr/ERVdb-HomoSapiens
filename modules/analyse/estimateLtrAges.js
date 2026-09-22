/**
 * estimateLtrAges.js
 *
 * Estimate LTR locus ages from nucleotide divergence from an
 * alignment-derived consensus.
 *
 * GLUE provides:
 *
 *   1. A nucleotide consensus in the coordinate space of the LTR reference.
 *   2. Alignment members projected into the same reference coordinate space.
 *
 * Conservative dating columns are selected using COLUMN OCCUPANCY only.
 *
 * A column is included when at least minColumnOccupancyPct of the qualifying
 * alignment members contain a canonical nucleotide (A/C/G/T) at that
 * reference-coordinate position.
 *
 * Consensus support is deliberately NOT used to select dating columns,
 * because filtering according to agreement with the consensus preferentially
 * selects conserved sites and can systematically reduce estimated divergence.
 *
 * Input loci:
 *   reference nucleotide coverage >= MIN_REF_NT_COVERAGE_PCT
 *
 * Dating:
 *   locus must contain callable nucleotides at >= MIN_DATING_COVERAGE_PCT
 *   of dating-mask sites.
 *
 * Both raw and occupancy-masked divergence are reported.
 */


// ============================================================================
// Configuration
// ============================================================================

var CONSENSUS_GENERATOR_MODULE =
    "nucleotideConsensusGenerator";

var FASTA_ALIGNMENT_EXPORTER_MODULE =
    "fastaAlignmentExporter";

var FEATURE_NAME =
    "whole_genome";


/*
 * Minimum reference coverage required for a locus to enter the analysis.
 */

var MIN_REF_NT_COVERAGE_PCT =
    70.0;


/*
 * Minimum proportion of dating-mask sites represented by canonical
 * nucleotides in an individual locus before an age estimate is assigned.
 */

var MIN_DATING_COVERAGE_PCT =
    70.0;


/*
 * Provisional neutral substitution rates.
 *
 * LOW rate  -> older age bound
 * HIGH rate -> younger age bound
 */

var SUBSTITUTION_RATE_CENTRAL =
    2.2e-9;

var SUBSTITUTION_RATE_LOW =
    1.8e-9;

var SUBSTITUTION_RATE_HIGH =
    2.6e-9;


// ============================================================================
// Public functions
// ============================================================================

function estimateConsensusAges(
    alignmentName,
    referenceName,
    minColumnOccupancyPct
) {

    var analysis =
        analyseAlignment(
            alignmentName,
            referenceName,
            minColumnOccupancyPct
        );

    return analysis.rows;
}


function summariseConsensusAges(
    alignmentName,
    referenceName,
    minColumnOccupancyPct
) {

    var analysis =
        analyseAlignment(
            alignmentName,
            referenceName,
            minColumnOccupancyPct
        );


    var ages =
        [];

    var rawDistances =
        [];

    var datingDistances =
        [];


    _.each(
        analysis.rows,
        function(row) {

            if(row.raw_p_distance !== null) {
                rawDistances.push(
                    row.raw_p_distance
                );
            }

            if(row.dating_p_distance !== null) {
                datingDistances.push(
                    row.dating_p_distance
                );
            }

            if(row.age_mya !== null) {
                ages.push(
                    row.age_mya
                );
            }
        }
    );


    sortNumeric(ages);
    sortNumeric(rawDistances);
    sortNumeric(datingDistances);


    return [{

        alignment_name:
            alignmentName,

        reference_name:
            referenceName,

        min_column_occupancy_pct:
            analysis.minColumnOccupancyPct,

        alignment_taxa:
            analysis.alignmentTaxa,

        consensus_length:
            analysis.consensusLength,

        callable_consensus_sites:
            analysis.callableConsensusSites,

        dating_mask_sites:
            analysis.datingMaskSites,

        dating_mask_pct:
            percentage(
                analysis.datingMaskSites,
                analysis.callableConsensusSites
            ),

        dated_taxa:
            ages.length,

        median_raw_p_distance:
            median(rawDistances),

        median_dating_p_distance:
            median(datingDistances),

        min_age_mya:
            percentile(ages, 0.00),

        q1_age_mya:
            percentile(ages, 0.25),

        median_age_mya:
            percentile(ages, 0.50),

        q3_age_mya:
            percentile(ages, 0.75),

        max_age_mya:
            percentile(ages, 1.00)
    }];
}

function storeConsensusAges(
    alignmentName,
    referenceName,
    ltrLineageId,
    minColumnOccupancyPct
) {

    ltrLineageId =
        normaliseRequired(
            ltrLineageId,
            "ltrLineageId"
        );


    var analysis =
        analyseAlignment(
            alignmentName,
            referenceName,
            minColumnOccupancyPct
        );


    /*
     * Calculate lineage-level divergence statistics once.
     *
     * QC is based on the observed dating divergence rather than the
     * clock-derived age.
     */

    var divergences =
        [];


    _.each(
        analysis.rows,
        function(row) {

            if(
                row.age_mya !== null &&
                row.dating_p_distance !== null
            ) {
                divergences.push(
                    row.dating_p_distance
                );
            }
        }
    );


    sortNumeric(
        divergences
    );


    var lineageMedianDivergence =
        median(
            divergences
        );


    var lineageMadDivergence =
        medianAbsoluteDeviation(
            divergences,
            lineageMedianDivergence
        );


    var storedCount =
        0;

    var skippedCount =
        0;

    var highOutlierCount =
        0;

    var lowOutlierCount =
        0;


    _.each(
        analysis.rows,
        function(row) {

            /*
             * A null age means the locus failed the dating-coverage
             * requirement. Keep it in the analytical output, but do not
             * create an age calibration.
             */

            if(row.age_mya === null) {

                skippedCount++;
                return;
            }


            var robustZ =
                robustZScore(
                    row.dating_p_distance,
                    lineageMedianDivergence,
                    lineageMadDivergence
                );


            var outlierStatus =
                outlierStatusFromRobustZ(
                    robustZ
                );


            if(outlierStatus === "high_outlier") {
                highOutlierCount++;
            }

            if(outlierStatus === "low_outlier") {
                lowOutlierCount++;
            }


            /*
             * Resolve the sequence -> erv_locus relationship.
             */

            var locusId =
                resolveErvLocusId(
                    row.source_name,
                    row.sequence_id
                );


            if(locusId === null) {

                glue.logInfo(
                    "Skipping consensus-clock calibration for " +
                    row.source_name +
                    "/" +
                    row.sequence_id +
                    ": sequence is not linked to an erv_locus"
                );

                skippedCount++;
                return;
            }


            /*
             * Stable calibration ID.
             *
             * The ID identifies the locus + method. Re-running the method
             * therefore updates the existing calibration rather than
             * creating a second record merely because a threshold changed.
             */

            var calibrationId =
                consensusCalibrationId(
                    locusId
                );


            storeConsensusCalibration(
                calibrationId,
                locusId,
                ltrLineageId,
                alignmentName,
                referenceName,
                row,
                lineageMedianDivergence,
                lineageMadDivergence,
                robustZ,
                outlierStatus
            );


            storedCount++;
        }
    );


    return [{

        alignment_name:
            alignmentName,

        reference_name:
            referenceName,

        ltr_lineage_id:
            ltrLineageId,

        min_column_occupancy_pct:
            analysis.minColumnOccupancyPct,

        dating_mask_sites:
            analysis.datingMaskSites,

        candidate_loci:
            analysis.rows.length,

        stored_calibrations:
            storedCount,

        skipped_loci:
            skippedCount,

        lineage_median_divergence:
            lineageMedianDivergence,

        lineage_mad_divergence:
            lineageMadDivergence,

        high_outliers:
            highOutlierCount,

        low_outliers:
            lowOutlierCount
    }];
}

// ============================================================================
// Core analysis
// ============================================================================

function analyseAlignment(
    alignmentName,
    referenceName,
    minColumnOccupancyPct
) {

    alignmentName =
        normaliseRequired(
            alignmentName,
            "alignmentName"
        );

    referenceName =
        normaliseRequired(
            referenceName,
            "referenceName"
        );

    minColumnOccupancyPct =
        normalisePercentage(
            minColumnOccupancyPct,
            "minColumnOccupancyPct"
        );


    var whereClause =
        buildMemberWhereClause();


    // ------------------------------------------------------------------------
    // Generate consensus
    // ------------------------------------------------------------------------

    var consensusResult;


    glue.inMode(
        "module/" + CONSENSUS_GENERATOR_MODULE,
        function() {

            consensusResult =
                glue.command([
                    "generate",
                    "fasta",
                    "nt-consensus",
                    alignmentName,
                    "-r",
                    referenceName,
                    "-f",
                    FEATURE_NAME,
                    "-w",
                    whereClause,
                    "-p"
                ]);
        }
    );


    var consensusRecords =
        nucleotideFastaRecords(
            consensusResult
        );


    if(consensusRecords.length !== 1) {

        throw (
            "Expected exactly one consensus sequence for " +
            alignmentName +
            " but found " +
            consensusRecords.length
        );
    }


    var consensusSequence =
        normaliseSequence(
            consensusRecords[0].sequence
        );


    if(consensusSequence.length === 0) {

        throw (
            "Consensus sequence is empty for " +
            alignmentName
        );
    }


    // ------------------------------------------------------------------------
    // Export qualifying alignment members in the SAME reference-coordinate
    // space.
    //
    // --includeInsertions is deliberately NOT used.
    // ------------------------------------------------------------------------

    var alignmentResult;


    glue.inMode(
        "module/" + FASTA_ALIGNMENT_EXPORTER_MODULE,
        function() {

            alignmentResult =
                glue.command([
                    "export",
                    alignmentName,
                    "-r",
                    referenceName,
                    "-f",
                    FEATURE_NAME,
                    "-w",
                    whereClause,
                    "-p"
                ]);
        }
    );


    var memberRecords =
        nucleotideFastaRecords(
            alignmentResult
        );


    if(memberRecords.length === 0) {

        throw (
            "No qualifying alignment members exported from " +
            alignmentName
        );
    }


    // ------------------------------------------------------------------------
    // Normalise sequences and verify coordinate compatibility
    // ------------------------------------------------------------------------

    var members =
        [];


    _.each(
        memberRecords,
        function(memberRecord) {

            var sequence =
                normaliseSequence(
                    memberRecord.sequence
                );


            if(
                sequence.length !==
                consensusSequence.length
            ) {

                throw (
                    "Coordinate-space length mismatch for " +
                    memberRecord.id +
                    ": consensus length = " +
                    consensusSequence.length +
                    ", member length = " +
                    sequence.length
                );
            }


            members.push({
                id: memberRecord.id,
                sequence: sequence
            });
        }
    );


    // ------------------------------------------------------------------------
    // Calculate occupancy and construct dating mask
    // ------------------------------------------------------------------------

    var columnOccupancies =
        calculateColumnOccupancies(
            members,
            consensusSequence.length
        );


    var datingMask =
        buildDatingMask(
            consensusSequence,
            columnOccupancies,
            minColumnOccupancyPct
        );


    var callableConsensusSites =
        countCanonicalNucleotides(
            consensusSequence
        );


    var datingMaskSites =
        countTrue(
            datingMask
        );


    if(datingMaskSites === 0) {

        throw (
            "Dating mask contains zero usable columns for " +
            alignmentName +
            " using occupancy >= " +
            minColumnOccupancyPct +
            "%"
        );
    }


    // ------------------------------------------------------------------------
    // Compare each locus with the consensus
    // ------------------------------------------------------------------------

    var rows =
        [];


    _.each(
        members,
        function(member) {

            var rawComparison =
                compareSequences(
                    consensusSequence,
                    member.sequence,
                    null
                );


            var datingComparison =
                compareSequences(
                    consensusSequence,
                    member.sequence,
                    datingMask
                );


            var rawCoveragePct =
                percentage(
                    rawComparison.sitesCompared,
                    callableConsensusSites
                );


            var datingCoveragePct =
                percentage(
                    datingComparison.sitesCompared,
                    datingMaskSites
                );


            var rawPDistance =
                distanceFromComparison(
                    rawComparison
                );


            var datingPDistance =
                distanceFromComparison(
                    datingComparison
                );


            var ageMya =
                null;

            var ageYoungerBoundMya =
                null;

            var ageOlderBoundMya =
                null;


            if(
                datingPDistance !== null &&
                datingCoveragePct >=
                    MIN_DATING_COVERAGE_PCT
            ) {

                ageMya =
                    ageFromDistance(
                        datingPDistance,
                        SUBSTITUTION_RATE_CENTRAL
                    );


                ageYoungerBoundMya =
                    ageFromDistance(
                        datingPDistance,
                        SUBSTITUTION_RATE_HIGH
                    );


                ageOlderBoundMya =
                    ageFromDistance(
                        datingPDistance,
                        SUBSTITUTION_RATE_LOW
                    );
            }


            var identity =
                parseAlignmentMemberId(
                    member.id,
                    alignmentName
                );


            rows.push({

                alignment_name:
                    alignmentName,

                reference_name:
                    referenceName,

                source_name:
                    identity.sourceName,

                sequence_id:
                    identity.sequenceID,


                // Analysis parameters

                min_column_occupancy_pct:
                    minColumnOccupancyPct,


                // Alignment / mask

                consensus_length:
                    consensusSequence.length,

                alignment_taxa:
                    members.length,

                callable_consensus_sites:
                    callableConsensusSites,

                dating_mask_sites:
                    datingMaskSites,


                // Raw comparison

                raw_sites_compared:
                    rawComparison.sitesCompared,

                raw_sites_different:
                    rawComparison.sitesDifferent,

                raw_comparison_coverage_pct:
                    rawCoveragePct,

                raw_p_distance:
                    rawPDistance,


                // Occupancy-masked comparison

                dating_sites_compared:
                    datingComparison.sitesCompared,

                dating_sites_different:
                    datingComparison.sitesDifferent,

                dating_coverage_pct:
                    datingCoveragePct,

                dating_p_distance:
                    datingPDistance,


                // Clock

                substitution_rate:
                    SUBSTITUTION_RATE_CENTRAL,

                substitution_rate_low:
                    SUBSTITUTION_RATE_LOW,

                substitution_rate_high:
                    SUBSTITUTION_RATE_HIGH,


                // Age

                age_mya:
                    ageMya,

                age_younger_bound_mya:
                    ageYoungerBoundMya,

                age_older_bound_mya:
                    ageOlderBoundMya
            });
        }
    );


    return {

        alignmentName:
            alignmentName,

        referenceName:
            referenceName,

        minColumnOccupancyPct:
            minColumnOccupancyPct,

        alignmentTaxa:
            members.length,

        consensusLength:
            consensusSequence.length,

        callableConsensusSites:
            callableConsensusSites,

        datingMaskSites:
            datingMaskSites,

        rows:
            rows
    };
}


// ============================================================================
// Column occupancy
// ============================================================================

function calculateColumnOccupancies(
    members,
    sequenceLength
) {

    var occupancies =
        [];


    /*
     * Occupancy asks only whether a canonical nucleotide is represented
     * at a reference-coordinate position.
     *
     * It deliberately says nothing about whether that nucleotide agrees
     * with the consensus.
     */

    for(
        var pos = 0;
        pos < sequenceLength;
        pos++
    ) {

        var callableCount =
            0;


        _.each(
            members,
            function(member) {

                if(
                    isCanonicalNt(
                        member.sequence.charAt(pos)
                    )
                ) {
                    callableCount++;
                }
            }
        );


        occupancies.push({

            callableCount:
                callableCount,

            occupancyPct:
                percentage(
                    callableCount,
                    members.length
                )
        });
    }


    return occupancies;
}


// ============================================================================
// Dating mask
// ============================================================================

function buildDatingMask(
    consensusSequence,
    columnOccupancies,
    minColumnOccupancyPct
) {

    var mask =
        [];


    for(
        var pos = 0;
        pos < consensusSequence.length;
        pos++
    ) {

        /*
         * A dating position must:
         *
         *   1. have a callable consensus nucleotide;
         *   2. meet the alignment occupancy threshold.
         *
         * No conservation / consensus-support criterion is applied.
         */

        mask.push(

            isCanonicalNt(
                consensusSequence.charAt(pos)
            ) &&

            columnOccupancies[pos].occupancyPct >=
                minColumnOccupancyPct
        );
    }


    return mask;
}


// ============================================================================
// Sequence comparison
// ============================================================================

function compareSequences(
    consensusSequence,
    memberSequence,
    mask
) {

    var sitesCompared =
        0;

    var sitesMatching =
        0;

    var sitesDifferent =
        0;


    for(
        var pos = 0;
        pos < consensusSequence.length;
        pos++
    ) {

        if(
            mask !== null &&
            !mask[pos]
        ) {
            continue;
        }


        var consensusNt =
            consensusSequence.charAt(pos);

        var memberNt =
            memberSequence.charAt(pos);


        if(
            !isCanonicalNt(consensusNt) ||
            !isCanonicalNt(memberNt)
        ) {
            continue;
        }


        sitesCompared++;


        if(
            consensusNt === memberNt
        ) {
            sitesMatching++;
        } else {
            sitesDifferent++;
        }
    }


    return {

        sitesCompared:
            sitesCompared,

        sitesMatching:
            sitesMatching,

        sitesDifferent:
            sitesDifferent
    };
}


function distanceFromComparison(
    comparison
) {

    if(
        comparison.sitesCompared === 0
    ) {
        return null;
    }


    return (
        comparison.sitesDifferent /
        comparison.sitesCompared
    );
}


// ============================================================================
// Age calculation
// ============================================================================

function ageFromDistance(
    distance,
    substitutionRate
) {

    return (
        distance /
        substitutionRate /
        1000000.0
    );
}


// ============================================================================
// Distribution helpers
// ============================================================================

function sortNumeric(values) {

    values.sort(
        function(a, b) {
            return a - b;
        }
    );
}


function median(values) {

    return percentile(
        values,
        0.5
    );
}


function percentile(
    sortedValues,
    proportion
) {

    if(
        sortedValues.length === 0
    ) {
        return null;
    }


    if(
        sortedValues.length === 1
    ) {
        return sortedValues[0];
    }


    var index =
        proportion *
        (sortedValues.length - 1);


    var lowerIndex =
        Math.floor(index);

    var upperIndex =
        Math.ceil(index);


    if(
        lowerIndex === upperIndex
    ) {
        return sortedValues[lowerIndex];
    }


    var fraction =
        index - lowerIndex;


    return (
        sortedValues[lowerIndex] +
        fraction *
        (
            sortedValues[upperIndex] -
            sortedValues[lowerIndex]
        )
    );
}


// ============================================================================
// Nucleotide helpers
// ============================================================================

function isCanonicalNt(nt) {

    return (
        nt === "A" ||
        nt === "C" ||
        nt === "G" ||
        nt === "T"
    );
}


function countCanonicalNucleotides(
    sequence
) {

    var count =
        0;


    for(
        var pos = 0;
        pos < sequence.length;
        pos++
    ) {

        if(
            isCanonicalNt(
                sequence.charAt(pos)
            )
        ) {
            count++;
        }
    }


    return count;
}


function countTrue(values) {

    var count =
        0;


    _.each(
        values,
        function(value) {

            if(value) {
                count++;
            }
        }
    );


    return count;
}


// ============================================================================
// Numeric helpers
// ============================================================================

function percentage(
    numerator,
    denominator
) {

    if(
        denominator === 0
    ) {
        return 0.0;
    }


    return (
        100.0 *
        numerator /
        denominator
    );
}


function normalisePercentage(
    value,
    parameterName
) {

    var number =
        Number(value);


    if(
        isNaN(number) ||
        number < 0.0 ||
        number > 100.0
    ) {

        throw (
            "Parameter '" +
            parameterName +
            "' must be a number between 0 and 100"
        );
    }


    return number;
}


// ============================================================================
// GLUE result parsing
// ============================================================================

function nucleotideFastaRecords(
    result
) {

    if(
        result === null ||
        result === undefined ||
        result.nucleotideFasta === undefined ||
        result.nucleotideFasta.sequences === undefined
    ) {

        throw (
            "Unexpected nucleotide FASTA result returned by GLUE"
        );
    }


    var sequences =
        result.nucleotideFasta.sequences;


    if(
        sequences === null
    ) {
        return [];
    }


    if(
        sequences.length === undefined
    ) {
        return [sequences];
    }


    return sequences;
}


// ============================================================================
// Alignment-member identity
// ============================================================================

function parseAlignmentMemberId(
    fastaId,
    alignmentName
) {

    var prefix =
        alignmentName +
        ".";


    if(
        fastaId.indexOf(prefix) !== 0
    ) {

        return {
            sourceName: null,
            sequenceID: null
        };
    }


    var remainder =
        fastaId.substring(
            prefix.length
        );


    var firstDot =
        remainder.indexOf(".");


    if(
        firstDot < 0
    ) {

        return {
            sourceName: null,
            sequenceID: remainder
        };
    }


    return {

        sourceName:
            remainder.substring(
                0,
                firstDot
            ),

        sequenceID:
            remainder.substring(
                firstDot + 1
            )
    };
}


// ============================================================================
// Member selection
// ============================================================================

function buildMemberWhereClause() {

    return (
        "fLocNotes.featureLoc.feature.name = '" +
        FEATURE_NAME +
        "' and fLocNotes.ref_nt_coverage_pct >= " +
        MIN_REF_NT_COVERAGE_PCT
    );
}

// ============================================================================
// Database persistence
// ============================================================================

function storeConsensusCalibration(
    calibrationId,
    locusId,
    ltrLineageId,
    alignmentName,
    referenceName,
    row,
    lineageMedianDivergence,
    lineageMadDivergence,
    robustZ,
    outlierStatus
) {

    var calibrationPath =
        customRowPath(
            "erv_age_calibration",
            calibrationId
        );


    var consensusClockPath =
        customRowPath(
            "erv_age_calibration_consensus_clock",
            calibrationId
        );


    ensureRow(
        "erv_age_calibration",
        calibrationId
    );


    ensureRow(
        "erv_age_calibration_consensus_clock",
        calibrationId
    );


    // ------------------------------------------------------------------------
    // Parent calibration
    // ------------------------------------------------------------------------

    glue.inMode(
        calibrationPath,
        function() {

            setFieldValue(
                "calibration_id",
                calibrationId
            );

            setFieldValue(
                "calibrated_entity_type",
                "erv_locus"
            );

            setFieldValue(
                "method_type",
                "ltr_consensus_divergence"
            );

            setFieldValue(
                "age_logic",
                "point_estimate"
            );

            setDoubleFieldValue(
                "age_mya",
                row.age_mya
            );

            setDoubleFieldValue(
                "age_younger_bound_mya",
                row.age_younger_bound_mya
            );

            setDoubleFieldValue(
                "age_older_bound_mya",
                row.age_older_bound_mya
            );

            setFieldValue(
                "bounds_type",
                "substitution_rate_range"
            );


            // Generic distance / clock fields

            setDoubleFieldValue(
                "divergence",
                row.dating_p_distance
            );

            setDoubleFieldValue(
                "substitution_rate",
                row.substitution_rate
            );

            setFieldValue(
                "distance_model",
                "p_distance"
            );

            setIntegerFieldValue(
                "sites_compared",
                row.dating_sites_compared
            );

            setDoubleFieldValue(
                "alignment_coverage",
                row.dating_coverage_pct
            );


            setFieldValue(
                "source_note",
                "ERVdb LTR consensus-divergence analysis"
            );


            setFieldValue(
                "notes",
                "Approximate LTR age estimated from divergence " +
                "from an alignment-derived consensus; dating columns " +
                "selected by alignment occupancy."
            );


            setLinkTarget(
                "erv_locus",
                customRowPath(
                    "erv_locus",
                    locusId
                )
            );


            setLinkTarget(
                "ltr_lineage",
                customRowPath(
                    "ltr_lineage",
                    ltrLineageId
                )
            );
        }
    );


    // ------------------------------------------------------------------------
    // Consensus-clock method details
    // ------------------------------------------------------------------------

    glue.inMode(
        consensusClockPath,
        function() {

            setFieldValue(
                "query_identifier",
                row.source_name +
                "/" +
                row.sequence_id
            );

            setFieldValue(
                "consensus_identifier",
                referenceName +
                ":alignment_consensus"
            );


            setDoubleFieldValue(
                "raw_divergence",
                row.raw_p_distance
            );

            setDoubleFieldValue(
                "divergence_from_consensus",
                row.dating_p_distance
            );


            setDoubleFieldValue(
                "min_ref_nt_coverage_pct",
                MIN_REF_NT_COVERAGE_PCT
            );

            setDoubleFieldValue(
                "min_column_occupancy_pct",
                row.min_column_occupancy_pct
            );

            setDoubleFieldValue(
                "min_dating_coverage_pct",
                MIN_DATING_COVERAGE_PCT
            );


            setIntegerFieldValue(
                "consensus_length",
                row.consensus_length
            );

            setIntegerFieldValue(
                "dating_mask_sites",
                row.dating_mask_sites
            );

            setIntegerFieldValue(
                "dating_sites_compared",
                row.dating_sites_compared
            );

            setDoubleFieldValue(
                "dating_coverage_pct",
                row.dating_coverage_pct
            );


            setDoubleFieldValue(
                "substitution_rate_low",
                row.substitution_rate_low
            );

            setDoubleFieldValue(
                "substitution_rate_high",
                row.substitution_rate_high
            );

            setFieldValue(
                "rate_units",
                "substitutions/site/year"
            );

            setFieldValue(
                "correction_model",
                "uncorrected_p_distance"
            );


            setDoubleFieldValue(
                "lineage_median_divergence",
                lineageMedianDivergence
            );

            setDoubleFieldValue(
                "lineage_mad_divergence",
                lineageMadDivergence
            );

            setDoubleFieldValue(
                "robust_z",
                robustZ
            );

            setFieldValue(
                "outlier_status",
                outlierStatus
            );


            setFieldValue(
                "clock_note",
                "Consensus generated from " +
                alignmentName +
                " in " +
                referenceName +
                " coordinate space."
            );


            setLinkTarget(
                "erv_age_calibration",
                calibrationPath
            );
        }
    );
}


/*
 * Resolve the formal sequence -> erv_locus relationship.
 */

function resolveErvLocusId(
    sourceName,
    sequenceId
) {

    var result;


    glue.inMode(
        "sequence/" +
        sourceName +
        "/" +
        sequenceId,
        function() {

            result =
                glue.command([
                    "show",
                    "property",
                    "erv_locus.id"
                ]);
        }
    );


    /*
     * show property result shape can vary depending on GLUE version /
     * result formatting, so use tableToObjects rather than reaching into
     * the command-result object directly.
     */

    var objects =
        glue.tableToObjects(
            result
        );


    if(
        objects === null ||
        objects.length === 0
    ) {
        return null;
    }


    var value =
        objects[0].value;


    if(
        value === null ||
        value === undefined ||
        ("" + value).trim() === ""
    ) {
        return null;
    }


    return (
        "" + value
    ).trim();
}


function consensusCalibrationId(
    locusId
) {

    return (
        "CONSCLK_" +
        locusId
    );
}


function ensureRow(
    tableName,
    rowId
) {

    try {

        glue.command([
            "create",
            "custom-table-row",
            tableName,
            rowId
        ]);

    } catch(e) {

        /*
         * Existing rows are intentionally reused so the operation is
         * idempotent.
         */
    }
}


function customRowPath(
    tableName,
    rowId
) {

    return (
        "custom-table-row/" +
        tableName +
        "/" +
        rowId
    );
}


function setFieldValue(
    fieldName,
    value
) {

    if(
        value === null ||
        value === undefined
    ) {
        return;
    }


    glue.command([
        "set",
        "field",
        fieldName,
        "" + value
    ]);
}


function setDoubleFieldValue(
    fieldName,
    value
) {

    if(
        value === null ||
        value === undefined ||
        isNaN(value)
    ) {
        return;
    }


    glue.command([
        "set",
        "field",
        fieldName,
        "" + value
    ]);
}


function setIntegerFieldValue(
    fieldName,
    value
) {

    if(
        value === null ||
        value === undefined ||
        isNaN(value)
    ) {
        return;
    }


    glue.command([
        "set",
        "field",
        fieldName,
        "" + Math.round(value)
    ]);
}


function setLinkTarget(
    linkName,
    targetPath
) {

    glue.command([
        "set",
        "link-target",
        linkName,
        targetPath
    ]);
}

// ============================================================================
// General helpers
// ============================================================================

function normaliseSequence(
    value
) {

    if(
        value === null ||
        value === undefined
    ) {
        return "";
    }


    return (
        ("" + value)
            .replace(/\s+/g, "")
            .toUpperCase()
    );
}


function normaliseRequired(
    value,
    parameterName
) {

    if(
        value === null ||
        value === undefined
    ) {

        throw (
            "Required parameter '" +
            parameterName +
            "' was not supplied"
        );
    }


    var result =
        ("" + value).trim();


    if(
        result.length === 0
    ) {

        throw (
            "Required parameter '" +
            parameterName +
            "' was empty"
        );
    }


    return result;
}

function medianAbsoluteDeviation(
    values,
    centre
) {

    if(
        values === null ||
        values.length === 0 ||
        centre === null
    ) {
        return null;
    }


    var deviations =
        [];


    _.each(
        values,
        function(value) {

            deviations.push(
                Math.abs(
                    value - centre
                )
            );
        }
    );


    sortNumeric(
        deviations
    );


    return median(
        deviations
    );
}


function robustZScore(
    value,
    medianValue,
    madValue
) {

    if(
        value === null ||
        medianValue === null ||
        madValue === null ||
        madValue === 0
    ) {
        return null;
    }


    return (
        0.6745 *
        (value - medianValue) /
        madValue
    );
}


function outlierStatusFromRobustZ(
    robustZ
) {

    if(robustZ === null) {
        return "none";
    }


    if(robustZ >= 3.5) {
        return "high_outlier";
    }


    if(robustZ <= -3.5) {
        return "low_outlier";
    }


    return "none";
}