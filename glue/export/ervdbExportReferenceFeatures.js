// glue/export/ervdbExportReferenceFeatures.js
//
// Export reference feature annotations and feature sequences for the
// HERVdb / ERVdb web app.
//
// Outputs:
//   web-app/ervdb_features.tsv
//   web-app/ervdb_feature_locations.tsv
//   web-app/ervdb_coding_nt.fasta
//   web-app/ervdb_coding_aa.fasta
//   web-app/ervdb_noncoding_nt.fasta
//   web-app/ervdb_representative_ltr_nt.fasta
//   web-app/ervdb_representative_ltrs.tsv
//   web-app/ervdb_feature_export_skipped.tsv
//
// Design:
//   - indexes GLUE feature metadata once
//   - uses CODES_AMINO_ACIDS=true to identify coding features
//   - iterates over references
//   - lists the feature-locations present on each reference
//   - extracts coding sequences using the feature-location amino-acid command
//   - exports each complete linked reference using fastaExporter
//   - reconstructs non-coding features from their feature-location segments
//   - exports non-coding features of at least MIN_NONCODING_LENGTH nucleotides
//   - exports both complete LTRs to the general non-coding FASTA
//   - selects one representative LTR per reference, preferring the 5' LTR
//     unless the 3' LTR is appreciably longer
//   - records skipped or problematic exports for QA
//
// Notes:
//   - Written for GLUE's ECMAScript 5.1 / Nashorn JavaScript layer.
//   - GLUE feature coordinates are 1-based and inclusive.

var DRY_RUN = false;

var OUTPUT_DIR = "web-app";

var FEATURES_TSV =
    OUTPUT_DIR + "/ervdb_features.tsv";

var FEATURE_LOCATIONS_TSV =
    OUTPUT_DIR + "/ervdb_feature_locations.tsv";

var CODING_NT_FASTA =
    OUTPUT_DIR + "/ervdb_coding_nt.fasta";

var CODING_AA_FASTA =
    OUTPUT_DIR + "/ervdb_coding_aa.fasta";

var NONCODING_NT_FASTA =
    OUTPUT_DIR + "/ervdb_noncoding_nt.fasta";

var REPRESENTATIVE_LTR_NT_FASTA =
    OUTPUT_DIR + "/ervdb_representative_ltr_nt.fasta";

var REPRESENTATIVE_LTRS_TSV =
    OUTPUT_DIR + "/ervdb_representative_ltrs.tsv";

var SKIPPED_TSV =
    OUTPUT_DIR + "/ervdb_feature_export_skipped.tsv";


// References are retained only if their linked sequence has this value.
// Set to null to retain all references.

var REQUIRED_SEQUENCE_KIND = "erv_ref";


// Optional additional reference filter.

var REFERENCE_WHERE_CLAUSE = null;


// Leave empty to export every feature carrying
// CODES_AMINO_ACIDS=true.
//
// Example:
//
// var INCLUDE_CODING_FEATURES = {
//     "gag": true,
//     "pro": true,
//     "pol": true,
//     "env": true
// };

var INCLUDE_CODING_FEATURES = {};


// These structural regions remain in the metadata TSV files but are not
// emitted as non-coding FASTA records.

var EXCLUDE_FROM_NONCODING_FASTA = {
    "whole_genome": true,
    "internal_region": true
};


// Short annotations such as TATA boxes, PPTs and PBSs remain in the TSV files,
// but are not emitted as standalone FASTA records below this length.

var MIN_NONCODING_LENGTH = 50;


// Prefer the 5' LTR unless the 3' LTR is at least this many nucleotides longer.

var LTR_LENGTH_ADVANTAGE_THRESHOLD = 10;


// Optional coding-sequence filters.

var SKIP_FASTA_WITH_INTERNAL_STOP = false;
var SKIP_FASTA_WITH_AMBIGUITY = false;


var File = Java.type("java.io.File");
var FileWriter = Java.type("java.io.FileWriter");
var BufferedWriter = Java.type("java.io.BufferedWriter");


// Cache complete reference sequences using source/sequenceID as the key.

var referenceSequenceCache = {};


// -----------------------------------------------------------------------------
// File-writing utilities
// -----------------------------------------------------------------------------

function ensureOutputDir() {
    var dir = new File(OUTPUT_DIR);

    if(!dir.exists()) {
        dir.mkdirs();
    }
}


function openWriter(path) {
    return new BufferedWriter(
        new FileWriter(path)
    );
}


function writeLine(writer, fields) {
    if(fields instanceof Array) {
        writer.write(
            fields.map(tsvEscape).join("\t")
        );
    } else {
        writer.write(String(fields));
    }

    writer.newLine();
}


