/* GLUE/Nashorn ECMA module. Run from project mode.
 * Coordinates: 1-based, inclusive, ascending on either strand.
 * No sequence, LTR association or Missillac identity is assigned here.
 */
var Files = Java.type('java.nio.file.Files');
var Paths = Java.type('java.nio.file.Paths');
var UTF8 = Java.type('java.nio.charset.StandardCharsets').UTF_8;
var LOCUS = 'erv_locus';
var ASSOC = 'erv_locus_lineage_assoc';
var REQUIRED = ['locus_id', 'scaffold', 'start_position', 'end_position',
  'orientation', 'locus_type', 'lineage_id', 'evidence', 'confidence'];
var OPTIONAL = ['structural_profile', 'is_mosaic', 'taxonomic_resolution',
  'is_high_support', 'curation_tier'];
var LIMITS = {scaffold:100, orientation:10, locus_type:30, structural_profile:100,
  taxonomic_resolution:30, curation_tier:30, evidence:50, confidence:30};

function textValue(x) { return x == null ? '' : String(x).trim(); }
function owns(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function table(cmd) { return glue.tableToObjects(glue.command(cmd)) || []; }
function path(t, id) { return 'custom-table-row/' + t + '/' + id; }
function assocId(r) { return r.locus_id + '__' + r.lineage_id; }
function integer(s) { return /^[1-9][0-9]*$/.test(s) && Number(s) <= 2147483647; }
function safeId(s) { return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s); }
function overlap(a, b) {
  return a.scaffold === b.scaffold &&
    Number(a.start_position) <= Number(b.end_position) &&
    Number(b.start_position) <= Number(a.end_position);
}
function overlapBp(a, b) {
  return Math.min(Number(a.end_position), Number(b.end_position)) -
    Math.max(Number(a.start_position), Number(b.start_position)) + 1;
}

