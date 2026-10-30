/*
 * Export relabelled Newick trees and their annotation TSVs from GLUE.
 * Run in the ERVdb project mode: run script exportWebAppTrees.js
 *
 * Set PROJECT_ROOT to the absolute project directory visible to GLUE, or
 * launch GLUE from the project directory and leave it as '.'. Java file I/O
 * resolves '.' against the process working directory, NOT load-save-path.
 * Output is PROJECT_ROOT/web-app/trees, not the filesystem root /web-app.
 * No database changes; input files are never modified.
 * Loci without MIssillac IDs retain their RBRT IDs and are reported in
 * unnumbered_labels.tsv, distinguishing unnumbered current loci from historical
 * IDs absent from the current locus table. Ambiguous reference/lineage mappings
 * still fail validation. Set REQUIRE_MISSILLAC_FOR_ALL_LOCI=true for strict mode.
 *
 * Folder/reference names use erv_lineage.id verbatim (including dots).
 * Locus labels use erv_locus.missillac_id verbatim. Newick labels containing
 * punctuation such as '(left)' are quoted automatically.
 *
 * Shared LTR families are copied to every associated ERV lineage. Families
 * without an association are skipped and reported; no lineage is guessed.
 * All input files are validated before any trees/annotations are written.
 * Failed validation writes export_errors.tsv with the unresolved mappings.
 * Historical RBRT labels resolve directly against erv_locus.id, regardless
 * of the source name embedded in the tree (e.g. filtered_2026_07).
 * Missing historical alignments are resolved using existing canonical lineage
 * IDs or unambiguous database reference/lineage aliases; never invented IDs.
 * Existing identical outputs are accepted; differing outputs require
 * OVERWRITE = true. Old outputs are never deleted; use a fresh output
 * directory when rebuilding after renaming lineages or removing trees.
 * Requires GLUE's Nashorn Java interoperability, as used by existing exports.
 */
