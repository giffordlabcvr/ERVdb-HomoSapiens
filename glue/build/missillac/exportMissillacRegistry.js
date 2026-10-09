// glue/build/missillac/exportMissillacRegistry.js
//
// INITIAL REGISTRY EXPORT ONLY.
// Run after applyErvLocusNames.js.
//
// Reads the database; creates a new UTF-8 TSV.
// Never overwrites an existing file.
//
// Future maintenance exports must merge the previous registry,
// retaining retired IDs. This script cannot establish historical
// non-reuse.
//
// One row represents a locus membership, not a species-specific
// Missillac ID.
//
// This bootstrap version requires a single species/assembly,
// like the current allocator.
//
// Coordinates are copied unchanged from erv_locus.
// No coordinate conversion is performed.
//
// Java NIO uses an absolute container path,
// NOT GLUE's load-save-path.

(function() {

    var OUTPUT_PATH =
        '/workspace/ERVdb-HomoSapiens/tabular/missillac/' +
        'missillac_registry.tsv';

    var MAX_DETAILS = 50;

    var errors = [];
    var eligibleCount = 0;


    // --------------------------------------------------------
    // Utilities
    // --------------------------------------------------------

    function clean(v) {
        if(v === null || v === undefined) {
            return '';
        }

        var s = String(v).trim();

        return /^(null|none|na|n\/a|-)$/i.test(s)
            ? ''
            : s;
    }

    function integer(v) {
        var s = clean(v);
        var n = Number(s);

        return /^\d+$/.test(s) &&
            n > 0 &&
            n <= 9007199254740991 &&
            Math.floor(n) === n
            ? n
            : null;
    }

    function query(table, fields) {
        return glue.tableToObjects(
            glue.command(
                ['list', 'custom-table-row', table]
                    .concat(fields)
            )
        );
    }

    function fail(message) {
        errors.push(message);
    }

    function map() {
        return Object.create(null);
    }


    // --------------------------------------------------------
    // Load loci
    // --------------------------------------------------------

    var loci = query('erv_locus', [
        'id',
        'host_species',
        'genome_build',
        'scaffold',
        'start_position',
        'end_position',
        'locus_type',
        'orthology_group',
        'missillac_id'
    ]);

    var known = map();
    var lineages = map();
    var groups = map();
    var scopes = map();

    loci.forEach(function(r) {
        var id = clean(r.id);

        if(!id || known[id]) {
            fail('Missing/duplicate locus ID: ' + id);
        }

        known[id] = true;
    });


    // --------------------------------------------------------
    // Load lineage associations
    // --------------------------------------------------------

    query('erv_locus_lineage_assoc', [
        'erv_locus.id',
        'erv_lineage.id'
    ]).forEach(function(r) {

        var id = clean(r['erv_locus.id']);
        var lin = clean(r['erv_lineage.id']);

        if(!known[id] || !lin) {
            fail(
                'Broken lineage association: ' +
                JSON.stringify(r)
            );
            return;
        }

        if(!lineages[id]) {
            lineages[id] = map();
        }

        lineages[id][lin] = true;
    });


    // --------------------------------------------------------
    // Validate and prepare registry rows
    // --------------------------------------------------------

    var exported = [];
    var timestamp = new Date().toISOString();

    var columns = [
        'registry_version',
        'registry_created_utc',
        'status',
        'group_key',
        'missillac_id',
        'lineage_id',
        'orthology_group',
        'locus_id',
        'host_species',
        'genome_build',
        'scaffold',
        'start_position',
        'end_position',
        'locus_type'
    ];

    loci.forEach(function(r) {

        var id = clean(r.id);
        var ls = Object.keys(lineages[id] || {});
        var type = clean(r.locus_type).toLowerCase();

        var eligible =
            ls.length === 1 &&
            (type === 'erv' || type === 'solo_ltr');

        var mid = clean(r.missillac_id);
        var rawGroup = clean(r.orthology_group);

        if(!eligible) {
            if(mid || rawGroup) {
                fail(
                    'Ineligible locus has naming fields: ' +
                    id
                );
            }
            return;
        }

        eligibleCount++;

        var n = integer(rawGroup);

        if(!mid || n === null) {
            fail(
                'Eligible locus lacks a complete valid ' +
                'assignment: ' + id
            );
            return;
        }

        var groupKey = ls[0] + '-' + n;

        var expected =
            groupKey +
            (type === 'solo_ltr' ? '(LTR)' : '');

        if(mid !== expected) {
            fail(
                'Assignment differs from lineage/group/type: ' +
                id + ': ' + mid
            );
        }

        var species = clean(r.host_species);
        var build = clean(r.genome_build);
        var scaffold = clean(r.scaffold);

        if(
            !species ||
            !build ||
            !scaffold ||
            integer(r.start_position) === null ||
            integer(r.end_position) === null ||
            Number(r.start_position) > Number(r.end_position)
        ) {
            fail(
                'Incomplete/invalid locus identity: ' + id
            );
        }

        scopes[JSON.stringify([species, build])] = true;

        // Group identity excludes the LTR suffix and host species.
        // This uniqueness check is restricted to this bootstrap
        // workflow, which requires a single species/assembly.

        if(groups[groupKey]) {
            fail(
                'Duplicate bootstrap group: ' +
                groupKey + ': ' +
                groups[groupKey] + ', ' + id
            );
        }

        groups[groupKey] = id;

        exported.push([
            '1',
            timestamp,
            'active',
            groupKey,
            mid,
            ls[0],
            String(n),
            id,
            species,
            build,
            scaffold,
            clean(r.start_position),
            clean(r.end_position),
            type
        ]);
    });

    if(!eligibleCount) {
        fail(
            'No eligible loci: refusing to create an empty registry'
        );
    }

    if(Object.keys(scopes).length > 1) {
        fail(
            'Multiple species/assemblies: requires an ' +
            'orthology-aware maintenance exporter'
        );
    }

    exported.forEach(function(row) {
        row.forEach(function(value, i) {
            if(/[\t\r\n]/.test(value)) {
                fail(
                    'TSV control character in ' +
                    columns[i] +
                    ' for locus ' + row[7]
                );
            }
        });
    });

    if(errors.length) {
        errors.slice(0, MAX_DETAILS).forEach(function(e) {
            glue.logInfo('ERROR: ' + e);
        });

        throw new Error(
            'Registry export failed with ' +
            errors.length +
            ' error(s). No output written.'
        );
    }


    // --------------------------------------------------------
    // Sort by lineage, then numeric orthology group
    // --------------------------------------------------------

    exported.sort(function(a, b) {
        if(a[5] !== b[5]) {
            return a[5] < b[5] ? -1 : 1;
        }

        return Number(a[6]) - Number(b[6]);
    });


    // --------------------------------------------------------
    // Write a new registry file
    // --------------------------------------------------------

    var Paths = Java.type('java.nio.file.Paths');
    var Files = Java.type('java.nio.file.Files');

    var Options = Java.type(
        'java.nio.file.StandardOpenOption'
    );

    var Charset = Java.type(
        'java.nio.charset.StandardCharsets'
    );

    var path = Paths.get(OUTPUT_PATH);

    if(!path.isAbsolute()) {
        throw new Error(
            'OUTPUT_PATH must be absolute (container filesystem)'
        );
    }

    Files.createDirectories(path.getParent());

    // CREATE_NEW fails atomically if the destination already exists.
    var writer = Files.newBufferedWriter(
        path,
        Charset.UTF_8,
        Options.CREATE_NEW,
        Options.WRITE
    );

    try {
        writer.write(columns.join('\t') + '\n');

        exported.forEach(function(row) {
            writer.write(row.join('\t') + '\n');
        });

        writer.close();

    } catch(e) {

        try {
            writer.close();
        } catch(closeError) {
            // Preserve the original error.
        }

        try {
            Files.deleteIfExists(path);
        } catch(deleteError) {
            glue.logInfo(
                'WARNING: incomplete output could not be removed: ' +
                OUTPUT_PATH
            );
        }

        throw e;
    }


    // --------------------------------------------------------
    // Summary
    // --------------------------------------------------------

    glue.logInfo(
        'Initial Missillac registry exported: ' +
        exported.length +
        ' active assignments'
    );

    glue.logInfo('File: ' + OUTPUT_PATH);

    glue.logInfo(
        'No database changes. Historical/retired-ID ' +
        'validation was not performed.'
    );

}());
