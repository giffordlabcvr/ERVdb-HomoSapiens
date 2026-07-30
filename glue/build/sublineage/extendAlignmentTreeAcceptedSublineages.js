// glue/build/sublineage/ervExtendAlignmentTreeSublineage.js
//
// Add accepted ERV sublineage reference sequences to the constrained
// alignment tree.
//
// Inclusion rule:
//   - status = accepted
//
// Input:
//   tabular/reference/herv_sublineage_data.tsv
//
// For each included row, the script:
//
//   1. Confirms that the corresponding erv_lineage row exists.
//   2. Confirms that the reference sequence exists.
//   3. Identifies the appropriate parent constrained alignment.
//   4. Ensures that the new reference is a member of that parent alignment.
//   5. Creates a constrained child alignment using the reference.
//
// Alignment naming:
//
//   Child alignment:
//     AL_<sanitised standardised lineage name>
//
//   Parent alignment, in order of preference:
//     AL_SUBGENUS_<sanitised subgenus>
//     AL_GENUS_<sanitised genus>
//     AL_CLADE_<sanitised clade>
//
// Reference naming:
//
//     REF_<sanitised sequenceID>
//
// The script caches the existing alignments after a single:
//
//     list alignment
//
// command. The cache is updated whenever a new alignment is created.
//
// Parent-alignment membership is cached on demand. Each parent alignment is
// queried at most once during the run.
// Parent alignment:
//   - subgenus, genus or clade alignment where classified
//   - no parent where the classification is explicitly Unclassified
//
// Set DRY_RUN to true to report intended changes without modifying the
// project.

var INPUT_FILE = "tabular/reference/herv_sublineage_data.tsv";
var DRY_RUN = false;


/*
 * Logging and general utility functions
 */

function log(message) {
	glue.logInfo(message);
}

function norm(value) {

	if(value == null) {
		return null;
	}

	var stringValue = ("" + value).trim();

	if(stringValue === "") {
		return null;
	}

	var lowerValue = stringValue.toLowerCase();

	if(
		lowerValue === "n/a" ||
		lowerValue === "na" ||
		lowerValue === "null" ||
		lowerValue === "none"
	) {
		return null;
	}

	return stringValue;
}

function sanitize(value) {
	return ("" + value).replace(/[^A-Za-z0-9]/g, "");
}

function escapeQuotes(value) {
	return ("" + value)
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'");
}

function runCmd(commandWords) {

	if(DRY_RUN) {
		log("[DRY RUN] " + commandWords.join(" "));
		return null;
	}

	return glue.command(commandWords);
}


/*
 * Input-table functions
 */

function loadRows() {

	var rows;

	glue.inMode("module/tabularUtility", function() {
		rows = glue.tableToObjects(
			glue.command([
				"load-tabular",
				INPUT_FILE
			])
		);
	});

	return rows;
}

function shouldInclude(row) {

	var status = norm(row["status"]);

	return status === "accepted";
}

/*
 * Entity-existence functions
 */

function customRowExists(tableName, rowId) {

	var rows = glue.tableToObjects(
		glue.command([
			"list",
			"custom-table-row",
			tableName,
			"-w",
			"id = '" + escapeQuotes(rowId) + "'"
		])
	);

	return rows.length > 0;
}

function referenceExists(referenceName) {

	var rows = glue.tableToObjects(
		glue.command([
			"list",
			"reference",
			"-w",
			"name = '" + escapeQuotes(referenceName) + "'"
		])
	);

	return rows.length > 0;
}


/*
 * Naming functions
 */

function referenceNameForSequenceId(sequenceId) {

	var cleanSequenceId = sanitize(sequenceId);

	if(cleanSequenceId === "") {
		throw "Could not derive reference name from sequenceID: " +
			sequenceId;
	}

	return "REF_" + cleanSequenceId;
}

function alignmentNameForRow(row) {

	var standardisedLineageName =
		norm(row["Standardised lineage name"]);

	var sequenceId =
		norm(row["sequenceID"]);

	var alignmentId =
		standardisedLineageName || sequenceId;

	var cleanAlignmentId =
		sanitize(alignmentId);

	if(cleanAlignmentId === "") {
		throw "Could not derive alignment name for row: " +
			JSON.stringify(row);
	}

	return "AL_LINEAGE_" + cleanAlignmentId;
}

