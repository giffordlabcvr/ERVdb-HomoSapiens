
/**
 * reportHml5HakoRecognition.js
 *
 * Screen HML5-assigned human ERV loci for HERV-hako
 * recognition using ervLineageRecogniser.
 *
 * Selection uses the existing Missillac namespace.
 *
 * Read-only: does not alter GLUE database records.
 */

var RECOGNISER = "ervLineageRecogniser";

var WHERE_CLAUSE =
    "erv_locus.missillac_id like 'ERV-2.Beta.Archaeo.5%' " +
    "and erv_locus.locus_type = 'erv'";

var HAKO_CATEGORY = "HERVhako";
var HML5_CATEGORY = "HERVKHML5";

var OUTPUT_FILE =
    "tabular/locus/qc/hml5_hako_recognition.tsv";

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function log(message) {
    glue.logInfo(String(message));
}

function query(command) {
    return glue.tableToObjects(glue.command(command));
}

function locusId(querySequenceId) {
    var value = String(querySequenceId);
    return value.substring(value.lastIndexOf("/") + 1);
}

function writeTsv(path, headers, rows) {

    var Paths = Java.type("java.nio.file.Paths");
    var Files = Java.type("java.nio.file.Files");
    var StandardCharsets =
        Java.type("java.nio.charset.StandardCharsets");

    var output = Paths.get(path);
    Files.createDirectories(output.getParent());

    var lines = [headers.join("\t")];

    rows.forEach(function(row) {
        lines.push(headers.map(function(h) {
            return String(
                row[h] === undefined ? "" : row[h]
            ).replace(/[\t\r\n]/g, " ");
        }).join("\t"));
    });


	
	var ArrayList = Java.type("java.util.ArrayList");
	
	var javaLines = new ArrayList();
	
	lines.forEach(function(line) {
		javaLines.add(line);
	});
	
	Files.write(
		output,
		javaLines,
		StandardCharsets.UTF_8
	);



}

// --------------------------------------------------
// 1. SELECT HML5-ASSIGNED LOCI
// --------------------------------------------------

log("Selecting HML5-assigned loci...");

var sequences = query([
    "list",
    "sequence",
    "sequenceID",
    "-w",
    WHERE_CLAUSE
]);

var ids = sequences.map(function(row) {
    return String(row.sequenceID);
});

log("Selected loci: " + ids.length);

// --------------------------------------------------
// 2. RUN RECOGNISER
// --------------------------------------------------

log("Running lineage recogniser...");

var hits = [];

glue.inMode("module/" + RECOGNISER, function() {

    hits = query([
        "recognise",
        "sequence",
        "-w",
        WHERE_CLAUSE
    ]);

});

log("Recognition results: " + hits.length);

// --------------------------------------------------
// 3. COLLECT RECOGNITION CATEGORIES
// --------------------------------------------------

var byLocus = {};

ids.forEach(function(id) {
    byLocus[id] = {};
});

hits.forEach(function(hit) {

    var id = locusId(hit.querySequenceId);
    var category = String(hit.categoryId);
    var direction = String(hit.direction);

    if(!Object.prototype.hasOwnProperty.call(byLocus, id)) {
        throw new Error("Unexpected locus: " + id);
    }

    if(!byLocus[id][category]) {
        byLocus[id][category] = {};
    }

    byLocus[id][category][direction] = true;
});

// --------------------------------------------------
// 4. CLASSIFY RESULTS
// --------------------------------------------------

var summary = {
    HAKO_ONLY: 0,
    HAKO_AND_HML5: 0,
    HML5_ONLY: 0,
    OTHER_ONLY: 0,
    NO_RECOGNITION: 0
};

var rows = ids.map(function(id) {

    var categories = Object.keys(byLocus[id]).sort();

    var hasHako =
        categories.indexOf(HAKO_CATEGORY) >= 0;

    var hasHml5 =
        categories.indexOf(HML5_CATEGORY) >= 0;

    var status;

    if(hasHako && hasHml5) {
        status = "HAKO_AND_HML5";
    } else if(hasHako) {
        status = "HAKO_ONLY";
    } else if(hasHml5) {
        status = "HML5_ONLY";
    } else if(categories.length > 0) {
        status = "OTHER_ONLY";
    } else {
        status = "NO_RECOGNITION";
    }

    summary[status]++;

    var hakoDirections = hasHako
        ? Object.keys(byLocus[id][HAKO_CATEGORY]).sort()
        : [];

    return {
        locus_id: id,
        hako_recognised: hasHako,
        hml5_recognised: hasHml5,
        status: status,
        hako_directions: hakoDirections.join(";"),
        categories: categories.join(";")
    };
});

// --------------------------------------------------
// 5. SORT HAKO CANDIDATES FIRST
// --------------------------------------------------

var priority = {
    HAKO_ONLY: 0,
    HAKO_AND_HML5: 1,
    HML5_ONLY: 2,
    OTHER_ONLY: 3,
    NO_RECOGNITION: 4
};

rows.sort(function(a, b) {

    var diff =
        priority[a.status] - priority[b.status];

    return diff ||
        a.locus_id.localeCompare(b.locus_id);
});

// --------------------------------------------------
// 6. WRITE TSV
// --------------------------------------------------

writeTsv(
    OUTPUT_FILE,
    [
        "locus_id",
        "hako_recognised",
        "hml5_recognised",
        "status",
        "hako_directions",
        "categories"
    ],
    rows
);

// --------------------------------------------------
// 7. SUMMARY
// --------------------------------------------------

log("");
log("===================================");
log("HML5 / HERV-HAKO RECOGNITION");
log("===================================");

log("Total loci: " + ids.length);

[
    "HAKO_ONLY",
    "HAKO_AND_HML5",
    "HML5_ONLY",
    "OTHER_ONLY",
    "NO_RECOGNITION"
].forEach(function(status) {
    log(status + ": " + summary[status]);
});

log("");
log("Output: " + OUTPUT_FILE);
log("No database changes made.");
