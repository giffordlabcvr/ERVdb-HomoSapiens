/*
 * Export relabelled Newick trees and their annotation TSVs from GLUE.
 * Run in the ERVdb project mode: run script exportWebAppTrees.js
 *
 * Set PROJECT_ROOT to the absolute project directory visible to GLUE, or
 * launch GLUE from the project directory and leave it as '.'. Java file I/O
 * resolves '.' against the process working directory, NOT load-save-path.
 * Output is PROJECT_ROOT/web-app/trees, not the filesystem root /web-app.
 * No database changes; input files are never modified.
 *
 * Folder/reference names use erv_lineage.id verbatim (including dots).
 * Locus labels use erv_locus.missillac_id verbatim. Newick labels containing
 * punctuation such as '(left)' are quoted automatically.
 *
 * Shared LTR families are copied to every associated ERV lineage. Families
 * without an association are skipped and reported; no lineage is guessed.
 * All input files are validated before the first output file is written.
 * Existing identical outputs are accepted; differing outputs require
 * OVERWRITE = true. Old outputs are never deleted; use a fresh output
 * directory when rebuilding after renaming lineages or removing trees.
 * Requires GLUE's Nashorn Java interoperability, as used by existing exports.
 */
var PROJECT_ROOT = ".";
var OUTPUT_DIR = "web-app/trees";
var DRY_RUN = false;
var OVERWRITE = false;
// Optional explicit mappings ONLY for missing/obsolete reference metadata.
// Values must be existing erv_lineage IDs; LTR values are arrays of IDs.
var LINEAGE_OVERRIDES = {}; // {"AL_LINEAGE_1_Zeta_W9P_W": "ERV-1.Zeta.W9P.W"}
var LTR_OVERRIDES = {};     // {"LTR17": ["ERV-1.Zeta.W9P.W"]}

