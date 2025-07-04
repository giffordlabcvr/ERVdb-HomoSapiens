var inputPath = "tabular/herv_locus_data.tsv";
var tableObjs = [];
var sourceName = "homo_sapiens";

glue.inMode("module/tabularUtility", function() {
	tableObjs = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
});

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
	var levelRaw = row["tax_level"];
	var taxonIdRaw = row["classification_mod"];
	var seqIdRaw = row["sequenceid"];

	// Guard against undefined/null
	if (!levelRaw || !taxonIdRaw || !seqIdRaw) {
		glue.log("WARNING", "Missing required field in row: " + JSON.stringify(row));
		return;
	}

	var level = levelRaw.toLowerCase().trim();
	var taxonId = taxonIdRaw.trim();
	var seqId = seqIdRaw.trim();
	var taxTable = taxLevelToTable[level];

	if (!taxTable) {
		glue.log("WARNING", "Unrecognized taxonomy level: " + level + " in row: " + JSON.stringify(row));
		return;
	}

	// Debug log to show what the script is trying to link
	glue.log("FINE", "Attempting to link sequence '" + seqId + "' to " + taxTable + " / " + taxonId);

	try {
		glue.command(["list", "custom-table-row", taxTable, "-w", "id = '" + taxonId + "'"]);
	} catch (e) {
		glue.log("INFO", "No taxonomy row found for: " + taxTable + " / " + taxonId + " (sequenceID: " + seqId + ")");
		missingTaxa++;
		return;
	}

	try {
		glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
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