function isUnclassified(value) {

	var normalisedValue = norm(value);

	return normalisedValue != null &&
		normalisedValue.toLowerCase() === "unclassified";
}


function parentAlignmentForRow(row) {

	/*
	 * An explicitly unclassified lineage belongs at the root of the
	 * constrained alignment tree.
	 */

	var subgenus = norm(row["subgenus"]);

	if(isUnclassified(subgenus)) {
		return {
			rootLevel: true,
			parentAlignmentName: null
		};
	}

	if(subgenus != null) {
		return {
			rootLevel: false,
			parentAlignmentName:
				"AL_SUBGENUS_" + sanitize(subgenus)
		};
	}


	var genus = norm(row["genus"]);

	if(isUnclassified(genus)) {
		return {
			rootLevel: true,
			parentAlignmentName: null
		};
	}

	if(genus != null) {
		return {
			rootLevel: false,
			parentAlignmentName:
				"AL_GENUS_" + sanitize(genus)
		};
	}


	var clade = norm(row["clade"]);

	if(isUnclassified(clade)) {
		return {
			rootLevel: true,
			parentAlignmentName: null
		};
	}

	if(clade != null) {
		return {
			rootLevel: false,
			parentAlignmentName:
				"AL_CLADE_" + sanitize(clade)
		};
	}


	/*
	 * No usable classification was supplied.
	 */

	return {
		rootLevel: false,
		parentAlignmentName: null
	};
}

/*
 * Alignment cache
 *
 * listAlignments() executes one project-level "list alignment" command and
 * stores the results in an object keyed by alignment name.
 *
 * Example:
 *
 * alignmentMap["AL_SUBGENUS_Kappa"] = {
 *     name: "AL_SUBGENUS_Kappa",
 *     parentName: "AL_GENUS_Betaretrovirus",
 *     referenceName: "REF_HERVK"
 * };
 */

function listAlignments() {

	var alignmentRows = glue.tableToObjects(
		glue.command([
			"list",
			"alignment"
		])
	);

	var alignmentMap = {};

	_.each(alignmentRows, function(alignmentRow) {

		var alignmentName =
			norm(alignmentRow["name"]);

		if(alignmentName == null) {
			return;
		}

		alignmentMap[alignmentName] = {
			name: alignmentName,

			parentName:
				norm(alignmentRow["parent.name"]),

			referenceName:
				norm(alignmentRow["refSequence.name"])
		};
	});

	return alignmentMap;
}

function alignmentExists(alignmentMap, alignmentName) {
	return alignmentMap[alignmentName] != null;
}

function addAlignmentToCache(
	alignmentMap,
	alignmentName,
	parentAlignmentName,
	referenceName
) {
	alignmentMap[alignmentName] = {
		name: alignmentName,
		parentName: parentAlignmentName,
		referenceName: referenceName
	};
}


/*
 * Parent-alignment membership cache
 *
 * Memberships are loaded only when a parent alignment is first encountered.
 *
 * The cache is keyed first by alignment name and then by reference name:
 *
 * memberMap["AL_SUBGENUS_Kappa"]["REF_HERVKHML1"] = true;
 *
 * A member created using:
 *
 *     add member -r REF_HERVKHML1
 *
 * is the sequence underlying that reference sequence. The where-clause below
 * therefore finds alignment members through the sequence-reference
 * relationship.
 */

function listReferenceMembers(alignmentName) {

	var referenceMemberMap = {};

	glue.inMode("alignment/" + alignmentName, function() {

		var memberRows = glue.tableToObjects(
			glue.command([
				"list",
				"member"
			])
		);

		_.each(memberRows, function(memberRow) {

			/*
			 * Depending on the GLUE version and configured list fields, the
			 * reference name may be exposed directly in one of these forms.
			 */

			var referenceName =
				norm(memberRow["sequence.referenceSequences.name"]) ||
				norm(memberRow["referenceSequence.name"]) ||
				norm(memberRow["reference.name"]);

			if(referenceName != null) {
				referenceMemberMap[referenceName] = true;
			}
		});
	});

	return referenceMemberMap;
}


