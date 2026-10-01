// glue/export/prepareReferenceFeatureAlignments.js
//
// Export one alignment-like FASTA file for each GLUE reference sequence.
// The first row is the complete reference genome. Each subsequent row shows
// one feature in its genomic position, padded with '-' outside its segments.
//
// Written for GLUE's ECMAScript 5.1 / Nashorn JavaScript layer.

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

var OUTPUT_DIR = "reference-feature-alignments";
var OUTPUT_SUFFIX = "-features.fasta";
var FASTA_LINE_WIDTH = 80;

// Set to null to export every reference. The default follows the reference
// naming convention used in ERVdb.
var REFERENCE_WHERE_CLAUSE = "name like 'REF_%'";

// Optional sequence_kind filter. For example:
// var REQUIRED_SEQUENCE_KIND = "erv_ref";
var REQUIRED_SEQUENCE_KIND = null;

// The complete sequence is always emitted first under this display label.
// The whole_genome feature-location itself is therefore not emitted again.
var GENOME_DISPLAY_NAME = "genome";
var WHOLE_GENOME_FEATURE = "whole_genome";

var File = Java.type("java.io.File");
var FileWriter = Java.type("java.io.FileWriter");
var BufferedWriter = Java.type("java.io.BufferedWriter");

function listResultRows(result) {
    if(result === null ||
            result === undefined ||
            result.listResult === undefined) {
        return [];
    }

    return result.listResult.row || [];
}

function listResultColumns(result) {
    if(result === null ||
            result === undefined ||
            result.listResult === undefined) {
        return [];
    }

    return result.listResult.column || [];
}

function rowToObject(columns, row) {
    var object = {};
    var values = row.value || [];

    for(var i = 0; i < columns.length; i++) {
        object[columns[i]] = values[i];
    }

    return object;
}

