/**
 * Link ERV locus sequences to taxonomy rows based on classification.
 * Populates links for the assigned level and all inferred higher taxonomy levels.
 */

var inputPath = "tabular/herv_locus_data.tsv";
var tableObjs = [];

glue.inMode("module/tabularUtility", function() {
  tableObjs = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
});

// Map tabular levels to GLUE taxonomy tables
var taxLevelToTable = {
  "species": "rv_species",
  "subgenus": "rv_subgenus",
  "genus": "rv_genus",
  "subfamily": "rv_subfamily",
  "clade": "rv_clade"
};

// Clade → Subfamily mapping
var cladeToSubfamily = {
  "I": "Permearetrovirinae",
  "II": "Glissorthoretrovirinae",
  "III": "Spumaretrovirinae"
};

var linkedCount = 0;
var missingTaxa = 0;
var failedSeqs = 0;

_.each(tableObjs, function(row) {


  var levelRaw = row["tax_level"];
  var taxonId = row["classification_mod"];
  var seqId = row["sequenceid"];


  if (!levelRaw || !taxonId || !seqId) {
    glue.log("WARNING", "Missing required field in row: " + JSON.stringify(row));
    return;
  }

  var level = levelRaw.toLowerCase().trim();
  var taxTable = taxLevelToTable[level];

  if (!taxTable) {
    glue.log("WARNING", "Unrecognized taxonomic level in row: " + JSON.stringify(row));
    return;
  }

  // Ensure taxonomy row exists
  var taxRows = glue.tableToObjects(glue.command([
    "list", "custom-table-row", taxTable, "-w", "id = '" + taxonId + "'"
  ]));

  if (taxRows.length === 0) {
    glue.log("INFO", "No taxonomy row found for: " + taxTable + " / " + taxonId + " (sequenceID: " + seqId + ")");
    missingTaxa++;
    return;
  }

  var taxRow = taxRows[0];

  // Determine source name (required for inMode)
  var seqResult = glue.tableToObjects(glue.command([
    "list", "sequence", "-w", "sequenceID = '" + seqId + "'"
  ]));

  if (seqResult.length === 0) {
    glue.log("WARNING", "No sequence found with ID: " + seqId);
    failedSeqs++;
    return;
  }

  var sourceName = seqResult[0]["source.name"];

  try {
    // Link to assigned level
    glue.log("FINE", "Linking sequence " + seqId + " to " + taxTable + "/" + taxonId);
    glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
      glue.command(["set", "link-target", taxTable, "custom-table-row/" + taxTable + "/" + taxonId]);
    });

    // Link to parent taxonomy levels
    _.each(["rv_subgenus", "rv_genus", "rv_clade"], function(parentTable) {
      var parentId = taxRow[parentTable + ".id"];
      if (parentId) {
        glue.log("FINE", "Linking sequence " + seqId + " to " + parentTable + "/" + parentId);
        glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
          glue.command(["set", "link-target", parentTable, "custom-table-row/" + parentTable + "/" + parentId]);
        });
      }
    });

    // Also link to rv_subfamily based on clade value, if possible
    if (taxRow["rv_clade.id"]) {
      var cladeId = taxRow["rv_clade.id"];
      var subfamilyId = cladeToSubfamily[cladeId];
      if (subfamilyId) {
        glue.log("FINE", "Linking sequence " + seqId + " to rv_subfamily/" + subfamilyId);
        glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
          glue.command(["set", "link-target", "rv_subfamily", "custom-table-row/rv_subfamily/" + subfamilyId]);
        });
      }
    }

    linkedCount++;

  } catch (e) {
    glue.log("WARNING", "Failed to link sequence: " + seqId + " to taxonomy. Error: " + e);
    failedSeqs++;
  }
});

glue.log("INFO", "Linking complete. Sequences linked: " + linkedCount +
  ", missing taxonomy rows: " + missingTaxa +
  ", failed sequence links: " + failedSeqs);
