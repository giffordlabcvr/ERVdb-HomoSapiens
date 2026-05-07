// glue/export/ervdbExportReferenceFeatures.js
//
// Export reference feature annotations and coding-feature sequences for the HERVdb / ERVdb web app.
//
// Adds sequence.length to feature-location exports so the web app can draw axes as 1..sequence_length.

var DRY_RUN = false;

var OUTPUT_DIR = "web-app";
var FEATURES_TSV = OUTPUT_DIR + "/ervdb_features.tsv";
var FEATURE_LOCATIONS_TSV = OUTPUT_DIR + "/ervdb_feature_locations.tsv";
var CODING_NT_FASTA = OUTPUT_DIR + "/ervdb_coding_nt.fasta";
var CODING_AA_FASTA = OUTPUT_DIR + "/ervdb_coding_aa.fasta";
var SKIPPED_TSV = OUTPUT_DIR + "/ervdb_feature_export_skipped.tsv";

var REQUIRED_SEQUENCE_KIND = "erv_ref";
var REFERENCE_WHERE_CLAUSE = null;
var INCLUDE_CODING_FEATURES = {};
var SKIP_FASTA_WITH_INTERNAL_STOP = false;
var SKIP_FASTA_WITH_AMBIGUITY = false;

var File = Java.type("java.io.File");
var FileWriter = Java.type("java.io.FileWriter");
var BufferedWriter = Java.type("java.io.BufferedWriter");

function ensureOutputDir() {
    var dir = new File(OUTPUT_DIR);
    if(!dir.exists()) {
        dir.mkdirs();
    }
}

function openWriter(path) {
    return new BufferedWriter(new FileWriter(path));
}

function writeLine(writer, fields) {
    if(fields instanceof Array) {
        writer.write(fields.map(tsvEscape).join("\t"));
    } else {
        writer.write(String(fields));
    }
    writer.newLine();
}

