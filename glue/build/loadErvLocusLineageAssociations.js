
// Curated source-name -> ERV lineage association loader.
// GLUE / Nashorn.
//
// Mapping file:
// tabular/erv/locus/erv_locus_name_mappings.tsv
//
// Run:
// run script glue/build/locus/loadErvLocusLineageAssociations.js
//
// DRY_RUN defaults to true.
//
// Missing erv_locus records are skipped (non-fatal).
// Invalid mappings and conflicting primary associations are fatal.
// Existing associations are never deleted or silently replaced.

var MAPPING_FILE =
  "tabular/locus/erv_locus_name_mappings.tsv";

var DRY_RUN = false;
var FAIL_ON_ANY_PROBLEM = true;

var EVIDENCE = "candidate_names_decision";
var CONFIDENCE = "high";
var ROLE = "primary";

function log(s) {
  glue.logInfo(s);
}

function trim(x) {
  return x == null ? "" : String(x).trim();
}

function quote(x) {
  return "'" + String(x).replace(/'/g, "''") + "'";
}

function rows(cmd) {
  return glue.tableToObjects(glue.command(cmd));
}

function path(t, id) {
  return "custom-table-row/" + t + "/" + id;
}

function assocId(locus, lineage) {
  return (locus + "__" + lineage)
    .replace(/[^A-Za-z0-9._-]/g, "_");
}

function isTrue(x) {
  return /^(true|yes|1)$/i.test(trim(x));
}

function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ------------------------------------------------------------
// 1. Read curated source-name mappings
// ------------------------------------------------------------

var Files = Java.type("java.nio.file.Files");
var Paths = Java.type("java.nio.file.Paths");
var StandardCharsets =
  Java.type("java.nio.charset.StandardCharsets");

var rawLines = Files.readAllLines(
  Paths.get(MAPPING_FILE),
  StandardCharsets.UTF_8
);

if (rawLines.size() < 2) {
  throw new Error(
    "Mapping file is empty: " + MAPPING_FILE
  );
}

var header = String(rawLines.get(0))
  .replace(/^\uFEFF/, "")
  .replace(/\r$/, "")
  .split("\t");

var expected = [
  "source_name",
  "entity_type",
  "erv_lineage_id"
];

if (header.join("\t") !== expected.join("\t")) {
  throw new Error(
    "Unexpected TSV header: " +
    header.join(" | ") +
    "; expected " +
    expected.join(" | ")
  );
}

var mapping = Object.create(null);
var problems = [];
var mappingCount = 0;

for (var i = 1; i < rawLines.size(); i++) {

  var line = String(rawLines.get(i))
    .replace(/\r$/, "");

  if (!trim(line)) {
    continue;
  }

  var c = line.split("\t");

  if (c.length !== 3) {
	problems.push(
	  "Mapping line " + (i + 1) +
	  ": expected 3 columns"
	);
	continue;
  }

  var source = trim(c[0]);
  var type = trim(c[1]);
  var target = trim(c[2]);

  if (!source) {
    problems.push(
      "Mapping line " + (i + 1) +
      ": empty source name"
    );
    continue;
  }

  if (own(mapping, source)) {
    problems.push(
      "Duplicate mapping: " + source
    );
    continue;
  }

  if (
    ["lineage", "sublineage", "ervr", "n/a"]
      .indexOf(type) < 0
  ) {
    problems.push(
      "Mapping " + source +
      ": unknown entity_type " + type
    );
  }

  if (type !== "n/a" && !target) {
    problems.push(
      "Mapping " + source +
      ": blank target"
    );
  }

  mapping[source] = {
    target: target,
    type: type
  };

  mappingCount++;
}

// ------------------------------------------------------------
// 2. Validate mapping targets against ERVdb
// ------------------------------------------------------------

// The database uses 'erv_derived_repeat' for ERVRs.

var typeLookup = {
  lineage: "lineage",
  sublineage: "sublineage",
  ervr: "erv_derived_repeat"
};

var lineages = Object.create(null);

rows([
  "list",
  "custom-table-row",
  "erv_lineage",
  "id",
  "entity_type"
]).forEach(function(r) {

  lineages[trim(r.id)] = trim(r.entity_type);

});

Object.keys(mapping).forEach(function(source) {

  var m = mapping[source];

  if (m.type === "n/a") {
    return;
  }

  if (!own(lineages, m.target)) {

    problems.push(
      "Mapping " + source +
      ": target not in erv_lineage: " +
      m.target
    );

  } else if (
    lineages[m.target] !== typeLookup[m.type]
  ) {

    problems.push(
      "Mapping " + source +
      ": entity_type " + m.type +
      " disagrees with database type " +
      lineages[m.target] +
      " for " + m.target
    );

  }

});

// ------------------------------------------------------------
// 3. Load loci, candidates and existing associations
// ------------------------------------------------------------

var loci = Object.create(null);

rows([
  "list",
  "custom-table-row",
  "erv_locus",
  "id"
]).forEach(function(r) {

  loci[trim(r.id)] = true;

});

var candidates = rows([
  "list",
  "custom-table-row",
  "erv_locus_candidate",
  "id",
  "case_status",
  "names_decision",
  "makes_mosaic"
]);

var existing = Object.create(null);
var byLocus = Object.create(null);

rows([
  "list",
  "custom-table-row",
  "erv_locus_lineage_assoc",
  "id",
  "erv_locus.id",
  "erv_lineage.id",
  "association_role",
  "evidence"
]).forEach(function(r) {

  var id = trim(r.id);
  var lid = trim(r["erv_locus.id"]);

  existing[id] = r;

  if (!own(byLocus, lid)) {
    byLocus[lid] = [];
  }

  byLocus[lid].push(r);

});

// ------------------------------------------------------------
// 4. Build and validate association plan
// ------------------------------------------------------------

var plan = [];

var skippedStatus = 0;
var skippedMosaic = 0;
var skippedNA = 0;
var skippedMissingLocus = 0;
var unchanged = 0;
var eligible = 0;

candidates.forEach(function(r) {

  var locus = trim(r.id);
  var source = trim(r.names_decision);

  if (
    trim(r.case_status) !== "Fully resolved"
  ) {
    skippedStatus++;
    return;
  }

  if (isTrue(r.makes_mosaic)) {
    skippedMosaic++;
    return;
  }

  eligible++;

  // A candidate may exist without a corresponding
  // erv_locus record, e.g. if it is located on an
  // alternative chromosome excluded from the locus
  // import.
  //
  // This is not a fatal error.

  if (!own(loci, locus)) {
    skippedMissingLocus++;
    return;
  }

  if (!own(mapping, source)) {

    problems.push(
      "Unmapped source name: " +
      locus + " [" + source + "]"
    );

    return;
  }

  var m = mapping[source];

  // Explicitly excluded from lineage linking.

  if (m.type === "n/a") {
    skippedNA++;
    return;
  }

  // Invalid targets were already reported during
  // mapping validation.

  if (
    !own(lineages, m.target) ||
    lineages[m.target] !== typeLookup[m.type]
  ) {
    return;
  }

  var id = assocId(locus, m.target);

  // Detect existing primary associations to a
  // different lineage.

  var conflicts = (byLocus[locus] || [])
    .filter(function(a) {

      return (
        trim(a.association_role) === ROLE &&
        trim(a["erv_lineage.id"]) !== m.target
      );

    });

  if (conflicts.length) {

    problems.push(
      "Conflicting primary association: " +
      locus +
      " [" + source + "] -> " +
      m.target +
      "; existing: " +
      conflicts.map(function(a) {
        return (
          trim(a["erv_lineage.id"]) +
          " (" + trim(a.id) + ")"
        );
      }).join(", ")
    );

    return;
  }

  if (own(existing, id)) {

    var old = existing[id];

    if (
      trim(old["erv_locus.id"]) !== locus ||
      trim(old["erv_lineage.id"]) !== m.target
    ) {

      problems.push(
        "Association ID collision: " + id
      );

      return;
    }

    unchanged++;
  }

  plan.push({
    id: id,
    locus: locus,
    target: m.target,
    source: source,
    exists: own(existing, id)
  });

});

// ------------------------------------------------------------
// 5. Report preflight results
// ------------------------------------------------------------

log(
  "===== Curated ERV locus association preflight ====="
);

log(
  "Mapping rows: " + mappingCount +
  "; ERV lineage records: " +
  Object.keys(lineages).length
);

log(
  "Candidates: " + candidates.length +
  "; eligible: " + eligible
);

log(
  "Skipped status: " + skippedStatus +
  "; mosaics: " + skippedMosaic +
  "; missing loci: " + skippedMissingLocus +
  "; intentional n/a: " + skippedNA
);

log(
  "Planned new associations: " +
  plan.filter(function(p) {
    return !p.exists;
  }).length +
  "; existing associations to refresh: " +
  unchanged
);

log(
  "Preflight problems: " + problems.length
);

problems.forEach(function(p) {
  log("PREFLIGHT ERROR: " + p);
});

// ------------------------------------------------------------
// 6. Apply associations (only when DRY_RUN = false)
// ------------------------------------------------------------

if (DRY_RUN) {

  log(
    "DRY RUN: no changes written. " +
    "Set DRY_RUN=false after reviewing."
  );

} else if (
  problems.length && FAIL_ON_ANY_PROBLEM
) {

  throw new Error(
    "Preflight failed with " +
    problems.length +
    " problem(s). No changes written."
  );

} else {

  var writes = 0;

  plan.forEach(function(p) {

    if (!p.exists) {

      glue.command([
        "create",
        "custom-table-row",
        "erv_locus_lineage_assoc",
        p.id
      ]);

    }

    glue.inMode(
      path(
        "erv_locus_lineage_assoc",
        p.id
      ),
      function() {

        glue.command([
          "set",
          "link-target",
          "erv_locus",
          path("erv_locus", p.locus)
        ]);

        glue.command([
          "set",
          "link-target",
          "erv_lineage",
          path("erv_lineage", p.target)
        ]);

        glue.command([
          "set",
          "field",
          "association_role",
          ROLE
        ]);

        glue.command([
          "set",
          "field",
          "evidence",
          EVIDENCE
        ]);

        glue.command([
          "set",
          "field",
          "confidence",
          CONFIDENCE
        ]);

      }
    );

    writes++;
  });

  log(
    "Written associations: " + writes +
    ". No associations deleted."
  );

}

// ------------------------------------------------------------
// 7. Return summary
// ------------------------------------------------------------

({
  mapping_rows: mappingCount,
  eligible: eligible,
  planned: plan.length,
  skipped_missing_locus: skippedMissingLocus,
  problems: problems.length,
  dry_run: DRY_RUN
});
