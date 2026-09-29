/**
 * glue/build/reference/ervr/loadSublineageAssociatedLtrLineages.js
 *
 * Load LTR lineages associated with ERV sublineage-layer records from:
 *
 *   tabular/ervr/sublineage/ervr_ltr_data_all.tsv
 *
 * LTR_name identifies the ltr_lineage row. The reference row is identified
 * by the actual sequenceID found in source ltr-sub. Usually this is
 * LTR_name, but original_name is also searched as a fallback.
 *
 * linked_lineage_id identifies an existing erv_lineage row. An LTR lineage
 * may have no ERV association.
 */

var INPUT_FILE = "tabular/reference/ervr/ervr_ltr_data_all.tsv";
var LTR_SOURCE = "ltr-sub";
var LTR_CATEGORY = "erv";
var DRY_RUN = false;


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(message) {
    glue.logInfo(message);
}

function norm(value) {
    if(value === null || value === undefined) {
        return null;
    }

    var result = ("" + value).trim();

    if(result === "") {
        return null;
    }

    var lower = result.toLowerCase();

    if(
        lower === "n/a" ||
        lower === "na" ||
        lower === "n/k" ||
        lower === "nk" ||
        lower === "unknown" ||
        lower === "null" ||
        lower === "none"
    ) {
        return null;
    }

    return result;
}

