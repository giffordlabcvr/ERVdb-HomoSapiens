// glue/export/exportErvLtrAlignmentSegments.js
// Export one row per aligned segment in ERV LTR alignments.
// Run from within the ervdb project mode.
// Alignments with zero or one member are skipped.

var WHERE = "name like 'AL_LTR%'";
var OUT = "web-app/herv_ltr_alignment_segments.tsv";

var FileWriter = Java.type("java.io.FileWriter");
var PrintWriter = Java.type("java.io.PrintWriter");

function log(msg) { glue.log("INFO", msg); }
function queryObjects(cmdWords) {
    return glue.tableToObjects(glue.command(cmdWords));
}
function tsv(value) {
    if(value === null || value === undefined) { return ""; }
    return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

// Reference sequence lengths, indexed by reference name.
var refLengthsByRefName = {};
var refRows = queryObjects([
    "list", "reference", "name", "sequence.sequenceID", "sequence.length"
]);
_.each(refRows, function(row) {
    refLengthsByRefName[row.name] = {
        sequenceID: row["sequence.sequenceID"],
        length: row["sequence.length"]
    };
});
log("Indexed lengths for " + refRows.length + " references");

var alignments = queryObjects([
    "list", "alignment", "-w", WHERE,
    "name", "parent.name", "refSequence.name", "-s", "name"
]);
log("Found " + alignments.length + " ERV LTR alignments");

var processed = 0;
var skipped = 0;
var skippedEmpty = 0;
var skippedSingle = 0;
var processedWithoutSegments = 0;
var exportedSegments = 0;
var exportedMembers = 0;

var out = new PrintWriter(new FileWriter(OUT));
try {
    out.println([
        "alignment_name", "alignment_type", "parent_alignment",
        "ref_name", "ref_sequence", "ref_length", "member_source",
        "member_sequence", "segment_index", "ref_start", "ref_end",
        "member_start", "member_end"
    ].join("\t"));

    _.each(alignments, function(aln) {
        var alnName = aln.name;
        var parentName = aln["parent.name"];
        var refName = aln["refSequence.name"];
        var refInfo = refLengthsByRefName[refName];
        var refSequenceID = refInfo ? refInfo.sequenceID : null;
        var refLength = refInfo ? refInfo.length : null;

        glue.inMode("/alignment/" + alnName, function() {
            var members = queryObjects(["list", "member"]);
            if(members.length <= 1) {
                skipped++;
                if(members.length === 0) { skippedEmpty++; }
                else { skippedSingle++; }
                return;
            }

            processed++;
            log("Exporting " + alnName + " (" + members.length + " members)");
            var alignmentSegmentCount = 0;

            _.each(members, function(member) {
                var sourceName = member["sequence.source.name"];
                var sequenceID = member["sequence.sequenceID"];

                glue.inMode("/member/" + sourceName + "/" + sequenceID, function() {
                    var segments = queryObjects(["list", "segment"]);
                    if(segments.length > 0) { exportedMembers++; }
                    var segmentIndex = 0;
                    _.each(segments, function(segment) {
                        segmentIndex++;
                        alignmentSegmentCount++;
                        exportedSegments++;
                        out.println([
                            alnName, "LTR", parentName,
                            refName, refSequenceID, refLength,
                            sourceName, sequenceID, segmentIndex,
                            segment.refStart, segment.refEnd,
                            segment.memberStart, segment.memberEnd
                        ].map(tsv).join("\t"));
                    });
                });
            });

            if(alignmentSegmentCount === 0) {
                processedWithoutSegments++;
                log("WARNING: " + alnName + " has >1 member but no aligned segments");
            }
        });
    });
} finally {
    out.close();
}

log("=== ERV LTR alignment segment export summary ===");
log("Alignments selected:                  " + alignments.length);
log("Alignments processed (>1 member):    " + processed);
log("Alignments skipped (<=1 member):     " + skipped);
log("  Skipped with zero members:         " + skippedEmpty);
log("  Skipped with one member:           " + skippedSingle);
log("Processed with no aligned segments:  " + processedWithoutSegments);
log("Members with aligned segments:       " + exportedMembers);
log("Aligned segments exported:           " + exportedSegments);
log("Output: " + OUT);
