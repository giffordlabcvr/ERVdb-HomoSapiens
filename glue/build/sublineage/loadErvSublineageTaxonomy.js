// glue/build/erv/loadErvTaxonomy.js
//
// Load ERV lineage taxonomy from tabular/erv/erv_side_data.tsv
//
// Expected core columns:
//   sequenceID
//   species
//   genus
//   subgenus
//   subfamily
//   clade
//
// Optional columns:
//   full_name
//   name
//
// Main actions:
//   - create taxonomy rows in rv_* tables
//   - populate rv_species rows
//   - populate higher-level taxonomy links
//   - link erv_lineage -> rv_species
//   - optionally link erv_lineage directly to higher taxonomic ranks
//
// Assumption:
//   - erv_lineage row IDs match sequenceID
//   - representative sequences are already linked separately via sequence -> erv_lineage

var INPUT_PATHS = [
	"tabular/erv/herv_lineage_data.tsv",
	"tabular/erv/nonhuman_erv_lineage_data.tsv"
];

function loadTsv(path) {
	var rows;
	glue.inMode("module/tabularUtility", function() {
		rows = glue.tableToObjects(glue.command(["load-tabular", path]));
	});
	return rows;
}

function norm(value) {
	if (value === null || value === undefined) {
		return null;
	}
	var s = ("" + value).trim();
	if (s === "") {
		return null;
	}
	var low = s.toLowerCase();
	if (low === "n/a" || low === "na" || low === "null" || low === "none") {
		return null;
	}
	return s;
}

function ensureRow(tableName, rowId) {
	rowId = norm(rowId);
	if (rowId === null) {
		return;
	}
	try {
		glue.command(["create", "custom-table-row", tableName, rowId]);
	} catch (e) {
		// assume row already exists
	}
}

function setFieldIfPresent(fieldName, value) {
	value = norm(value);
	if (value !== null) {
		glue.command(["set", "field", fieldName, value]);
	}
}

function setLinkIfPresent(linkName, targetPath) {
	if (targetPath !== null) {
		glue.command(["set", "link-target", linkName, targetPath]);
	}
}

function customRowPath(tableName, rowId) {
	return "custom-table-row/" + tableName + "/" + rowId;
}

// Load TSV rows
var taxRows = [];
_.each(INPUT_PATHS, function(path) {
	var rows = loadTsv(path);
	taxRows = taxRows.concat(rows);
	glue.logInfo("Loaded " + rows.length + " rows from " + path);
});

// --------------------------------------------------
// Pass 1: ensure taxonomy rows exist
// --------------------------------------------------

_.each(taxRows, function(row) {
	ensureRow("rv_clade", row["clade"]);
	ensureRow("rv_subfamily", row["subfamily"]);
	ensureRow("rv_genus", row["genus"]);
	ensureRow("rv_subgenus", row["subgenus"]);
	ensureRow("rv_species", row["species"]);
});

// --------------------------------------------------
// Pass 2: populate rv_species and higher taxonomy
// --------------------------------------------------

_.each(taxRows, function(row) {

	var cladeId = norm(row["clade"]);
	var subfamilyId = norm(row["subfamily"]);
	var genusId = norm(row["genus"]);
	var subgenusId = norm(row["subgenus"]);
	var speciesId = norm(row["species"]);

	if (speciesId === null) {
		glue.logInfo("Skipping row with missing species: " + JSON.stringify(row));
		return;
	}

	glue.inMode(customRowPath("rv_species", speciesId), function() {
		setFieldIfPresent("full_name", row["full_name"]);
		setFieldIfPresent("name", row["name"]);

		if (genusId !== null) {
			setLinkIfPresent("rv_genus", customRowPath("rv_genus", genusId));
		}
		if (subgenusId !== null) {
			setLinkIfPresent("rv_subgenus", customRowPath("rv_subgenus", subgenusId));
		}
		if (subfamilyId !== null) {
			setLinkIfPresent("rv_subfamily", customRowPath("rv_subfamily", subfamilyId));
		}
		if (cladeId !== null) {
			setLinkIfPresent("rv_clade", customRowPath("rv_clade", cladeId));
		}
	});

	if (subgenusId !== null && genusId !== null) {
		glue.inMode(customRowPath("rv_subgenus", subgenusId), function() {
			setLinkIfPresent("rv_genus", customRowPath("rv_genus", genusId));
		});
	}

	if (genusId !== null && subfamilyId !== null) {
		glue.inMode(customRowPath("rv_genus", genusId), function() {
			setLinkIfPresent("rv_subfamily", customRowPath("rv_subfamily", subfamilyId));
		});
	}

	if (subfamilyId !== null && cladeId !== null) {
		glue.inMode(customRowPath("rv_subfamily", subfamilyId), function() {
			setLinkIfPresent("rv_clade", customRowPath("rv_clade", cladeId));
		});
	}
});

// --------------------------------------------------
// Pass 3: link erv_lineage -> taxonomy
// --------------------------------------------------

_.each(taxRows, function(row) {

	var lineageId = norm(row["sequenceID"]);
	var speciesId = norm(row["species"]);
	var cladeId = norm(row["clade"]);
	var subfamilyId = norm(row["subfamily"]);
	var genusId = norm(row["genus"]);
	var subgenusId = norm(row["subgenus"]);

	if (lineageId === null) {
		glue.logInfo("Skipping row with missing sequenceID: " + JSON.stringify(row));
		return;
	}
	if (speciesId === null) {
		glue.logInfo("Skipping erv_lineage '" + lineageId + "' because species is missing");
		return;
	}

	try {
		glue.inMode(customRowPath("erv_lineage", lineageId), function() {
			setLinkIfPresent("rv_species", customRowPath("rv_species", speciesId));

			// Optional direct higher-rank links for convenience
			if (subgenusId !== null) {
				setLinkIfPresent("rv_subgenus", customRowPath("rv_subgenus", subgenusId));
			}
			if (genusId !== null) {
				setLinkIfPresent("rv_genus", customRowPath("rv_genus", genusId));
			}
			if (subfamilyId !== null) {
				setLinkIfPresent("rv_subfamily", customRowPath("rv_subfamily", subfamilyId));
			}
			if (cladeId !== null) {
				setLinkIfPresent("rv_clade", customRowPath("rv_clade", cladeId));
			}
		});
	} catch (e) {
		glue.logInfo("Could not link erv_lineage '" + lineageId + "' to taxonomy");
	}
});