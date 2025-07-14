// Path to input tabular file
var inputPath = "tabular/herv_locus_data.tsv";
var sourceName = "homo_sapiens";
var tableObjs = [];

glue.inMode("module/tabularUtility", function() {
	tableObjs = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
});

// Mapping of taxonomic levels to custom-table names
var taxLevelToTable = {
    "species": "rv_species",
    "subgenus": "rv_subgenus",
    "genus": "rv_genus",
    "subfamily": "rv_subfamily",
    "clade": "rv_clade"
};

// Step 1: Build taxonomy lookup from reference sequences
var taxonomyLookup = {};

var refSeqsResult = glue.command([
    "list", "sequence", "-w", "source.name like '%-refseqs-%'"
]);

_.each(refSeqsResult.listResult.row, function(ref) {
    var sourceName = ref.value[0];
    var refSeqId = ref.value[1];

    glue.inMode("sequence/" + sourceName + "/" + refSeqId, function() {
        var speciesIdResult = glue.command(["show", "property", "rv_species.id"]);
        var speciesId = speciesIdResult["propertyValueResult"]["value"];

        if (!speciesId) {
            glue.log("WARNING", "Reference sequence " + refSeqId + " has no rv_species.id property.");
            return;
        }

        taxonomyLookup[speciesId] = { "species": speciesId };

        _.each(["subgenus", "genus", "subfamily", "clade"], function(level) {
            var propertyName = "rv_" + level + ".id";
            try {
                var propResult = glue.command(["show", "property", propertyName]);
                var levelId = propResult["propertyValueResult"]["value"];
                if (levelId) {
                    taxonomyLookup[speciesId][level] = levelId;
                }
            } catch (e) {
                // Property may not exist—ignore
            }
        });
    });
});

glue.log("INFO", "Taxonomy lookup populated for " + _.keys(taxonomyLookup).length + " species.");

// Step 2: Process locus sequences and set complete taxonomy links

var linkedCount = 0;
var missingTaxa = 0;
var failedSeqs = 0;

_.each(tableObjs, function(row) {

    var levelRaw = row["tax_level"];
    var taxonIdRaw = row["classification_mod"];
    var seqIdRaw = row["sequenceid"];

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

    var resolvedTaxonomy = null;

	var allowedLevels = [];
	if (level === "species") {
		allowedLevels = ["species", "subgenus", "genus", "subfamily", "clade"];
	} else if (level === "subgenus") {
		allowedLevels = ["subgenus", "genus", "subfamily", "clade"];
	} else if (level === "genus") {
		allowedLevels = ["genus", "subfamily", "clade"];
	} else if (level === "subfamily") {
		allowedLevels = ["subfamily", "clade"];
	} else if (level === "clade") {
		allowedLevels = ["clade"];
	}

	if (level === "species") {
		resolvedTaxonomy = {};
		_.each(allowedLevels, function(taxLevel) {
			var val = taxonomyLookup[taxonId] ? taxonomyLookup[taxonId][taxLevel] : null;
			if (val) resolvedTaxonomy[taxLevel] = val;
		});
	} else {
		_.each(taxonomyLookup, function(taxData) {
			if (taxData[level] === taxonId) {
				resolvedTaxonomy = {};
				_.each(allowedLevels, function(taxLevel) {
					var val = taxData[taxLevel];
					if (val) resolvedTaxonomy[taxLevel] = val;
				});
				return false; // break
			}
		});
	}

    // Link available taxonomy levels for this sequence
    try {
        glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
            _.each(["species", "subgenus", "genus", "subfamily", "clade"], function(taxLevel) {
                var value = resolvedTaxonomy[taxLevel];
                if (value) {
                    var table = taxLevelToTable[taxLevel];
                    glue.command(["set", "link-target", table, "custom-table-row/" + table + "/" + value]);
                    glue.log("FINE", "Linked " + seqId + " to " + table + " / " + value);
                }
            });
        });
        linkedCount++;
    } catch (e) {
        glue.log("WARNING", "Failed to link sequence: " + seqId + " " + e);
        failedSeqs++;
    }
});

glue.log("INFO", "Linking complete. Sequences linked: " + linkedCount +
    ", missing taxonomy rows: " + missingTaxa +
    ", failed sequence links: " + failedSeqs);
