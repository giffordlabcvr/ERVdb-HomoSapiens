/**
 * estimateLtrAges.js
 *
 * Estimate the ages of LTR loci from nucleotide divergence from an
 * alignment-derived consensus sequence.
 *
 * The LTR alignment must be constrained by the supplied LTR reference.
 *
 * GLUE is used to:
 *
 *   1. Generate a nucleotide consensus in the coordinate space of the
 *      supplied LTR reference.
 *
 *   2. Export qualifying alignment members in exactly the same reference
 *      coordinate space, excluding insertions relative to the reference.
 *
 * This script then compares each exported sequence directly with the
 * consensus.
 *
 * Only positions containing canonical nucleotides (A/C/G/T) in BOTH the
 * consensus and the alignment member are compared.
 *
 * Gaps and ambiguous nucleotides are excluded from the calculation.
 *
 * Raw nucleotide divergence:
 *
 *      p_distance = substitutions / sites_compared
 *
 * Age:
 *
 *      age_mya = p_distance / substitution_rate / 1,000,000
 *
 * This is a consensus-divergence age estimate. There is therefore no
 * factor of two, unlike dating based on divergence between paired
 * proviral LTRs.
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
 * Initial locus-selection threshold.
 *
 * This is deliberately independent of the later calculation of
 * sites_compared / comparison_coverage_pct.
 */

var MIN_REF_NT_COVERAGE_PCT =
    70.0;


/*
 * Neutral substitution rate.
 *
 * IMPORTANT:
 * This value should be reviewed before age estimates are treated as
 * definitive ERVdb calibrations.
 *
 * Units:
 * substitutions / site / year
 */

var SUBSTITUTION_RATE =
    2.2e-9;


// ============================================================================
// Public function
// ============================================================================

function estimateConsensusAges(
    alignmentName,
    referenceName
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


    var whereClause =
        buildMemberWhereClause();


    // ------------------------------------------------------------------------
    // Generate consensus
    // ------------------------------------------------------------------------

    var consensusResult;

    glue.inMode(
        "module/" +
        CONSENSUS_GENERATOR_MODULE,
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
            "Consensus sequence is empty for alignment " +
            alignmentName
        );
    }


    // ------------------------------------------------------------------------
    // Export qualifying alignment members in the SAME reference coordinate
    // space.
    //
    // Note that --includeInsertions / -i is deliberately NOT supplied.
    // ------------------------------------------------------------------------

    var alignmentResult;

    glue.inMode(
        "module/" +
        FASTA_ALIGNMENT_EXPORTER_MODULE,
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
            "No qualifying alignment members were exported from " +
            alignmentName
        );
    }


    // ------------------------------------------------------------------------
    // Determine callable consensus positions
    // ------------------------------------------------------------------------

    var callableConsensusSites =
        countCanonicalNucleotides(
            consensusSequence
        );


    if(callableConsensusSites === 0) {

        throw (
            "Consensus for " +
            alignmentName +
            " contains no callable A/C/G/T positions"
        );
    }


    // ------------------------------------------------------------------------
    // Compare each member with the consensus
    // ------------------------------------------------------------------------

    var resultRows =
        [];


    _.each(
        memberRecords,
        function(memberRecord) {

            var memberSequence =
                normaliseSequence(
                    memberRecord.sequence
                );


            /*
             * This is an important sanity check.
             *
             * Both sequences should have been generated in precisely the
             * same related-reference / feature coordinate space.
             */

            if(
                memberSequence.length !==
                consensusSequence.length
            ) {

                throw (
                    "Coordinate-space length mismatch for " +
                    memberRecord.id +
                    ": consensus length = " +
                    consensusSequence.length +
                    ", member length = " +
                    memberSequence.length
                );
            }


            var comparison =
                compareSequences(
                    consensusSequence,
                    memberSequence
                );


            var comparisonCoveragePct =
                (
                    100.0 *
                    comparison.sitesCompared /
                    callableConsensusSites
                );


            var pDistance = null;
            var ageMya = null;


            if(comparison.sitesCompared > 0) {

                pDistance =
                    (
                        comparison.sitesDifferent /
                        comparison.sitesCompared
                    );


                ageMya =
                    (
                        pDistance /
                        SUBSTITUTION_RATE /
                        1000000.0
                    );
            }


            var memberIdentity =
                parseAlignmentMemberId(
                    memberRecord.id,
                    alignmentName
                );


            resultRows.push({

                alignment_name:
                    alignmentName,

                reference_name:
                    referenceName,

                source_name:
                    memberIdentity.sourceName,

                sequence_id:
                    memberIdentity.sequenceID,

                fasta_id:
                    memberRecord.id,

                consensus_length:
                    consensusSequence.length,

                callable_consensus_sites:
                    callableConsensusSites,

                sites_compared:
                    comparison.sitesCompared,

                sites_matching:
                    comparison.sitesMatching,

                sites_different:
                    comparison.sitesDifferent,

                comparison_coverage_pct:
                    comparisonCoveragePct,

                p_distance:
                    pDistance,

                substitution_rate:
                    SUBSTITUTION_RATE,

                age_mya:
                    ageMya
            });
        }
    );


    return resultRows;
}


// ============================================================================
// Sequence comparison
// ============================================================================

function compareSequences(
    consensusSequence,
    memberSequence
) {

    var sitesCompared =
        0;

    var sitesMatching =
        0;

    var sitesDifferent =
        0;


    for(
        var i = 0;
        i < consensusSequence.length;
        i++
    ) {

        var consensusNt =
            consensusSequence.charAt(i);

        var memberNt =
            memberSequence.charAt(i);


        /*
         * Compare only canonical nucleotides.
         *
         * This automatically excludes:
         *
         *   -
         *   N
         *   IUPAC ambiguity codes
         *   any other non-canonical character
         */

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


function isCanonicalNt(nt) {

    return (
        nt === "A" ||
        nt === "C" ||
        nt === "G" ||
        nt === "T"
    );
}


function countCanonicalNucleotides(sequence) {

    var count =
        0;


    for(
        var i = 0;
        i < sequence.length;
        i++
    ) {

        if(
            isCanonicalNt(
                sequence.charAt(i)
            )
        ) {
            count++;
        }
    }


    return count;
}


// ============================================================================
// GLUE result parsing
// ============================================================================

function nucleotideFastaRecords(result) {

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


    /*
     * Nashorn / GLUE result objects can occasionally expose a single
     * result differently from a normal JS array. Normalise here.
     */

    if(sequences === null) {
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

    /*
     * fastaAlignmentExporter currently emits:
     *
     *   <alignment>.<source>.<sequenceID>
     *
     * e.g.
     *
     *   AL_LTR_LTR12C.filtered_2026_07.RBRT10000
     *
     * Strip the known alignment prefix and then split the remainder.
     *
     * This assumes source names do not contain ".".
     */

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

function normaliseSequence(value) {

    if(
        value === null ||
        value === undefined
    ) {
        return "";
    }


    /*
     * FASTA command results should not contain whitespace, but removing it
     * here makes the comparison robust to representation differences.
     */

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
