#!/usr/bin/env bash

# renameMsaSelectorFiles.sh
#
# Rename MSA selector XML files from representative-sequence-based names:
#
#   msaSelector_HERVFa_pol_nucs.xml
#
# to standard-lineage-ID-based names:
#
#   msaSelector_1_Zeta_HF_Fa_pol_nucs.xml
#
# Translation table format:
#
#   sequenceID    lineage_id
#   HERV-Fa       ERV-1.Zeta.HF.Fa
#
# Existing filenames omit punctuation from sequenceID values:
#
#   HERV-Fa       -> HERVFa
#   HERV-K-HML2   -> HERVKHML2
#   PRIMA-41      -> PRIMA41
#
# Usage:
#
#   bash renameMsaSelectorFiles.sh TranslationTable.tsv
#   bash renameMsaSelectorFiles.sh TranslationTable.tsv --apply
#
# The script expects to be run from the project root. The default selector
# directory is:
#
#   modules/analyse/msa_masking/nucs
#
# A different root directory may be supplied as the third argument.

set -u

TRANSLATION_TABLE="${1:-}"
MODE="${2:-}"
SELECTOR_ROOT="${3:-modules/analyse/msa_masking/nucs}"

if [ -z "$TRANSLATION_TABLE" ]; then
	echo "Usage: $0 TRANSLATION_TABLE [--apply] [SELECTOR_ROOT]" >&2
	exit 1
fi

if [ ! -f "$TRANSLATION_TABLE" ]; then
	echo "ERROR: Translation table not found: $TRANSLATION_TABLE" >&2
	exit 1
fi

if [ ! -d "$SELECTOR_ROOT" ]; then
	echo "ERROR: Selector directory not found: $SELECTOR_ROOT" >&2
	exit 1
fi

if [ -n "$MODE" ] && [ "$MODE" != "--apply" ]; then
	echo "ERROR: Second argument must be --apply or omitted" >&2
	exit 1
fi

if [ "$MODE" = "--apply" ]; then
	APPLY=true
	echo "Mode: APPLY"
else
	APPLY=false
	echo "Mode: DRY RUN"
	echo "No files will be changed."
fi

echo "Translation table: $TRANSLATION_TABLE"
echo "Selector root: $SELECTOR_ROOT"
echo

PLAN_FILE="$(mktemp "${TMPDIR:-/tmp}/msa-selector-renames.XXXXXX")"
trap 'rm -f "$PLAN_FILE"' EXIT HUP INT TERM

# ---------------------------------------------------------------------------
# Construct a rename plan.
#
# Translation-table sequence IDs are normalised in the same way as the old
# filename stems: all characters other than letters and digits are removed.
#
# Standard lineage IDs are converted as follows:
#
#   ERV-1.Zeta.HF.Fa   -> 1_Zeta_HF_Fa
#   ERVR-1.Theta.101   -> 1R_Theta_101
#
# The ERVR rule is included for future sublineage selector modules.
# ---------------------------------------------------------------------------

awk -F '\t' '
BEGIN {
	OFS = "\t"
}

NR == 1 {
	# Remove a possible carriage return from a Windows-format TSV.
	gsub(/\r$/, "", $2)

	if($1 != "sequenceID" || $2 != "lineage_id") {
		print "ERROR: Expected headers sequenceID and lineage_id" > "/dev/stderr"
		exit 2
	}

	next
}

{
	sequenceId = $1
	lineageId = $2

	gsub(/\r$/, "", lineageId)

	if(sequenceId == "" || lineageId == "") {
		next
	}

	# Historical filenames remove punctuation from the representative name.
	oldStem = sequenceId
	gsub(/[^A-Za-z0-9]/, "", oldStem)

	# Convert the standard ID to the alignment/module naming convention.
	if(lineageId ~ /^ERVR-/) {
		newStem = lineageId
		sub(/^ERVR-/, "", newStem)

		# ERVR-1.Theta.101 -> 1R.Theta.101
		sub(/^([^.]+)/, "&R", newStem)
	} else if(lineageId ~ /^ERV-/) {
		newStem = lineageId
		sub(/^ERV-/, "", newStem)
	} else {
		print "ERROR: Unsupported lineage ID: " lineageId > "/dev/stderr"
		exit 2
	}

	gsub(/\./, "_", newStem)

	print oldStem, newStem, sequenceId, lineageId
}
' "$TRANSLATION_TABLE" > "$PLAN_FILE"

AWK_STATUS=$?

if [ "$AWK_STATUS" -ne 0 ]; then
	echo "ERROR: Could not construct the rename plan" >&2
	exit "$AWK_STATUS"
fi

# ---------------------------------------------------------------------------
# Examine and optionally apply the plan.
# ---------------------------------------------------------------------------

FOUND_COUNT=0
RENAMED_COUNT=0
UNCHANGED_COUNT=0
MISSING_COUNT=0
COLLISION_COUNT=0

while IFS="$(printf '\t')" read -r OLD_STEM NEW_STEM SEQUENCE_ID LINEAGE_ID
do
	for FEATURE in gag pol env
	do
		DIRECTORY="$SELECTOR_ROOT/$FEATURE"

		OLD_FILE="$DIRECTORY/msaSelector_${OLD_STEM}_${FEATURE}_nucs.xml"
		NEW_FILE="$DIRECTORY/msaSelector_${NEW_STEM}_${FEATURE}_nucs.xml"

		if [ ! -e "$OLD_FILE" ]; then
			MISSING_COUNT=$((MISSING_COUNT + 1))
			continue
		fi

		FOUND_COUNT=$((FOUND_COUNT + 1))

		if [ "$OLD_FILE" = "$NEW_FILE" ]; then
			UNCHANGED_COUNT=$((UNCHANGED_COUNT + 1))
			echo "UNCHANGED: $OLD_FILE"
			continue
		fi

		if [ -e "$NEW_FILE" ]; then
			COLLISION_COUNT=$((COLLISION_COUNT + 1))
			echo "COLLISION: target already exists" >&2
			echo "  source: $OLD_FILE" >&2
			echo "  target: $NEW_FILE" >&2
			continue
		fi

		echo "RENAME:"
		echo "  $OLD_FILE"
		echo "  -> $NEW_FILE"

		if [ "$APPLY" = true ]; then
			mv "$OLD_FILE" "$NEW_FILE"

			if [ "$?" -ne 0 ]; then
				echo "ERROR: Failed to rename $OLD_FILE" >&2
				exit 1
			fi

			RENAMED_COUNT=$((RENAMED_COUNT + 1))
		fi
	done
done < "$PLAN_FILE"

echo
echo "============================================================"
echo "MSA selector filename rename summary"
echo "============================================================"
echo "Existing source files found:       $FOUND_COUNT"
echo "Already correctly named:           $UNCHANGED_COUNT"
echo "Expected files not present:        $MISSING_COUNT"
echo "Target-name collisions:            $COLLISION_COUNT"

if [ "$APPLY" = true ]; then
	echo "Files renamed:                     $RENAMED_COUNT"
else
	echo "Files renamed:                     0 (dry run)"
fi

if [ "$COLLISION_COUNT" -gt 0 ]; then
	echo
	echo "ERROR: One or more target filenames already existed." >&2
	echo "No colliding file was overwritten." >&2
	exit 1
fi

if [ "$APPLY" = false ]; then
	echo
	echo "Review the proposed changes, then apply them with:"
	echo
	echo "  bash $0 \"$TRANSLATION_TABLE\" --apply \"$SELECTOR_ROOT\""
fi