// glue/export/exportHervLineageAlignmentSegments.js
//
// Export aligned segment details for HERV lineage alignments.
// Assumes this script is run from within the ervdb project mode.

var WHERE = "name like 'AL_LINEAGE_HERV%'";
var OUT = "web-app/herv_lineage_alignment_segments.tsv";

var FileWriter = Java.type("java.io.FileWriter");
var PrintWriter = Java.type("java.io.PrintWriter");

function rows(cmdResult) {
  if(!cmdResult.listResult || !cmdResult.listResult.row) {
    return [];
  }
  return cmdResult.listResult.row;
}

function val(row, i) {
  return row.value[i];
}

function tsv(x) {
  if(x === null || x === undefined) {
    return "";
  }
  return String(x).replace(/\t/g, " ").replace(/\r?\n/g, " ");
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

var alnResult = glue.command([
  "list", "alignment",
  "-w", WHERE,
  "name", "parent.name", "refSequence.name"
]);

rows(alnResult).forEach(function(alnRow) {

  var alnName = val(alnRow, 0);
  var parentName = val(alnRow, 1);
  var refName = val(alnRow, 2);

  var memberResult = glue.command([
    "alignment", alnName,
    "list", "member"
  ]);

  rows(memberResult).forEach(function(memberRow) {

    var sourceName = val(memberRow, 1);
    var sequenceID = val(memberRow, 2);

    var segResult = glue.command([
      "alignment", alnName,
      "member", sourceName, sequenceID,
      "list", "segment"
    ]);

    var segIndex = 0;

    rows(segResult).forEach(function(segRow) {
      segIndex++;

      out.println([
        alnName,
        parentName,
        refName,
        sourceName,
        sequenceID,
        segIndex,
        val(segRow, 0),
        val(segRow, 1),
        val(segRow, 2),
        val(segRow, 3)
      ].map(tsv).join("\t"));
    });
  });
});

out.close();

glue.logInfo("Exported HERV lineage alignment segment details to " + OUT);