/*
 * Determine directly whether a reference's underlying sequence is already
 * present in an alignment.
 *
 * This targeted query is used because the normal "list member" output does
 * not necessarily include reference-sequence names as columns.
 */

function referenceIsAlignmentMember(
	alignmentName,
	referenceName
) {

	var memberRows;

	glue.inMode("alignment/" + alignmentName, function() {

		memberRows = glue.tableToObjects(
			glue.command([
				"list",
				"member",
				"-w",
				"sequence.referenceSequences.name = '" +
					escapeQuotes(referenceName) + "'"
			])
		);
	});

	return memberRows.length > 0;
}


/*
 * Load and cache membership information for one parent alignment.
 *
 * The membership cache is intentionally populated with only the references
 * needed during this build. This avoids requiring every "list member" row to
 * expose a reference-name column.
 */

function ensureMembershipCacheForAlignment(
	memberMap,
	alignmentName
) {

	if(memberMap[alignmentName] == null) {
		memberMap[alignmentName] = {};
	}

	return memberMap[alignmentName];
}


/*
 * Ensure that the sequence represented by referenceName is a direct member
 * of parentAlignmentName.
 *
 * This must happen before creating a constrained child alignment whose
 * reference is referenceName. GLUE requires the child reference sequence to
 * be a member of the proposed parent alignment.
 *
 * Returns:
 *
 *     "existing"  if the membership was already present
 *     "added"     if the membership was created
 *     "dry-run"   if it would be created in dry-run mode
 */

function ensureReferenceIsAlignmentMember(
	memberMap,
	parentAlignmentName,
	referenceName
) {

	var parentMemberMap =
		ensureMembershipCacheForAlignment(
			memberMap,
			parentAlignmentName
		);

	if(parentMemberMap[referenceName] === true) {
		return "existing";
	}

	if(
		referenceIsAlignmentMember(
			parentAlignmentName,
			referenceName
		)
	) {
		parentMemberMap[referenceName] = true;
		return "existing";
	}

	log(
		"Adding reference " + referenceName +
		" as a member of parent alignment " +
		parentAlignmentName
	);

	if(DRY_RUN) {

		log(
			"[DRY RUN] alignment/" +
			parentAlignmentName +
			": add member -r " +
			referenceName
		);

		parentMemberMap[referenceName] = true;

		return "dry-run";
	}

	glue.inMode(
		"alignment/" + parentAlignmentName,
		function() {
			glue.command([
				"add",
				"member",
				"-r",
				referenceName
			]);
		}
	);

	parentMemberMap[referenceName] = true;

	return "added";
}


/*
 * Main build
 */

var rows = loadRows();

log(
	"Loaded " + rows.length +
	" rows from " + INPUT_FILE
);

log("Loading existing alignment table");

var alignmentMap = listAlignments();
var memberMap = {};

log(
	"Loaded " +
	Object.keys(alignmentMap).length +
	" existing alignments"
);


/*
 * Summary counters
 */

var includedCount = 0;
var skippedCount = 0;

var missingLineageCount = 0;
var missingReferenceCount = 0;
var missingParentAlignmentCount = 0;

var existingParentMembershipCount = 0;
var addedParentMembershipCount = 0;
var dryRunParentMembershipCount = 0;

var existingAlignmentCount = 0;
var createdAlignmentCount = 0;
var dryRunAlignmentCount = 0;


/*
 * Process each TSV row
 */

