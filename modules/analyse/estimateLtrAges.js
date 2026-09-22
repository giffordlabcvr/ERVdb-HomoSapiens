/**
 * estimateLtrAges.js
 *
 * Estimate LTR locus ages from divergence from an alignment-derived
 * consensus sequence.
 *
 * Dating columns are selected automatically using:
 *
 *   1. minimum column occupancy;
 *   2. minimum support for the GLUE consensus nucleotide.
 *
 * Both thresholds are supplied as function parameters so their effects
 * can be investigated without modifying the module.
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
 * Minimum reference coverage for a locus to enter the analysis.
 */

var MIN_REF_NT_COVERAGE_PCT =
    70.0;


/*
 * Minimum proportion of dating-mask sites represented by canonical
 * nucleotides in a locus before an age is assigned.
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
    minColumnOccupancyPct,
    minConsensusSupportPct
) {

    var analysis =
        analyseAlignment(
            alignmentName,
            referenceName,
            minColumnOccupancyPct,
            minConsensusSupportPct
        );

    return analysis.rows;
}


function summariseConsensusAges(
    alignmentName,
    referenceName,
    minColumnOccupancyPct,
    minConsensusSupportPct
) {

    var analysis =
        analyseAlignment(
            alignmentName,
            referenceName,
            minColumnOccupancyPct,
            minConsensusSupportPct
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

        min_consensus_support_pct:
            analysis.minConsensusSupportPct,


        // Alignment / mask

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


        // Number of loci actually receiving an age

        dated_taxa:
            ages.length,


        // Divergence summaries

        median_raw_p_distance:
            median(rawDistances),

        median_dating_p_distance:
            median(datingDistances),


        // Age distribution

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


// ============================================================================
// Core analysis
// ============================================================================

function analyseAlignment(
    alignmentName,
    referenceName,
    minColumnOccupancyPct,
    minConsensusSupportPct
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


    minConsensusSupportPct =
        normalisePercentage(
            minConsensusSupportPct,
            "minConsensusSupportPct"
        );


    var whereClause =
        buildMemberWhereClause();


    // ------------------------------------------------------------------------
    // Generate GLUE consensus
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
    // Export qualifying members in the same reference-coordinate space.
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
    // Normalise sequences and check coordinate compatibility
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
    // Column statistics and dating mask
    // ------------------------------------------------------------------------

    var columnStats =
        calculateColumnStats(
            consensusSequence,
            members
        );


    var datingMask =
        buildDatingMask(
            consensusSequence,
            columnStats,
            minColumnOccupancyPct,
            minConsensusSupportPct
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
            "% and consensus support >= " +
            minConsensusSupportPct +
            "%"
        );
    }


    // ------------------------------------------------------------------------
    // Locus comparisons
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


                // Mask definition

                min_column_occupancy_pct:
                    minColumnOccupancyPct,

                min_consensus_support_pct:
                    minConsensusSupportPct,

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


                // Masked comparison

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

        minConsensusSupportPct:
            minConsensusSupportPct,

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
// Column statistics
// ============================================================================

function calculateColumnStats(
    consensusSequence,
    members
) {

    var stats =
        [];


    for(
        var pos = 0;
        pos < consensusSequence.length;
        pos++
    ) {

        var consensusNt =
            consensusSequence.charAt(pos);


        var callableCount =
            0;

        var consensusCount =
            0;


        _.each(
            members,
            function(member) {

                var nt =
                    member.sequence.charAt(pos);


                if(!isCanonicalNt(nt)) {
                    return;
                }


                callableCount++;


                if(
                    isCanonicalNt(consensusNt) &&
                    nt === consensusNt
                ) {
                    consensusCount++;
                }
            }
        );


        stats.push({

            callableCount:
                callableCount,

            consensusCount:
                consensusCount,

            occupancyPct:
                percentage(
                    callableCount,
                    members.length
                ),

            consensusSupportPct:
                percentage(
                    consensusCount,
                    callableCount
                )
        });
    }


    return stats;
}


// ============================================================================
// Dating mask
// ============================================================================

function buildDatingMask(
    consensusSequence,
    columnStats,
    minColumnOccupancyPct,
    minConsensusSupportPct
) {

    var mask =
        [];


    for(
        var pos = 0;
        pos < consensusSequence.length;
        pos++
    ) {

        var stats =
            columnStats[pos];


        mask.push(

            isCanonicalNt(
                consensusSequence.charAt(pos)
            ) &&

            stats.occupancyPct >=
                minColumnOccupancyPct &&

            stats.consensusSupportPct >=
                minConsensusSupportPct
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


        if(consensusNt === memberNt) {
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

    if(comparison.sitesCompared === 0) {
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


/*
 * Linear interpolation between adjacent ranked observations.
 *
 * For exploratory summaries this gives us conventional continuous
 * quartiles without adding another dependency.
 */

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

    if(denominator === 0) {
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


    if(sequences === null) {
        return [];
    }


    if(sequences.length === undefined) {
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


    if(firstDot < 0) {

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


    if(result.length === 0) {

        throw (
            "Required parameter '" +
            parameterName +
            "' was empty"
        );
    }


    return result;
}
