// glue/build/sublineage/ervExtendAlignmentTreeSublineage.js
//
// Add accepted ERV sublineage reference sequences to the constrained
// alignment tree.
//
// Inclusion rule:
//   - status = accepted
//
// Input:
//   tabular/sublineage/herv_sublineage_data.tsv
//
// For each included row, the script:
//
//   1. Confirms that the corresponding erv_lineage row exists.
//   2. Confirms that the reference sequence exists.
//   3. Identifies the appropriate parent constrained alignment.
//   4. Creates a missing subgenus alignment where required.
//   5. Ensures that the new reference is a member of its parent alignment.
//   6. Creates a constrained lineage alignment using the reference.
//
// Alignment naming:
//
//   Lineage alignment:
//     AL_LINEAGE_<sanitised standardised lineage name>
//
//   Subgenus alignment:
//     AL_SUBGENUS_<sanitised subgenus>
//
//   Parent alignment for a lineage, in order of preference:
//     AL_SUBGENUS_<sanitised subgenus>
//     AL_GENUS_<sanitised genus>
//     AL_CLADE_<sanitised clade>
//
//   Parent alignment for a newly created subgenus:
//     AL_GENUS_<sanitised genus>
//     AL_CLADE_<sanitised clade>
//
// A missing subgenus alignment is created using the first accepted lineage
// reference encountered for that subgenus.
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
// Parent-alignment membership is cached on demand. Each required
// reference/alignment membership is queried at most once during the run.
//
// Root placement:
//   - Explicitly Unclassified classifications are placed at the root.
//   - A subgenus with no usable genus or clade is also placed at the root.
//
// Missing genus or clade alignments are not created automatically.
//
// Set DRY_RUN to true to report intended changes without modifying the
// project.

var INPUT_FILE = "tabular/sublineage/herv_sublineage_data.tsv";
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


function sublineageAlignmentName(lineageId) {

	lineageId = norm(lineageId);

	if(lineageId === null) {
		throw "Cannot derive sublineage alignment name from missing lineage_id";
	}

	var suffix = lineageId
		.replace(/^ERVR-([A-Za-z0-9]+)(?=\.|$)/i, "$1R")
		.replace(/^ERV-/i, "")
		.replace(/[^A-Za-z0-9]+/g, "_")
		.replace(/^_+/, "")
		.replace(/_+$/, "");
	
	if(suffix === "") {
		throw "Could not derive sublineage alignment name from lineage_id: " +
			lineageId;
	}

	return "AL_SUBLINEAGE_" + suffix;
}



function subgenusAlignmentName(subgenus) {

	var cleanSubgenus = sanitize(subgenus);

	if(cleanSubgenus === "") {
		throw "Could not derive subgenus alignment name from: " +
			subgenus;
	}

	return "AL_SUBGENUS_" + cleanSubgenus;
}

function isUnclassified(value) {

	var normalisedValue = norm(value);

	return normalisedValue != null &&
		normalisedValue.toLowerCase() === "unclassified";
}


/*
 * Determine the direct parent for a lineage alignment.
 */

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
				subgenusAlignmentName(subgenus)
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
 * Determine where a newly created subgenus alignment should sit.
 *
 * Parent alignment, in order of preference:
 *
 *     AL_GENUS_<genus>
 *     AL_CLADE_<clade>
 *
 * If genus or clade is explicitly Unclassified, the subgenus alignment is
 * created at the root.
 *
 * If no usable genus or clade is supplied, the subgenus alignment is also
 * created at the root.
 */

