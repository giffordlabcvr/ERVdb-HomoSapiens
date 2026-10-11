// glue/build/missillac/validateMissillacAssignments.js
//
// Read-only validation of assigned Missillac identifiers.
//
// Run after:
//   applyErvLocusNames.js
//
// Run before:
//   exportMissillacRegistry.js
//
// Validates:
//   - Locus identity and coordinates
//   - Lineage-association integrity
//   - Assignment completeness
//   - Missillac ID syntax
//   - Agreement with current lineage assignment
//   - Agreement with locus type (ERV / solo LTR)
//   - Orthology group numbering
//   - Duplicate assignments within an assembly
//   - Compatibility with initial registry export
//
// Missillac groups are species-independent orthology groups.
// Reuse across species/assemblies is not inherently erroneous.
//
// This bootstrap validator requires a single species/assembly
// to match the current applyErvLocusNames.js and initial
// exportMissillacRegistry.js workflows.
//
// Does NOT:
//   - Modify database records
//   - Allocate identifiers
//   - Validate biological orthology
//   - Verify historical ID reservations
//   - Validate retired IDs against a previous registry
//
// All database operations are read-only.

(function() {

    // --------------------------------------------------------
    // Configuration
    // --------------------------------------------------------

    var MAX_DETAILS = 100;

    var REQUIRE_SINGLE_SCOPE = true;
    var REQUIRE_ALL_ELIGIBLE_ASSIGNED = true;
    var REQUIRE_UNIQUE_GROUP_PER_SCOPE = true;

    var LOCUS_TABLE = 'erv_locus';
    var ASSOC_TABLE = 'erv_locus_lineage_assoc';

    // --------------------------------------------------------
    // Utilities
    // --------------------------------------------------------

    var errors = 0;
    var warnings = 0;
    var shown = 0;

    var counts = Object.create(null);

    function map() {
        return Object.create(null);
    }

    function clean(value) {
        if(value === null || value === undefined) {
            return null;
        }

        var s = String(value).trim();

        if(
            s === '' ||
            /^(null|none|na|n\/a|-)$/i.test(s)
        ) {
            return null;
        }

        return s;
    }

    function integer(value) {
        var s = clean(value);

        if(s === null || !/^[1-9]\d*$/.test(s)) {
            return null;
        }

        var n = Number(s);

        if(
            !isFinite(n) ||
            Math.floor(n) !== n ||
            n > 9007199254740991
        ) {
            return null;
        }

        return n;
    }

    function key(parts) {
        return JSON.stringify(parts);
    }

    function query(table, fields) {
        return glue.tableToObjects(
            glue.command(
                ['list', 'custom-table-row', table]
                    .concat(fields)
            )
        );
    }

    function report(level, code, detail) {

        if(level === 'ERROR') {
            errors++;
        } else {
            warnings++;
        }

        var countKey = level + ' ' + code;

        counts[countKey] =
            (counts[countKey] || 0) + 1;

        if(shown < MAX_DETAILS) {
            glue.logInfo(
                level + ' ' + code + ': ' + detail
            );
            shown++;
        }
    }

    function error(code, detail) {
        report('ERROR', code, detail);
    }

    function warning(code, detail) {
        report('WARNING', code, detail);
    }

    function parseMissillacId(value) {

        var id = clean(value);

        if(id === null) {
            return null;
        }

        // Greedy lineage capture is intentional.
        // Canonical lineage IDs contain hyphens.
        //
        // Examples:
        //
        // ERV-1.Zeta.HF.H.1-123
        // ERV-1.Zeta.HF.H.1-123(LTR)

        var match =
            /^(.+)-([1-9]\d*)(\(LTR\))?$/.exec(id);

        if(!match) {
            return null;
        }

        var group = integer(match[2]);

        if(group === null) {
            return null;
        }

        return {
            lineage_id: match[1],
            orthology_group: group,
            is_ltr: match[3] === '(LTR)',
            group_key: match[1] + '-' + group
        };
    }

    // --------------------------------------------------------
    // Start
    // --------------------------------------------------------

    glue.logInfo(
        '=============================================='
    );

    glue.logInfo(
        'Missillac assignment validation'
    );

    glue.logInfo(
        'Read-only: no database modifications'
    );

    glue.logInfo(
        '=============================================='
    );

    // --------------------------------------------------------
    // 1. Load loci
    // --------------------------------------------------------

    glue.logInfo('Loading ERV loci');

    var locusRows = query(LOCUS_TABLE, [
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

    var loci = map();

    locusRows.forEach(function(row) {

        var id = clean(row.id);

        if(id === null) {
            error(
                'missing_locus_id',
                'Locus row without an ID'
            );
            return;
        }

        if(loci[id]) {
            error(
                'duplicate_locus_id',
                'Duplicate locus: ' + id
            );
            return;
        }

        loci[id] = row;
    });

    if(locusRows.length === 0) {
        error(
            'empty_locus_table',
            'No ERV loci have been loaded'
        );
    }

    glue.logInfo(
        'Loaded ' + locusRows.length + ' ERV loci'
    );

    // --------------------------------------------------------
    // 2. Load lineage associations
    // --------------------------------------------------------

    glue.logInfo('Loading lineage associations');

    var associationRows = query(ASSOC_TABLE, [
        'id',
        'erv_locus.id',
        'erv_lineage.id'
    ]);

    var associations = map();
    var associationIds = map();

    associationRows.forEach(function(row) {

        var assocId = clean(row.id);
        var locusId = clean(row['erv_locus.id']);
        var lineageId = clean(row['erv_lineage.id']);

        if(assocId === null) {
            error(
                'missing_association_id',
                JSON.stringify(row)
            );
            return;
        }

        if(associationIds[assocId]) {
            error(
                'duplicate_association_id',
                assocId
            );
            return;
        }

        associationIds[assocId] = true;

        if(
            locusId === null ||
            lineageId === null ||
            !loci[locusId]
        ) {
            error(
                'broken_lineage_association',
                JSON.stringify(row)
            );
            return;
        }

        if(!associations[locusId]) {
            associations[locusId] = map();
        }

        if(associations[locusId][lineageId]) {
            error(
                'duplicate_lineage_association',
                locusId + ' -> ' + lineageId
            );
            return;
        }

        associations[locusId][lineageId] = true;
    });

    glue.logInfo(
        'Loaded ' + associationRows.length +
        ' lineage associations'
    );

    // --------------------------------------------------------
    // 3. Validate assignments
    // --------------------------------------------------------

    var stats = {
        total_loci: locusRows.length,
        eligible_loci: 0,
        ineligible_loci: 0,
        assigned_loci: 0,
        unassigned_eligible: 0,
        assigned_ineligible: 0,
        erv_assignments: 0,
        solo_ltr_assignments: 0,
        unique_group_keys: 0,
        unique_group_scope_keys: 0
    };

    var scopes = map();

    // A group key identifies an orthology group.
    // It deliberately excludes species and assembly.

    var groups = map();

    // A group-scope key includes species and assembly.
    // It is used for bootstrap duplicate detection.

    var groupsByScope = map();

    // Track the assignment of each locus.

    var assignedLoci = map();

    Object.keys(loci).sort().forEach(function(id) {

        var row = loci[id];

        var type = (
            clean(row.locus_type) || ''
        ).toLowerCase();

        var lineageIds =
            Object.keys(associations[id] || {});

        var eligible =
            lineageIds.length === 1 &&
            (
                type === 'erv' ||
                type === 'solo_ltr'
            );

        var mid = clean(row.missillac_id);
        var rawGroup = clean(row.orthology_group);

        // ----------------------------------------------------
        // Eligibility
        // ----------------------------------------------------

        if(eligible) {
            stats.eligible_loci++;
        } else {
            stats.ineligible_loci++;
        }

        // ----------------------------------------------------
        // No assignment present
        // ----------------------------------------------------

        if(mid === null && rawGroup === null) {

            if(eligible) {
                stats.unassigned_eligible++;

                if(REQUIRE_ALL_ELIGIBLE_ASSIGNED) {
                    error(
                        'eligible_unassigned',
                        id +
                        ': eligible locus lacks a ' +
                        'Missillac assignment'
                    );
                } else {
                    warning(
                        'eligible_unassigned',
                        id
                    );
                }
            }

            return;
        }

        // ----------------------------------------------------
        // Assignment present
        // ----------------------------------------------------

        stats.assigned_loci++;

        if(!eligible) {
            stats.assigned_ineligible++;

            error(
                'assigned_ineligible',
                id +
                ': assignment exists but locus ' +
                'is not uniquely lineage-resolved; ' +
                'lineages=' +
                lineageIds.join(',') +
                ', type=' + type
            );
        }

        // ----------------------------------------------------
        // Completeness
        // ----------------------------------------------------

        if(mid === null || rawGroup === null) {
            error(
                'partial_assignment',
                id +
                ': missillac_id=' + mid +
                ', orthology_group=' + rawGroup
            );

            return;
        }

        // ----------------------------------------------------
        // Parse ID and numeric group
        // ----------------------------------------------------

        var parsed = parseMissillacId(mid);
        var group = integer(rawGroup);

        if(parsed === null) {
            error(
                'malformed_missillac_id',
                id + ': ' + mid
            );

            return;
        }

        if(group === null) {
            error(
                'invalid_orthology_group',
                id + ': ' + rawGroup
            );

            return;
        }

        // ----------------------------------------------------
        // Group number consistency
        // ----------------------------------------------------

        if(parsed.orthology_group !== group) {
            error(
                'group_number_mismatch',
                id +
                ': missillac_id=' + mid +
                ', orthology_group=' + group
            );
        }

        // ----------------------------------------------------
        // Lineage consistency
        // ----------------------------------------------------

        if(eligible) {

            var currentLineage = lineageIds[0];

            if(parsed.lineage_id !== currentLineage) {
                error(
                    'lineage_mismatch',
                    id +
                    ': Missillac lineage=' +
                    parsed.lineage_id +
                    ', current lineage=' +
                    currentLineage
                );
            }
        }

        // ----------------------------------------------------
        // LTR suffix consistency
        // ----------------------------------------------------

        if(type === 'solo_ltr') {

            if(!parsed.is_ltr) {
                error(
                    'missing_ltr_suffix',
                    id + ': ' + mid
                );
            }

            stats.solo_ltr_assignments++;

        } else if(type === 'erv') {

            if(parsed.is_ltr) {
                error(
                    'unexpected_ltr_suffix',
                    id + ': ' + mid
                );
            }

            stats.erv_assignments++;
        }

        // ----------------------------------------------------
        // Coordinate and host identity
        // ----------------------------------------------------

        var species = clean(row.host_species);
        var build = clean(row.genome_build);
        var scaffold = clean(row.scaffold);

        var start = integer(row.start_position);
        var end = integer(row.end_position);

        if(
            species === null ||
            build === null ||
            scaffold === null ||
            start === null ||
            end === null ||
            start > end
        ) {
            error(
                'invalid_locus_identity',
                id +
                ': species=' + species +
                ', build=' + build +
                ', scaffold=' + scaffold +
                ', start=' + row.start_position +
                ', end=' + row.end_position
            );
        }

        // ----------------------------------------------------
        // Scope tracking
        // ----------------------------------------------------

        var scopeKey = key([
            species,
            build
        ]);

        scopes[scopeKey] = true;

        // ----------------------------------------------------
        // Orthology group tracking
        // ----------------------------------------------------

        var groupKey = parsed.group_key;

        if(!groups[groupKey]) {
            groups[groupKey] = [];
        }

        groups[groupKey].push(id);

        // The suffix distinguishes a solo-LTR identifier,
        // but not the underlying orthology group.

        var groupScopeKey = key([
            groupKey,
            species,
            build
        ]);

        if(!groupsByScope[groupScopeKey]) {
            groupsByScope[groupScopeKey] = [];
        }

        groupsByScope[groupScopeKey].push(id);

        assignedLoci[id] = {
            missillac_id: mid,
            group_key: groupKey,
            lineage_id: parsed.lineage_id,
            group: group,
            species: species,
            build: build,
            type: type
        };
    });

    // --------------------------------------------------------
    // 4. Validate scope
    // --------------------------------------------------------

    var scopeKeys = Object.keys(scopes);

    if(
        REQUIRE_SINGLE_SCOPE &&
        scopeKeys.length > 1
    ) {
        error(
            'multiple_scopes',
            'Current bootstrap workflow requires ' +
            'one species/assembly, but found ' +
            scopeKeys.length +
            ': ' + scopeKeys.join('; ')
        );
    }

    // --------------------------------------------------------
    // 5. Validate group uniqueness
    // --------------------------------------------------------

    Object.keys(groupsByScope)
        .sort()
        .forEach(function(groupScopeKey) {

            var members = groupsByScope[groupScopeKey];

            if(members.length <= 1) {
                return;
            }

            var message =
                groupScopeKey +
                ': loci=' + members.join(', ');

            if(REQUIRE_UNIQUE_GROUP_PER_SCOPE) {
                error(
                    'duplicate_group_in_scope',
                    message
                );
            } else {
                warning(
                    'multiple_group_members_in_scope',
                    message
                );
            }
        });

    stats.unique_group_keys =
        Object.keys(groups).length;

    stats.unique_group_scope_keys =
        Object.keys(groupsByScope).length;

    // --------------------------------------------------------
    // 6. Check for an empty naming result
    // --------------------------------------------------------

    if(stats.eligible_loci === 0) {
        error(
            'no_eligible_loci',
            'No eligible ERV/solo-LTR loci'
        );
    }

    if(stats.assigned_loci === 0) {
        error(
            'no_assignments',
            'No Missillac assignments found; ' +
            'has applyErvLocusNames.js run?'
        );
    }

    // --------------------------------------------------------
    // 7. Summary
    // --------------------------------------------------------

    glue.logInfo(
        '=============================================='
    );

    glue.logInfo(
        'Missillac assignment validation summary'
    );

    glue.logInfo(
        '=============================================='
    );

    glue.logInfo(
        'Total loci:                  ' +
        stats.total_loci
    );

    glue.logInfo(
        'Eligible loci:               ' +
        stats.eligible_loci
    );

    glue.logInfo(
        'Ineligible loci:             ' +
        stats.ineligible_loci
    );

    glue.logInfo(
        'Assigned loci:               ' +
        stats.assigned_loci
    );

    glue.logInfo(
        'Eligible but unassigned:     ' +
        stats.unassigned_eligible
    );

    glue.logInfo(
        'Assigned but ineligible:     ' +
        stats.assigned_ineligible
    );

    glue.logInfo(
        'ERV assignments:             ' +
        stats.erv_assignments
    );

    glue.logInfo(
        'Solo-LTR assignments:        ' +
        stats.solo_ltr_assignments
    );

    glue.logInfo(
        'Unique orthology groups:     ' +
        stats.unique_group_keys
    );

    glue.logInfo(
        'Unique group/scope pairs:    ' +
        stats.unique_group_scope_keys
    );

    glue.logInfo(
        'Species/assembly scopes:     ' +
        scopeKeys.length
    );

    glue.logInfo(
        '----------------------------------------------'
    );

    Object.keys(counts)
        .sort()
        .forEach(function(k) {
            glue.logInfo(
                k + ': ' + counts[k]
            );
        });

    if(errors + warnings > shown) {
        glue.logInfo(
            'Additional details suppressed; ' +
            'summary counts include all findings.'
        );
    }

    glue.logInfo(
        '----------------------------------------------'
    );

    glue.logInfo(
        'Errors:   ' + errors
    );

    glue.logInfo(
        'Warnings: ' + warnings
    );

    glue.logInfo(
        'Database changes: none'
    );

    glue.logInfo(
        'Historical registry validation: not performed'
    );

    glue.logInfo(
        'Biological orthology validation: not performed'
    );

    glue.logInfo(
        '=============================================='
    );

    // --------------------------------------------------------
    // 8. Final result
    // --------------------------------------------------------

    if(errors > 0) {
        throw new Error(
            'Missillac assignment validation FAILED with ' +
            errors + ' error(s) and ' +
            warnings + ' warning(s). ' +
            'No database changes made.'
        );
    }

    glue.logInfo(
        'Missillac assignment validation PASSED with ' +
        warnings + ' warning(s). ' +
        'No database changes made.'
    );

}());