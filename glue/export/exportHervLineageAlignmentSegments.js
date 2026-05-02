// glue/export/exportHervLineageAlignmentSegments.js
//
// Export aligned segment details for HERV lineage alignments.
// Assumes this script is run from within the ervdb project mode.

var WHERE = "name like 'AL_LINEAGE_HERV%'";
var OUT = "web-app/herv_lineage_alignment_segments.tsv";

var FileWriter = Java.type("java.io.FileWriter");
var PrintWriter = Java.type("java.io.PrintWriter");

function log(msg) {
    glue.log("INFO", msg);
}

function queryObjects(cmdWords) {
    return glue.tableToObjects(glue.command(cmdWords));
}

function tsv(value) {
    if(value === null || value === undefined) {
        return "";
    }
    return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

var out = new PrintWriter(new FileWriter(OUT));

out.println([
    "alignment_name",
    "parent_alignment",
    "ref_name",
    "member_source",
    "member_sequence",
    "segment_index",
    "ref_start",
    "ref_end",
    "member_start",
    "member_end"
].join("\t"));

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

var alignments = queryObjects([
    "list", "alignment",
    "-w", WHERE,
    "name", "parent.name", "refSequence.name",
    "-s", "name"
]);

log("Found " + alignments.length + " HERV lineage alignments");

_.each(alignments, function(aln) {

    var alnName = aln.name;
    var parentName = aln["parent.name"];
    var refName = aln["refSequence.name"];

    log("Exporting segments for " + alnName);

    glue.inMode("/alignment/" + alnName, function() {

        var members = queryObjects([
            "list", "member"
        ]);

        _.each(members, function(member) {

            var sourceName = member["sequence.source.name"];
            var sequenceID = member["sequence.sequenceID"];

            glue.inMode("/member/" + sourceName + "/" + sequenceID, function() {

                var segments = queryObjects([
                    "list", "segment"
                ]);

                var segmentIndex = 0;

                _.each(segments, function(segment) {
                    segmentIndex++;

                    out.println([
                        alnName,
                        parentName,
                        refName,
                        sourceName,
                        sequenceID,
                        segmentIndex,
                        segment.refStart,
                        segment.refEnd,
                        segment.memberStart,
                        segment.memberEnd
                    ].map(tsv).join("\t"));
                });
            });
        });
    });
});

out.close();

log("Exported HERV lineage alignment segment details to " + OUT);