var PROJECT_ROOT = "/workspace/ERVdb-HomoSapiens";
var OUTPUT_DIR = "web-app/trees";
var DRY_RUN = false;
var OVERWRITE = false;
// Retain a stable RBRT ID when the current database has no MIssillac ID.
// These labels are reported in unnumbered_labels.tsv; no name is invented.
// Set true to require an assigned MIssillac ID for every locus instead.
var REQUIRE_MISSILLAC_FOR_ALL_LOCI = false;
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
    var locusNames = Object.create(null), knownLoci = Object.create(null);
    var lineageCodes = Object.create(null), referenceLineages = Object.create(null);
    var lineageAliases = Object.create(null);
    var destinations = Object.create(null), plan = [], skipped = [];
    var manifest = [["input", "output", "erv_lineage", "alignment", "kind", "tips_or_cells_relabelled"]];
    var labels = [["output", "original_label", "new_label"]];
    var issues = [];
    var unnumbered = [["input", "output", "original_label", "retained_id", "reason"]];

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
    function locusName(source, seq) { return locusNames[seq] || null; }
    function normalCode(s) { return String(s).replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }
    function addIndex(index, name, value) {
        if (!name) return;
        var k = normalCode(name);
        if (!index[k]) index[k] = [];
        if (index[k].indexOf(value) < 0) index[k].push(value);
    }
    function referenceCandidates(seq) {
        // Exact sequence identifiers take precedence over normalised aliases.
        var exact = referenceLineages[seq] || [];
        return exact.length ? unique(exact) : (lineageAliases[normalCode(seq)] || []);
    }

    log("Project directory: " + root);
    log("Output directory: " + output);
    query(["list", "custom-table-row", "erv_lineage", "id", "legacy_name"]).forEach(function (r) {
        var id = String(r.id);
        lineages[id] = true;
        addIndex(lineageCodes, id.replace(/^ERV[-_.]?/i, ""), id);
        addIndex(lineageAliases, id, id);
        addIndex(lineageAliases, norm(r.legacy_name), id);
    });
    query(["list", "custom-table-row", "erv_lineage_alias", "alias_name", "erv_lineage.id"]).forEach(function (r) {
        var lineage = norm(r["erv_lineage.id"]);
        if (lineage) addIndex(lineageAliases, norm(r.alias_name), lineage);
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
        var ref = {
            source: norm(r["sequence.source.name"]), sequence: norm(r["sequence.sequenceID"]),
            lineage: norm(r["sequence.erv_lineage_reference.erv_lineage.id"]),
            ltr: norm(r["sequence.ltr_lineage_reference.ltr_lineage.id"])
        };
        references[String(r.name)] = ref;
        if (ref.lineage && ref.sequence) {
            if (!referenceLineages[ref.sequence]) referenceLineages[ref.sequence] = [];
            referenceLineages[ref.sequence].push(ref.lineage);
            addIndex(lineageAliases, ref.sequence, ref.lineage);
        }
    });
    query(["list", "alignment", "name", "refSequence.name"]).forEach(function (r) {
        alignments[String(r.name)] = references[String(r["refSequence.name"])];
    });
    // The permanent locus ID is the stable RBRT key. Historical tree source
    // names are not keys in the current release and must not restrict lookup.
    query(["list", "custom-table-row", "erv_locus", "id", "missillac_id"]).forEach(function (r) {
        var id = norm(r.id), label = norm(r.missillac_id);
        if (id) knownLoci[id] = true;
        if (id && label) locusNames[id] = label;
    });
    log("Loaded " + Object.keys(locusNames).length + " permanent locus-to-MIssillac mappings");

    function validateLineage(id) {
        if (!lineages[id]) throw new Error("Unknown erv_lineage.id: " + id);
        return safe(id);
    }
    function resolveFile(name, kind, text) {
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
            if (!lineage) {
                // Compare complete canonical codes, ignoring punctuation only:
                // 2_Beta_K_HML2 matches ERV-2.Beta.K.HML.2, but a shortened
                // parent code must never match several numbered sublineages.
                var candidates = lineageCodes[normalCode(code)] || [];
                if (candidates.length === 1) lineage = candidates[0];
                else if (candidates.length > 1) throw new Error("Ambiguous canonical lineage code for " + aln + ": " + candidates.join(", "));
            }
            if (!lineage) {
                // Historical files may contain a reference no longer used by a
                // current alignment. Resolve its name using current metadata.
                var evidence = [];
                (text.match(/\/?alignment\/[^/\s'"]+\/member\/[^/\s'"]+\/[^\s():,;\[\]'"]+/g) || []).forEach(function (label) {
                    var member = parseMember(label);
                    if (member && !locusNames[member.sequence]) evidence = evidence.concat(referenceCandidates(member.sequence));
                });
                evidence = unique(evidence);
                if (evidence.length === 1) lineage = evidence[0];
                else if (evidence.length > 1) throw new Error("Conflicting historical reference mappings for " + aln + ": " + evidence.join(", "));
            }
            if (!lineage) throw new Error("Cannot resolve historical alignment " + aln + " to an existing lineage; add an explicit LINEAGE_OVERRIDES entry");
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
        return {alignment: aln, lineages: targets, kind: kind, ltr: entry ? entry.id : code};
    }
    function referenceLabel(seq, context, folder) {
        var ref = alignments[context.alignment];
        // Sequence identifiers of references are stable across source renames,
        // e.g. erv/HERV-R -> lineage/HERV-R.
        if (ref && seq === ref.sequence) return folder + "-reference";
        if (context.kind === "ltr") {
            var ltr = ltrs[seq];
            if (ltr && ltr.id === context.ltr) return folder + "-reference";
            var found = [];
            Object.keys(references).forEach(function (name) {
                var r = references[name];
                if (r.sequence === seq && r.ltr) found.push(r.ltr);
            });
            found = unique(found);
            if (found.length === 1 && found[0] === context.ltr) return folder + "-reference";
        }
        var linked = referenceCandidates(seq);
        if (linked.length > 1) throw new Error("Ambiguous reference identifier " + seq + ": " + linked.join(", "));
        if (linked.length === 1) return linked[0] + "-reference";
        return null;
    }
    function retainUnnumbered(seq, originalLabel, report) {
        if (!/^RBRT[0-9]+$/.test(seq)) return null;
        if (REQUIRE_MISSILLAC_FOR_ALL_LOCI) throw new Error("No assigned MIssillac ID for " + originalLabel);
        report(originalLabel, seq, knownLoci[seq] ? "Current locus has no MIssillac ID" : "Historical RBRT ID absent from current locus table");
        return seq;
    }
    function replacement(label, context, folder, allowBare, report) {
        var member = parseMember(label);
        if (member) {
            var locus = locusName(member.source, member.sequence);
            if (locus) return locus;
            var refLabel = referenceLabel(member.sequence, context, folder);
            if (refLabel) return refLabel;
            var retained = retainUnnumbered(member.sequence, label, report);
            if (retained) return retained;
            throw new Error("No numbered erv_locus.id or reference mapping for " + label);
        }
        if (allowBare || /^RBRT[0-9]+$/.test(label)) {
            if (locusNames[label]) return locusNames[label];
            var r = referenceLabel(label, context, folder);
            if (r) return r;
            var bareRetained = retainUnnumbered(label, label, report);
            if (bareRetained) return bareRetained;
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
    function addPlan(relative, content, diagnostic) {
        if (destinations[relative]) throw new Error("Output collision: " + relative);
        destinations[relative] = true;
        var f = new File(output, relative);
        if (f.exists() && !OVERWRITE && !diagnostic && read(f) !== content) throw new Error("Output differs; set OVERWRITE=true or use a fresh OUTPUT_DIR: " + f);
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
                var text = read(file);
                var context = resolveFile(name, kind, text);
                if (!context) {
                    if (/\.(tree|tsv)$/.test(name)) throw new Error("Unrecognised tree/annotation filename: " + name);
                    return;
                }
                if (!context.lineages.length) {
                    skipped.push([input, context.alignment, "No ERV-lineage association for LTR family"]);
                    return;
                }
                var isTree = /\.tree$/.test(name);
                context.lineages.forEach(function (folder) {
                    var relative = folder + "/" + safe(name), count = 0, map = Object.create(null);
                    var warned = Object.create(null);
                    function recordUnnumbered(originalLabel, id, reason) {
                        if (!warned[originalLabel]) {
                            unnumbered.push([input, relative, originalLabel, id, reason]);
                            warned[originalLabel] = true;
                        }
                    }
                    function rename(value) {
                        var changed;
                        try { changed = replacement(value, context, folder, !isTree, recordUnnumbered); }
                        catch (e) {
                            issues.push([input, value, String(e.message || e)]);
                            return value; // Continue validation to report every missing mapping.
                        }
                        if (isTree && !parseMember(value) && changed === value) {
                            // Previously relabelled tips are accepted, but unknown IDs
                            // are errors so that missing mappings cannot pass silently.
                            if (!/^ERV-/.test(value) && !/^RBRT[0-9]+$/.test(value)) throw new Error("Unrecognised tree tip: " + value);
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
            } catch (e) { issues.push([input, "", String(e.message || e)]); }
        });
    }
    scan("lineage"); scan("ltr");
    skipped.forEach(function (r) { log("SKIPPED: " + r[0] + " (" + r[2] + ")"); });
    if (unnumbered.length > 1) {
        log("WARNING: " + (unnumbered.length - 1) + " file/label occurrences retain RBRT IDs because no MIssillac ID is available; see unnumbered_labels.tsv");
    }
    if (issues.length) {
        var report = new File(output, "export_errors.tsv");
        if (!DRY_RUN) {
            Files.createDirectories(output.toPath());
            Files.write(report.toPath(), bytes(table([["input", "original_label", "problem"]].concat(issues))));
            Files.write(new File(output, "unnumbered_labels.tsv").toPath(), bytes(table(unnumbered)));
        }
        issues.slice(0, 12).forEach(function (r) { log("ERROR: " + r.join(": ")); });
        log("Validation found " + issues.length + " issue(s)" + (DRY_RUN ? " (DRY_RUN: no report written)" : "; full report: " + report));
        throw new Error("Preflight failed; no trees or annotations written. See export_errors.tsv (or ERROR lines in DRY_RUN).");
    }
    if (manifest.length === 1) throw new Error("No files selected; check PROJECT_ROOT");
    addPlan("unnumbered_labels.tsv", table(unnumbered), true);
    // Replace an earlier failed-run diagnostic with an empty error report.
    addPlan("export_errors.tsv", table([["input", "original_label", "problem"]]), true);
    addPlan("export_manifest.tsv", table(manifest));
    addPlan("label_map.tsv", table(labels));
    addPlan("skipped_files.tsv", table([["input", "alignment", "reason"]].concat(skipped)));
    log("Validated " + (manifest.length - 1) + " tree/annotation copies; " + skipped.length + " input files skipped");
    if (DRY_RUN) { log("DRY_RUN: no outputs written"); return; }
    plan.forEach(function (item) {
        Files.createDirectories(item.file.toPath().getParent());
        Files.write(item.file.toPath(), bytes(item.content));
    });
    log("Export complete: " + output + " (including manifest, label map, skipped-file and unnumbered-label reports)");
})();
