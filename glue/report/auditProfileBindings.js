// Run in the fully built ERVdb project:
//   run script glue/validation/auditProfileBindings.js
// ES5 / Nashorn. Read-only database access; never changes Markdown files.
// Java paths are absolute CONTAINER paths, independent of GLUE load-save-path.
// Install at glue/validation/auditProfileBindings.js and edit ROOT below.
// Reports go into a unique new run directory; old reports are retained.
// findings.tsv: all mismatches, ambiguity, and review candidates.
// bindings.tsv: resolved filename -> entity IDs (+ coordinates for loci).
// missing_profiles.tsv: taxonomy/lineage coverage gaps (informational).
// An exact match proves lookup consistency only. It does not prove that the
// Markdown describes the right biological locus or that a legacy number was
// transferred correctly. Review first-run locus bindings against legacy
// sources/coordinates; later baseline comparison detects identity changes.
// No Markdown body/heading or citation audit is performed.
(function () {
    var ROOT = '/workspace/ERVdb-HomoSapiens';
    var PROFILE_ROOT = ROOT + '/md/profile';
    var OUTPUT_ROOT = ROOT + '/tabular/profile_audit';
    // Optional previously reviewed bindings TSV produced by this script.
    // Copy an accepted run's bindings.tsv somewhere stable and set this path.
    var BASELINE_PATH = '';
    var FAIL_ON_ERRORS = true;
    // Use only verified Navigator lookup rules here. Each key is a filename
    // stem and each value identifies a real GLUE table row. These overrides
    // are explicit lookup rules, NOT inferred taxonomy corrections.
    // Example shape: 'some_slug': {table: 'rv_genus', id: 'actual_row_id'}
    var CLADE_BINDINGS = {};
    var CLADE_TABLES = ['rv_major_clade', 'rv_minor_clade', 'rv_genus', 'rv_subgenus'];

    var Files = Java.type('java.nio.file.Files');
    var Paths = Java.type('java.nio.file.Paths');
    var UTF8 = Java.type('java.nio.charset.StandardCharsets').UTF_8;
    var Options = Java.type('java.nio.file.StandardOpenOption');
    function path(s) { return Paths.get(s); }
    function clean(v) {
        if (v === null || v === undefined) { return ''; }
        var s = String(v).trim();
        return /^(null|none|na|n\/a|-)$/i.test(s) ? '' : s;
    }
    function map() { return Object.create(null); }
    function query(table, fields) {
        glue.logInfo('Loading ' + table);
        return glue.tableToObjects(glue.command(['list', 'custom-table-row', table].concat(fields)));
    }
    var findings = [], bindings = [], missing = [], counts = map();
    var errors = 0;
    function issue(level, code, file, detail) {
        findings.push([level, code, file, detail]);
        counts[level + ':' + code] = (counts[level + ':' + code] || 0) + 1;
        if (level === 'ERROR') { errors++; }
    }
    function indexAdd(index, key, row) {
        if (!index[key]) { index[key] = []; }
        index[key].push(row);
    }
    function listProfiles(kind) {
        var dir = path(PROFILE_ROOT + '/' + kind);
        if (!Files.isDirectory(dir)) { throw new Error('Missing profile directory: ' + dir); }
        var stream = Files.newDirectoryStream(dir), result = [];
        try {
            var it = stream.iterator();
            while (it.hasNext()) {
                var p = it.next(), name = String(p.getFileName());
                if (Files.isRegularFile(p) && /\.md$/i.test(name)) {
                    result.push({kind:kind, name:name, stem:name.slice(0,-3), path:p,
                        relative:kind + '/' + name});
                } else if (Files.isDirectory(p)) {
                    issue('WARNING', 'nested_directory_ignored', kind + '/' + name,
                        'Only direct children are used by this audit');
                }
            }
        } finally { stream.close(); }
        return result.sort(function(a,b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    }
    // Normalisation generates review candidates only; it NEVER accepts a binding.
    function loose(s) { return s.toLowerCase().replace(/^clade[ _.-]*/, '').replace(/retrovirus$/, '').replace(/[^a-z0-9]/g, ''); }
    function lineageLoose(s) { return s.replace(/^ERV-([123])-/, 'ERV-$1.').replace(/HML\.(\d+)/g, 'HML$1').toLowerCase(); }
    var clades = map(), allClades = [];
    CLADE_TABLES.forEach(function(table) {
        var rows = query(table, ['id']);
        if (!rows.length) { issue('WARNING', 'empty_taxonomy_table', '', table); }
        rows.forEach(function(r) {
            var e = {table:table, id:clean(r.id)};
            indexAdd(clades, e.id, e); allClades.push(e);
        });
    });
    var lineageRows = query('erv_lineage', ['id', 'legacy_name', 'status', 'entity_type']);
    var lineages = map(), aliases = map();
    lineageRows.forEach(function(r) { lineages[clean(r.id)] = r; });
    query('erv_lineage_alias', ['alias_name', 'erv_lineage.id']).forEach(function(r) {
        indexAdd(aliases, clean(r.alias_name), clean(r['erv_lineage.id']));
    });
    var loci = query('erv_locus', ['id','missillac_id','orthology_group','host_species',
        'genome_build','scaffold','start_position','end_position','orientation']);
    if (!allClades.length || !lineageRows.length || !loci.length) {
        throw new Error('Required entity layer is empty; build the full project first');
    }
    var byMissillac = map(), locusLineages = map();
    loci.forEach(function(r) {
        var mid = clean(r.missillac_id);
        if (mid) { indexAdd(byMissillac, mid, r); }
    });
    query('erv_locus_lineage_assoc', ['erv_locus.id','erv_lineage.id']).forEach(function(r) {
        var id = clean(r['erv_locus.id']);
        if (!locusLineages[id]) { locusLineages[id] = map(); }
        locusLineages[id][clean(r['erv_lineage.id'])] = true;
    });
    var previous = map();
    function parseTsv(filename) {
        var lines = String(new (Java.type('java.lang.String'))(Files.readAllBytes(path(filename)), UTF8)).replace(/^\uFEFF/, '').split(/\r?\n/);
        var header = lines.shift().split('\t');
        var required = ['file','kind','lookup_key','entity_table','entity_ids','identity_json'];
        required.forEach(function(k) { if (header.indexOf(k) < 0) { throw new Error('Baseline lacks column: ' + k); } });
        lines.forEach(function(line) {
            if (!line) { return; }
            var cells = line.split('\t'), row = {};
            header.forEach(function(k,i) { row[k] = cells[i] || ''; });
            if (previous[row.file]) { throw new Error('Duplicate baseline file: ' + row.file); }
            previous[row.file] = row;
        });
    }
    if (BASELINE_PATH) { parseTsv(BASELINE_PATH); }
    var seen = map(), covered = map();
    function bind(f, table, ids, identity) {
        ids.sort();
        var idString = ids.join(';'), identityString = JSON.stringify(identity);
        bindings.push([f.relative, f.kind, f.stem, table, idString, identityString]);
        covered[table + ':' + f.stem] = true;
        var old = previous[f.relative];
        if (old && (old.entity_table !== table || old.entity_ids !== idString || old.identity_json !== identityString)) {
            issue('ERROR', 'binding_changed_since_baseline', f.relative,
                'previous=' + old.entity_ids + ' ' + old.identity_json + '; current=' + idString + ' ' + identityString);
        } else if (BASELINE_PATH && !old) {
            issue('INFO', 'new_profile_since_baseline', f.relative, idString);
        }
    }
    ['clade','lineage','locus'].forEach(function(kind) {
        var profiles = listProfiles(kind), folded = map();
        profiles.forEach(function(f) {
            seen[f.relative] = true;
            var fold = f.name.toLowerCase();
            if (folded[fold]) { issue('ERROR','case_colliding_filename',f.relative,folded[fold]); }
            folded[fold] = f.relative;
            if (!/\.md$/.test(f.name)) { issue('ERROR','extension_case',f.relative,'Navigator may require lowercase .md'); }
            if (Number(Files.size(f.path)) === 0) { issue('WARNING','empty_profile',f.relative,'Empty Markdown file'); }
            if (kind === 'clade') {
                var matches = clades[f.stem] || [], override = CLADE_BINDINGS[f.stem];
                if (override) {
                    matches = allClades.filter(function(e) { return e.table === override.table && e.id === override.id; });
                }
                if (matches.length !== 1) {
                    var candidates = allClades.filter(function(e) { return loose(e.id) === loose(f.stem); });
                    issue('ERROR', matches.length ? 'ambiguous_clade' : 'unmatched_clade', f.relative,
                        'Exact matches=' + JSON.stringify(matches) + '; review candidates=' + JSON.stringify(candidates));
                } else {
                    bind(f,matches[0].table,[matches[0].id],{});
                    covered[matches[0].table + ':' + matches[0].id] = true;
                    if (override) { issue('WARNING','explicit_clade_lookup_rule',f.relative,
                        'Verify Navigator implements this mapping: ' + JSON.stringify(override)); }
                }
            } else if (kind === 'lineage') {
                var r = lineages[f.stem];
                if (!r) {
                    var suggestions = lineageRows.filter(function(e) {
                        return lineageLoose(clean(e.id)) === lineageLoose(f.stem) || clean(e.legacy_name) === f.stem;
                    }).map(function(e) { return clean(e.id); });
                    issue('ERROR','unmatched_lineage',f.relative,
                        'Review candidates=' + JSON.stringify(suggestions.concat(aliases[f.stem] || [])));
                } else {
                    bind(f,'erv_lineage',[f.stem],{});
                    if (/retired|deprecated|excluded|inactive|superseded/i.test(clean(r.status))) {
                        issue('ERROR','inactive_lineage',f.relative,'status=' + clean(r.status));
                    }
                }
            } else {
                var members = byMissillac[f.stem] || [];
                if (!members.length) {
                    issue('ERROR','unmatched_locus',f.relative,
                        'No exact erv_locus.missillac_id match; do not infer identity from the numeric suffix alone');
                    return;
                }
                var identities = members.map(function(r) {
                    return [clean(r.id),clean(r.host_species),clean(r.genome_build),clean(r.scaffold),
                        clean(r.start_position),clean(r.end_position),clean(r.orientation)];
                }).sort(function(a,b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
                bind(f,'erv_locus',members.map(function(r) { return clean(r.id); }),identities);
                if (members.length > 1) { issue('WARNING','multiple_locus_members',f.relative,
                    'Shared orthology/tandem group: ' + members.map(function(r) { return clean(r.id); }).join(';')); }
                members.forEach(function(r) {
                    var parsed = /^(.+)-([1-9]\d*)$/.exec(f.stem);
                    var ls = Object.keys(locusLineages[clean(r.id)] || {});
                    if (!parsed) { issue('ERROR','noncanonical_missillac_id',f.relative,clean(r.id)); return; }
                    if (String(Number(parsed[2])) !== clean(r.orthology_group)) {
                        issue('ERROR','orthology_number_mismatch',f.relative,clean(r.id) + ': group=' + clean(r.orthology_group));
                    }
                    if (ls.length !== 1 || ls[0] !== parsed[1] || !lineages[parsed[1]]) {
                        issue('ERROR','locus_lineage_mismatch',f.relative,clean(r.id) + ': associations=' + ls.join(';'));
                    }
                });
            }
        });
        glue.logInfo(kind + ': ' + profiles.length + ' Markdown files');
    });
    allClades.forEach(function(e) {
        if (!covered[e.table + ':' + e.id]) { missing.push(['clade',e.table,e.id,'']); }
    });
    lineageRows.forEach(function(r) {
        if (!covered['erv_lineage:' + clean(r.id)]) { missing.push(['lineage','erv_lineage',clean(r.id),clean(r.status)]); }
    });
    Object.keys(previous).sort().forEach(function(file) {
        if (!seen[file]) { issue('WARNING','profile_removed_since_baseline',file,previous[file].entity_ids); }
        else if (!bindings.some(function(b) { return b[0] === file; })) {
            issue('ERROR','baseline_binding_now_unresolved',file,previous[file].entity_ids);
        }
    });
    // Missing locus descriptions are expected. Avoid producing ~100,000 gaps.
    var described = Object.keys(byMissillac).filter(function(mid) { return covered['erv_locus:' + mid]; }).length;
    glue.logInfo('Assigned Missillac keys: ' + Object.keys(byMissillac).length + '; keys with profiles: ' + described);
    if (!BASELINE_PATH) { issue('WARNING','no_reviewed_baseline','',
        'Existing matches cannot establish historical or biological identity. Review bindings before retaining a baseline.'); }
    var output = path(OUTPUT_ROOT);
    Files.createDirectories(output);
    var runDir = Files.createTempDirectory(output, 'run-' + new Date().toISOString().replace(/[:.]/g,'-') + '-');
    function write(name, header, rows) {
        var writer = Files.newBufferedWriter(runDir.resolve(name),UTF8,Options.CREATE_NEW,Options.WRITE);
        function cell(v) { return String(v).replace(/[\t\r\n]/g,' '); }
        try {
            writer.write(header.join('\t') + '\n');
            rows.forEach(function(r) { writer.write(r.map(cell).join('\t') + '\n'); });
        } finally { writer.close(); }
    }
    write('findings.tsv',['severity','code','file','detail'],findings);
    write('bindings.tsv',['file','kind','lookup_key','entity_table','entity_ids','identity_json'],bindings);
    write('missing_profiles.tsv',['kind','entity_table','entity_id','status'],missing);
    Object.keys(counts).sort().forEach(function(k) { glue.logInfo(k + ': ' + counts[k]); });
    glue.logInfo('Audit reports: ' + runDir + '; errors=' + errors);
    if (errors && FAIL_ON_ERRORS) { throw new Error('Profile binding audit failed: ' + errors + ' errors. Reports written to ' + runDir); }
}());
