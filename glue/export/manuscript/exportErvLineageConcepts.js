// Export historical lineage names and their ERVdb correspondences.
//
// Run:
// project ervdb run script glue/export/manuscript/exportErvLineageConcepts.js
//
// One row per historical name + recorded name source.
// Multiple matching ERVdb lineage IDs are retained in the same row.
// Legacy full names accompany their short names.
//
// Read-only database operations.
// Existing output is not overwritten.

(function() {

    var OUTPUT_PATH = "web-app/erv_historical_lineage_concepts.tsv";


    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function text(value) {
        if(value === null || value === undefined) {
            return "";
        }

        var result = String(value)
            .replace(/[\t\r\n]+/g, " ")
            .trim();

        return result === "-" ? "" : result;
    }

    function listRows(command) {
        var result = glue.command(command);

        if(!result ||
                !result.listResult ||
                !result.listResult.column) {
            throw new Error(
                "Unexpected list result: " + command.join(" ")
            );
        }

        var columns = result.listResult.column;
        var rows = result.listResult.row || [];
        var output = [];

        for(var i = 0; i < rows.length; i++) {
            var record = {};
            var values = rows[i].value || [];

            for(var j = 0; j < columns.length; j++) {
                record[String(columns[j])] = text(values[j]);
            }

            output.push(record);
        }

        return output;
    }

    function compare(a, b) {
        return a < b ? -1 : (a > b ? 1 : 0);
    }

    function addUnique(array, value) {
        value = text(value);

        if(value !== "" && array.indexOf(value) === -1) {
            array.push(value);
        }
    }

    function joined(array) {
        return array.slice().sort(compare).join("; ");
    }

    function cleanReferenceNote(value) {
        var note = text(value)
            .replace(/^reconstruction:\s*/i, "")
            .replace(/^Input reference_method:\s*/i, "")
            .replace(/^curation:\s*/i, "")
            .trim();

        if(note.toLowerCase() === "not_known") {
            return "";
        }

        return note;
    }


    // -------------------------------------------------------------------------
    // Read database
    // -------------------------------------------------------------------------

    var lineages = listRows([
        "list", "custom-table-row", "erv_lineage",
        "id",
        "legacy_name",
        "legacy_full_name",
        "entity_type",
        "status",
        "human_erv"
    ]);

    var aliases = listRows([
        "list", "custom-table-row", "erv_lineage_alias",
        "erv_lineage.id",
        "alias_name",
        "alias_source"
    ]);

    var references = listRows([
        "list", "custom-table-row", "erv_lineage_reference",
        "id",
        "erv_lineage.id",
        "accession",
        "pubmed_id",
        "derivation_method",
        "derivation_source",
        "reconstruction_notes",
        "curation_notes"
    ]);

    var sequences = listRows([
        "list", "sequence",
        "source.name",
        "sequenceID",
        "erv_lineage_reference.id",
        "-w", "erv_lineage_reference.id != null"
    ]);


    // -------------------------------------------------------------------------
    // Index lineages, references and sequences
    // -------------------------------------------------------------------------

    var lineageIndex = {};
    var referenceIndex = {};
    var sequenceIndex = {};
    var conceptIndex = {};
    var concepts = [];

    for(var i = 0; i < lineages.length; i++) {
        lineageIndex["$" + lineages[i].id] = lineages[i];
    }

    for(var j = 0; j < references.length; j++) {
        var reference = references[j];
        var lineageKey = "$" + reference["erv_lineage.id"];

        if(!lineageIndex[lineageKey]) {
            throw new Error(
                "Reference has missing/unknown lineage: " +
                reference.id
            );
        }

        if(!referenceIndex[lineageKey]) {
            referenceIndex[lineageKey] = [];
        }

        referenceIndex[lineageKey].push(reference);
    }

    for(var k = 0; k < sequences.length; k++) {
        var sequence = sequences[k];
        var referenceKey =
            "$" + sequence["erv_lineage_reference.id"];

        if(!sequenceIndex[referenceKey]) {
            sequenceIndex[referenceKey] = [];
        }

        addUnique(
            sequenceIndex[referenceKey],
            sequence["source.name"] + "/" + sequence.sequenceID
        );
    }


    // -------------------------------------------------------------------------
    // Collect historical names
    // -------------------------------------------------------------------------

    function addConcept(
        name,
        source,
        fullName,
        lineageId,
        nameType
    ) {
        if(!name) {
            return;
        }

        if(!lineageIndex["$" + lineageId]) {
            throw new Error(
                "Name has missing/unknown lineage: " + name
            );
        }

        // Exact matching: preserve spelling, punctuation and case.
        var conceptKey = "$" + JSON.stringify([name, source]);
        var concept = conceptIndex[conceptKey];

        if(!concept) {
            concept = {
                name: name,
                source: source,
                fullNames: [],
                lineageIds: [],
                nameTypes: []
            };

            conceptIndex[conceptKey] = concept;
            concepts.push(concept);
        }

        addUnique(concept.fullNames, fullName);
        addUnique(concept.lineageIds, lineageId);
        addUnique(concept.nameTypes, nameType);
    }

    // Leave the historical source blank for legacy names:
    // storage in ERVdb does not establish original historical provenance.
    for(var l = 0; l < lineages.length; l++) {
        var lineage = lineages[l];

        if(lineage.legacy_name) {
            addConcept(
                lineage.legacy_name,
                "",
                lineage.legacy_full_name,
                lineage.id,
                "legacy_name"
            );
        } else if(lineage.legacy_full_name) {
            addConcept(
                lineage.legacy_full_name,
                "",
                "",
                lineage.id,
                "legacy_full_name"
            );
        }
    }

    for(var a = 0; a < aliases.length; a++) {
        var alias = aliases[a];

        addConcept(
            alias.alias_name,
            alias.alias_source,
            "",
            alias["erv_lineage.id"],
            "alias"
        );
    }

    concepts.sort(function(a, b) {
        return compare(a.name, b.name) ||
            compare(a.source, b.source);
    });


    // -------------------------------------------------------------------------
    // Output columns
    // -------------------------------------------------------------------------

    var headers = [
        "historical_name",
        "historical_full_name",
        "recorded_name_source",
        "historical_definition_or_scope",
        "historical_source_citation",
        "historical_reference_sequences",
        "corresponding_ervdb_lineage_ids",
        "ervdb_legacy_names",
        "ervdb_entity_types",
        "ervdb_statuses",
        "human_erv",
        "correspondence_relationship",
        "reconciliation_evidence",
        "reconciliation_supporting_references",
        "ervdb_reference_sequences",
        "ervdb_reference_accessions",
        "ervdb_reference_pubmed_ids",
        "ervdb_reference_derivation",
        "ervdb_reference_notes",
        "curator_notes",
        "export_name_types"
    ];


    // -------------------------------------------------------------------------
    // Assemble historical-concept rows
    // -------------------------------------------------------------------------

    var outputRows = [];

    for(var c = 0; c < concepts.length; c++) {
        var concept = concepts[c];

        var currentNames = [];
        var entityTypes = [];
        var statuses = [];
        var humanErvValues = [];
        var referenceSequences = [];
        var accessions = [];
        var pubmedIds = [];
        var derivations = [];
        var referenceNotes = [];

        concept.lineageIds.sort(compare);

        for(var d = 0; d < concept.lineageIds.length; d++) {
            var lineageId = concept.lineageIds[d];
            var current = lineageIndex["$" + lineageId];

            addUnique(currentNames, current.legacy_name);
            addUnique(entityTypes, current.entity_type);
            addUnique(statuses, current.status);
            addUnique(humanErvValues, current.human_erv);

            var linkedReferences =
                referenceIndex["$" + lineageId] || [];

            for(var r = 0; r < linkedReferences.length; r++) {
                var ref = linkedReferences[r];

                var linkedSequences =
                    sequenceIndex["$" + ref.id] || [];

                for(var s = 0; s < linkedSequences.length; s++) {
                    addUnique(
                        referenceSequences,
                        linkedSequences[s]
                    );
                }

                addUnique(accessions, ref.accession);
                addUnique(pubmedIds, ref.pubmed_id);

                var derivation = [];

                if(ref.derivation_method) {
                    derivation.push(
                        "method=" + ref.derivation_method
                    );
                }

                if(ref.derivation_source) {
                    derivation.push(
                        "source=" + ref.derivation_source
                    );
                }

                addUnique(
                    derivations,
                    derivation.join(", ")
                );

                addUnique(
                    referenceNotes,
                    cleanReferenceNote(ref.reconstruction_notes)
                );

                addUnique(
                    referenceNotes,
                    cleanReferenceNote(ref.curation_notes)
                );
            }
        }

        outputRows.push([
            concept.name,
            joined(concept.fullNames),
            concept.source,
            "",                         // Historical definition/scope
            "",                         // Historical source citation
            "",                         // Historical reference sequences
            joined(concept.lineageIds),
            joined(currentNames),
            joined(entityTypes),
            joined(statuses),
            joined(humanErvValues),
            "",                         // Correspondence relationship
            "",                         // Reconciliation evidence
            "",                         // Reconciliation references
            joined(referenceSequences),
            joined(accessions),
            joined(pubmedIds),
            joined(derivations),
            joined(referenceNotes),
            "",                         // Curator notes
            joined(concept.nameTypes)
        ]);
    }


    // -------------------------------------------------------------------------
    // Write UTF-8 TSV
    // -------------------------------------------------------------------------

    var Paths = Java.type("java.nio.file.Paths");
    var Files = Java.type("java.nio.file.Files");

    var StandardCharsets =
        Java.type("java.nio.charset.StandardCharsets");

    var StandardOpenOption =
        Java.type("java.nio.file.StandardOpenOption");

    var output = Paths.get(OUTPUT_PATH);

    if(Files.exists(output)) {
        throw new Error(
            "Output already exists: " + OUTPUT_PATH +
            ". Rename it or change OUTPUT_PATH before re-exporting."
        );
    }

    if(output.getParent() !== null) {
        Files.createDirectories(output.getParent());
    }

    var writer = Files.newBufferedWriter(
        output,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE
    );

    function writeRow(fields) {
        var values = [];

        for(var i = 0; i < fields.length; i++) {
            values.push(text(fields[i]));
        }

        writer.write(values.join("\t"));
        writer.newLine();
    }

    try {
        writeRow(headers);

        for(var n = 0; n < outputRows.length; n++) {
            writeRow(outputRows[n]);
        }
    } finally {
        writer.close();
    }

    glue.logInfo(
        "Exported " + outputRows.length +
        " historical name/source entries to " + OUTPUT_PATH
    );

})();

