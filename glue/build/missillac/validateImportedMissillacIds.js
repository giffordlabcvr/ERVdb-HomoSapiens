// glue/build/missillac/validateImportedMissillacIds.js
// Read-only BOOTSTRAP preflight. Run after importLegacyMappings.glue and
// before applyErvLocusNames.js. Uses bulk queries; writes no database fields.
//
// Legacy import populates xrefs, NOT preassigned Missillac IDs. This checks
// those numbering claims using the supplied bootstrap allocator's precedence.
// Primary ambiguity/collisions are fatal; Wang fallback conflicts are warnings
// because the allocator gives affected loci de novo numbers.
//
// This is NOT historical-registry validation: retired IDs, prior assignments,
// orthology across species/assemblies and biological matches cannot be verified
// from these tables alone. The supplied allocator is not registry-aware.
// Existing assignments therefore block this bootstrap preflight deliberately.
// A single species/assembly is required by this bootstrap workflow; that is
// not a general restriction on species-independent Missillac orthology groups.

(function() {
    var PRIMARY = 'compiled_human_erv_loci_hg19';
    var SECONDARY = 'wang_hervh_hg19';
    var WANG_LINEAGE = 'ERV-1.Zeta.HF.H.1';
    var MAX_DETAILS = 100;
    var errors = 0, warnings = 0, shown = 0;
    var counts = Object.create(null);

    function clean(v) {
        if(v === null || v === undefined) return null;
        var s = String(v).trim();
        return s === '' || /^(null|none|na|n\/a|-)$/i.test(s) ? null : s;
    }

    function integer(v) {
        var s = clean(v);
        if(s === null || !/^\d+$/.test(s)) return null;
        var n = Number(s);
        return isFinite(n) && n > 0 && Math.floor(n) === n &&
            n <= 9007199254740991 ? n : null;
    }

    function map() {
        return Object.create(null);
    }

    function key(parts) {
        return JSON.stringify(parts);
    }

    function report(level, code, detail) {
        if(level === 'ERROR') errors++;
        else warnings++;

        counts[level + ' ' + code] =
            (counts[level + ' ' + code] || 0) + 1;

        if(shown < MAX_DETAILS) {
            glue.logInfo(level + ' ' + code + ': ' + detail);
            shown++;
        }
    }

    function query(table, fields) {
        return glue.tableToObjects(glue.command(
            ['list', 'custom-table-row', table].concat(fields)
        ));
    }

    function addNumber(claims, locus, n) {
        if(!claims[locus]) claims[locus] = map();
        claims[locus][String(n)] = true;
    }

    glue.logInfo('Missillac bootstrap preflight: read-only');

    var rows = query('erv_locus', [
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
    var associations = map();
    var scopes = map();

    rows.forEach(function(r) {
        var id = clean(r.id);

        if(id === null || loci[id]) {
            report(
                'ERROR',
                'locus_id',
                'Missing or duplicate locus key: ' + id
            );
            return;
        }

        loci[id] = r;
    });

    if(rows.length === 0) {
        report('ERROR', 'empty_loci', 'No permanent loci loaded');
    }

    query('erv_locus_lineage_assoc', [
        'erv_locus.id',
        'erv_lineage.id'
    ]).forEach(function(r) {
        var id = clean(r['erv_locus.id']);
        var lineage = clean(r['erv_lineage.id']);

        if(id === null || lineage === null || !loci[id]) {
            report(
                'ERROR',
                'broken_association',
                JSON.stringify(r)
            );
            return;
        }

        if(!associations[id]) associations[id] = map();
        associations[id][lineage] = true;
    });

    var eligible = map();
    var byLineage = map();
    var existingGroups = map();
    var eligibleCount = 0;
    var existingCount = 0;

    Object.keys(loci).sort().forEach(function(id) {
        var r = loci[id];
        var lineages = Object.keys(associations[id] || {});
        var type = (clean(r.locus_type) || '').toLowerCase();

        var ok = lineages.length === 1 &&
            (type === 'erv' || type === 'solo_ltr');

        if(ok) {
            eligible[id] = lineages[0];

            if(!byLineage[lineages[0]]) {
                byLineage[lineages[0]] = [];
            }

            byLineage[lineages[0]].push(id);
            eligibleCount++;

            var species = clean(r.host_species);
            var build = clean(r.genome_build);

            if(
                species === null ||
                build === null ||
                clean(r.scaffold) === null ||
                integer(r.start_position) === null ||
                integer(r.end_position) === null ||
                Number(r.start_position) > Number(r.end_position)
            ) {
                report(
                    'ERROR',
                    'locus_identity',
                    'Incomplete/invalid coordinates or host/build: ' + id
                );
            }

            scopes[key([species, build])] = true;
        }

        var mid = clean(r.missillac_id);
        var rawGroup = clean(r.orthology_group);

        if(mid === null && rawGroup === null) return;

        existingCount++;

        var group = integer(rawGroup);

        if(mid === null || group === null) {
            report(
                'ERROR',
                'partial_assignment',
                id + ': id=' + mid + ', group=' + rawGroup
            );
            return;
        }

        // Greedy lineage match handles hyphens in the lineage;
        // the final integer is the group.
        var parsed = /^(.+)-([1-9]\d*)(\(LTR\))?$/.exec(mid);

        if(!parsed || integer(parsed[2]) !== group) {
            report(
                'ERROR',
                'malformed_assignment',
                id + ': ' + mid + ', group=' + rawGroup
            );
            return;
        }

        if(!ok) {
            report(
                'ERROR',
                'assigned_ineligible',
                id + ': ' + mid
            );
        } else if(
            mid !== lineages[0] + '-' + group +
                (type === 'solo_ltr' ? '(LTR)' : '')
        ) {
            report(
                'ERROR',
                'assignment_mismatch',
                id + ': ID differs from current lineage/type: ' + mid
            );
        }

        var gk = key([
            parsed[1],
            group,
            clean(r.host_species),
            clean(r.genome_build)
        ]);

        if(existingGroups[gk]) {
            report(
                'ERROR',
                'duplicate_group_in_assembly',
                existingGroups[gk] + ' and ' + id + ': ' + mid
            );
        } else {
            existingGroups[gk] = id;
        }
    });

    if(eligibleCount === 0) {
        report(
            'ERROR',
            'no_eligible_loci',
            'No lineage-resolved erv/solo_ltr loci'
        );
    }

    if(Object.keys(scopes).length > 1) {
        report(
            'ERROR',
            'multiple_scopes',
            'Bootstrap allocator does not reconcile orthology ' +
            'across species/assemblies'
        );
    }

    if(existingCount > 0) {
        report(
            'ERROR',
            'bootstrap_existing_assignments',
            existingCount + ' loci already have naming fields. ' +
            'Supplied allocator recalculates them; use a ' +
            'registry-aware allocator before continuing.'
        );
    }

    var primary = map();
    var secondary = map();
    var sourceCounts = map();
    var statusCounts = map();
    var outside = 0;

    query('erv_locus_legacy_xref', [
        'id',
        'legacy_source',
        'legacy_name',
        'source_numeric_id',
        'mapping_status',
        'erv_locus.id'
    ]).forEach(function(r) {
        var source = clean(r.legacy_source);

        if(source !== PRIMARY && source !== SECONDARY) return;

        sourceCounts[source] = (sourceCounts[source] || 0) + 1;

        var status = clean(r.mapping_status);
        var sk = source + '/' + status;

        statusCounts[sk] = (statusCounts[sk] || 0) + 1;

        if(status !== 'mapped') return;

        var id = clean(r['erv_locus.id']);

        if(id === null || !loci[id]) {
            report(
                'ERROR',
                'broken_legacy_link',
                String(r.id)
            );
            return;
        }

        if(
            !eligible[id] ||
            (source === SECONDARY && eligible[id] !== WANG_LINEAGE)
        ) {
            outside++;
            return;
        }

        var n = integer(r.source_numeric_id);

        if(source === SECONDARY && n === null) {
            var match = /^HERVH_(\d+)$/i.exec(
                clean(r.legacy_name) || ''
            );
            n = match ? integer(match[1]) : null;
        }

        if(n === null) {
            report(
                'WARNING',
                'unusable_legacy_number',
                source + ': ' + r.id + ' -> ' + id
            );
            return;
        }

        addNumber(
            source === PRIMARY ? primary : secondary,
            id,
            n
        );
    });

    if(!sourceCounts[PRIMARY]) {
        report(
            'ERROR',
            'missing_primary_import',
            'No ' + PRIMARY + ' xrefs; check that legacy import ran'
        );
    }

    if(!sourceCounts[SECONDARY]) {
        report(
            'WARNING',
            'missing_wang_import',
            'No ' + SECONDARY + ' xrefs'
        );
    }

    Object.keys(byLineage).sort().forEach(function(lineage) {
        var reserved = map();
        var primaryLoci = map();
        var wangNumbers = map();

        byLineage[lineage].forEach(function(id) {
            var nums = Object.keys(primary[id] || {});

            if(nums.length === 0) return;

            primaryLoci[id] = true;

            if(nums.length > 1) {
                report(
                    'ERROR',
                    'ambiguous_primary',
                    id + ': ' + nums.join(', ')
                );
                return;
            }

            if(!reserved[nums[0]]) reserved[nums[0]] = [];
            reserved[nums[0]].push(id);
        });

        Object.keys(reserved).forEach(function(n) {
            if(reserved[n].length > 1) {
                report(
                    'ERROR',
                    'primary_collision',
                    lineage + '-' + n + ': ' +
                    reserved[n].join(', ')
                );
            }
        });

        if(lineage !== WANG_LINEAGE) return;

        byLineage[lineage].forEach(function(id) {
            if(primaryLoci[id]) return;

            var nums = Object.keys(secondary[id] || {});

            if(nums.length > 1) {
                report(
                    'WARNING',
                    'ambiguous_wang',
                    id + ': ' + nums.join(', ') +
                    '; allocator uses de novo numbering'
                );
            } else if(nums.length === 1) {
                if(!wangNumbers[nums[0]]) {
                    wangNumbers[nums[0]] = [];
                }
                wangNumbers[nums[0]].push(id);
            }
        });

        Object.keys(wangNumbers).forEach(function(n) {
            if(reserved[n]) {
                report(
                    'WARNING',
                    'wang_reserved_by_primary',
                    lineage + '-' + n + ': ' +
                    wangNumbers[n].join(', ') +
                    '; allocator uses de novo numbering'
                );
            } else if(wangNumbers[n].length > 1) {
                report(
                    'WARNING',
                    'wang_collision',
                    lineage + '-' + n + ': ' +
                    wangNumbers[n].join(', ') +
                    '; allocator uses de novo numbering'
                );
            }
        });
    });

    glue.logInfo(
        'Loci=' + rows.length +
        ', eligible=' + eligibleCount +
        ', existing naming fields=' + existingCount +
        ', mapped xrefs outside numbering eligibility=' + outside
    );

    Object.keys(statusCounts).sort().forEach(function(k) {
        glue.logInfo(
            'Legacy mappings ' + k + ': ' + statusCounts[k]
        );
    });

    Object.keys(counts).sort().forEach(function(k) {
        glue.logInfo(k + ': ' + counts[k]);
    });

    if(errors + warnings > shown) {
        glue.logInfo(
            'Additional details suppressed; counts above ' +
            'include all findings.'
        );
    }

    glue.logInfo(
        'Historical reservation and biological orthology checks: ' +
        'NOT PERFORMED (no registry input).'
    );

    if(errors > 0) {
        throw new Error(
            'Missillac bootstrap preflight failed with ' +
            errors + ' error(s) and ' + warnings +
            ' warning(s). No database changes made.'
        );
    }

    glue.logInfo(
        'Missillac bootstrap preflight PASSED with ' +
        warnings + ' warning(s). No database changes made.'
    );
}());