function tsvEscape(value) {
    if(value === null || value === undefined) {
        return "";
    }
    return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function fastaWrap(sequence) {
    var lines = [];
    var width = 70;
    for(var i = 0; i < sequence.length; i += width) {
        lines.push(sequence.substring(i, i + width));
    }
    return lines.join("\n");
}

function writeFastaRecord(writer, header, sequence) {
    writer.write(">" + header);
    writer.newLine();
    writer.write(fastaWrap(sequence));
    writer.newLine();
}

function listResultRows(result) {
    if(result === null || result === undefined || result.listResult === undefined) {
        return [];
    }
    return result.listResult.row || [];
}

function listResultColumns(result) {
    if(result === null || result === undefined || result.listResult === undefined) {
        return [];
    }
    return result.listResult.column || [];
}

function rowToObject(columns, row) {
    var obj = {};
    var values = row.value || [];
    for(var i = 0; i < columns.length; i++) {
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

function indexFeatures() {
    var result = glue.command(["list", "feature"]);
    var columns = listResultColumns(result);
    var rows = listResultRows(result);
    var featuresByName = {};

    for(var i = 0; i < rows.length; i++) {
        var feature = rowToObject(columns, rows[i]);
        var metatags = getFeatureMetatags(feature.name);
        feature.codes_amino_acids = metatags["CODES_AMINO_ACIDS"] === "true";
        feature.own_codon_numbering = metatags["OWN_CODON_NUMBERING"] === "true";
        featuresByName[feature.name] = feature;
    }
    return featuresByName;
}

function getFeatureMetatags(featureName) {
    var metatags = {};
    glue.inMode("/feature/" + featureName, function() {
        var result = glue.command(["list", "metatag"]);
        var columns = listResultColumns(result);
        var rows = listResultRows(result);
        for(var i = 0; i < rows.length; i++) {
            var rowObj = rowToObject(columns, rows[i]);
            metatags[rowObj.name] = rowObj.value;
        }
    });
    return metatags;
}

function buildEligibleSequenceIndex() {
    var index = {};
    var cmd = ["list", "sequence", "sequenceID", "source.name", "sequence_kind", "length"];

    if(REQUIRED_SEQUENCE_KIND !== null) {
        cmd.push("-w");
        cmd.push("sequence_kind = '" + REQUIRED_SEQUENCE_KIND + "'");
    }

    var result = glue.command(cmd);
    var columns = listResultColumns(result);
    var rows = listResultRows(result);

    for(var i = 0; i < rows.length; i++) {
        var rowObj = rowToObject(columns, rows[i]);
        var key = rowObj["source.name"] + "/" + rowObj.sequenceID;
        index[key] = rowObj;
    }
    return index;
}

function getReferenceSequenceInfo(referenceName) {
    var modeResult = { sourceName: null, sequenceID: null };

    try {
        glue.inMode("/reference/" + referenceName, function() {
            var result = glue.command(["show", "sequence"]);
            if(result !== null && result.showSequenceResult !== undefined) {
                modeResult.sourceName = result.showSequenceResult["sequence.source.name"];
                modeResult.sequenceID = result.showSequenceResult["sequence.sequenceID"];
            }
        });
    } catch(e) {
        // leave nulls
    }

    return modeResult;
}

function listReferences(eligibleSequenceIndex) {
    var cmd = ["list", "reference"];
    if(REFERENCE_WHERE_CLAUSE !== null) {
        cmd.push("-w");
        cmd.push(REFERENCE_WHERE_CLAUSE);
    }

    var result = glue.command(cmd);
    var columns = listResultColumns(result);
    var rows = listResultRows(result);
    var refs = [];

    for(var i = 0; i < rows.length; i++) {
        var ref = rowToObject(columns, rows[i]);
        var seqInfo = getReferenceSequenceInfo(ref.name);

        ref["sequence.source.name"] = seqInfo.sourceName;
        ref["sequence.sequenceID"] = seqInfo.sequenceID;

        var seqKey = seqInfo.sourceName + "/" + seqInfo.sequenceID;

        if(REQUIRED_SEQUENCE_KIND === null || eligibleSequenceIndex[seqKey] !== undefined) {
            if(eligibleSequenceIndex[seqKey] !== undefined) {
                ref["sequence.length"] = eligibleSequenceIndex[seqKey].length;
            } else {
                ref["sequence.length"] = null;
            }
            refs.push(ref);
        }
    }
    return refs;
}

function getReferenceFeatureLocationRows(referenceName) {
    var modeRows = [];
    var modeColumns = [];

    try {
        glue.inMode("/reference/" + referenceName, function() {
            var result = glue.command(["list", "feature-location"]);
            modeColumns = listResultColumns(result);
            modeRows = listResultRows(result);
        });
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

function listReferenceFeatureLocations(referenceName) {
    var listed = getReferenceFeatureLocationRows(referenceName);
    var columns = listed.columns;
    var rows = listed.rows;
    var featureLocations = [];

    for(var i = 0; i < rows.length; i++) {
        var rowObj = rowToObject(columns, rows[i]);
        var featureName = rowObj["feature.name"] || rowObj["feature"] || rowObj["name"];
        if(featureName !== null && featureName !== undefined) {
            rowObj._featureName = featureName;
            featureLocations.push(rowObj);
        }
    }
    return featureLocations;
}

function getFeatureLocationAminoAcidResult(referenceName, featureName) {
    var modeResult = null;
    try {
        glue.inMode("/reference/" + referenceName + "/feature-location/" + featureName, function() {
            modeResult = glue.command(["amino-acid"]);
        });
    } catch(e) {
        modeResult = null;
    }
    return modeResult;
}

function listFeatureLocationSegments(referenceName, featureName) {
    var modeColumns = [];
    var modeRows = [];

    try {
        glue.inMode("/reference/" + referenceName + "/feature-location/" + featureName, function() {
            var result = glue.command(["list", "segment"]);
            modeColumns = listResultColumns(result);
            modeRows = listResultRows(result);
        });
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

function exportCodingFeature(referenceName, featureName) {
    var result = getFeatureLocationAminoAcidResult(referenceName, featureName);
    if(result === null || result.featureLocAminoAcidResult === undefined) {
        return {
            ok: false,
            reason: "amino_acid_command_failed_or_no_feature_location"
        };
    }

    var aaResult = result.featureLocAminoAcidResult;
    var columns = aaResult.column || [];
    var rows = aaResult.row || [];

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

    for(var i = 0; i < rows.length; i++) {
        var rowObj = rowToObject(columns, rows[i]);
        var codonNts = rowObj.codonNts;
        var aminoAcid = rowObj.aminoAcid;

        if(codonNts === null || codonNts === undefined || codonNts === "") {
            missingCodonNts = true;
            codonNts = "NNN";
        }
        if(aminoAcid === null || aminoAcid === undefined || aminoAcid === "") {
            missingAminoAcid = true;
            aminoAcid = "X";
        }

        codonNts = String(codonNts).toUpperCase();
        aminoAcid = String(aminoAcid).toUpperCase();

        if(/[^ACGT]/.test(codonNts)) {
            hasAmbiguity = true;
        }
        if(/[^ABCDEFGHIKLMNPQRSTVWXYZ\*]/.test(aminoAcid)) {
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
    if(SKIP_FASTA_WITH_INTERNAL_STOP && hasInternalStop) {
        skipFasta = true;
        skipReason = "internal_stop";
    }
    if(SKIP_FASTA_WITH_AMBIGUITY && hasAmbiguity) {
        skipFasta = true;
        skipReason = skipReason === "" ? "ambiguity" : skipReason + ";ambiguity";
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
        missingCodonNts: missingCodonNts,
        missingAminoAcid: missingAminoAcid,
        skipFasta: skipFasta,
        skipReason: skipReason
    };
}

function includeCodingFeature(featureName) {
    var keys = [];
    for(var key in INCLUDE_CODING_FEATURES) {
        if(INCLUDE_CODING_FEATURES.hasOwnProperty(key)) {
            keys.push(key);
        }
    }
    if(keys.length === 0) {
        return true;
    }
    return INCLUDE_CODING_FEATURES[featureName] === true;
}

function main() {
    ensureOutputDir();

    var featuresWriter = openWriter(FEATURES_TSV);
    var featureLocationsWriter = openWriter(FEATURE_LOCATIONS_TSV);
    var ntWriter = openWriter(CODING_NT_FASTA);
    var aaWriter = openWriter(CODING_AA_FASTA);
    var skippedWriter = openWriter(SKIPPED_TSV);

    writeLine(featuresWriter, [
        "feature",
        "parent_feature",
        "description",
        "feature_type",
        "codes_amino_acids",
        "own_codon_numbering"
    ]);

    writeLine(featureLocationsWriter, [
        "record_id",
        "reference",
        "source_name",
        "sequence_id",
        "sequence_length",
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
        "exported_coding_fasta"
    ]);

    writeLine(skippedWriter, [
        "reference",
        "source_name",
        "sequence_id",
        "feature",
        "reason"
    ]);

    var featuresByName = indexFeatures();
    var eligibleSequenceIndex = buildEligibleSequenceIndex();
    var refs = listReferences(eligibleSequenceIndex);

    var featureCount = 0;
    for(var featureNameForCount in featuresByName) {
        if(featuresByName.hasOwnProperty(featureNameForCount)) {
            featureCount++;
        }
    }

    glue.log("INFO", "Indexed " + featureCount + " feature definition(s)");
    glue.log("INFO", "Required sequence_kind = " + (REQUIRED_SEQUENCE_KIND === null ? "<none>" : REQUIRED_SEQUENCE_KIND));
    glue.log("INFO", "Selected " + refs.length + " reference(s)");

    var totalFeatureLocations = 0;
    var totalFeatureLocationSegments = 0;
    var totalCodingFeatureLocations = 0;
    var totalCodingExports = 0;
    var totalSkippedCodingExports = 0;

    for(var featureNameOut in featuresByName) {
        if(featuresByName.hasOwnProperty(featureNameOut)) {
            var featureOut = featuresByName[featureNameOut];
            var isCodingOut = featureOut.codes_amino_acids === true;
            writeLine(featuresWriter, [
                featureOut.name,
                featureOut["parent.name"],
                featureOut.description,
                isCodingOut ? "coding" : "noncoding",
                isCodingOut,
                featureOut.own_codon_numbering === true
            ]);
        }
    }

    for(var r = 0; r < refs.length; r++) {
        var ref = refs[r];
        var referenceName = ref.name;
        var sourceName = ref["sequence.source.name"];
        var sequenceID = ref["sequence.sequenceID"];
        var sequenceLength = ref["sequence.length"];

        var featureLocations = listReferenceFeatureLocations(referenceName);
        totalFeatureLocations += featureLocations.length;

        for(var f = 0; f < featureLocations.length; f++) {
            var loc = featureLocations[f];
            var featureName = loc._featureName;
            var feature = featuresByName[featureName] || {
                name: featureName,
                "parent.name": null,
                description: null,
                codes_amino_acids: false,
                own_codon_numbering: false
            };

            var isCoding = feature.codes_amino_acids === true;
            var recordID = referenceName + "|" + featureName;

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

            if(isCoding && includeCodingFeature(featureName)) {
                totalCodingFeatureLocations++;
                var codingExport = exportCodingFeature(referenceName, featureName);
                if(codingExport.ok) {
                    ntLength = codingExport.ntLength;
                    aaLength = codingExport.aaLength;
                    codonCount = codingExport.codonCount;
                    hasTranslation = true;
                    hasStop = codingExport.hasStop;
                    hasInternalStop = codingExport.hasInternalStop;
                    hasAmbiguity = codingExport.hasAmbiguity;
                    missingCodonNts = codingExport.missingCodonNts;
                    missingAminoAcid = codingExport.missingAminoAcid;

                    if(codingExport.skipFasta) {
                        writeLine(skippedWriter, [referenceName, sourceName, sequenceID, featureName, codingExport.skipReason]);
                        totalSkippedCodingExports++;
                    } else {
                        if(!DRY_RUN) {
                            writeFastaRecord(ntWriter, recordID, codingExport.ntSeq);
                            writeFastaRecord(aaWriter, recordID, codingExport.aaSeq);
                        }
                        exportedCodingFasta = true;
                        totalCodingExports++;
                    }
                } else {
                    writeLine(skippedWriter, [referenceName, sourceName, sequenceID, featureName, codingExport.reason]);
                    totalSkippedCodingExports++;
                }
            }

            var segments = listFeatureLocationSegments(referenceName, featureName);
            var segmentColumns = segments.columns;
            var segmentRows = segments.rows;

            if(segmentRows.length === 0) {
                writeLine(featureLocationsWriter, [
                    recordID,
                    referenceName,
                    sourceName,
                    sequenceID,
                    sequenceLength,
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
                    exportedCodingFasta
                ]);
            } else {
                for(var s = 0; s < segmentRows.length; s++) {
                    var segment = rowToObject(segmentColumns, segmentRows[s]);
                    totalFeatureLocationSegments++;
                    writeLine(featureLocationsWriter, [
                        recordID,
                        referenceName,
                        sourceName,
                        sequenceID,
                        sequenceLength,
                        featureName,
                        s + 1,
                        segment.refStart,
                        segment.refEnd,
                        segment.translationModifierName,
                        segment.spliceIndex,
                        segment.transcriptionIndex,
                        ntLength,
                        aaLength,
                        codonCount,
                        hasTranslation,
                        hasStop,
                        hasInternalStop,
                        hasAmbiguity,
                        missingCodonNts,
                        missingAminoAcid,
                        exportedCodingFasta
                    ]);
                }
            }
        }
    }

    featuresWriter.close();
    featureLocationsWriter.close();
    ntWriter.close();
    aaWriter.close();
    skippedWriter.close();

    glue.log("INFO", "Observed " + totalFeatureLocations + " reference feature-location(s)");
    glue.log("INFO", "Observed " + totalFeatureLocationSegments + " reference feature-location segment(s)");
    glue.log("INFO", "Observed " + totalCodingFeatureLocations + " coding reference feature-location(s)");
    glue.log("INFO", "Exported " + totalCodingExports + " coding FASTA record pair(s)");
    glue.log("INFO", "Skipped " + totalSkippedCodingExports + " coding feature export(s)");
    glue.log("INFO", "Wrote " + FEATURES_TSV);
    glue.log("INFO", "Wrote " + FEATURE_LOCATIONS_TSV);
    glue.log("INFO", "Wrote " + CODING_NT_FASTA);
    glue.log("INFO", "Wrote " + CODING_AA_FASTA);
    glue.log("INFO", "Wrote " + SKIPPED_TSV);
}

main();