_.each(rows, function(row) {

	var sequenceId =
		norm(row["sequenceID"]);

	if(sequenceId == null) {

		skippedCount++;

		log(
			"Skipping row with missing sequenceID: " +
			JSON.stringify(row)
		);

		return;
	}

	if(!shouldInclude(row)) {

		skippedCount++;

		log(
			"Skipping " + sequenceId +
			" because entity_type=" +
			norm(row["entity_type"]) +
			", status=" +
			norm(row["status"])
		);

		return;
	}

	includedCount++;


	/*
	 * Confirm that the lineage record exists.
	 */

	if(!customRowExists("erv_lineage", sequenceId)) {

		missingLineageCount++;

		log(
			"Skipping " + sequenceId +
			" because erv_lineage row is missing"
		);

		return;
	}


	/*
	 * Confirm that the reference sequence exists.
	 */

	var referenceName =
		referenceNameForSequenceId(sequenceId);

	if(!referenceExists(referenceName)) {

		missingReferenceCount++;

		log(
			"Skipping " + sequenceId +
			" because reference is missing: " +
			referenceName
		);

		return;
	}


	/*
	 * Resolve child and parent alignment names.
	 */

	var alignmentName =
		alignmentNameForRow(row);

	var parentResolution =
		parentAlignmentForRow(row);

	var rootLevel =
		parentResolution.rootLevel;

	var parentAlignmentName =
		parentResolution.parentAlignmentName;


	/*
	 * Only non-root alignments require a parent alignment.
	 */

	if(
		!rootLevel &&
		(
			parentAlignmentName == null ||
			!alignmentExists(
				alignmentMap,
				parentAlignmentName
			)
		)
	) {

		missingParentAlignmentCount++;

		log(
			"Skipping " + sequenceId +
			" because parent alignment is missing: " +
			parentAlignmentName
		);

		return;
	}

	/*
	 * If the child alignment already exists, no further action is needed.
	 *
	 * In particular, its reference must already be a member of its parent,
	 * because GLUE would not have allowed the constrained alignment to be
	 * created otherwise.
	 */

	if(
		alignmentExists(
			alignmentMap,
			alignmentName
		)
	) {

		existingAlignmentCount++;

		log(
			"Alignment already exists: " +
			alignmentName
		);

		return;
	}


	/*
	 * Ensure the reference is a member of the proposed parent alignment.
	 *
	 * This is the step required to avoid:
	 *
	 * Reference REF_x of alignment AL_x is not a member of proposed
	 * parent alignment AL_y
	 */

	if(!rootLevel) {

		var membershipResult =
			ensureReferenceIsAlignmentMember(
				memberMap,
				parentAlignmentName,
				referenceName
			);

		if(membershipResult === "existing") {
			existingParentMembershipCount++;
		} else if(membershipResult === "added") {
			addedParentMembershipCount++;
		} else if(membershipResult === "dry-run") {
			dryRunParentMembershipCount++;
		}
	}


	/*
	 * Create the constrained child alignment.
	 */

	var createAlignmentCommand = [
		"create",
		"alignment",
		alignmentName,
		"-r",
		referenceName
	];

	if(!rootLevel) {

		createAlignmentCommand.push(
			"-p",
			parentAlignmentName
		);
	}


	if(DRY_RUN) {

		runCmd(createAlignmentCommand);

		dryRunAlignmentCount++;

		addAlignmentToCache(
			alignmentMap,
			alignmentName,
			parentAlignmentName,
			referenceName
		);

		return;
	}


	runCmd(createAlignmentCommand);

	addAlignmentToCache(
		alignmentMap,
		alignmentName,
		parentAlignmentName,
		referenceName
	);

	createdAlignmentCount++;

	if(rootLevel) {

		log(
			"Created root constrained alignment " +
			alignmentName +
			" with reference " +
			referenceName
		);
	}
	else {

		log(
			"Created constrained alignment " +
			alignmentName +
			" under " +
			parentAlignmentName +
			" with reference " +
			referenceName
		);
	}

});


/*
 * Summary
 */

log("----- SUMMARY -----");

log(
	"Rows loaded: " +
	rows.length
);

log(
	"Rows included by filter: " +
	includedCount
);

log(
	"Rows skipped by filter/incomplete: " +
	skippedCount
);

log(
	"Missing erv_lineage rows: " +
	missingLineageCount
);

log(
	"Missing references: " +
	missingReferenceCount
);

log(
	"Missing parent alignments: " +
	missingParentAlignmentCount
);

log(
	"Existing parent memberships: " +
	existingParentMembershipCount
);

log(
	"Parent memberships added: " +
	addedParentMembershipCount
);

if(DRY_RUN) {
	log(
		"Parent memberships to add: " +
		dryRunParentMembershipCount
	);
}

log(
	"Existing alignments: " +
	existingAlignmentCount
);

log(
	"Created alignments: " +
	createdAlignmentCount
);

if(DRY_RUN) {
	log(
		"Alignments to create: " +
		dryRunAlignmentCount
	);
}