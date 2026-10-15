
/**
 * reportHml6HakoRecognition.js
 *
 * Screen Hml6-assigned human ERV loci for HERV-hako
 * recognition using ervLineageRecogniser.
 *
 * Selection uses the existing Missillac namespace.
 *
 * Read-only: does not alter GLUE database records.
 */

var RECOGNISER = "ervLineageRecogniser";

var WHERE_CLAUSE =
    "erv_locus.missillac_id like 'ERV-2.Beta.Archaeo.6%' " +
    "and erv_locus.locus_type = 'erv'";

var HAKO_CATEGORY = "HERVhako";
var Hml6_CATEGORY = "HERVKHml6";

var OUTPUT_FILE =
    "tabular/locus/qc/Hml6_hako_recognition.tsv";

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
// 1. SELECT Hml6-ASSIGNED LOCI
// --------------------------------------------------

log("Selecting Hml6-assigned loci...");

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
    HAKO_AND_Hml6: 0,
    Hml6_ONLY: 0,
    OTHER_ONLY: 0,
    NO_RECOGNITION: 0
};

var rows = ids.map(function(id) {

    var categories = Object.keys(byLocus[id]).sort();

    var hasHako =
        categories.indexOf(HAKO_CATEGORY) >= 0;

    var hasHml6 =
        categories.indexOf(Hml6_CATEGORY) >= 0;

    var status;

    if(hasHako && hasHml6) {
        status = "HAKO_AND_Hml6";
    } else if(hasHako) {
        status = "HAKO_ONLY";
    } else if(hasHml6) {
        status = "Hml6_ONLY";
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
        Hml6_recognised: hasHml6,
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
    HAKO_AND_Hml6: 1,
    Hml6_ONLY: 2,
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
        "Hml6_recognised",
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
log("Hml6 / HERV-HAKO RECOGNITION");
log("===================================");

log("Total loci: " + ids.length);

[
    "HAKO_ONLY",
    "HAKO_AND_Hml6",
    "Hml6_ONLY",
    "OTHER_ONLY",
    "NO_RECOGNITION"
].forEach(function(status) {
    log(status + ": " + summary[status]);
});

log("");
log("Output: " + OUTPUT_FILE);
log("No database changes made.");