function escapeQuotes(value) {
    return ("" + value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}

function customRowPath(tableName, rowId) {
    return "custom-table-row/" + tableName + "/" + rowId;
}

function customRowExists(tableName, rowId) {
    rowId = norm(rowId);

    if(rowId === null) {
        return false;
    }

    var result = glue.command([
        "list",
        "custom-table-row",
        tableName,
        "-w",
        "id = '" + escapeQuotes(rowId) + "'"
    ]);

    return glue.tableToObjects(result).length > 0;
}

function ensureCustomRow(tableName, rowId) {
    rowId = norm(rowId);

    if(rowId === null || customRowExists(tableName, rowId)) {
        return false;
    }

    if(DRY_RUN) {
        log("[DRY RUN] Would create " + tableName + "/" + rowId);
        return true;
    }

    glue.command([
        "create",
        "custom-table-row",
        tableName,
        rowId
    ]);

    log("Created " + tableName + "/" + rowId);
    return true;
}

function setFieldIfPresent(fieldName, value) {
    value = norm(value);

    if(value !== null) {
        glue.command([
            "set",
            "field",
            fieldName,
            value
        ]);
    }
}

function setLink(linkName, tableName, rowId) {
    glue.command([
        "set",
        "link-target",
        linkName,
        customRowPath(tableName, rowId)
    ]);
}

function findSequenceInSource(sourceName, sequenceID) {
    sequenceID = norm(sequenceID);

    if(sequenceID === null) {
        return null;
    }

    var rows = glue.tableToObjects(
        glue.command([
            "list",
            "sequence",
            "source.name",
            "sequenceID",
            "-w",
            "source.name = '" +
                escapeQuotes(sourceName) +
                "' and sequenceID = '" +
                escapeQuotes(sequenceID) +
                "'"
        ])
    );

    if(rows.length === 0) {
        return null;
    }

    return {
        sourceName: sourceName,
        sequenceID: sequenceID
    };
}

function findLtrSequence(ltrLineageId, originalName) {
    var found = findSequenceInSource(
        LTR_SOURCE,
        ltrLineageId
    );

    if(
        found === null &&
        originalName !== null &&
        originalName !== ltrLineageId
    ) {
        found = findSequenceInSource(
            LTR_SOURCE,
            originalName
        );
    }

    return found;
}

function associationId(ervLineageId, ltrLineageId) {
    return ervLineageId + "__" + ltrLineageId;
}

function associationComment(row, ltrLineageId, ervLineageId) {
    var comment =
        "LTR lineage " + ltrLineageId +
        " associated with ERV lineage " + ervLineageId;

    var linkedElementName =
        norm(row["linked_element_name"]);
    var linkedElementStatus =
        norm(row["linked_element_status"]);
    var assocCategory =
        norm(row["assoc_category"]);
    var flag =
        norm(row["flag"]);

    if(linkedElementName !== null) {
        comment +=
            "; original linked element: " +
            linkedElementName;
    }

    if(linkedElementStatus !== null) {
        comment +=
            "; source element status: " +
            linkedElementStatus;
    }

    if(assocCategory !== null) {
        comment +=
            "; source category: " +
            assocCategory;
    }

    if(flag !== null) {
        comment +=
            "; source flag: " +
            flag;
    }

    return comment;
}


// ---------------------------------------------------------------------------
// Load and inspect input
// ---------------------------------------------------------------------------

var rows;

glue.inMode("module/tabularUtility", function() {
    rows = glue.tableToObjects(
        glue.command([
            "load-tabular",
            INPUT_FILE
        ])
    );
});

log(
    "Loaded " + rows.length +
    " rows from " + INPUT_FILE
);
log("LTR sequence search source: " + LTR_SOURCE);


// ---------------------------------------------------------------------------
// Preflight: resolve identifiers and detect conflicting assignments
// ---------------------------------------------------------------------------

var prepared = [];
var referenceToLineage = {};
var seenAssociations = {};

_.each(rows, function(row) {
    var ltrLineageId =
        norm(row["LTR_name"]);
    var ervLineageId =
        norm(row["linked_lineage_id"]);
    var originalName =
        norm(row["original_name"]);

    if(ltrLineageId === null) {
        throw new Error(
            "Missing LTR_name in row: " +
            JSON.stringify(row)
        );
    }

    var sequenceRef =
        findLtrSequence(ltrLineageId, originalName);

    if(sequenceRef !== null) {
        var referenceId = sequenceRef.sequenceID;
        var previousLineage =
            referenceToLineage[referenceId];

        if(
            previousLineage !== undefined &&
            previousLineage !== ltrLineageId
        ) {
            throw new Error(
                "LTR sequence " + LTR_SOURCE + "/" +
                referenceId +
                " is assigned to both '" +
                previousLineage + "' and '" +
                ltrLineageId + "'"
            );
        }

        referenceToLineage[referenceId] =
            ltrLineageId;
    }

    if(ervLineageId !== null) {
        if(
            !customRowExists(
                "erv_lineage",
                ervLineageId
            )
        ) {
            throw new Error(
                "ERV lineage '" + ervLineageId +
                "' not found for LTR lineage '" +
                ltrLineageId + "'"
            );
        }

        var assocId =
            associationId(
                ervLineageId,
                ltrLineageId
            );

        if(seenAssociations[assocId]) {
            throw new Error(
                "Duplicate ERV-LTR association '" +
                assocId + "' in input"
            );
        }

        seenAssociations[assocId] = true;
    }

    prepared.push({
        row: row,
        ltrLineageId: ltrLineageId,
        ervLineageId: ervLineageId,
        sequenceRef: sequenceRef
    });
});

log("Preflight successful");


// ---------------------------------------------------------------------------
// Pass 1: create lineage, reference and association rows
// ---------------------------------------------------------------------------

var ltrRowsCreated = 0;
var referenceRowsCreated = 0;
var associationsCreated = 0;

_.each(prepared, function(item) {
    if(
        ensureCustomRow(
            "ltr_lineage",
            item.ltrLineageId
        )
    ) {
        ltrRowsCreated++;
    }

    if(item.sequenceRef !== null) {
        if(
            ensureCustomRow(
                "ltr_lineage_reference",
                item.sequenceRef.sequenceID
            )
        ) {
            referenceRowsCreated++;
        }
    }

    if(item.ervLineageId !== null) {
        if(
            ensureCustomRow(
                "erv_lineage_ltr_assoc",
                associationId(
                    item.ervLineageId,
                    item.ltrLineageId
                )
            )
        ) {
            associationsCreated++;
        }
    }
});

log(
    "Created/verified LTR lineage, reference and " +
    "association rows"
);


// ---------------------------------------------------------------------------
// Pass 2: populate records and links
// ---------------------------------------------------------------------------

var populatedLtrLineages = {};
var linkedReferences = {};
var missingSequences = 0;
var associationsUpdated = 0;
var unlinkedLtrRows = 0;

_.each(prepared, function(item) {
    var row = item.row;
    var ltrLineageId = item.ltrLineageId;
    var ervLineageId = item.ervLineageId;
    var sequenceRef = item.sequenceRef;

    if(!populatedLtrLineages[ltrLineageId]) {
        if(!DRY_RUN) {
            glue.inMode(
                customRowPath(
                    "ltr_lineage",
                    ltrLineageId
                ),
                function() {
                    setFieldIfPresent(
                        "original_name",
                        row["original_name"]
                    );
                    setFieldIfPresent(
                        "ltr_category",
                        LTR_CATEGORY
                    );
                }
            );
        }

        populatedLtrLineages[ltrLineageId] = true;
    }

    if(sequenceRef === null) {
        missingSequences++;

        log(
            "No LTR sequence found for " +
            "ltr_lineage/" + ltrLineageId
        );
    } else {
        var referenceId =
            sequenceRef.sequenceID;

        if(!linkedReferences[referenceId]) {
            if(!DRY_RUN) {
                glue.inMode(
                    customRowPath(
                        "ltr_lineage_reference",
                        referenceId
                    ),
                    function() {
                        setLink(
                            "ltr_lineage",
                            "ltr_lineage",
                            ltrLineageId
                        );
                    }
                );

                glue.inMode(
                    "sequence/" +
                    sequenceRef.sourceName +
                    "/" +
                    referenceId,
                    function() {
                        setLink(
                            "ltr_lineage_reference",
                            "ltr_lineage_reference",
                            referenceId
                        );
                    }
                );
            }

            linkedReferences[referenceId] = true;

            log(
                "Linked LTR sequence " +
                sequenceRef.sourceName + "/" +
                referenceId +
                " -> ltr_lineage_reference/" +
                referenceId +
                " -> ltr_lineage/" +
                ltrLineageId
            );
        }
    }

    if(ervLineageId === null) {
        unlinkedLtrRows++;
        return;
    }

    var assocId =
        associationId(
            ervLineageId,
            ltrLineageId
        );


	if(!DRY_RUN) {
		glue.inMode(
			customRowPath(
				"erv_lineage_ltr_assoc",
				assocId
			),
			function() {
				setLink(
					"erv_lineage",
					"erv_lineage",
					ervLineageId
				);
				setLink(
					"ltr_lineage",
					"ltr_lineage",
					ltrLineageId
				);
			}
		);
	}

    associationsUpdated++;
});


// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

log("----- LTR SUBLINEAGE-LAYER SUMMARY -----");
log("Input rows: " + rows.length);
log(
    "Distinct LTR lineages: " +
    Object.keys(populatedLtrLineages).length
);
log("LTR lineage rows created: " + ltrRowsCreated);
log("LTR reference rows created: " + referenceRowsCreated);
log(
    "LTR references linked: " +
    Object.keys(linkedReferences).length
);
log("Rows without an LTR sequence: " + missingSequences);
log("Association rows created: " + associationsCreated);
log("Associations populated: " + associationsUpdated);
log(
    "Rows without an ERV association: " +
    unlinkedLtrRows
);
log("Finished loading sublineage-associated LTR lineages");