(function () {
    var File = Java.type("java.io.File");
    var Files = Java.type("java.nio.file.Files");
    var UTF8 = Java.type("java.nio.charset.StandardCharsets").UTF_8;
    var JString = Java.type("java.lang.String");
    var root = new File(PROJECT_ROOT).getCanonicalFile();
    var output = new File(root, OUTPUT_DIR).getCanonicalFile();
    var lineages = Object.create(null), ltrs = Object.create(null);
    var alignments = Object.create(null), references = Object.create(null);
    var locusNames = Object.create(null), bareNames = Object.create(null);
    var destinations = Object.create(null), plan = [], skipped = [];
    var manifest = [["input", "output", "erv_lineage", "alignment", "kind", "tips_or_cells_relabelled"]];
    var labels = [["output", "original_label", "new_label"]];
    var issues = [];

    function log(s) { glue.log("INFO", s); }
    function query(a) { return glue.tableToObjects(glue.command(a)); }
    function norm(v) {
        if (v === null || v === undefined) return null;
        var s = String(v).trim();
        return !s || s === "-" || s === "null" ? null : s;
    }
    function read(f) { return String(new JString(Files.readAllBytes(f.toPath()), UTF8)); }
    function bytes(s) { return new JString(s).getBytes(UTF8); }
    function key(source, seq) { return source + "/" + seq; }
    function unique(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
    function safe(s) {
        if (!s || !/^[A-Za-z0-9_.-]+$/.test(s) || s === "." || s === "..") {
            throw new Error("Unsafe directory/file component: " + s);
        }
        return s;
    }
    function table(rows) {
        return rows.map(function (r) {
            return r.map(function (v) { return String(v).replace(/[\t\r\n]/g, " "); }).join("\t");
        }).join("\n") + "\n";
    }
    function newickLabel(s) {
        return /^[^\s():,;\[\]'\"]+$/.test(s) ? s : "'" + s.replace(/'/g, "''") + "'";
    }
    function parseMember(s) {
        var m = /^\/?alignment\/([^/]+)\/member\/([^/]+)\/(.+)$/.exec(s);
        return m ? {alignment: m[1], source: m[2], sequence: m[3]} : null;
    }
    function locusName(source, seq) { return locusNames[key(source, seq)] || null; }

    log("Project directory: " + root);
    log("Output directory: " + output);
    query(["list", "custom-table-row", "erv_lineage", "id"]).forEach(function (r) {
        lineages[String(r.id)] = true;
    });
    query(["list", "custom-table-row", "ltr_lineage", "id", "original_name"]).forEach(function (r) {
        var entry = {id: String(r.id), lineages: []};
        ltrs[String(r.id)] = entry;
        var alias = norm(r.original_name);
        if (alias) {
            if (ltrs[alias] && ltrs[alias].id !== entry.id) throw new Error("Ambiguous LTR alias: " + alias);
            ltrs[alias] = entry;
        }
    });
    query(["list", "custom-table-row", "erv_lineage_ltr_assoc", "id", "erv_lineage.id", "ltr_lineage.id"]).forEach(function (r) {
        var e = norm(r["erv_lineage.id"]), l = norm(r["ltr_lineage.id"]);
        if (e && l && ltrs[l]) ltrs[l].lineages.push(e);
    });
    query(["list", "reference", "name", "sequence.source.name", "sequence.sequenceID",
        "sequence.erv_lineage_reference.erv_lineage.id", "sequence.ltr_lineage_reference.ltr_lineage.id"]).forEach(function (r) {
        references[String(r.name)] = {
            source: norm(r["sequence.source.name"]), sequence: norm(r["sequence.sequenceID"]),
            lineage: norm(r["sequence.erv_lineage_reference.erv_lineage.id"]),
            ltr: norm(r["sequence.ltr_lineage_reference.ltr_lineage.id"])
        };
    });
    query(["list", "alignment", "name", "refSequence.name"]).forEach(function (r) {
        alignments[String(r.name)] = references[String(r["refSequence.name"])];
    });
    query(["list", "sequence", "-w", "erv_locus.missillac_id != null",
        "source.name", "sequenceID", "erv_locus.missillac_id"]).forEach(function (r) {
        var s = String(r["source.name"]), id = String(r.sequenceID), label = norm(r["erv_locus.missillac_id"]);
        if (!label) return;
        locusNames[key(s, id)] = label;
        if (!bareNames[id]) bareNames[id] = [];
        bareNames[id].push(label);
    });
    log("Loaded " + Object.keys(locusNames).length + " sequence-to-MIssillac mappings");

    function validateLineage(id) {
        if (!lineages[id]) throw new Error("Unknown erv_lineage.id: " + id);
        return safe(id);
    }
    function resolveFile(name, kind) {
        var m, aln, ref, code;
        if (kind === "lineage") {
            m = /^AL_LINEAGE_(.+)\.annotations\.tsv$/.exec(name);
            if (m) code = m[1];
            else {
                m = /^(.+)_(gag|pol|env)_nucs(?:_midpoint_rerooted)?\.tree$/.exec(name);
                if (!m) return null;
                code = m[1];
            }
            aln = "AL_LINEAGE_" + code;
            ref = alignments[aln];
            var lineage = LINEAGE_OVERRIDES[aln] || (ref && ref.lineage);
            if (!lineage) throw new Error("No ERV lineage linked to constraining reference for " + aln + "; populate reference metadata or LINEAGE_OVERRIDES");
            return {alignment: aln, lineages: [validateLineage(lineage)], kind: kind};
        }
        m = /^AL_LTR_(.+)\.annotations\.tsv$/.exec(name);
        if (m) code = m[1];
        else {
            m = /^(.+)_nucs(?:_midpoint_rerooted)?\.tree$/.exec(name);
            if (!m) return null;
            code = m[1];
        }
        aln = "AL_LTR_" + code;
        ref = alignments[aln];
        var entry = (ref && ref.ltr && ltrs[ref.ltr]) || ltrs[code];
        var targets = LTR_OVERRIDES[code] || (entry && entry.lineages) || [];
        targets = unique(targets).map(validateLineage).sort();
        return {alignment: aln, lineages: targets, kind: kind};
    }
    function replacement(label, context, folder, allowBare) {
        var member = parseMember(label);
        if (member) {
            var locus = locusName(member.source, member.sequence);
            if (locus) return locus;
            var ref = alignments[context.alignment];
            if (ref && member.source === ref.source && member.sequence === ref.sequence) return folder + "-reference";
            // A non-constraining reference/outgroup may also have lineage metadata.
            var linked = [];
            Object.keys(references).forEach(function (n) {
                var r = references[n];
                if (r.source === member.source && r.sequence === member.sequence && r.lineage) linked.push(r.lineage);
            });
            linked = unique(linked);
            if (linked.length === 1) return linked[0] + "-reference";
            throw new Error("No MIssillac ID or reference mapping for " + label);
        }
        if (allowBare) {
            var a = unique(bareNames[label] || []);
            if (a.length === 1) return a[0];
            if (a.length > 1) throw new Error("Ambiguous bare sequence ID in annotations: " + label);
            var r = alignments[context.alignment];
            if (r && label === r.sequence) return folder + "-reference";
        }
        return label;
    }

    // Tokenise Newick without reserialising topology, lengths, supports or comments.
    // Only leaf-name spans are replaced, including single-quoted GLUE names.
    function relabelNewick(text, rename) {
        if (/^\s*#NEXUS/i.test(text)) throw new Error("Expected Newick, found NEXUS");
        var result = [], pos = 0, i = 0, expectLeaf = true, depth = 0;
        var tips = 0, semicolons = 0, seen = Object.create(null);
        while (i < text.length) {
            var c = text.charAt(i);
            if (/\s/.test(c)) { i++; continue; }
            if (c === "[") {
                var nesting = 1; i++;
                while (i < text.length && nesting) {
                    c = text.charAt(i++);
                    if (c === "[") nesting++;
                    else if (c === "]") nesting--;
                }
                if (nesting) throw new Error("Unterminated Newick annotation");
                continue;
            }
            if (c === "(") { depth++; expectLeaf = true; i++; continue; }
            if (c === ",") { expectLeaf = true; i++; continue; }
            if (c === ")") { if (--depth < 0) throw new Error("Unbalanced Newick"); expectLeaf = false; i++; continue; }
            if (c === ":") { expectLeaf = false; i++; continue; }
            if (c === ";") {
                if (depth !== 0) throw new Error("Unbalanced Newick");
                semicolons++; seen = Object.create(null); expectLeaf = true; i++; continue;
            }
            var start = i, value = "";
            if (c === "'") {
                i++; var closed = false;
                while (i < text.length) {
                    c = text.charAt(i++);
                    if (c === "'") {
                        if (text.charAt(i) === "'") { value += "'"; i++; }
                        else { closed = true; break; }
                    } else value += c;
                }
                if (!closed) throw new Error("Unterminated quoted Newick name");
            } else {
                while (i < text.length && !/[\s():,;\[\]]/.test(text.charAt(i))) value += text.charAt(i++);
                if (i === start) throw new Error("Unexpected Newick character at " + i);
            }
            if (expectLeaf) {
                var changed = rename(value);
                if (seen[changed]) throw new Error("Duplicate tip label after relabelling: " + changed);
                seen[changed] = true; tips++;
                result.push(text.substring(pos, start), newickLabel(changed)); pos = i;
            }
            expectLeaf = false;
        }
        if (depth !== 0 || !semicolons || !tips || !/;\s*(?:\[[\s\S]*\]\s*)?$/.test(text)) throw new Error("Incomplete/empty Newick tree");
        result.push(text.substring(pos));
        return result.join("");
    }
    // GLUE annotations are plain TSV. Relabel only exact ID cells; preserve
    // headers, all other fields, column order and original line endings.
    function relabelTsv(text, rename) {
        return text.split(/(\r\n|\n|\r)/).map(function (line, index) {
            if (index % 2) return line;
            return line.split("\t").map(function (cell) {
                var quoted = /^"(?:[^"]|"")*"$/.test(cell);
                var value = quoted ? cell.substring(1, cell.length - 1).replace(/""/g, '"') : cell;
                var changed = rename(value);
                if (changed === value) return cell;
                return quoted ? '"' + changed.replace(/"/g, '""') + '"' : changed;
            }).join("\t");
        }).join("");
    }
    function addPlan(relative, content) {
        if (destinations[relative]) throw new Error("Output collision: " + relative);
        destinations[relative] = true;
        var f = new File(output, relative);
        if (f.exists() && !OVERWRITE && read(f) !== content) throw new Error("Output differs; set OVERWRITE=true or use a fresh OUTPUT_DIR: " + f);
        plan.push({file: f, content: content});
    }
    function scan(kind) {
        var dir = new File(root, "trees/" + kind);
        if (!dir.isDirectory()) throw new Error("Missing input directory: " + dir);
        var children = dir.listFiles(), files = [];
        for (var j = 0; j < children.length; j++) if (children[j].isFile()) files.push(children[j]);
        files.sort(function (a, b) { return String(a.getName()).localeCompare(String(b.getName())); });
        files.forEach(function (file) {
            var name = String(file.getName()), input = "trees/" + kind + "/" + name;
            try {
                var context = resolveFile(name, kind);
                if (!context) {
                    if (/\.(tree|tsv)$/.test(name)) throw new Error("Unrecognised tree/annotation filename: " + name);
                    return;
                }
                if (!context.lineages.length) {
                    skipped.push([input, context.alignment, "No ERV-lineage association for LTR family"]);
                    return;
                }
                var text = read(file), isTree = /\.tree$/.test(name);
                context.lineages.forEach(function (folder) {
                    var relative = folder + "/" + safe(name), count = 0, map = Object.create(null);
                    function rename(value) {
                        var changed = replacement(value, context, folder, !isTree);
                        if (isTree && !parseMember(value) && changed === value) {
                            // Previously relabelled tips are accepted, but unknown IDs
                            // are errors so that missing mappings cannot pass silently.
                            if (!/^ERV-/.test(value)) throw new Error("Unrecognised tree tip: " + value);
                        }
                        if (changed !== value) {
                            count++;
                            if (!map[value]) { labels.push([relative, value, changed]); map[value] = true; }
                        }
                        return changed;
                    }
                    var content = isTree ? relabelNewick(text, rename) : relabelTsv(text, rename);
                    addPlan(relative, content);
                    manifest.push([input, relative, folder, context.alignment, isTree ? "tree" : "annotations", count]);
                });
            } catch (e) { issues.push(input + ": " + e.message); }
        });
    }
    scan("lineage"); scan("ltr");
    skipped.forEach(function (r) { log("SKIPPED: " + r[0] + " (" + r[2] + ")"); });
    if (issues.length) {
        issues.forEach(function (s) { log("ERROR: " + s); });
        throw new Error("Preflight failed with " + issues.length + " issue(s); no outputs written. See ERROR lines above.");
    }
    if (manifest.length === 1) throw new Error("No files selected; check PROJECT_ROOT");
    addPlan("export_manifest.tsv", table(manifest));
    addPlan("label_map.tsv", table(labels));
    addPlan("skipped_files.tsv", table([["input", "alignment", "reason"]].concat(skipped)));
    log("Validated " + (manifest.length - 1) + " tree/annotation copies; " + skipped.length + " input files skipped");
    if (DRY_RUN) { log("DRY_RUN: no outputs written"); return; }
    plan.forEach(function (item) {
        Files.createDirectories(item.file.toPath().getParent());
        Files.write(item.file.toPath(), bytes(item.content));
    });
    log("Export complete: " + output + " (including manifest, label map and skipped-file report)");
})();
