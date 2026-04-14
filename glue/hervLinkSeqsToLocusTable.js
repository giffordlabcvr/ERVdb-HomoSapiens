// Define the sources to process
var sources = ["fr_rt4_samerow", "fr_samename", "fr_only1id"];

// Loop through each source
_.each(sources, function(sourceName) {

    // List the sequences for the current source
    var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = '" + sourceName + "'"]);

    // Extract sequence IDs
    var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

    // For each sequence ID in the source
    _.each(seqIds, function(seqId) {

        // Create an object in the 'erv_locus' table with this ID
        glue.command(["create", "custom-table-row", "erv_locus", seqId]);

        // Associate the sequence with the erv_locus row
        glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
            glue.command(["set", "link-target", "erv_locus", "custom-table-row/erv_locus/" + seqId]);
        });

    });

});
