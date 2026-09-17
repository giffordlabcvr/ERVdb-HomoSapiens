// glue/export/prepareSingleLtrSublineageReferences.js
//
// Construct synthetic full-length reference sequences for ERV sublineages
// having exactly one associated LTR lineage:
//
//     5' LTR + Repbase internal sequence + 3' LTR
//
// The same LTR reference sequence is used at both ends. The script only writes
// FASTA and TSV files; it does not change the GLUE database.
//
// Written for GLUE's ECMAScript 5.1 / Nashorn JavaScript layer.

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

var OUTPUT_DIR = "sublineage-full-length-single-ltr";
var INDIVIDUAL_FASTA_DIR = OUTPUT_DIR + "/fasta";

var COMBINED_FASTA =
    OUTPUT_DIR +
    "/sublineage-full-length-single-ltr.fasta";

var MANIFEST_TSV =
    OUTPUT_DIR +
    "/sublineage-full-length-single-ltr.tsv";

var SKIPPED_TSV =
    OUTPUT_DIR +
    "/sublineage-full-length-single-ltr-skipped.tsv";

var INTERNAL_SOURCE_NAME = "erv-sub";
var LTR_SOURCE_NAME = "ltr-sub";

var FASTA_LINE_WIDTH = 80;

// Guard against silently changing the intended set if the association table
// changes. Set to null to disable this check.
var EXPECTED_SINGLE_ASSOCIATION_COUNT = 18;

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
    return "'" +
        String(value).replace(/'/g, "\\'") +
        "'";
}

function ensureDirectory(path) {
    var directory = new File(path);

    if(!directory.exists() &&
            !directory.mkdirs()) {
        throw new Error(
            "Unable to create directory: " +
            path
        );
    }

    if(!directory.isDirectory()) {
        throw new Error(
            "Path is not a directory: " +
            path
        );
    }
}

function openWriter(path) {
    return new BufferedWriter(
        new FileWriter(path)
    );
}

function safeFilename(value) {
    return String(value).replace(
        /[^A-Za-z0-9._-]/g,
        "_"
    );
}

function tsvEscape(value) {
    if(value === null ||
            value === undefined) {
        return "";
    }

    return String(value)
        .replace(/\t/g, " ")
        .replace(/\r?\n/g, " ");
}

function writeTsvLine(writer, fields) {
    var escaped = [];

    for(var i = 0; i < fields.length; i++) {
        escaped.push(
            tsvEscape(fields[i])
        );
    }

    writer.write(
        escaped.join("\t")
    );

    writer.newLine();
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

function writeFastaRecord(
        writer,
        header,
        sequence) {

    writer.write(">" + header);
    writer.newLine();

    writer.write(
        fastaWrap(sequence)
    );

    writer.newLine();
}

function listSublineageLtrAssociations() {
    var result = glue.command([
        "list",
        "custom-table-row",
        "erv_lineage_ltr_assoc",
        "erv_lineage.id",
        "ltr_lineage.id",
        "-w",
        "erv_lineage.entity_level = 'sublineage'"
    ]);

    var columns =
        listResultColumns(result);

    var rows =
        listResultRows(result);

    var associationsBySublineage = {};

    for(var i = 0; i < rows.length; i++) {
        var object = rowToObject(
            columns,
            rows[i]
        );

        var sublineageID =
            object["erv_lineage.id"];

        var ltrLineageID =
            object["ltr_lineage.id"];

        if(sublineageID === null ||
                sublineageID === undefined ||
                ltrLineageID === null ||
                ltrLineageID === undefined) {
            continue;
        }

        sublineageID =
            String(sublineageID);

        ltrLineageID =
            String(ltrLineageID);

        if(associationsBySublineage[
                sublineageID
            ] === undefined) {
            associationsBySublineage[
                sublineageID
            ] = [];
        }

        associationsBySublineage[
            sublineageID
        ].push(ltrLineageID);
    }

    return associationsBySublineage;
}

function singleAssociationRows(
        associationsBySublineage) {

    var rows = [];

    for(var sublineageID
            in associationsBySublineage) {

        if(!associationsBySublineage
                .hasOwnProperty(sublineageID)) {
            continue;
        }

        var ltrLineages =
            associationsBySublineage[
                sublineageID
            ];

        if(ltrLineages.length === 1) {
            rows.push({
                sublineageID:
                    sublineageID,

                ltrLineageID:
                    ltrLineages[0]
            });
        }
    }

    rows.sort(function(a, b) {
        return a.sublineageID.localeCompare(
            b.sublineageID
        );
    });

    return rows;
}

function listSequenceLinks(
        sourceName,
        linkField) {

    var result = glue.command([
        "list",
        "sequence",
        "source.name",
        "sequenceID",
        linkField,
        "-w",
        "source.name = " +
            cayenneStringLiteral(sourceName)
    ]);

    var columns =
        listResultColumns(result);

    var rows =
        listResultRows(result);

    var index = {};

    for(var i = 0; i < rows.length; i++) {
        var object = rowToObject(
            columns,
            rows[i]
        );

        var linkedID =
            object[linkField];

        if(linkedID === null ||
                linkedID === undefined) {
            continue;
        }

        linkedID = String(linkedID);

        if(index[linkedID] === undefined) {
            index[linkedID] = [];
        }

        index[linkedID].push({
            sourceName:
                String(
                    object["source.name"]
                ),

            sequenceID:
                String(
                    object.sequenceID
                )
        });
    }

    return index;
}

function exportNucleotides(
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
            result.nucleotideFasta
                .sequences === undefined) {
        return null;
    }

    var sequences =
        result.nucleotideFasta.sequences || [];

    if(sequences.length !== 1 ||
            sequences[0].sequence === null ||
            sequences[0].sequence === undefined) {
        return null;
    }

    return String(
        sequences[0].sequence
    )
        .replace(/\s/g, "")
        .toUpperCase();
}

