// glue/build/missillac/importMissillacRegistry.js
//
// Restore Missillac assignments from the version-1 TSV registry.
//
// Matching:
//   Exact host species, genome build, scaffold, start and end.
//   Locus IDs may change if all identity fields still match.
//   Reuse of a registry locus ID at different coordinates is fatal.
//   No overlap-based or fuzzy matching.
//
// Safety:
//   Validate the registry and all proposed changes before writing.
//   Never overwrite a conflicting current assignment.
//   Retired rows are never restored.
//   Unmatched active rows remain in the input registry.
//   This script never edits the registry file.
//
// IMPORTANT:
//   This restores assignments only. It does not make the current
//   bootstrap allocator safe for maintenance builds.
//   Future allocation must reserve ALL registry numbers,
//   including those belonging to retired or absent loci.
//
// Scope:
//   Version 1 bootstrap registry: one species/assembly,
//   one locus membership per lineage/group.
//
// Java NIO paths are absolute container paths.
// They do not use GLUE's load-save-path.
//
// Database writes are not a single transaction. If interrupted,
// rerunning is safe: assignments already restored are unchanged.

(function() {

    var INPUT_PATH =
        '/workspace/ERVdb-HomoSapiens/tabular/missillac/' +
        'missillac_registry.tsv';

    // Start with a read-only review.
    // Set false once the proposed restoration is satisfactory.
    var DRY_RUN = true;

    var MAX_DETAILS = 100;

    var errors = [];
    var warnings = [];
    var assignments = [];
    var unchanged = 0;
    var unmatched = 0;
    var retired = 0;

    function map() {
        return Object.create(null);
    }

    function clean(value) {
        if(value === null || value === undefined) {
            return '';
        }

        var s = String(value).trim();

        return /^(null|none|na|n\/a|-)$/i.test(s)
            ? ''
            : s;
    }

    function positiveInt(value) {
        var s = clean(value);
        var n = Number(s);

        return /^\d+$/.test(s) &&
            isFinite(n) &&
            n > 0 &&
            Math.floor(n) === n &&
            n <= 9007199254740991
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

    function identity(row) {
        return JSON.stringify([
            clean(row.host_species),
            clean(row.genome_build),
            clean(row.scaffold),
            positiveInt(row.start_position),
            positiveInt(row.end_position)
        ]);
    }

    function validIdentity(row) {
        var start = positiveInt(row.start_position);
        var end = positiveInt(row.end_position);

        return !!clean(row.host_species) &&
            !!clean(row.genome_build) &&
            !!clean(row.scaffold) &&
            start !== null &&
            end !== null &&
            start <= end;
    }

    function stopIfErrors(stage) {
        if(errors.length === 0) return;

        errors.slice(0, MAX_DETAILS).forEach(function(message) {
            glue.logInfo('ERROR: ' + message);
        });

        throw new Error(
            stage + ' failed with ' + errors.length +
            ' error(s). No database changes made.'
        );
    }


    // --------------------------------------------------------
    // 1. Read the registry
    // --------------------------------------------------------

    var Paths = Java.type('java.nio.file.Paths');
    var Files = Java.type('java.nio.file.Files');
    var Charset = Java.type(
        'java.nio.charset.StandardCharsets'
    );

    var path = Paths.get(INPUT_PATH);

    if(!path.isAbsolute()) {
        throw new Error(
            'INPUT_PATH must be an absolute container path'
        );
    }

    var text = String(
        new (Java.type('java.lang.String'))(
            Files.readAllBytes(path),
            Charset.UTF_8
        )
    );

    text = text.replace(/^\uFEFF/, '');

    var lines = text.split(/\r\n|\n|\r/);

    // Allow trailing newline(s), but not empty rows inside the file.
    while(lines.length && lines[lines.length - 1] === '') {
        lines.pop();
    }

    if(lines.length < 2) {
        throw new Error('Registry is empty or has no data rows');
    }

    var headers = lines[0].split('\t');
    var headerMap = map();

    headers.forEach(function(name, index) {
        if(!name || headerMap[name] !== undefined) {
            errors.push('Missing or duplicate header: ' + name);
        }
        headerMap[name] = index;
    });

    var required = [
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

    required.forEach(function(name) {
        if(headerMap[name] === undefined) {
            errors.push('Missing required column: ' + name);
        }
    });

    stopIfErrors('Registry header validation');

    var registry = [];
    var reservedGroups = map();
    var registryLocusIds = map();
    var registryIdentities = map();
    var registryScopes = map();

    for(var i = 1; i < lines.length; i++) {

        var values = lines[i].split('\t');
        var rowNumber = i + 1;

        if(values.length !== headers.length) {
            errors.push(
                'Row ' + rowNumber +
                ': incorrect number of TSV columns'
            );
            continue;
        }

        var row = {};

        headers.forEach(function(name, index) {
            row[name] = values[index];
        });

        row.rowNumber = rowNumber;

        if(row.registry_version !== '1') {
            errors.push(
                'Row ' + rowNumber +
                ': unsupported registry version'
            );
        }

        if(row.status !== 'active' && row.status !== 'retired') {
            errors.push(
                'Row ' + rowNumber +
                ': status must be active or retired'
            );
        }

        var lineage = clean(row.lineage_id);
        var number = positiveInt(row.orthology_group);
        var type = clean(row.locus_type);

        if(
            !lineage ||
            number === null ||
            (type !== 'erv' && type !== 'solo_ltr')
        ) {
            errors.push(
                'Row ' + rowNumber +
                ': invalid lineage, group number or locus type'
            );
            continue;
        }

        var groupKey = lineage + '-' + number;

        var expectedId =
            groupKey + (type === 'solo_ltr' ? '(LTR)' : '');

        if(
            row.group_key !== groupKey ||
            row.missillac_id !== expectedId
        ) {
            errors.push(
                'Row ' + rowNumber +
                ': inconsistent group key or Missillac ID'
            );
        }

        if(!clean(row.locus_id) || !validIdentity(row)) {
            errors.push(
                'Row ' + rowNumber +
                ': incomplete or invalid locus identity'
            );
            continue;
        }

        var locusId = clean(row.locus_id);
        var identityKey = identity(row);

        if(reservedGroups[groupKey]) {
            errors.push(
                'Duplicate registry group: ' + groupKey
            );
        }

        if(registryLocusIds[locusId]) {
            errors.push(
                'Duplicate registry locus ID: ' + locusId
            );
        }

        if(registryIdentities[identityKey]) {
            errors.push(
                'Multiple registry entries at the same exact ' +
                'locus identity: ' + locusId
            );
        }

        row.number = number;
        row.identityKey = identityKey;

        // Includes both active and retired assignments.
        reservedGroups[groupKey] = row;
        registryLocusIds[locusId] = row;
        registryIdentities[identityKey] = row;

        registryScopes[JSON.stringify([
            clean(row.host_species),
            clean(row.genome_build)
        ])] = true;

        registry.push(row);
    }

    if(Object.keys(registryScopes).length !== 1) {
        errors.push(
            'This version requires a single species/assembly registry'
        );
    }

    stopIfErrors('Registry validation');


    // --------------------------------------------------------
    // 2. Load current loci and lineage associations
    // --------------------------------------------------------

    var locusRows = query('erv_locus', [
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

    if(locusRows.length === 0) {
        throw new Error(
            'No permanent loci loaded. No database changes made.'
        );
    }

    var lociById = map();
    var lociByIdentity = map();
    var lineagesByLocus = map();

    locusRows.forEach(function(row) {
        var id = clean(row.id);

        if(!id || lociById[id]) {
            errors.push('Missing or duplicate current locus ID: ' + id);
            return;
        }

        lociById[id] = row;

        if(validIdentity(row)) {
            var k = identity(row);

            if(!lociByIdentity[k]) {
                lociByIdentity[k] = [];
            }

            lociByIdentity[k].push(row);
        }
    });

    query('erv_locus_lineage_assoc', [
        'erv_locus.id',
        'erv_lineage.id'
    ]).forEach(function(row) {

        var locusId = clean(row['erv_locus.id']);
        var lineageId = clean(row['erv_lineage.id']);

        if(!lociById[locusId] || !lineageId) {
            errors.push(
                'Broken current lineage association: ' +
                JSON.stringify(row)
            );
            return;
        }

        if(!lineagesByLocus[locusId]) {
            lineagesByLocus[locusId] = map();
        }

        lineagesByLocus[locusId][lineageId] = true;
    });

    stopIfErrors('Current locus validation');


    // --------------------------------------------------------
    // 3. Match active registry rows
    // --------------------------------------------------------

    var matchedRegistryByLocus = map();
    var matchedCount = 0;

    registry.forEach(function(entry) {

        if(entry.status === 'retired') {
            retired++;
            return;
        }

        var oldId = clean(entry.locus_id);
        var sameIdLocus = lociById[oldId];

        if(
            sameIdLocus &&
            identity(sameIdLocus) !== entry.identityKey
        ) {
            errors.push(
                'Registry locus ID now has different coordinates ' +
                'or host/build: ' + oldId
            );
            return;
        }

        var matches = lociByIdentity[entry.identityKey] || [];

        if(matches.length === 0) {
            unmatched++;
            warnings.push(
                'Active registry entry absent from current loci: ' +
                entry.missillac_id + ' [' + oldId + ']'
            );
            return;
        }

        if(matches.length !== 1) {
            errors.push(
                'Ambiguous exact coordinate match for ' +
                entry.missillac_id
            );
            return;
        }

        var locus = matches[0];
        var locusId = clean(locus.id);

        if(matchedRegistryByLocus[locusId]) {
            errors.push(
                'Current locus matched to multiple registry entries: ' +
                locusId
            );
            return;
        }

        matchedRegistryByLocus[locusId] = entry;
        matchedCount++;

        var lineageIds = Object.keys(
            lineagesByLocus[locusId] || {}
        );

        if(
            lineageIds.length !== 1 ||
            lineageIds[0] !== clean(entry.lineage_id)
        ) {
            errors.push(
                'Current classification differs from registry for ' +
                locusId + ': ' + entry.missillac_id +
                '. Requires explicit curator review.'
            );
        }

        if(
            clean(locus.locus_type).toLowerCase() !==
            clean(entry.locus_type)
        ) {
            errors.push(
                'Current locus type differs from registry: ' +
                locusId
            );
        }

        var currentId = clean(locus.missillac_id);
        var currentGroup = clean(locus.orthology_group);

        if(currentId || currentGroup) {

            if(
                currentId !== entry.missillac_id ||
                positiveInt(currentGroup) !== entry.number
            ) {
                errors.push(
                    'Existing assignment conflicts with registry: ' +
                    locusId + ': ' + currentId
                );
            } else {
                unchanged++;
            }

            return;
        }

        assignments.push({
            locus_id: locusId,
            number: entry.number,
            missillac_id: entry.missillac_id
        });

        if(locusId !== oldId) {
            warnings.push(
                'Restoring by exact coordinates despite changed ' +
                'locus ID: ' + oldId + ' -> ' + locusId
            );
        }
    });


    // --------------------------------------------------------
    // 4. Check naming fields outside the matched registry set
    // --------------------------------------------------------

    locusRows.forEach(function(locus) {

        var locusId = clean(locus.id);
        var mid = clean(locus.missillac_id);
        var group = clean(locus.orthology_group);

        if(!mid && !group) return;

        if(!matchedRegistryByLocus[locusId]) {
            errors.push(
                'Current naming fields have no matching active ' +
                'registry entry: ' + locusId + ': ' + mid
            );
        }
    });

    // Avoid a misleading successful import of the wrong build/dataset.
    if(matchedCount === 0 && registry.length > retired) {
        errors.push(
            'No active registry entries matched current loci. ' +
            'Check the input file, species, assembly and coordinates.'
        );
    }

    glue.logInfo('Registry rows: ' + registry.length);
    glue.logInfo('Retired groups retained in registry: ' + retired);
    glue.logInfo('Active entries matched: ' + matchedCount);
    glue.logInfo('Active entries absent: ' + unmatched);
    glue.logInfo('Assignments already correct: ' + unchanged);
    glue.logInfo('Assignments to restore: ' + assignments.length);

    warnings.slice(0, MAX_DETAILS).forEach(function(message) {
        glue.logInfo('WARNING: ' + message);
    });

    if(warnings.length > MAX_DETAILS) {
        glue.logInfo(
            'Additional warnings suppressed: ' +
            (warnings.length - MAX_DETAILS)
        );
    }

    stopIfErrors('Missillac registry import preflight');


    // --------------------------------------------------------
    // 5. Restore assignments
    // --------------------------------------------------------

    if(DRY_RUN) {
        assignments.slice(0, MAX_DETAILS).forEach(function(a) {
            glue.logInfo(
                'RESTORE ' + a.locus_id +
                ' -> ' + a.missillac_id
            );
        });

        glue.logInfo('DRY RUN: no database changes made.');
        return;
    }

    assignments.forEach(function(a, index) {

        glue.inMode(
            '/custom-table-row/erv_locus/' + a.locus_id,
            function() {

                glue.command([
                    'set', 'field',
                    'orthology_group',
                    String(a.number)
                ]);

                glue.command([
                    'set', 'field',
                    'missillac_id',
                    a.missillac_id
                ]);
            }
        );

        if((index + 1) % 10000 === 0) {
            glue.logInfo(
                'Restored ' + (index + 1) + ' assignments'
            );
        }
    });

    glue.logInfo(
        'Registry import completed: ' +
        assignments.length + ' assignments restored.'
    );

    glue.logInfo(
        'Registry file unchanged. Allocation must separately ' +
        'reserve every active and retired registry group.'
    );

}());
