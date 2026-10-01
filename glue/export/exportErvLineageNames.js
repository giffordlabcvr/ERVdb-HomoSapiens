// glue/export/exportErvLineageNames.js
//
// Export all user-facing/searchable names associated with ERV lineages.
//
// Combines:
//   - erv_lineage.legacy_name
//   - erv_lineage.legacy_full_name
//   - erv_lineage_alias.alias_name / alias_source
//
// Output:
//   web-app/erv_lineage_names.tsv
//
// Written for GLUE's ECMAScript 5.1 / Nashorn JavaScript layer.

var OUTPUT_PATH =
    "web-app/erv_lineage_names.tsv";

var FileWriter =
    Java.type("java.io.FileWriter");

var BufferedWriter =
    Java.type("java.io.BufferedWriter");


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function listResultRows(result) {
    if(result === null ||
            result === undefined ||
            result.listResult === undefined) {
        return [];
    }

    return result.listResult.row || [];
}

function listResultColumns(result) {
    if(result === null ||
            result === undefined ||
            result.listResult === undefined) {
        return [];
    }

    return result.listResult.column || [];
}

function rowToObject(columns, row) {
    var object = {};
    var values = row.value || [];

    for(var i = 0; i < columns.length; i++) {
        object[columns[i]] = values[i];
    }

    return object;
}

function tsvEscape(value) {
    if(value === null ||
            value === undefined) {
        return "";
    }

    return String(value)
        .replace(/\t/g, " ")
        .replace(/\r?\n/g, " ");
}

function writeTsvLine(writer, fields) {
    var values = [];

    for(var i = 0; i < fields.length; i++) {
        values.push(
            tsvEscape(fields[i])
        );
    }

    writer.write(
        values.join("\t")
    );

    writer.newLine();
}

function hasValue(value) {
    return value !== null &&
        value !== undefined &&
        String(value).trim() !== "";
}


// -----------------------------------------------------------------------------
// Collect names
// -----------------------------------------------------------------------------

var names = [];


// Canonical / legacy names stored on erv_lineage

var lineageResult = glue.command([
    "list",
    "custom-table-row",
    "erv_lineage",
    "id",
    "legacy_name",
    "legacy_full_name"
]);

var lineageColumns =
    listResultColumns(lineageResult);

var lineageRows =
    listResultRows(lineageResult);

for(var i = 0; i < lineageRows.length; i++) {

    var lineage =
        rowToObject(
            lineageColumns,
            lineageRows[i]
        );

    if(hasValue(lineage.legacy_name)) {
        names.push({
            erv_lineage_id: lineage.id,
            name: lineage.legacy_name,
            name_type: "legacy_name",
            source: "ervdb"
        });
    }

    if(hasValue(lineage.legacy_full_name)) {
        names.push({
            erv_lineage_id: lineage.id,
            name: lineage.legacy_full_name,
            name_type: "legacy_full_name",
            source: "ervdb"
        });
    }
}


// Additional aliases

var aliasResult = glue.command([
    "list",
    "custom-table-row",
    "erv_lineage_alias",
    "erv_lineage.id",
    "alias_name",
    "alias_source"
]);

var aliasColumns =
    listResultColumns(aliasResult);

var aliasRows =
    listResultRows(aliasResult);

for(var j = 0; j < aliasRows.length; j++) {

    var alias =
        rowToObject(
            aliasColumns,
            aliasRows[j]
        );

    if(hasValue(alias.alias_name)) {
        names.push({
            erv_lineage_id: alias["erv_lineage.id"],
            name: alias.alias_name,
            name_type: "alias",
            source: alias.alias_source
        });
    }
}


// -----------------------------------------------------------------------------
// Sort
// -----------------------------------------------------------------------------

names.sort(function(a, b) {

    var cmp =
        a.erv_lineage_id.localeCompare(
            b.erv_lineage_id
        );

    if(cmp !== 0) {
        return cmp;
    }

    cmp =
        a.name_type.localeCompare(
            b.name_type
        );

    if(cmp !== 0) {
        return cmp;
    }

    return a.name.localeCompare(b.name);
});


// -----------------------------------------------------------------------------
// Write output
// -----------------------------------------------------------------------------

var writer =
    new BufferedWriter(
        new FileWriter(OUTPUT_PATH)
    );

try {

    writeTsvLine(writer, [
        "erv_lineage_id",
        "name",
        "name_type",
        "source"
    ]);

    for(var k = 0; k < names.length; k++) {

        var record = names[k];

        writeTsvLine(writer, [
            record.erv_lineage_id,
            record.name,
            record.name_type,
            record.source
        ]);
    }

} finally {
    writer.close();
}

glue.logInfo(
    "Exported " +
    names.length +
    " ERV lineage names to " +
    OUTPUT_PATH
);
