var refResult = glue.command([
    "list", "reference",
    "name",
    "sequence.sequenceID"
]);

var refToSequenceId = {};

var refRows = refResult.listResult.row;

for(var i = 0; i < refRows.length; i++) {
    var values = refRows[i].value;
    refToSequenceId[values[0]] = values[1];
}


var alignmentResult = glue.command([
    "list", "alignment",
    "-w", "name like 'AL_LTR_%'"
]);

var alignmentRows = alignmentResult.listResult.row;


// Build TSV
var lines = [];

lines.push(
    "alignmentName\treferenceName\tsequenceID"
);

for(var j = 0; j < alignmentRows.length; j++) {

    var values = alignmentRows[j].value;

    // Returned columns:
    // 0 = name
    // 1 = parent.name
    // 2 = refSequence.name

    var alignmentName = values[0];
    var refName = values[2];

    var sequenceId = "";

    if(refName != null && refToSequenceId[refName] != null) {
        sequenceId = refToSequenceId[refName];
    }

    lines.push(
        alignmentName + "\t" +
        (refName == null ? "" : refName) + "\t" +
        sequenceId
    );
}

var tsv = lines.join("\n") + "\n";

glue.inMode("module/tabularUtility", function() {

    glue.command([
        "file-util", "save-string",
        tsv,
        "tabular/ltrAlignments.tsv"
    ]);

});

glue.log("INFO",
    "Wrote " + alignmentRows.length +
    " rows to tabular/ltrAlignments.tsv"
);