function resolveExactlyOne(
        index,
        linkedID,
        componentLabel) {

    var matches =
        index[linkedID] || [];

    if(matches.length === 0) {
        return {
            ok: false,
            reason:
                "no_" +
                componentLabel +
                "_sequence"
        };
    }

    if(matches.length > 1) {
        return {
            ok: false,
            reason:
                "multiple_" +
                componentLabel +
                "_sequences_" +
                matches.length
        };
    }

    return {
        ok: true,
        sequenceRecord: matches[0]
    };
}

function writeIndividualFasta(
        sequenceID,
        sequence) {

    var outputPath =
        INDIVIDUAL_FASTA_DIR +
        "/" +
        safeFilename(sequenceID) +
        ".fna";

    var writer =
        openWriter(outputPath);

    try {
        writeFastaRecord(
            writer,
            sequenceID,
            sequence
        );
    } finally {
        writer.close();
    }

    return outputPath;
}

function main() {
    ensureDirectory(OUTPUT_DIR);
    ensureDirectory(
        INDIVIDUAL_FASTA_DIR
    );

    var associationsBySublineage =
        listSublineageLtrAssociations();

    var selected =
        singleAssociationRows(
            associationsBySublineage
        );

    glue.log(
        "INFO",
        "Selected " +
        selected.length +
        " sublineage(s) having exactly " +
        "one associated LTR lineage"
    );

    if(EXPECTED_SINGLE_ASSOCIATION_COUNT !== null &&
            selected.length !==
                EXPECTED_SINGLE_ASSOCIATION_COUNT) {
        throw new Error(
            "Expected " +
            EXPECTED_SINGLE_ASSOCIATION_COUNT +
            " single-LTR sublineages but found " +
            selected.length +
            "; review the association table or update " +
            "EXPECTED_SINGLE_ASSOCIATION_COUNT"
        );
    }

    var internalSequenceIndex =
        listSequenceLinks(
            INTERNAL_SOURCE_NAME,
            "erv_lineage.id"
        );

    var ltrSequenceIndex =
        listSequenceLinks(
            LTR_SOURCE_NAME,
            "ltr_lineage.id"
        );

    var combinedWriter =
        openWriter(COMBINED_FASTA);

    var manifestWriter =
        openWriter(MANIFEST_TSV);

    var skippedWriter =
        openWriter(SKIPPED_TSV);

    var exportedCount = 0;
    var skippedCount = 0;

    writeTsvLine(
        manifestWriter,
        [
            "sublineage_id",
            "internal_source",
            "internal_sequence_id",
            "internal_length",
            "ltr_lineage_id",
            "ltr_source",
            "ltr_sequence_id",
            "ltr_length",
            "reconstructed_length",
            "whole_genome_start",
            "whole_genome_end",
            "five_ltr_start",
            "five_ltr_end",
            "internal_region_start",
            "internal_region_end",
            "three_ltr_start",
            "three_ltr_end",
            "individual_fasta"
        ]
    );

    writeTsvLine(
        skippedWriter,
        [
            "sublineage_id",
            "ltr_lineage_id",
            "reason"
        ]
    );

    try {
        for(var i = 0;
                i < selected.length;
                i++) {

            var selectedRow =
                selected[i];

            var sublineageID =
                selectedRow.sublineageID;

            var ltrLineageID =
                selectedRow.ltrLineageID;

            var internalResolution =
                resolveExactlyOne(
                    internalSequenceIndex,
                    sublineageID,
                    "internal"
                );

            if(!internalResolution.ok) {
                writeTsvLine(
                    skippedWriter,
                    [
                        sublineageID,
                        ltrLineageID,
                        internalResolution.reason
                    ]
                );

                skippedCount++;
                continue;
            }

            var ltrResolution =
                resolveExactlyOne(
                    ltrSequenceIndex,
                    ltrLineageID,
                    "ltr"
                );

            if(!ltrResolution.ok) {
                writeTsvLine(
                    skippedWriter,
                    [
                        sublineageID,
                        ltrLineageID,
                        ltrResolution.reason
                    ]
                );

                skippedCount++;
                continue;
            }

            var internalRecord =
                internalResolution.sequenceRecord;

            var ltrRecord =
                ltrResolution.sequenceRecord;

            var internalSequence =
                exportNucleotides(
                    internalRecord.sourceName,
                    internalRecord.sequenceID
                );

            var ltrSequence =
                exportNucleotides(
                    ltrRecord.sourceName,
                    ltrRecord.sequenceID
                );

            if(internalSequence === null ||
                    internalSequence.length === 0) {
                writeTsvLine(
                    skippedWriter,
                    [
                        sublineageID,
                        ltrLineageID,
                        "internal_sequence_export_failed_or_empty"
                    ]
                );

                skippedCount++;
                continue;
            }

            if(ltrSequence === null ||
                    ltrSequence.length === 0) {
                writeTsvLine(
                    skippedWriter,
                    [
                        sublineageID,
                        ltrLineageID,
                        "ltr_sequence_export_failed_or_empty"
                    ]
                );

                skippedCount++;
                continue;
            }

            var fullSequence =
                ltrSequence +
                internalSequence +
                ltrSequence;

            var ltrLength =
                ltrSequence.length;

            var internalLength =
                internalSequence.length;

            var fullLength =
                fullSequence.length;

            var fiveLtrStart = 1;
            var fiveLtrEnd = ltrLength;

            var internalStart =
                ltrLength + 1;

            var internalEnd =
                ltrLength +
                internalLength;

            var threeLtrStart =
                internalEnd + 1;

            var threeLtrEnd =
                fullLength;

            var individualPath =
                writeIndividualFasta(
                    internalRecord.sequenceID,
                    fullSequence
                );

            writeFastaRecord(
                combinedWriter,
                internalRecord.sequenceID,
                fullSequence
            );

            writeTsvLine(
                manifestWriter,
                [
                    sublineageID,
                    internalRecord.sourceName,
                    internalRecord.sequenceID,
                    internalLength,
                    ltrLineageID,
                    ltrRecord.sourceName,
                    ltrRecord.sequenceID,
                    ltrLength,
                    fullLength,
                    1,
                    fullLength,
                    fiveLtrStart,
                    fiveLtrEnd,
                    internalStart,
                    internalEnd,
                    threeLtrStart,
                    threeLtrEnd,
                    individualPath
                ]
            );

            exportedCount++;

            glue.log(
                "INFO",
                "Constructed " +
                sublineageID +
                " using " +
                ltrLineageID +
                " (" +
                ltrLength +
                " + " +
                internalLength +
                " + " +
                ltrLength +
                " = " +
                fullLength +
                " nt)"
            );
        }
    } finally {
        combinedWriter.close();
        manifestWriter.close();
        skippedWriter.close();
    }

    glue.log(
        "INFO",
        "Exported " +
        exportedCount +
        " reconstructed full-length " +
        "sublineage reference(s)"
    );

    glue.log(
        "INFO",
        "Skipped " +
        skippedCount +
        " sublineage(s)"
    );

    glue.log(
        "INFO",
        "Wrote " +
        COMBINED_FASTA
    );

    glue.log(
        "INFO",
        "Wrote " +
        MANIFEST_TSV
    );

    glue.log(
        "INFO",
        "Wrote " +
        SKIPPED_TSV
    );

    if(skippedCount > 0) {
        throw new Error(
            "Sublineage reference construction " +
            "completed with " +
            skippedCount +
            " skipped record(s); see " +
            SKIPPED_TSV
        );
    }
}

main();
