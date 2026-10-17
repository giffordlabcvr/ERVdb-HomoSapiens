/**
 * ervLocusLineageCurator.js
 * GLUE ECMA function invoker for curated locus-to-lineage corrections.
 *
 * Input TSV columns:
 * locus_id  old_lineage_id  new_lineage_id  reason
 *
 * Requires project mode. Invoke previewOverrides before applyOverrides.
 * Only primary associations are affected. Existing associations to other
 * lineage entities (e.g. secondary) are not changed.
 */

var Files = Java.type('java.nio.file.Files');
var Paths = Java.type('java.nio.file.Paths');
var StandardCharsets = Java.type('java.nio.charset.StandardCharsets');

var TABLE = 'erv_locus_lineage_assoc';
var PRIMARY = 'primary';

function norm(x) {
  return x == null ? '' : String(x).trim();
}

function has(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function query(cmd) {
  return glue.tableToObjects(glue.command(cmd)) || [];
}

function rowPath(table, id) {
  return 'custom-table-row/' + table + '/' + id;
}

function associationId(locus, lineage) {
  return (locus + '__' + lineage)
    .replace(/[^A-Za-z0-9._-]/g, '_');
}

// ------------------------------------------------------------
// 1. Read override TSV
// ------------------------------------------------------------

function parseTsv(filename) {

  var lines = Java.from(
    Files.readAllLines(
      Paths.get(String(filename)),
      StandardCharsets.UTF_8
    )
  );

  if (!lines.length) {
    throw new Error('TSV is empty: ' + filename);
  }

  var header = String(lines[0])
    .replace(/^\uFEFF/, '')
    .split('\t');

  var needed = [
    'locus_id',
    'old_lineage_id',
    'new_lineage_id',
    'reason'
  ];

  needed.forEach(function(col) {
    if (header.indexOf(col) < 0) {
      throw new Error('Missing TSV column: ' + col);
    }
  });

  var seen = Object.create(null);
  var result = [];

  for (var i = 1; i < lines.length; i++) {

    var line = String(lines[i]);

    if (!norm(line) || /^\s*#/.test(line)) {
      continue;
    }

    var cells = line.split('\t');
    var item = { line: i + 1 };

    header.forEach(function(col, j) {
      item[col] = norm(cells[j]);
    });

    if (!item.locus_id ||
        !item.old_lineage_id ||
        !item.new_lineage_id ||
        !item.reason) {

      throw new Error(
        'Missing required value on line ' + (i + 1)
      );
    }

    if (has(seen, item.locus_id)) {
      throw new Error(
        'Duplicate locus: ' + item.locus_id
      );
    }

    seen[item.locus_id] = true;
    result.push(item);
  }

  return result;
}

// ------------------------------------------------------------
// 2. Load database state
// ------------------------------------------------------------

function snapshot() {

  var loci = Object.create(null);
  var lineages = Object.create(null);

  var assocByLocus = Object.create(null);
  var assocById = Object.create(null);

  query([
    'list', 'custom-table-row',
    'erv_locus', 'id'
  ]).forEach(function(r) {
    loci[norm(r.id)] = true;
  });

  query([
    'list', 'custom-table-row',
    'erv_lineage', 'id', 'entity_type'
  ]).forEach(function(r) {
    lineages[norm(r.id)] = norm(r.entity_type);
  });

  query([
    'list', 'custom-table-row',
    TABLE,
    'id',
    'erv_locus.id',
    'erv_lineage.id',
    'association_role'
  ]).forEach(function(r) {

    var locus = norm(r['erv_locus.id']);

    assocById[norm(r.id)] = r;

    if (!has(assocByLocus, locus)) {
      assocByLocus[locus] = [];
    }

    assocByLocus[locus].push(r);
  });

  return {
    loci: loci,
    lineages: lineages,
    byLocus: assocByLocus,
    byId: assocById
  };
}

// ------------------------------------------------------------
// 3. Build and validate override plan
// ------------------------------------------------------------

function buildPlan(filename) {

  var items = parseTsv(filename);
  var db = snapshot();

  var results = [];
  var invalid = 0;

  items.forEach(function(item) {

    var locus = item.locus_id;
    var oldL = item.old_lineage_id;
    var newL = item.new_lineage_id;

    var status = 'READY';
    var message = '';

    var primary = (db.byLocus[locus] || [])
      .filter(function(r) {
        return norm(r.association_role) === PRIMARY;
      });

    var old = primary.filter(function(r) {
      return norm(r['erv_lineage.id']) === oldL;
    });

    var newer = primary.filter(function(r) {
      return norm(r['erv_lineage.id']) === newL;
    });

    var targetId = associationId(locus, newL);

    if (!has(db.loci, locus)) {

      status = 'ERROR';
      message = 'Locus absent';

    } else if (!has(db.lineages, oldL) ||
               !has(db.lineages, newL)) {

      status = 'ERROR';
      message = 'Old or new lineage absent';

    } else if (db.lineages[newL] !== 'lineage') {

      status = 'ERROR';
      message = 'Target entity_type is not lineage';

    } else if (oldL === newL) {

      status = 'ERROR';
      message = 'Old and new lineage identical';

    } else if (
      primary.length === 1 &&
      newer.length === 1 &&
      !old.length &&
      norm(newer[0].id) === targetId
    ) {

      status = 'ALREADY_APPLIED';

    } else if (
      primary.length !== 1 ||
      old.length !== 1
    ) {

      status = 'ERROR';
      message =
        'Current primary association does not match expected old lineage';

    } else if (has(db.byId, targetId)) {

      status = 'ERROR';
      message = 'Target association ID already exists';
    }

    if (status === 'ERROR') {
      invalid++;
    }

    results.push({
      locus_id: locus,
      old_lineage_id: oldL,
      new_lineage_id: newL,
      reason: item.reason,
      status: status,
      message: message,
      old_assoc_id: old.length ? norm(old[0].id) : '',
      new_assoc_id: targetId
    });
  });

  return {
    results: results,
    invalid: invalid
  };
}

// ------------------------------------------------------------
// 4. Preview overrides
// ------------------------------------------------------------

function previewOverrides(tsvFile) {

  return buildPlan(tsvFile).results.map(function(r) {

    return {
      locus_id: r.locus_id,
      old_lineage_id: r.old_lineage_id,
      new_lineage_id: r.new_lineage_id,
      reason: r.reason,
      status: r.status,
      message: r.message
    };

  });
}

// ------------------------------------------------------------
// 5. Apply overrides
// ------------------------------------------------------------

function applyOverrides(tsvFile) {

  var plan = buildPlan(tsvFile);

  if (plan.invalid) {
    throw new Error(
      'Preflight failed: ' +
      plan.invalid +
      ' invalid override(s). No changes made.'
    );
  }

  var results = [];

  plan.results.forEach(function(r) {

    if (r.status === 'ALREADY_APPLIED') {

      results.push({
        locus_id: r.locus_id,
        status: 'ALREADY_APPLIED'
      });

      return;
    }

    // Create replacement first, so the old association
    // survives a create error.

    glue.command([
      'create',
      'custom-table-row',
      TABLE,
      r.new_assoc_id
    ]);

    glue.inMode(
      rowPath(TABLE, r.new_assoc_id),
      function() {

        glue.command([
          'set',
          'link-target',
          'erv_locus',
          rowPath('erv_locus', r.locus_id)
        ]);

        glue.command([
          'set',
          'link-target',
          'erv_lineage',
          rowPath('erv_lineage', r.new_lineage_id)
        ]);

        glue.command([
          'set',
          'field',
          'association_role',
          PRIMARY
        ]);

        glue.command([
          'set',
          'field',
          'evidence',
          'manual_curation'
        ]);

        glue.command([
          'set',
          'field',
          'confidence',
          'high'
        ]);
      }
    );

    // Remove superseded association.

    glue.command([
      'delete',
      'custom-table-row',
      TABLE,
      r.old_assoc_id
    ]);

    results.push({
      locus_id: r.locus_id,
      status: 'APPLIED'
    });
  });

  return results;
}

// ------------------------------------------------------------
// 6. List primary associations
// ------------------------------------------------------------

function listPrimaryAssociations(locusId) {

  var id = norm(locusId);
  var db = snapshot();

  if (!has(db.loci, id)) {
    throw new Error('Unknown locus: ' + id);
  }

  return (db.byLocus[id] || [])
    .filter(function(r) {
      return norm(r.association_role) === PRIMARY;
    })
    .map(function(r) {

      return {
        locus_id: id,
        association_id: norm(r.id),
        lineage_id: norm(r['erv_lineage.id']),
        role: norm(r.association_role)
      };

    });
}