function tsvEscape(value) {
    if(
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replace(/\t/g, " ")
        .replace(/\r?\n/g, " ");
}


function fastaWrap(sequence) {
    var lines = [];
    var width = 70;

    for(
        var i = 0;
        i < sequence.length;
        i += width
    ) {
        lines.push(
            sequence.substring(
                i,
                i + width
            )
        );
    }

    return lines.join("\n");
}


function writeFastaRecord(
    writer,
    header,
    sequence
) {
    writer.write(">" + header);
    writer.newLine();

    writer.write(
        fastaWrap(sequence)
    );

    writer.newLine();
}


// -----------------------------------------------------------------------------
// GLUE result utilities
// -----------------------------------------------------------------------------

function listResultRows(result) {
    if(
        result === null ||
        result === undefined ||
        result.listResult === undefined
    ) {
        return [];
    }

    return result.listResult.row || [];
}


function listResultColumns(result) {
    if(
        result === null ||
        result === undefined ||
        result.listResult === undefined
    ) {
        return [];
    }

    return result.listResult.column || [];
}


function rowToObject(columns, row) {
    var obj = {};
    var values = row.value || [];

    for(
        var i = 0;
        i < columns.length;
        i++
    ) {
        obj[columns[i]] = values[i];
    }

    return obj;
}


function commandOrNull(cmdArray) {
    try {
        return glue.command(cmdArray);
    } catch(e) {
        return null;
    }
}


function cayenneStringLiteral(value) {
    return "'" +
        String(value).replace(/'/g, "\\'") +
        "'";
}


function getField(obj, names) {
    for(
        var i = 0;
        i < names.length;
        i++
    ) {
        if(
            obj[names[i]] !== undefined &&
            obj[names[i]] !== null
        ) {
            return obj[names[i]];
        }
    }

    return null;
}


// -----------------------------------------------------------------------------
// Feature metadata
// -----------------------------------------------------------------------------

function getFeatureMetatags(featureName) {
    var metatags = {};

    glue.inMode(
        "/feature/" + featureName,
        function() {
            var result = glue.command([
                "list",
                "metatag"
            ]);

            var columns =
                listResultColumns(result);

            var rows =
                listResultRows(result);

            for(
                var i = 0;
                i < rows.length;
                i++
            ) {
                var rowObj =
                    rowToObject(
                        columns,
                        rows[i]
                    );

                metatags[rowObj.name] =
                    rowObj.value;
            }
        }
    );

    return metatags;
}


function indexFeatures() {
    var result = glue.command([
        "list",
        "feature"
    ]);

    var columns =
        listResultColumns(result);

    var rows =
        listResultRows(result);

    var featuresByName = {};

    for(
        var i = 0;
        i < rows.length;
        i++
    ) {
        var feature =
            rowToObject(
                columns,
                rows[i]
            );

        var metatags =
            getFeatureMetatags(
                feature.name
            );

        feature.codes_amino_acids =
            metatags[
                "CODES_AMINO_ACIDS"
            ] === "true";

        feature.own_codon_numbering =
            metatags[
                "OWN_CODON_NUMBERING"
            ] === "true";

        featuresByName[
            feature.name
        ] = feature;
    }

    return featuresByName;
}


// -----------------------------------------------------------------------------
// References and linked sequences
// -----------------------------------------------------------------------------

function buildEligibleSequenceIndex() {
    var index = {};

    var cmd = [
        "list",
        "sequence",
        "sequenceID",
        "source.name",
        "sequence_kind"
    ];

    if(REQUIRED_SEQUENCE_KIND !== null) {
        cmd.push("-w");

        cmd.push(
            "sequence_kind = '" +
            REQUIRED_SEQUENCE_KIND +
            "'"
        );
    }

    var result =
        glue.command(cmd);

    var columns =
        listResultColumns(result);

    var rows =
        listResultRows(result);

    for(
        var i = 0;
        i < rows.length;
        i++
    ) {
        var rowObj =
            rowToObject(
                columns,
                rows[i]
            );

        var key =
            rowObj["source.name"] +
            "/" +
            rowObj.sequenceID;

        index[key] = rowObj;
    }

    return index;
}


function getReferenceSequenceInfo(referenceName) {
    var result = commandOrNull([
        "reference",
        referenceName,
        "show",
        "sequence"
    ]);

    if(
        result !== null &&
        result.showSequenceResult !== undefined
    ) {
        return {
            sourceName:
                result.showSequenceResult[
                    "sequence.source.name"
                ],

            sequenceID:
                result.showSequenceResult[
                    "sequence.sequenceID"
                ]
        };
    }


    var modeResult = {
        sourceName: null,
        sequenceID: null
    };

    try {
        glue.inMode(
            "/reference/" + referenceName,
            function() {
                var result2 = glue.command([
                    "show",
                    "sequence"
                ]);

                if(
                    result2 !== null &&
                    result2.showSequenceResult !== undefined
                ) {
                    modeResult.sourceName =
                        result2.showSequenceResult[
                            "sequence.source.name"
                        ];

                    modeResult.sequenceID =
                        result2.showSequenceResult[
                            "sequence.sequenceID"
                        ];
                }
            }
        );
    } catch(e) {
        // Leave null values.
    }

    return modeResult;
}


function listReferences(
    eligibleSequenceIndex
) {
    var cmd = [
        "list",
        "reference"
    ];

    if(
        REFERENCE_WHERE_CLAUSE !== null
    ) {
        cmd.push("-w");
        cmd.push(
            REFERENCE_WHERE_CLAUSE
        );
    }

    var result =
        glue.command(cmd);

    var columns =
        listResultColumns(result);

    var rows =
        listResultRows(result);

    var refs = [];

    for(
        var i = 0;
        i < rows.length;
        i++
    ) {
        var ref =
            rowToObject(
                columns,
                rows[i]
            );

        var seqInfo =
            getReferenceSequenceInfo(
                ref.name
            );

        ref["sequence.source.name"] =
            seqInfo.sourceName;

        ref["sequence.sequenceID"] =
            seqInfo.sequenceID;

        var seqKey =
            seqInfo.sourceName +
            "/" +
            seqInfo.sequenceID;

        if(
            REQUIRED_SEQUENCE_KIND === null ||
            eligibleSequenceIndex[
                seqKey
            ] !== undefined
        ) {
            refs.push(ref);
        }
    }

    return refs;
}


// -----------------------------------------------------------------------------
// Complete reference-sequence export
// -----------------------------------------------------------------------------

function getReferenceNucleotides(sourceName, sequenceID) {
    var cacheKey = sourceName + "/" + sequenceID;

    if(referenceSequenceCache.hasOwnProperty(cacheKey)) {
        return referenceSequenceCache[cacheKey];
    }

    var whereClause =
        "source.name = " + cayenneStringLiteral(sourceName) +
        " and sequenceID = " + cayenneStringLiteral(sequenceID);

    var result = null;

    try {
        glue.inMode("module/fastaExporter", function() {
            result = glue.command([
                "export",
                "-w", whereClause,
                "-p"
            ]);
        });
    } catch(e) {
        glue.log(
            "WARNING",
            "Failed to export reference sequence " +
            cacheKey +
            " using fastaExporter: " +
            e
        );

        result = null;
    }

    var ntSequence = null;

    if(
        result !== null &&
        result.nucleotideFasta !== undefined &&
        result.nucleotideFasta.sequences !== undefined
    ) {
        var sequences =
            result.nucleotideFasta.sequences || [];

        for(var i = 0; i < sequences.length; i++) {
            if(
                sequences[i].sequence !== null &&
                sequences[i].sequence !== undefined
            ) {
                ntSequence =
                    String(sequences[i].sequence)
                    .replace(/\s/g, "")
                    .toUpperCase();

                break;
            }
        }
    }

    referenceSequenceCache[cacheKey] = ntSequence;

    if(ntSequence === null) {
        glue.log(
            "WARNING",
            "fastaExporter returned no nucleotide sequence for " +
            cacheKey
        );
    }

    return ntSequence;
}



// -----------------------------------------------------------------------------
// Feature locations and segments
// -----------------------------------------------------------------------------

function getReferenceFeatureLocationRows(
    referenceName
) {
    var result = commandOrNull([
        "reference",
        referenceName,
        "list",
        "feature-location"
    ]);

    if(result !== null) {
        return {
            columns:
                listResultColumns(result),

            rows:
                listResultRows(result)
        };
    }


    var modeRows = [];
    var modeColumns = [];

    try {
        glue.inMode(
            "/reference/" + referenceName,
            function() {
                var result2 =
                    glue.command([
                        "list",
                        "feature-location"
                    ]);

                modeColumns =
                    listResultColumns(
                        result2
                    );

                modeRows =
                    listResultRows(
                        result2
                    );
            }
        );

        return {
            columns: modeColumns,
            rows: modeRows
        };
    } catch(e) {
        return {
            columns: [],
            rows: []
        };
    }
}


function listReferenceFeatureLocations(
    referenceName
) {
    var listed =
        getReferenceFeatureLocationRows(
            referenceName
        );

    var columns =
        listed.columns;

    var rows =
        listed.rows;

    var featureLocations = [];

    for(
        var i = 0;
        i < rows.length;
        i++
    ) {
        var rowObj =
            rowToObject(
                columns,
                rows[i]
            );

        var featureName =
            rowObj["feature.name"] ||
            rowObj["feature"] ||
            rowObj["name"];

        if(
            featureName !== null &&
            featureName !== undefined
        ) {
            rowObj._featureName =
                featureName;

            featureLocations.push(
                rowObj
            );
        }
    }

    return featureLocations;
}


function listFeatureLocationSegments(
    referenceName,
    featureName
) {
    var result = commandOrNull([
        "reference",
        referenceName,
        "feature-location",
        featureName,
        "list",
        "segment"
    ]);

    if(
        result !== null &&
        result.listResult !== undefined
    ) {
        return {
            columns:
                listResultColumns(result),

            rows:
                listResultRows(result)
        };
    }


    var modeColumns = [];
    var modeRows = [];

    try {
        glue.inMode(
            "/reference/" +
            referenceName +
            "/feature-location/" +
            featureName,
            function() {
                var result2 =
                    glue.command([
                        "list",
                        "segment"
                    ]);

                modeColumns =
                    listResultColumns(
                        result2
                    );

                modeRows =
                    listResultRows(
                        result2
                    );
            }
        );

        return {
            columns: modeColumns,
            rows: modeRows
        };
    } catch(e) {
        return {
            columns: [],
            rows: []
        };
    }
}


function orderedFeatureSegments(
    segmentColumns,
    segmentRows
) {
    var segments = [];

    for(
        var i = 0;
        i < segmentRows.length;
        i++
    ) {
        var segment =
            rowToObject(
                segmentColumns,
                segmentRows[i]
            );

        segment._originalIndex = i;

        segments.push(segment);
    }


    segments.sort(
        function(a, b) {
            var aIndex =
                a.transcriptionIndex;

            var bIndex =
                b.transcriptionIndex;


            if(
                aIndex !== null &&
                aIndex !== undefined &&
                bIndex !== null &&
                bIndex !== undefined &&
                Number(aIndex) !== Number(bIndex)
            ) {
                return (
                    Number(aIndex) -
                    Number(bIndex)
                );
            }


            if(
                Number(a.refStart) !==
                Number(b.refStart)
            ) {
                return (
                    Number(a.refStart) -
                    Number(b.refStart)
                );
            }


            return (
                a._originalIndex -
                b._originalIndex
            );
        }
    );

    return segments;
}


// -----------------------------------------------------------------------------
// Coding feature extraction
// -----------------------------------------------------------------------------

function getFeatureLocationAminoAcidResult(
    referenceName,
    featureName
) {
    var result = commandOrNull([
        "reference",
        referenceName,
        "feature-location",
        featureName,
        "amino-acid"
    ]);

    if(
        result !== null &&
        result.featureLocAminoAcidResult !== undefined
    ) {
        return result;
    }


    var modeResult = null;

    try {
        glue.inMode(
            "/reference/" +
            referenceName +
            "/feature-location/" +
            featureName,
            function() {
                modeResult =
                    glue.command([
                        "amino-acid"
                    ]);
            }
        );
    } catch(e) {
        modeResult = null;
    }

    return modeResult;
}


function exportCodingFeature(
    referenceName,
    featureName
) {
    var result =
        getFeatureLocationAminoAcidResult(
            referenceName,
            featureName
        );

    if(
        result === null ||
        result.featureLocAminoAcidResult === undefined
    ) {
        return {
            ok: false,

            reason:
                "amino_acid_command_failed_" +
                "or_no_feature_location"
        };
    }


    var aaResult =
        result.featureLocAminoAcidResult;

    var columns =
        aaResult.column || [];

    var rows =
        aaResult.row || [];


    if(rows.length === 0) {
        return {
            ok: false,
            reason: "zero_codons"
        };
    }


    var ntSeq = "";
    var aaSeq = "";

    var hasStop = false;
    var hasInternalStop = false;
    var hasAmbiguity = false;

    var missingCodonNts = false;
    var missingAminoAcid = false;


    for(
        var i = 0;
        i < rows.length;
        i++
    ) {
        var rowObj =
            rowToObject(
                columns,
                rows[i]
            );

        var codonNts =
            rowObj.codonNts;

        var aminoAcid =
            rowObj.aminoAcid;


        if(
            codonNts === null ||
            codonNts === undefined ||
            codonNts === ""
        ) {
            missingCodonNts = true;
            codonNts = "NNN";
        }


        if(
            aminoAcid === null ||
            aminoAcid === undefined ||
            aminoAcid === ""
        ) {
            missingAminoAcid = true;
            aminoAcid = "X";
        }


        codonNts =
            String(codonNts)
            .toUpperCase();

        aminoAcid =
            String(aminoAcid)
            .toUpperCase();


        if(/[^ACGT]/.test(codonNts)) {
            hasAmbiguity = true;
        }


        if(
            /[^ABCDEFGHIKLMNPQRSTVWXYZ\*]/.test(
                aminoAcid
            )
        ) {
            hasAmbiguity = true;
        }


        if(aminoAcid === "*") {
            hasStop = true;

            if(i < rows.length - 1) {
                hasInternalStop = true;
            }
        }


        ntSeq += codonNts;
        aaSeq += aminoAcid;
    }


    var skipFasta = false;
    var skipReason = "";


    if(
        SKIP_FASTA_WITH_INTERNAL_STOP &&
        hasInternalStop
    ) {
        skipFasta = true;
        skipReason = "internal_stop";
    }


    if(
        SKIP_FASTA_WITH_AMBIGUITY &&
        hasAmbiguity
    ) {
        skipFasta = true;

        skipReason =
            skipReason === ""
            ? "ambiguity"
            : skipReason + ";ambiguity";
    }


    return {
        ok: true,

        ntSeq: ntSeq,
        aaSeq: aaSeq,

        ntLength: ntSeq.length,
        aaLength: aaSeq.length,
        codonCount: rows.length,

        hasStop: hasStop,
        hasInternalStop: hasInternalStop,
        hasAmbiguity: hasAmbiguity,

        missingCodonNts:
            missingCodonNts,

        missingAminoAcid:
            missingAminoAcid,

        skipFasta: skipFasta,
        skipReason: skipReason
    };
}


function includeCodingFeature(
    featureName
) {
    var keys = [];

    for(
        var key in INCLUDE_CODING_FEATURES
    ) {
        if(
            INCLUDE_CODING_FEATURES
                .hasOwnProperty(key)
        ) {
            keys.push(key);
        }
    }

    if(keys.length === 0) {
        return true;
    }

    return (
        INCLUDE_CODING_FEATURES[
            featureName
        ] === true
    );
}


// -----------------------------------------------------------------------------
// Non-coding feature extraction
// -----------------------------------------------------------------------------

function includeNoncodingFastaFeature(
    featureName
) {
    return (
        EXCLUDE_FROM_NONCODING_FASTA[
            featureName
        ] !== true
    );
}


function extractFeatureNucleotides(
    referenceNucleotides,
    segmentColumns,
    segmentRows
) {
    if(
        referenceNucleotides === null ||
        referenceNucleotides === undefined
    ) {
        return {
            ok: false,

            reason:
                "reference_sequence_export_" +
                "failed_or_empty"
        };
    }


    if(segmentRows.length === 0) {
        return {
            ok: false,

            reason:
                "feature_location_has_no_segments"
        };
    }


    var segments =
        orderedFeatureSegments(
            segmentColumns,
            segmentRows
        );

    var ntSeq = "";


    for(
        var i = 0;
        i < segments.length;
        i++
    ) {
        var refStart =
            Number(
                segments[i].refStart
            );

        var refEnd =
            Number(
                segments[i].refEnd
            );


        if(
            isNaN(refStart) ||
            isNaN(refEnd) ||
            refStart < 1 ||
            refEnd < refStart ||
            refEnd >
                referenceNucleotides.length
        ) {
            return {
                ok: false,

                reason:
                    "invalid_feature_segment_" +
                    refStart +
                    "_" +
                    refEnd
            };
        }


        // GLUE coordinates are 1-based and inclusive.
        // JavaScript substring uses a 0-based inclusive start
        // and an exclusive end.

        ntSeq +=
            referenceNucleotides.substring(
                refStart - 1,
                refEnd
            );
    }


    return {
        ok: true,

        ntSeq: ntSeq,
        ntLength: ntSeq.length,

        hasAmbiguity:
            /[^ACGT]/.test(ntSeq)
    };
}


// -----------------------------------------------------------------------------
// Representative LTR selection
// -----------------------------------------------------------------------------

function chooseRepresentativeLtr(
    fivePrimeLtr,
    threePrimeLtr
) {
    if(
        fivePrimeLtr === null &&
        threePrimeLtr === null
    ) {
        return null;
    }


    if(fivePrimeLtr === null) {
        return {
            selected: threePrimeLtr,
            reason: "only_3ltr_available"
        };
    }


    if(threePrimeLtr === null) {
        return {
            selected: fivePrimeLtr,
            reason: "only_5ltr_available"
        };
    }


    if(
        threePrimeLtr.ntLength >=
        fivePrimeLtr.ntLength +
        LTR_LENGTH_ADVANTAGE_THRESHOLD
    ) {
        return {
            selected: threePrimeLtr,

            reason:
                "3ltr_at_least_" +
                LTR_LENGTH_ADVANTAGE_THRESHOLD +
                "nt_longer"
        };
    }


    return {
        selected: fivePrimeLtr,
        reason: "5ltr_preferred"
    };
}


// -----------------------------------------------------------------------------
// Main export
// -----------------------------------------------------------------------------

function main() {
    ensureOutputDir();


    var featuresWriter =
        openWriter(FEATURES_TSV);

    var featureLocationsWriter =
        openWriter(FEATURE_LOCATIONS_TSV);

    var codingNtWriter =
        openWriter(CODING_NT_FASTA);

    var codingAaWriter =
        openWriter(CODING_AA_FASTA);

    var noncodingNtWriter =
        openWriter(NONCODING_NT_FASTA);

    var representativeLtrNtWriter =
        openWriter(
            REPRESENTATIVE_LTR_NT_FASTA
        );

    var representativeLtrsWriter =
        openWriter(
            REPRESENTATIVE_LTRS_TSV
        );

    var skippedWriter =
        openWriter(SKIPPED_TSV);


    writeLine(
        featuresWriter,
        [
            "feature",
            "parent_feature",
            "description",
            "feature_type",
            "codes_amino_acids",
            "own_codon_numbering"
        ]
    );


    writeLine(
        featureLocationsWriter,
        [
            "record_id",
            "reference",
            "source_name",
            "sequence_id",
            "feature",
            "segment_index",
            "ref_start",
            "ref_end",
            "translation_modifier_name",
            "splice_index",
            "transcription_index",
            "nt_length",
            "aa_length",
            "codon_count",
            "has_translation",
            "has_stop",
            "has_internal_stop",
            "has_ambiguity",
            "missing_codon_nts",
            "missing_amino_acid",
            "exported_coding_fasta",
            "exported_noncoding_fasta"
        ]
    );


    writeLine(
        representativeLtrsWriter,
        [
            "reference",
            "source_name",
            "sequence_id",
            "selected_feature",
            "selected_length",
            "five_prime_length",
            "three_prime_length",
            "selection_reason"
        ]
    );


    writeLine(
        skippedWriter,
        [
            "reference",
            "source_name",
            "sequence_id",
            "feature",
            "reason"
        ]
    );


    var featuresByName =
        indexFeatures();

    var eligibleSequenceIndex =
        buildEligibleSequenceIndex();

    var refs =
        listReferences(
            eligibleSequenceIndex
        );


    var featureCount = 0;

    for(
        var featureNameForCount
        in featuresByName
    ) {
        if(
            featuresByName.hasOwnProperty(
                featureNameForCount
            )
        ) {
            featureCount++;
        }
    }


    glue.log(
        "INFO",
        "Indexed " +
        featureCount +
        " feature definition(s)"
    );

    glue.log(
        "INFO",
        "Required sequence_kind = " +
        (
            REQUIRED_SEQUENCE_KIND === null
            ? "<none>"
            : REQUIRED_SEQUENCE_KIND
        )
    );

    glue.log(
        "INFO",
        "Selected " +
        refs.length +
        " reference(s)"
    );


    var totalFeatureLocations = 0;
    var totalFeatureLocationSegments = 0;

    var totalCodingFeatureLocations = 0;
    var totalCodingExports = 0;
    var totalSkippedCodingExports = 0;

    var totalNoncodingFeatureLocations = 0;
    var totalNoncodingExports = 0;
    var totalSkippedNoncodingExports = 0;

    var totalRepresentativeLtrExports = 0;


    // Export global feature definitions.

    for(
        var featureNameOut
        in featuresByName
    ) {
        if(
            featuresByName.hasOwnProperty(
                featureNameOut
            )
        ) {
            var featureOut =
                featuresByName[
                    featureNameOut
                ];

            var isCodingOut =
                featureOut
                    .codes_amino_acids === true;


            writeLine(
                featuresWriter,
                [
                    featureOut.name,

                    featureOut[
                        "parent.name"
                    ],

                    featureOut.description,

                    isCodingOut
                    ? "coding"
                    : "noncoding",

                    isCodingOut,

                    featureOut
                        .own_codon_numbering ===
                        true
                ]
            );
        }
    }


    // Export feature locations for each reference.

    for(
        var r = 0;
        r < refs.length;
        r++
    ) {
        var ref = refs[r];

        var referenceName =
            ref.name;

        var sourceName =
            ref[
                "sequence.source.name"
            ];

        var sequenceID =
            ref[
                "sequence.sequenceID"
            ];


        var featureLocations =
            listReferenceFeatureLocations(
                referenceName
            );


        // Export and cache the complete linked reference sequence once.

        var referenceNucleotides =
            getReferenceNucleotides(
                sourceName,
                sequenceID
            );


        var fivePrimeLtr = null;
        var threePrimeLtr = null;


        for(
            var f = 0;
            f < featureLocations.length;
            f++
        ) {
            var loc =
                featureLocations[f];

            var featureName =
                loc._featureName;

            totalFeatureLocations++;


            var feature =
                featuresByName[
                    featureName
                ] ||
                {
                    name: featureName,
                    "parent.name": null,
                    description: null,
                    codes_amino_acids: false,
                    own_codon_numbering: false
                };


            var isCoding =
                feature
                    .codes_amino_acids ===
                    true;


            var recordID =
                referenceName +
                "|" +
                featureName;


            var ntLength = "";
            var aaLength = "";
            var codonCount = "";

            var hasTranslation = false;
            var hasStop = "";
            var hasInternalStop = "";
            var hasAmbiguity = "";

            var missingCodonNts = "";
            var missingAminoAcid = "";

            var exportedCodingFasta = false;
            var exportedNoncodingFasta = false;


            // Segments are used both for metadata and for reconstructing
            // non-coding feature sequences.

            var segments =
                listFeatureLocationSegments(
                    referenceName,
                    featureName
                );

            var segmentColumns =
                segments.columns;

            var segmentRows =
                segments.rows;


            // -------------------------------------------------------------
            // Coding feature sequence export
            // -------------------------------------------------------------

            if(
                isCoding &&
                includeCodingFeature(
                    featureName
                )
            ) {
                totalCodingFeatureLocations++;

                var codingExport =
                    exportCodingFeature(
                        referenceName,
                        featureName
                    );


                if(codingExport.ok) {
                    ntLength =
                        codingExport.ntLength;

                    aaLength =
                        codingExport.aaLength;

                    codonCount =
                        codingExport.codonCount;

                    hasTranslation = true;

                    hasStop =
                        codingExport.hasStop;

                    hasInternalStop =
                        codingExport
                            .hasInternalStop;

                    hasAmbiguity =
                        codingExport
                            .hasAmbiguity;

                    missingCodonNts =
                        codingExport
                            .missingCodonNts;

                    missingAminoAcid =
                        codingExport
                            .missingAminoAcid;


                    if(
                        codingExport.skipFasta
                    ) {
                        writeLine(
                            skippedWriter,
                            [
                                referenceName,
                                sourceName,
                                sequenceID,
                                featureName,
                                codingExport
                                    .skipReason
                            ]
                        );

                        totalSkippedCodingExports++;
                    } else {
                        if(!DRY_RUN) {
                            writeFastaRecord(
                                codingNtWriter,
                                recordID,
                                codingExport.ntSeq
                            );

                            writeFastaRecord(
                                codingAaWriter,
                                recordID,
                                codingExport.aaSeq
                            );
                        }

                        exportedCodingFasta = true;
                        totalCodingExports++;
                    }
                } else {
                    writeLine(
                        skippedWriter,
                        [
                            referenceName,
                            sourceName,
                            sequenceID,
                            featureName,
                            codingExport.reason
                        ]
                    );

                    totalSkippedCodingExports++;
                }
            }


            // -------------------------------------------------------------
            // Non-coding feature sequence export
            // -------------------------------------------------------------

            if(
                !isCoding &&
                includeNoncodingFastaFeature(
                    featureName
                )
            ) {
                totalNoncodingFeatureLocations++;

                var noncodingExport =
                    extractFeatureNucleotides(
                        referenceNucleotides,
                        segmentColumns,
                        segmentRows
                    );


                if(noncodingExport.ok) {
                    ntLength =
                        noncodingExport.ntLength;

                    hasAmbiguity =
                        noncodingExport
                            .hasAmbiguity;


                    // Keep complete LTRs for representative-LTR selection.

                    var ltrRecord = {
                        featureName:
                            featureName,

                        ntSeq:
                            noncodingExport
                                .ntSeq,

                        ntLength:
                            noncodingExport
                                .ntLength
                    };


                    if(
                        featureName === "5LTR"
                    ) {
                        fivePrimeLtr =
                            ltrRecord;
                    } else if(
                        featureName === "3LTR"
                    ) {
                        threePrimeLtr =
                            ltrRecord;
                    }


                    if(
                        noncodingExport.ntLength <
                        MIN_NONCODING_LENGTH
                    ) {
                        writeLine(
                            skippedWriter,
                            [
                                referenceName,
                                sourceName,
                                sequenceID,
                                featureName,

                                "noncoding_feature_" +
                                "shorter_than_" +
                                MIN_NONCODING_LENGTH +
                                "nt"
                            ]
                        );

                        totalSkippedNoncodingExports++;
                    } else {
                        if(!DRY_RUN) {
                            writeFastaRecord(
                                noncodingNtWriter,
                                recordID,
                                noncodingExport
                                    .ntSeq
                            );
                        }

                        exportedNoncodingFasta =
                            true;

                        totalNoncodingExports++;
                    }
                } else {
                    writeLine(
                        skippedWriter,
                        [
                            referenceName,
                            sourceName,
                            sequenceID,
                            featureName,
                            noncodingExport.reason
                        ]
                    );

                    totalSkippedNoncodingExports++;
                }
            }


            // -------------------------------------------------------------
            // Feature-location segment metadata
            // -------------------------------------------------------------

            if(segmentRows.length === 0) {
                writeLine(
                    featureLocationsWriter,
                    [
                        recordID,
                        referenceName,
                        sourceName,
                        sequenceID,
                        featureName,
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        ntLength,
                        aaLength,
                        codonCount,
                        hasTranslation,
                        hasStop,
                        hasInternalStop,
                        hasAmbiguity,
                        missingCodonNts,
                        missingAminoAcid,
                        exportedCodingFasta,
                        exportedNoncodingFasta
                    ]
                );
            } else {
                for(
                    var s = 0;
                    s < segmentRows.length;
                    s++
                ) {
                    var segment =
                        rowToObject(
                            segmentColumns,
                            segmentRows[s]
                        );

                    totalFeatureLocationSegments++;


                    writeLine(
                        featureLocationsWriter,
                        [
                            recordID,
                            referenceName,
                            sourceName,
                            sequenceID,
                            featureName,
                            s + 1,
                            segment.refStart,
                            segment.refEnd,

                            segment
                                .translationModifierName,

                            segment.spliceIndex,

                            segment
                                .transcriptionIndex,

                            ntLength,
                            aaLength,
                            codonCount,
                            hasTranslation,
                            hasStop,
                            hasInternalStop,
                            hasAmbiguity,
                            missingCodonNts,
                            missingAminoAcid,
                            exportedCodingFasta,
                            exportedNoncodingFasta
                        ]
                    );
                }
            }
        }


        // -----------------------------------------------------------------
        // Representative LTR
        // -----------------------------------------------------------------

        var representativeLtr =
            chooseRepresentativeLtr(
                fivePrimeLtr,
                threePrimeLtr
            );


        if(representativeLtr !== null) {
            var selectedLtr =
                representativeLtr.selected;


            var representativeRecordID =
                referenceName +
                "|representative_ltr|" +
                selectedLtr.featureName;


            if(!DRY_RUN) {
                writeFastaRecord(
                    representativeLtrNtWriter,
                    representativeRecordID,
                    selectedLtr.ntSeq
                );
            }


            writeLine(
                representativeLtrsWriter,
                [
                    referenceName,
                    sourceName,
                    sequenceID,

                    selectedLtr.featureName,
                    selectedLtr.ntLength,

                    fivePrimeLtr === null
                    ? ""
                    : fivePrimeLtr.ntLength,

                    threePrimeLtr === null
                    ? ""
                    : threePrimeLtr.ntLength,

                    representativeLtr.reason
                ]
            );


            totalRepresentativeLtrExports++;
        }
    }


    // Close outputs.

    featuresWriter.close();
    featureLocationsWriter.close();

    codingNtWriter.close();
    codingAaWriter.close();

    noncodingNtWriter.close();

    representativeLtrNtWriter.close();
    representativeLtrsWriter.close();

    skippedWriter.close();


    // Export summary.

    glue.log(
        "INFO",
        "Observed " +
        totalFeatureLocations +
        " reference feature-location(s)"
    );

    glue.log(
        "INFO",
        "Observed " +
        totalFeatureLocationSegments +
        " reference feature-location segment(s)"
    );

    glue.log(
        "INFO",
        "Observed " +
        totalCodingFeatureLocations +
        " coding reference feature-location(s)"
    );

    glue.log(
        "INFO",
        "Exported " +
        totalCodingExports +
        " coding FASTA record pair(s)"
    );

    glue.log(
        "INFO",
        "Skipped " +
        totalSkippedCodingExports +
        " coding feature export(s)"
    );

    glue.log(
        "INFO",
        "Observed " +
        totalNoncodingFeatureLocations +
        " non-coding reference feature-location(s) " +
        "eligible for sequence extraction"
    );

    glue.log(
        "INFO",
        "Exported " +
        totalNoncodingExports +
        " non-coding FASTA record(s)"
    );

    glue.log(
        "INFO",
        "Skipped " +
        totalSkippedNoncodingExports +
        " non-coding feature export(s)"
    );

    glue.log(
        "INFO",
        "Exported " +
        totalRepresentativeLtrExports +
        " representative LTR FASTA record(s)"
    );


    glue.log(
        "INFO",
        "Wrote " + FEATURES_TSV
    );

    glue.log(
        "INFO",
        "Wrote " +
        FEATURE_LOCATIONS_TSV
    );

    glue.log(
        "INFO",
        "Wrote " + CODING_NT_FASTA
    );

    glue.log(
        "INFO",
        "Wrote " + CODING_AA_FASTA
    );

    glue.log(
        "INFO",
        "Wrote " + NONCODING_NT_FASTA
    );

    glue.log(
        "INFO",
        "Wrote " +
        REPRESENTATIVE_LTR_NT_FASTA
    );

    glue.log(
        "INFO",
        "Wrote " +
        REPRESENTATIVE_LTRS_TSV
    );

    glue.log(
        "INFO",
        "Wrote " + SKIPPED_TSV
    );
}


main();