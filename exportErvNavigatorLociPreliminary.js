// glue/build/locus/exportErvNavigatorLociPreliminary.js
//
// Export preliminary ERV Navigator loci table by combining:
//   erv_locus_candidate
//   erv_locus_candidate_name
//
// Output:
//   web-app/ervnavigator_loci_preliminary.tsv

var OUTPUT_PATH = "web-app/ervnavigator_loci_preliminary.tsv";

var FileWriter = Java.type("java.io.FileWriter");
var BufferedWriter = Java.type("java.io.BufferedWriter");

function norm(value) {
	if(value === null || value === undefined) return null;
	var s = ("" + value).trim();
	if(s === "" || s === "-" || s.toLowerCase() === "na" || s.toLowerCase() === "n/a") return null;
	return s;
}

function out(value) {
	value = norm(value);
	if(value === null) return "";
	return ("" + value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function hasValue(value) {
	return norm(value) !== null;
}

function supportingDatasets(row) {
	var parts = [];
	if(hasValue(row["digs_ids"])) parts.push("DIGS");
	if(hasValue(row["repbase_ids"])) parts.push("Repbase");
	if(hasValue(row["retrotector_ids"])) parts.push("Retrotector");
	return parts.join(",");
}

function category(row) {
	var status = norm(row["status"]);
	var curatedns = norm(row["curatedns"]);

	if(status === "LTR") return "soloLTR";
	if(status === "ERV" && curatedns === "1") return "High-support ERV";
	if(status === "ERV" && curatedns === "0") return "Low-support ERV";
	if(status === "ERV") return "ERV";
	return "";
}

function taxonomicResolution(row) {
	var cs = norm(row["case_status"]);

	if(cs === "Fully resolved") return "Resolved";
	if(cs === "Unresolved") return "Unresolved";
	if(cs === "Mosaic") return "Mosaic";

	if(cs !== null && cs.indexOf("Resolved at") === 0) return "Mosaic";

	return "";
}

function rowKey(row) {
	return norm(row["id"]);
}

// Load candidate rows
var candidateRows = glue.tableToObjects(glue.command([
	"list", "custom-table-row", "erv_locus_candidate",
	"id",
	"case_status",
	"chrom",
	"clade_out",
	"curatedns",
	"digs_ids",
	"end_position",
	"genes",
	"genes_order",
	"genes_simplified",
	"group_out",
	"length",
	"makes_mosaic",
	"names",
	"names_decision",
	"phylogeny_name",
	"repbase_ids",
	"retrotector_ids",
	"start_position",
	"status",
	"strand",
	"subgroup_out"
]));

// Load naming rows
var nameRows = glue.tableToObjects(glue.command([
	"list", "custom-table-row", "erv_locus_candidate_name",
	"id",
	"candidate_id",
	"naming_source",
	"raw_name",
	"resolved_lineage_id",
	"standard_id",
	"locus_number",
	"missillac_id",
	"resolution_status",
	"notes"
]));

var nameByCandidateId = {};
_.each(nameRows, function(row) {
	var cid = norm(row["candidate_id"]);
	if(cid === null) cid = norm(row["id"]);
	if(cid !== null) {
		nameByCandidateId[cid] = row;
	}
});

var headers = [
	"RBRT_ID",
	"Missillac_ID",
	"Lineage_ID",
	"Resolved_Lineage_ID",
	"Locus_Number",
	"Naming_Status",
	"Naming_Source",
	"Raw_Name",

	"Chromosome",
	"Start",
	"End",
	"Strand",
	"Length",

	"Status",
	"Category",
	"Taxonomic_Resolution",
	"Case_Status",
	"Makes_Mosaic",

	"Supporting_Datasets",
	"DIGS_IDs",
	"Repbase_IDs",
	"Retrotector_IDs",

	"Names",
	"Names_Decision",
	"Genes",
	"Genes_Order",
	"Genes_Simplified",

	"Clade",
	"Group",
	"Subgroup",
	"Phylogeny_Name",

	"Host_Species",
	"Genome_Build",
	"Coverage_Available",
	"Features",
	"Notes"
];

var writer = new BufferedWriter(new FileWriter(OUTPUT_PATH));
writer.write(headers.join("\t"));
writer.newLine();

var exported = 0;
var missingNames = 0;

_.each(candidateRows, function(row) {

	var id = rowKey(row);
	if(id === null) return;

	var nameRow = nameByCandidateId[id];
	if(nameRow === undefined) {
		missingNames++;
		nameRow = {};
	}

	var values = [
		id,
		nameRow["missillac_id"],
		nameRow["standard_id"],
		nameRow["resolved_lineage_id"],
		nameRow["locus_number"],
		nameRow["resolution_status"],
		nameRow["naming_source"],
		nameRow["raw_name"],

		row["chrom"],
		row["start_position"],
		row["end_position"],
		row["strand"],
		row["length"],

		row["status"],
		category(row),
		taxonomicResolution(row),
		row["case_status"],
		row["makes_mosaic"],

		supportingDatasets(row),
		row["digs_ids"],
		row["repbase_ids"],
		row["retrotector_ids"],

		row["names"],
		row["names_decision"],
		row["genes"],
		row["genes_order"],
		row["genes_simplified"],

		row["clade_out"],
		row["group_out"],
		row["subgroup_out"],
		row["phylogeny_name"],

		"Homo sapiens",
		"hg19",
		"false",
		"",
		nameRow["notes"]
	];

	writer.write(_.map(values, out).join("\t"));
	writer.newLine();

	exported++;

	if(exported % 10000 === 0) {
		glue.logInfo("Exported " + exported + " rows");
	}
});

writer.close();

glue.logInfo("Preliminary ERV Navigator locus export complete");
glue.logInfo("Output file: " + OUTPUT_PATH);
glue.logInfo("Exported rows: " + exported);
glue.logInfo("Rows missing naming data: " + missingNames);