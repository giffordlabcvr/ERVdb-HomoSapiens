// Define the sources to process
var sources = [

	// Filtered big set 60K
    "filtered_2026_07",

    // Fully resolved
    "fr_rt4_samerow",
    "fr_samename",
    "fr_only1id",
    "fr_harlequin",

    // Partially resolved
    "r_rt4_phyloclade",
    "r_rt4_phylogroup",
    "r_rt4_phylosubgroup",
    "r_rt4_phyloname",

    // Other
    "r-mosiac-grp-subgrp-ur-notinrt4",
    "r-phyloclade-ur-notinrt4_files",
    "r-phylogroup-ur-notinrt4_files",
    "r-phyloname-ur-notinrt4_files",
    "r-phylosubgrp-ur-notinrt4_files",
    "ur-notinrt4_files"
];


// Loop through each source
_.each(sources, function(sourceName) {

    // List the sequences for the current source
    var listSeqResult = glue.command(["list", "sequence", "-w", "source.name = '" + sourceName + "'"]);

    // Extract sequence IDs
    var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

    // For each sequence ID in the source
    _.each(seqIds, function(seqId) {

        // Create an object in the 'erv_locus_candidate' table with this ID
        glue.command(["create", "custom-table-row", "erv_locus_candidate", seqId]);

        // Associate the sequence with the erv_locus_candidate row
        glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
            glue.command(["set", "link-target", "erv_locus_candidate", "custom-table-row/erv_locus_candidate/" + seqId]);
        });

    });

});
