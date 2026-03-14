var sources = ["fr_rt4_samerow", "fr_samename"];

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
	var refSource = ref.value[0];
	var refSeqId = ref.value[1];

	glue.inMode("sequence/" + refSource + "/" + refSeqId, function() {
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


// Step 2: Process locus sequences and set taxonomy links
_.each(sources, function(sourceName) {


	// Path to input tabular file
	var inputPath = "tabular/locus/" + sourceName + ".tsv";
	var tableObjs = [];

	glue.inMode("module/tabularUtility", function() {
		tableObjs = glue.tableToObjects(glue.command(["load-tabular", inputPath]));
	});

	var linkedCount = 0;
	var missingTaxa = 0;
	var failedSeqs = 0;

	_.each(tableObjs, function(row) {

		var levelRaw = row["tax_level"];
		var taxonIdRaw = row["names_decision"];
		var seqId = row["sequenceid"];

		if (!levelRaw || !taxonIdRaw || !seqId ) {
			glue.log("WARNING", "Missing required field in row: " + JSON.stringify(row));
			return;
		}

		var level = levelRaw.toLowerCase().trim();
		var taxonId = taxonIdRaw.trim();

		// Set classification and tax_level fields regardless of linkage success
		try {
			glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
				glue.command(["set", "field", "classification", taxonId]);
				glue.command(["set", "field", "tax_level", levelRaw]);
			});
		} catch (e) {
			glue.log("WARNING", "Failed to set classification/tax_level for sequence " + seqId + ": " + e);
			failedSeqs++;
			return;
		}

		// If the tax_level is not one of the core taxonomic ranks, skip linkage but count success
		if (!(level in taxLevelToTable)) {
			linkedCount++;
			return;
		}

		var taxTable = taxLevelToTable[level];
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

		// Lookup full lineage from species entry
		if (level === "species") {
			resolvedTaxonomy = {};
			_.each(allowedLevels, function(taxLevel) {
				var val = taxonomyLookup[taxonId] ? taxonomyLookup[taxonId][taxLevel] : null;
				if (val) resolvedTaxonomy[taxLevel] = val;
			});
		} else {
			// Find a species that maps to the same higher-level taxon
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

		try {
			glue.inMode("sequence/" + sourceName + "/" + seqId, function() {
				_.each(["species", "subgenus", "genus", "subfamily", "clade"], function(taxLevel) {
					var value = resolvedTaxonomy ? resolvedTaxonomy[taxLevel] : null;
					if (value) {
						var table = taxLevelToTable[taxLevel];
						glue.command(["set", "link-target", table, "custom-table-row/" + table + "/" + value]);
						glue.log("FINE", "Linked " + seqId + " to " + table + " / " + value);
					}
				});
			});
			linkedCount++;
		} catch (e) {
			glue.log("WARNING", "Failed to link taxonomy for sequence " + seqId + ": " + e);
			failedSeqs++;
		}

	});

	glue.log("INFO", "Linking complete. Sequences linked: " + linkedCount +
		", failed links: " + failedSeqs);


});