function readInput(filename) {
  var lines = Java.from(Files.readAllLines(Paths.get(String(filename)), UTF8));
  if (!lines.length) { throw new Error('Empty TSV'); }
  var header = String(lines[0]).replace(/^\uFEFF/, '').split('\t');
  var seenColumns = Object.create(null);
  header.forEach(function(k) {
    if (owns(seenColumns, k)) { throw new Error('Duplicate column: ' + k); }
    if (REQUIRED.concat(OPTIONAL).indexOf(k) < 0) {
      throw new Error('Unknown column: ' + k);
    }
    seenColumns[k] = true;
  });
  REQUIRED.forEach(function(k) {
    if (!owns(seenColumns, k)) { throw new Error('Missing column: ' + k); }
  });
  var rows = [];
  var seen = Object.create(null);
  for (var i = 1; i < lines.length; i++) {
    var line = String(lines[i]);
    if (!textValue(line) || /^\s*#/.test(line)) { continue; }
    var cells = line.split('\t');
    if (cells.length !== header.length) {
      throw new Error('Wrong column count on line ' + (i + 1));
    }
    var r = {input_line:i + 1};
    header.forEach(function(k, j) { r[k] = textValue(cells[j]); });
    REQUIRED.forEach(function(k) {
      if (!r[k]) { throw new Error('Missing ' + k + ' on line ' + (i + 1)); }
    });
    if (!safeId(r.locus_id) || !safeId(r.lineage_id)) {
      throw new Error('Unsafe locus/lineage ID on line ' + (i + 1));
    }
    if (owns(seen, r.locus_id)) { throw new Error('Duplicate locus_id: ' + r.locus_id); }
    seen[r.locus_id] = true;
    if (!integer(r.start_position) || !integer(r.end_position) ||
        Number(r.start_position) > Number(r.end_position)) {
      throw new Error('Invalid 1-based inclusive interval on line ' + (i + 1));
    }
    if (['+', '-', 'positive', 'negative'].indexOf(r.orientation) < 0) {
      throw new Error('orientation must be +, -, positive or negative: line ' + (i + 1));
    }
    // Preserve the supplied encoding: use the convention of the existing build.
    ['is_mosaic', 'is_high_support'].forEach(function(k) {
      if (r[k] && r[k] !== 'true' && r[k] !== 'false') {
        throw new Error(k + ' must be true, false or blank: line ' + (i + 1));
      }
    });
    Object.keys(LIMITS).forEach(function(k) {
      if (r[k] && r[k].length > LIMITS[k]) {
        throw new Error(k + ' exceeds schema length: line ' + (i + 1));
      }
    });
    rows.push(r);
  }
  if (!rows.length) { throw new Error('TSV has no data rows'); }
  return rows;
}

function snapshot(host, build, scaffolds) {
  var db = {ids:Object.create(null), loci:[], lineages:Object.create(null),
    assocs:Object.create(null), assocIds:Object.create(null)};
  table(['list', 'custom-table-row', LOCUS, 'id', 'host_species',
    'genome_build', 'scaffold', 'start_position', 'end_position', 'orientation'])
    .forEach(function(r) {
      db.ids[textValue(r.id)] = r;
      if (textValue(r.host_species) !== host || textValue(r.genome_build) !== build) { return; }
      r.scaffold = textValue(r.scaffold);
      if (!owns(scaffolds, r.scaffold)) { return; }
      if (!integer(textValue(r.start_position)) || !integer(textValue(r.end_position)) ||
          Number(r.start_position) > Number(r.end_position)) {
        throw new Error('Invalid coordinates in existing locus ' + r.id +
          '; repair before matching on this scaffold');
      }
      db.loci.push(r);
    });
  table(['list', 'custom-table-row', 'erv_lineage', 'id', 'entity_type'])
    .forEach(function(r) { db.lineages[textValue(r.id)] = textValue(r.entity_type); });
  table(['list', 'custom-table-row', ASSOC, 'id', 'erv_locus.id',
    'erv_lineage.id', 'association_role']).forEach(function(r) {
      db.assocIds[textValue(r.id)] = true;
      var id = textValue(r['erv_locus.id']);
      if (!owns(db.assocs, id)) { db.assocs[id] = []; }
      db.assocs[id].push(textValue(r['erv_lineage.id']) + ':' + textValue(r.association_role));
    });
  return db;
}

function makePlan(tsvFile, hostSpecies, genomeBuild) {
  var host = textValue(hostSpecies), build = textValue(genomeBuild);
  if (!host || host.length > 100 || !build || build.length > 50) {
    throw new Error('Supply hostSpecies (<=100 characters) and genomeBuild (<=50 characters)');
  }
  var input = readInput(tsvFile), scaffolds = Object.create(null);
  input.forEach(function(r) { scaffolds[r.scaffold] = true; });
  var db = snapshot(host, build, scaffolds);
  var report = [], invalid = 0;
  input.forEach(function(r) {
    var errors = [], inputOverlaps = [];
    if (!owns(db.lineages, r.lineage_id)) { errors.push('Unknown lineage_id'); }
    else if (['lineage', 'sublineage', 'erv_derived_repeat'].indexOf(db.lineages[r.lineage_id]) < 0) {
      errors.push('Unsupported lineage entity_type: ' + db.lineages[r.lineage_id]);
    }
    input.forEach(function(other) {
      if (other !== r && overlap(r, other)) { inputOverlaps.push(other.locus_id); }
    });
    if (inputOverlaps.length) { errors.push('Overlapping input candidates: ' + inputOverlaps.join(', ')); }
    var hits = db.loci.filter(function(x) { return overlap(r, x); });
    if (owns(db.ids, r.locus_id) && !hits.some(function(x) { return textValue(x.id) === r.locus_id; })) {
      errors.push('locus_id already belongs to a different interval, host or build');
    }
    if (!hits.length && owns(db.assocIds, assocId(r))) { errors.push('Association ID already exists'); }
    r.status = errors.length ? 'ERROR' : (hits.length ? 'SKIP_OVERLAP' : 'READY');
    if (errors.length) { invalid++; }
    (hits.length ? hits : [null]).forEach(function(hit) {
      report.push({input_line:r.input_line, locus_id:r.locus_id,
        host_species:host, genome_build:build, scaffold:r.scaffold,
        start_position:r.start_position, end_position:r.end_position,
        orientation:r.orientation, lineage_id:r.lineage_id, status:r.status,
        matched_locus_id:hit ? textValue(hit.id) : '',
        matched_start:hit ? hit.start_position : '', matched_end:hit ? hit.end_position : '',
        matched_orientation:hit ? textValue(hit.orientation) : '',
        overlap_bp:hit ? overlapBp(r, hit) : 0,
        matched_lineages:hit ? (db.assocs[textValue(hit.id)] || []).join('; ') : '',
        message:errors.join('; ') || (hits.length ? 'Existing overlap; no changes' : 'Create locus and primary association')});
    });
  });
  return {input:input, report:report, invalid:invalid, host:host, build:build};
}

function previewLoci(tsvFile, hostSpecies, genomeBuild) {
  return makePlan(tsvFile, hostSpecies, genomeBuild).report;
}

function setField(k, v) { glue.command(['set', 'field', k, String(v)]); }

function createCandidate(r, host, build) {
  var locusCreated = false, assocCreated = false, aid = assocId(r);
  try {
    glue.command(['create', 'custom-table-row', LOCUS, r.locus_id]);
    locusCreated = true;
    glue.inMode(path(LOCUS, r.locus_id), function() {
      setField('host_species', host); setField('genome_build', build);
      ['scaffold', 'start_position', 'end_position', 'orientation', 'locus_type']
        .concat(OPTIONAL).forEach(function(k) {
          if (r[k] != null && r[k] !== '') { setField(k, r[k]); }
        });
    });
    glue.command(['create', 'custom-table-row', ASSOC, aid]);
    assocCreated = true;
    glue.inMode(path(ASSOC, aid), function() {
      glue.command(['set', 'link-target', 'erv_locus', path(LOCUS, r.locus_id)]);
      glue.command(['set', 'link-target', 'erv_lineage', path('erv_lineage', r.lineage_id)]);
      setField('association_role', 'primary');
      setField('evidence', r.evidence); setField('confidence', r.confidence);
    });
  } catch (e) {
    // Best-effort compensation for this candidate only; no batch transaction is assumed.
    var cleanupErrors = [];
    if (assocCreated) {
      try { glue.command(['delete', 'custom-table-row', ASSOC, aid]); }
      catch (ae) { cleanupErrors.push('association cleanup: ' + String(ae)); }
    }
    if (locusCreated && !cleanupErrors.length) {
      try { glue.command(['delete', 'custom-table-row', LOCUS, r.locus_id]); }
      catch (le) { cleanupErrors.push('locus cleanup: ' + String(le)); }
    }
    throw new Error('Creation failed for ' + r.locus_id + ': ' + String(e) +
      '. Earlier successful candidates remain. ' +
      (cleanupErrors.length ? cleanupErrors.join('; ') : 'Current candidate cleanup completed.'));
  }
}

function importLoci(tsvFile, hostSpecies, genomeBuild) {
  // Always rebuild against live state, even if previewLoci was already called.
  var plan = makePlan(tsvFile, hostSpecies, genomeBuild);
  if (plan.invalid) {
    throw new Error('Preflight failed for ' + plan.invalid +
      ' candidate(s). No changes made. Run previewLoci for details.');
  }
  plan.input.forEach(function(r) {
    if (r.status === 'READY') { createCandidate(r, plan.host, plan.build); }
  });
  plan.report.forEach(function(r) {
    if (r.status === 'READY') { r.status = 'CREATED'; r.message = 'Created locus and primary association'; }
  });
  return plan.report;
}