function cayenneStringLiteral(value) {
    return "'" + String(value).replace(/'/g, "\\'") + "'";
}

function ensureOutputDirectory() {
    var directory = new File(OUTPUT_DIR);

    if(!directory.exists() && !directory.mkdirs()) {
        throw new Error(
            "Unable to create output directory: " + OUTPUT_DIR
        );
    }

    if(!directory.isDirectory()) {
        throw new Error(
            "Output path is not a directory: " + OUTPUT_DIR
        );
    }
}

function safeFilename(value) {
    return String(value).replace(
        /[^A-Za-z0-9._-]/g,
        "_"
    );
}

function repeatCharacter(character, count) {
    if(count <= 0) {
        return "";
    }

    return new Array(count + 1).join(character);
}

function fastaWrap(sequence) {
    var lines = [];

    for(var i = 0;
            i < sequence.length;
            i += FASTA_LINE_WIDTH) {
        lines.push(
            sequence.substring(
                i,
                i + FASTA_LINE_WIDTH
            )
        );
    }

    return lines.join("\n");
}

function writeFastaRecord(writer, header, sequence) {
    writer.write(">" + header);
    writer.newLine();

    writer.write(fastaWrap(sequence));
    writer.newLine();
}

function getReferenceSequenceInfo(referenceName) {
    var info = {
        sourceName: null,
        sequenceID: null
    };

    try {
        glue.inMode(
            "/reference/" + referenceName,
            function() {
                var result = glue.command([
                    "show",
                    "sequence"
                ]);

                if(result.showSequenceResult !== undefined) {
                    info.sourceName =
                        result.showSequenceResult[
                            "sequence.source.name"
                        ];

                    info.sequenceID =
                        result.showSequenceResult[
                            "sequence.sequenceID"
                        ];
                }
            }
        );
    } catch(e) {
        return info;
    }

    return info;
}

function listReferences() {
    var command = [
        "list",
        "reference"
    ];

    if(REFERENCE_WHERE_CLAUSE !== null) {
        command.push("-w");
        command.push(REFERENCE_WHERE_CLAUSE);
    }

    var result = glue.command(command);
    var columns = listResultColumns(result);
    var rows = listResultRows(result);
    var references = [];

    for(var i = 0; i < rows.length; i++) {
        var reference = rowToObject(
            columns,
            rows[i]
        );

        if(reference.name === null ||
                reference.name === undefined) {
            continue;
        }

        var sequenceInfo =
            getReferenceSequenceInfo(
                reference.name
            );

        reference.sourceName =
            sequenceInfo.sourceName;

        reference.sequenceID =
            sequenceInfo.sequenceID;

        references.push(reference);
    }

    references.sort(function(a, b) {
        return String(a.name).localeCompare(
            String(b.name)
        );
    });

    return references;
}

function sequenceHasRequiredKind(
        sourceName,
        sequenceID) {

    if(REQUIRED_SEQUENCE_KIND === null) {
        return true;
    }

    var whereClause =
        "source.name = " +
        cayenneStringLiteral(sourceName) +
        " and sequenceID = " +
        cayenneStringLiteral(sequenceID) +
        " and sequence_kind = " +
        cayenneStringLiteral(
            REQUIRED_SEQUENCE_KIND
        );

    var result = glue.command([
        "list",
        "sequence",
        "sequenceID",
        "-w",
        whereClause
    ]);

    return listResultRows(result).length > 0;
}

function getReferenceNucleotides(
        sourceName,
        sequenceID) {

    var whereClause =
        "source.name = " +
        cayenneStringLiteral(sourceName) +
        " and sequenceID = " +
        cayenneStringLiteral(sequenceID);

    var result = null;

    glue.inMode(
        "module/fastaExporter",
        function() {
            result = glue.command([
                "export",
                "-w",
                whereClause,
                "-p"
            ]);
        }
    );

    if(result === null ||
            result.nucleotideFasta === undefined ||
            result.nucleotideFasta.sequences === undefined) {
        return null;
    }

    var sequences =
        result.nucleotideFasta.sequences || [];

    for(var i = 0; i < sequences.length; i++) {
        if(sequences[i].sequence !== null &&
                sequences[i].sequence !== undefined) {
            return String(
                sequences[i].sequence
            )
                .replace(/\s/g, "")
                .toUpperCase();
        }
    }

    return null;
}

function listReferenceFeatureNames(referenceName) {
    var result = null;

    glue.inMode(
        "/reference/" + referenceName,
        function() {
            result = glue.command([
                "list",
                "feature-location"
            ]);
        }
    );

    var columns = listResultColumns(result);
    var rows = listResultRows(result);
    var featureNames = [];

    for(var i = 0; i < rows.length; i++) {
        var object = rowToObject(
            columns,
            rows[i]
        );

        var featureName =
            object["feature.name"] ||
            object.feature ||
            object.name;

        if(featureName !== null &&
                featureName !== undefined &&
                featureName !==
                    WHOLE_GENOME_FEATURE) {
            featureNames.push(
                String(featureName)
            );
        }
    }

    return featureNames;
}

function listFeatureSegments(
        referenceName,
        featureName) {

    var result = null;

    glue.inMode(
        "/reference/" + referenceName +
        "/feature-location/" + featureName,
        function() {
            result = glue.command([
                "list",
                "segment"
            ]);
        }
    );

    var columns = listResultColumns(result);
    var rows = listResultRows(result);
    var segments = [];

    for(var i = 0; i < rows.length; i++) {
        var object = rowToObject(
            columns,
            rows[i]
        );

        segments.push({
            refStart: Number(object.refStart),
            refEnd: Number(object.refEnd)
        });
    }

    return segments;
}

function validateAndMergeSegments(
        referenceName,
        featureName,
        segments,
        genomeLength) {

    if(segments.length === 0) {
        throw new Error(
            referenceName +
            " / " +
            featureName +
            " has no segments"
        );
    }

    segments.sort(function(a, b) {
        if(a.refStart !== b.refStart) {
            return a.refStart - b.refStart;
        }

        return a.refEnd - b.refEnd;
    });

    var merged = [];

    for(var i = 0; i < segments.length; i++) {
        var segment = segments[i];

        if(isNaN(segment.refStart) ||
                isNaN(segment.refEnd) ||
                segment.refStart < 1 ||
                segment.refEnd < segment.refStart ||
                segment.refEnd > genomeLength) {
            throw new Error(
                referenceName +
                " / " +
                featureName +
                " has invalid segment " +
                segment.refStart +
                ".." +
                segment.refEnd +
                " for genome length " +
                genomeLength
            );
        }

        if(merged.length === 0 ||
                segment.refStart >
                merged[
                    merged.length - 1
                ].refEnd + 1) {
            merged.push({
                refStart: segment.refStart,
                refEnd: segment.refEnd
            });
        } else if(
                segment.refEnd >
                merged[
                    merged.length - 1
                ].refEnd) {
            merged[
                merged.length - 1
            ].refEnd = segment.refEnd;
        }
    }

    return merged;
}

function loadFeatureLocations(
        referenceName,
        genomeLength) {

    var featureNames =
        listReferenceFeatureNames(
            referenceName
        );

    var locations = [];

    for(var i = 0;
            i < featureNames.length;
            i++) {
        var featureName =
            featureNames[i];

        var segments =
            validateAndMergeSegments(
                referenceName,
                featureName,
                listFeatureSegments(
                    referenceName,
                    featureName
                ),
                genomeLength
            );

        locations.push({
            featureName: featureName,
            segments: segments,
            firstStart:
                segments[0].refStart,
            lastEnd:
                segments[
                    segments.length - 1
                ].refEnd
        });
    }

    // Move progressively from the left end
    // of the genome to the right.
    //
    // If two features start together, show
    // the encompassing feature first,
    // followed by its more specific regions.
    locations.sort(function(a, b) {
        if(a.firstStart !== b.firstStart) {
            return (
                a.firstStart -
                b.firstStart
            );
        }

        if(a.lastEnd !== b.lastEnd) {
            return (
                b.lastEnd -
                a.lastEnd
            );
        }

        return a.featureName.localeCompare(
            b.featureName
        );
    });

    return locations;
}

function renderFeatureRow(
        referenceNucleotides,
        segments) {

    var parts = [];
    var nextPosition = 1;

    for(var i = 0; i < segments.length; i++) {
        var segment = segments[i];

        parts.push(
            repeatCharacter(
                "-",
                segment.refStart -
                nextPosition
            )
        );

        parts.push(
            referenceNucleotides.substring(
                segment.refStart - 1,
                segment.refEnd
            )
        );

        nextPosition =
            segment.refEnd + 1;
    }

    parts.push(
        repeatCharacter(
            "-",
            referenceNucleotides.length -
            nextPosition + 1
        )
    );

    return parts.join("");
}

function exportReference(reference) {
    var referenceName =
        reference.name;

    var sourceName =
        reference.sourceName;

    var sequenceID =
        reference.sequenceID;

    if(sourceName === null ||
            sourceName === undefined ||
            sequenceID === null ||
            sequenceID === undefined) {
        throw new Error(
            "Unable to resolve linked sequence for " +
            referenceName
        );
    }

    if(!sequenceHasRequiredKind(
            sourceName,
            sequenceID)) {
        return {
            exported: false,
            reason:
                "sequence_kind does not match"
        };
    }

    var referenceNucleotides =
        getReferenceNucleotides(
            sourceName,
            sequenceID
        );

    if(referenceNucleotides === null ||
            referenceNucleotides.length === 0) {
        throw new Error(
            "Unable to export linked nucleotide " +
            "sequence for " +
            referenceName +
            " (" +
            sourceName +
            "/" +
            sequenceID +
            ")"
        );
    }

    var locations =
        loadFeatureLocations(
            referenceName,
            referenceNucleotides.length
        );

    var outputPath =
        OUTPUT_DIR +
        "/" +
        safeFilename(sequenceID) +
        OUTPUT_SUFFIX;

    var writer =
        new BufferedWriter(
            new FileWriter(outputPath)
        );

    try {
        writeFastaRecord(
            writer,
            sequenceID +
            "|" +
            GENOME_DISPLAY_NAME,
            referenceNucleotides
        );

        for(var i = 0;
                i < locations.length;
                i++) {
            var location =
                locations[i];

            var featureRow =
                renderFeatureRow(
                    referenceNucleotides,
                    location.segments
                );

            writeFastaRecord(
                writer,
                sequenceID +
                "|" +
                location.featureName,
                featureRow
            );
        }
    } finally {
        writer.close();
    }

    return {
        exported: true,
        outputPath: outputPath,
        featureCount: locations.length,
        genomeLength:
            referenceNucleotides.length
    };
}

function main() {
    ensureOutputDirectory();

    var references = listReferences();

    var exportedCount = 0;
    var filteredCount = 0;
    var failedCount = 0;

    glue.log(
        "INFO",
        "Selected " +
        references.length +
        " reference(s)"
    );

    for(var i = 0;
            i < references.length;
            i++) {
        var reference =
            references[i];

        try {
            var result =
                exportReference(
                    reference
                );

            if(result.exported) {
                exportedCount++;

                glue.log(
                    "INFO",
                    "Exported " +
                    reference.name +
                    " to " +
                    result.outputPath +
                    " (" +
                    result.genomeLength +
                    " nt; " +
                    result.featureCount +
                    " feature row(s))"
                );
            } else {
                filteredCount++;

                glue.log(
                    "FINE",
                    "Skipped " +
                    reference.name +
                    ": " +
                    result.reason
                );
            }
        } catch(e) {
            failedCount++;

            glue.log(
                "WARNING",
                "Failed to export " +
                reference.name +
                ": " +
                e
            );
        }
    }

    glue.log(
        "INFO",
        "Exported " +
        exportedCount +
        " reference feature-alignment " +
        "FASTA file(s)"
    );

    glue.log(
        "INFO",
        "Filtered " +
        filteredCount +
        " reference(s)"
    );

    glue.log(
        "INFO",
        "Failed " +
        failedCount +
        " reference export(s)"
    );

    if(failedCount > 0) {
        throw new Error(
            "Reference feature-alignment " +
            "export completed with " +
            failedCount +
            " error(s); see preceding " +
            "WARNING messages"
        );
    }
}

main();