/**
 * This script links ERV locus sequences to taxonomy rows in the appropriate
 * rv_taxonomy table based on the classification level and value.
 * 
 * Assumes:
 * - `sequenceid` is the ID of an ERV locus
 * - `classification_mod` contains the taxon row ID
 * - `tax_level` contains the taxonomy table to link to (e.g. species, genus, clade, etc.)
 */

var inputPath = "tabular/herv_locus_data.tsv";
var tableObjs = [];

glue.inMode("module/tabularUtility", function() {
	tableObjs = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
});

// Mapping of tax_level values to taxonomy tables
var taxLevelToTable = {
	"species": "rv_species",
	"subgenus": "rv_subgenus",
	"genus": "rv_genus",
	"subfamily": "rv_subfamily",
	"clade": "rv_clade"
};

var linkedCount = 0;
var missingTaxa = 0;
var failedSeqs = 0;

_.each(tableObjs, function(row) {
	var levelRaw = row["tax_level"] || "";
	var taxonId = (row["classification_mod"] || "").trim();
	var seqId = (row["sequenceid"] || "").trim();

	var level = levelRaw.toLowerCase().trim();
	var taxTable = taxLevelToTable[level];

	if (!taxTable || !taxonId || !seqId) {
		glue.log("WARNING", "Missing or unrecognized classification in row: " + JSON.stringify(row));
		return;
	}

	// Ensure taxonomy row exists
	try {
		glue.command(["show", "custom-table-row", taxTable, taxonId]);
	} catch (e) {
		glue.log("INFO", "No taxonomy row found for: " + taxTable + " / " + taxonId + " (sequenceID: " + seqId + ")");
		missingTaxa++;
		return;
	}

	// Link the sequence to the taxonomy table
	try {
		glue.inMode("sequence/" + seqId, function() {
			glue.command(["set", "link-target", taxTable, "custom-table-row/" + taxTable + "/" + taxonId]);
		});
		linkedCount++;
	} catch (e) {
		glue.log("WARNING", "Failed to link sequence: " + seqId + " to " + taxTable + " / " + taxonId);
		failedSeqs++;
	}
});

glue.log("INFO", "Linking complete. Sequences linked: " + linkedCount +
                  ", missing taxonomy rows: " + missingTaxa +
                  ", failed sequence links: " + failedSeqs);