function parentAlignmentForSubgenus(row) {

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


	return {
		rootLevel: true,
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
 * The cache is keyed first by alignment name and then by reference name:
 *
 * memberMap["AL_SUBGENUS_Kappa"]["REF_HERVKHML1"] = true;
 */


/*
 * Determine directly whether a reference's underlying sequence is already
 * present in an alignment.
 *
 * This targeted query is used because normal "list member" output does not
 * necessarily include reference-sequence names as columns.
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
 * Initialise membership information for one alignment.
 *
 * The cache is intentionally populated only with references needed during
 * this build.
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
 * Ensure that the subgenus alignment required by a lineage row exists.
 *
 * A missing subgenus alignment is created using the current lineage
 * reference as its constrained reference.
 *
 * After creation, all members of the higher parent alignment assigned to
 * this subgenus are demoted into the new subgenus alignment. This is required
 * because creating a constrained child alignment does not itself make its
 * reference sequence a direct member of that child alignment.
 *
 * Returns an object containing:
 *
 *     status:
 *         "existing"
 *         "created"
 *         "dry-run"
 *         "missing-higher-parent"
 *         "not-applicable"
 *
 *     alignmentName:
 *         name of the subgenus alignment, where applicable
 *
 *     higherParentAlignmentName:
 *         genus or clade parent, where applicable
 *
 *     parentMembershipResult:
 *         "existing"
 *         "added"
 *         "dry-run"
 *         null
 *
 *     demotionResult:
 *         "performed"
 *         "dry-run"
 *         null
 */

function ensureSubgenusAlignment(
	row,
	alignmentMap,
	memberMap,
	referenceName
) {

	var subgenus = norm(row["subgenus"]);

	if(
		subgenus == null ||
		isUnclassified(subgenus)
	) {
		return {
			status: "not-applicable",
			alignmentName: null,
			higherParentAlignmentName: null,
			parentMembershipResult: null,
			demotionResult: null
		};
	}


	var alignmentName =
		subgenusAlignmentName(subgenus);


	if(
		alignmentExists(
			alignmentMap,
			alignmentName
		)
	) {
		return {
			status: "existing",
			alignmentName: alignmentName,
			higherParentAlignmentName:
				alignmentMap[alignmentName].parentName,
			parentMembershipResult: null,
			demotionResult: null
		};
	}


	var parentResolution =
		parentAlignmentForSubgenus(row);

	var rootLevel =
		parentResolution.rootLevel;

	var higherParentAlignmentName =
		parentResolution.parentAlignmentName;


	/*
	 * A subgenus alignment can only be populated by demotion when it has a
	 * higher parent. Missing genus or clade alignments are not created here.
	 */

	if(
		rootLevel ||
		higherParentAlignmentName == null ||
		!alignmentExists(
			alignmentMap,
			higherParentAlignmentName
		)
	) {
		return {
			status: "missing-higher-parent",
			alignmentName: alignmentName,
			higherParentAlignmentName:
				higherParentAlignmentName,
			parentMembershipResult: null,
			demotionResult: null
		};
	}


	/*
	 * Ensure that the reference used for the new subgenus alignment is
	 * currently a member of the higher parent alignment.
	 */

	var parentMembershipResult =
		ensureReferenceIsAlignmentMember(
			memberMap,
			higherParentAlignmentName,
			referenceName
		);


	/*
	 * Create the constrained subgenus alignment beneath the higher parent.
	 */

	var createAlignmentCommand = [
		"create",
		"alignment",
		alignmentName,
		"-r",
		referenceName,
		"-p",
		higherParentAlignmentName
	];

	runCmd(createAlignmentCommand);


	/*
	 * Update the alignment cache in normal and dry-run modes.
	 */

	addAlignmentToCache(
		alignmentMap,
		alignmentName,
		higherParentAlignmentName,
		referenceName
	);


	/*
	 * Demote all members assigned to this subgenus from the higher parent
	 * alignment into the new subgenus alignment.
	 */

	var demoteWhereClause =
		"sequence.erv_lineage.rv_subgenus.id = '" +
		escapeQuotes(subgenus) +
		"'";


	log(
		"Demoting members assigned to subgenus " +
		subgenus +
		" from " +
		higherParentAlignmentName +
		" into " +
		alignmentName
	);


	if(DRY_RUN) {

		log(
			"[DRY RUN] alignment/" +
			higherParentAlignmentName +
			": demote member " +
			alignmentName +
			" -w \"" +
			demoteWhereClause +
			"\""
		);

		/*
		 * Record the current reference as a member of the subgenus alignment
		 * so subsequent dry-run processing can continue.
		 */

		var dryRunSubgenusMemberMap =
			ensureMembershipCacheForAlignment(
				memberMap,
				alignmentName
			);

		dryRunSubgenusMemberMap[referenceName] = true;


		log(
			"[DRY RUN] Would create subgenus alignment " +
			alignmentName +
			" under " +
			higherParentAlignmentName +
			" with reference " +
			referenceName
		);

		return {
			status: "dry-run",
			alignmentName: alignmentName,
			higherParentAlignmentName:
				higherParentAlignmentName,
			parentMembershipResult:
				parentMembershipResult,
			demotionResult: "dry-run"
		};
	}


	glue.inMode(
		"alignment/" + higherParentAlignmentName,
		function() {
			glue.command([
				"demote",
				"member",
				alignmentName,
				"-w",
				demoteWhereClause
			]);
		}
	);


	/*
	 * Reset the relevant membership caches because demotion changes direct
	 * membership in both the higher parent and the new child alignment.
	 */

	memberMap[higherParentAlignmentName] = {};
	memberMap[alignmentName] = {};


	log(
		"Created subgenus alignment " +
		alignmentName +
		" under " +
		higherParentAlignmentName +
		" with reference " +
		referenceName
	);

	log(
		"Demoted subgenus " +
		subgenus +
		" members into " +
		alignmentName
	);


	return {
		status: "created",
		alignmentName: alignmentName,
		higherParentAlignmentName:
			higherParentAlignmentName,
		parentMembershipResult:
			parentMembershipResult,
		demotionResult: "performed"
	};
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
var missingHigherParentAlignmentCount = 0;

var existingSubgenusAlignmentCount = 0;
var createdSubgenusAlignmentCount = 0;
var dryRunSubgenusAlignmentCount = 0;

var existingSubgenusParentMembershipCount = 0;
var addedSubgenusParentMembershipCount = 0;
var dryRunSubgenusParentMembershipCount = 0;

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

	var lineageId =
		norm(row["lineage_id"]);

	var sequenceId =
		norm(row["sequenceID"]);

	if(lineageId == null) {

		skippedCount++;

		log(
			"Skipping row with missing lineage_id: " +
			JSON.stringify(row)
		);

		return;
	}

	if(sequenceId == null) {

		skippedCount++;

		log(
			"Skipping erv_lineage/" + lineageId +
			" because sequenceID is missing"
		);

		return;
	}

	if(!shouldInclude(row)) {

		skippedCount++;

		log(
			"Skipping " + sequenceId +
			" [" + lineageId + "]" +
			" because entity_type=" +
			norm(row["entity_type"]) +
			", status=" +
			norm(row["status"])
		);

		return;
	}

	includedCount++;


	/*
	 * Confirm that the canonical lineage record exists.
	 *
	 * lineage_id identifies the erv_lineage row.
	 * sequenceID identifies its representative sequence.
	 */

	if(!customRowExists("erv_lineage", lineageId)) {

		missingLineageCount++;

		log(
			"Skipping " + sequenceId +
			" because canonical erv_lineage row is missing: " +
			lineageId
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
	 * Resolve lineage and parent alignment names.
	 */


	var alignmentName =
		sublineageAlignmentName(lineageId);
	
	var parentResolution =
		parentAlignmentForRow(row);

	var rootLevel =
		parentResolution.rootLevel;

	var parentAlignmentName =
		parentResolution.parentAlignmentName;


	/*
	 * If the lineage belongs to a subgenus and that subgenus alignment does
	 * not yet exist, create it now.
	 *
	 * The first accepted lineage encountered for the subgenus supplies the
	 * constrained reference for the new subgenus alignment.
	 */

	if(
		!rootLevel &&
		parentAlignmentName != null &&
		parentAlignmentName.indexOf("AL_SUBGENUS_") === 0
	) {

		var subgenusResult =
			ensureSubgenusAlignment(
				row,
				alignmentMap,
				memberMap,
				referenceName
			);


		if(subgenusResult.status === "existing") {

			existingSubgenusAlignmentCount++;

		}
		else if(subgenusResult.status === "created") {

			createdSubgenusAlignmentCount++;

		}
		else if(subgenusResult.status === "dry-run") {

			dryRunSubgenusAlignmentCount++;

		}
		else if(
			subgenusResult.status ===
			"missing-higher-parent"
		) {

			missingHigherParentAlignmentCount++;

			log(
				"Skipping " + sequenceId +
				" because the higher parent required for " +
				subgenusResult.alignmentName +
				" is missing: " +
				subgenusResult.higherParentAlignmentName
			);

			return;
		}


		if(
			subgenusResult.parentMembershipResult ===
			"existing"
		) {
			existingSubgenusParentMembershipCount++;
		}
		else if(
			subgenusResult.parentMembershipResult ===
			"added"
		) {
			addedSubgenusParentMembershipCount++;
		}
		else if(
			subgenusResult.parentMembershipResult ===
			"dry-run"
		) {
			dryRunSubgenusParentMembershipCount++;
		}
	}


	/*
	 * After attempting to create a missing subgenus alignment, confirm that
	 * the required parent now exists.
	 *
	 * Missing genus or clade alignments are not created by this script.
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
	 * If the lineage alignment already exists, no further action is needed.
	 *
	 * Its reference must already be a member of its parent because GLUE
	 * would not have allowed the constrained alignment to be created
	 * otherwise.
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
	 * Ensure the lineage reference is a member of the proposed parent
	 * alignment.
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
		}
		else if(membershipResult === "added") {
			addedParentMembershipCount++;
		}
		else if(membershipResult === "dry-run") {
			dryRunParentMembershipCount++;
		}
	}


	/*
	 * Create the constrained lineage alignment.
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


	runCmd(createAlignmentCommand);

	addAlignmentToCache(
		alignmentMap,
		alignmentName,
		parentAlignmentName,
		referenceName
	);


	if(DRY_RUN) {

		dryRunAlignmentCount++;

		return;
	}


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
	"Missing higher parent alignments: " +
	missingHigherParentAlignmentCount
);

log(
	"Existing subgenus alignments encountered: " +
	existingSubgenusAlignmentCount
);

log(
	"Subgenus alignments created: " +
	createdSubgenusAlignmentCount
);

if(DRY_RUN) {
	log(
		"Subgenus alignments to create: " +
		dryRunSubgenusAlignmentCount
	);
}

log(
	"Existing subgenus-parent memberships: " +
	existingSubgenusParentMembershipCount
);

log(
	"Subgenus-parent memberships added: " +
	addedSubgenusParentMembershipCount
);

if(DRY_RUN) {
	log(
		"Subgenus-parent memberships to add: " +
		dryRunSubgenusParentMembershipCount
	);
}

log(
	"Existing lineage-parent memberships: " +
	existingParentMembershipCount
);

log(
	"Lineage-parent memberships added: " +
	addedParentMembershipCount
);

if(DRY_RUN) {
	log(
		"Lineage-parent memberships to add: " +
		dryRunParentMembershipCount
	);
}

log(
	"Existing lineage alignments: " +
	existingAlignmentCount
);

log(
	"Lineage alignments created: " +
	createdAlignmentCount
);

if(DRY_RUN) {
	log(
		"Lineage alignments to create: " +
		dryRunAlignmentCount
	);
}