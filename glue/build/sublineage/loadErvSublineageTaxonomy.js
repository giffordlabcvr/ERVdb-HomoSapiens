// glue/build/sublineage/loadErvSublineageTaxonomy.js
//
// Load taxonomy links for ERV sublineage-like rows from:
//
//   tabular/reference/herv_sublineage_data.tsv
//
// Main actions:
//   - create taxonomy rows in rv_* tables
//   - populate rv_species rows
//   - populate higher-level taxonomy links
//   - link matching erv_lineage rows to rv_species
//   - optionally link erv_lineage rows directly to higher taxonomic ranks
//
// Assumptions:
//   - sublineage / annotation_group / repeat_group rows are stored in erv_lineage
//   - erv_lineage row IDs match sequenceID
//   - representative sequences are linked separately via sequence -> erv_lineage

var INPUT_PATH = "tabular/reference/herv_sublineage_data.tsv";

function loadTsv(path) {
	var rows;
	glue.inMode("module/tabularUtility", function() {
		rows = glue.tableToObjects(glue.command(["load-tabular", path]));
	});
	return rows;
}

function norm(value) {
	if(value === null || value === undefined) {
		return null;
	}
	var s = ("" + value).trim();
	if(s === "") {
		return null;
	}
	var low = s.toLowerCase();
	if(low === "n/a" || low === "na" || low === "null" || low === "none") {
		return null;
	}
	return s;
}

function ensureRow(tableName, rowId) {
	rowId = norm(rowId);
	if(rowId === null) {
		return;
	}
	try {
		glue.command(["create", "custom-table-row", tableName, rowId]);
	} catch(e) {
		// assume row already exists
	}
}

function setFieldIfPresent(fieldName, value) {
	value = norm(value);
	if(value !== null) {
		glue.command(["set", "field", fieldName, value]);
	}
}

function setLinkIfPresent(linkName, targetPath) {
	if(targetPath !== null) {
		glue.command(["set", "link-target", linkName, targetPath]);
	}
}

function customRowPath(tableName, rowId) {
	return "custom-table-row/" + tableName + "/" + rowId;
}

// Load TSV rows
var taxRows = loadTsv(INPUT_PATH);
glue.logInfo("Loaded " + taxRows.length + " rows from " + INPUT_PATH);

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

	if(speciesId === null) {
		glue.logInfo("Skipping row with missing species: " + JSON.stringify(row));
		return;
	}

	glue.inMode(customRowPath("rv_species", speciesId), function() {
		setFieldIfPresent("full_name", row["full_name"]);
		setFieldIfPresent("name", row["name"]);

		if(genusId !== null) {
			setLinkIfPresent("rv_genus", customRowPath("rv_genus", genusId));
		}
		if(subgenusId !== null) {
			setLinkIfPresent("rv_subgenus", customRowPath("rv_subgenus", subgenusId));
		}
		if(subfamilyId !== null) {
			setLinkIfPresent("rv_subfamily", customRowPath("rv_subfamily", subfamilyId));
		}
		if(cladeId !== null) {
			setLinkIfPresent("rv_clade", customRowPath("rv_clade", cladeId));
		}
	});

	if(subgenusId !== null && genusId !== null) {
		glue.inMode(customRowPath("rv_subgenus", subgenusId), function() {
			setLinkIfPresent("rv_genus", customRowPath("rv_genus", genusId));
		});
	}

	if(genusId !== null && subfamilyId !== null) {
		glue.inMode(customRowPath("rv_genus", genusId), function() {
			setLinkIfPresent("rv_subfamily", customRowPath("rv_subfamily", subfamilyId));
		});
	}

	if(subfamilyId !== null && cladeId !== null) {
		glue.inMode(customRowPath("rv_subfamily", subfamilyId), function() {
			setLinkIfPresent("rv_clade", customRowPath("rv_clade", cladeId));
		});
	}
});

// --------------------------------------------------
// Pass 3: link erv_lineage rows -> taxonomy
// --------------------------------------------------

_.each(taxRows, function(row) {

	var lineageId = norm(row["sequenceID"]);
	var speciesId = norm(row["species"]);
	var cladeId = norm(row["clade"]);
	var subfamilyId = norm(row["subfamily"]);
	var genusId = norm(row["genus"]);
	var subgenusId = norm(row["subgenus"]);

	if(lineageId === null) {
		glue.logInfo("Skipping row with missing sequenceID: " + JSON.stringify(row));
		return;
	}
	if(speciesId === null) {
		glue.logInfo("Skipping erv_lineage row '" + lineageId + "' because species is missing");
		return;
	}

	try {
		glue.inMode(customRowPath("erv_lineage", lineageId), function() {
			setLinkIfPresent("rv_species", customRowPath("rv_species", speciesId));

			if(subgenusId !== null) {
				setLinkIfPresent("rv_subgenus", customRowPath("rv_subgenus", subgenusId));
			}
			if(genusId !== null) {
				setLinkIfPresent("rv_genus", customRowPath("rv_genus", genusId));
			}
			if(subfamilyId !== null) {
				setLinkIfPresent("rv_subfamily", customRowPath("rv_subfamily", subfamilyId));
			}
			if(cladeId !== null) {
				setLinkIfPresent("rv_clade", customRowPath("rv_clade", cladeId));
			}
		});
	} catch(e) {
		glue.logInfo("Could not link erv_lineage row '" + lineageId + "' to taxonomy");
	}
});
