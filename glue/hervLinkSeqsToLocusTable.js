// Define the sources to process
//var sources = ["homo_sapiens", "homo_sapiens_ltr", "homo_sapiens_malr", "homo_sapiens_mosaic"];
var sources = ["fr_rt4_samerow"];

// Loop through each source
_.each(sources, function(sourceName) {

    // List the sequences for the current source
    var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = '" + sourceName + "'"]);

    // Extract sequence IDs
    var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

    // For each sequence ID in the source
    _.each(seqIds, function(seqId) {

        // Create an object in the 'locus_data' table with this ID
        glue.command(["create", "custom-table-row", "locus_data", seqId]);

        // Associate the sequence with the locus_data row
        glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
            glue.command(["set", "link-target", "locus_data", "custom-table-row/locus_data/" + seqId]);
        });

    });

});
