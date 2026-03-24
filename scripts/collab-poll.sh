#!/usr/bin/env bash
# collab-poll.sh — Single-shot message poll with clean output
# Usage: collab-poll.sh <team-id> [--sleep N]
# Returns new messages since last poll, formatted cleanly.
# Tracks SEEN state in /tmp/ensemble/<TEAM_ID>/.poll-seen
#
# Output: tab-separated "sender\tcontent" lines, ending with one of:
#   ---STATUS:ACTIVE   new messages found
#   ---STATUS:QUIET    no new messages
#   ---STATUS:DONE     team finished (followed by summary.txt)
#   ---STATUS:WAITING  messages file not yet created
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./collab-paths.sh
source "$SCRIPT_DIR/collab-paths.sh"

TEAM_ID="${1:?Usage: collab-poll.sh <team-id> [--sleep N]}"
shift
SLEEP=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --sleep)
      shift
      SLEEP="${1:?--sleep requires a number}"
      if ! [[ "$SLEEP" =~ ^[0-9]+$ ]]; then
        echo "Error: --sleep must be a positive integer, got '$SLEEP'" >&2
        exit 1
      fi
      shift
      ;;
    -*)
      echo "Error: unknown option: $1" >&2
      echo "Usage: collab-poll.sh <team-id> [--sleep N]" >&2
      exit 1
      ;;
    *) shift ;;
  esac
done

[ "$SLEEP" -gt 0 ] && sleep "$SLEEP"

JSONL="$(collab_messages_file "$TEAM_ID")"
FINISHED="$(collab_finished_marker "$TEAM_ID")"
SUMMARY="$(collab_summary_file "$TEAM_ID")"
SEEN_FILE="/tmp/ensemble/$TEAM_ID/.poll-seen"

# Read previous SEEN count (with numeric guard)
SEEN=0
if [ -f "$SEEN_FILE" ]; then
  RAW=$(cat "$SEEN_FILE" 2>/dev/null | tr -d ' ' || true)
  [[ "${RAW:-}" =~ ^[0-9]+$ ]] && SEEN="$RAW"
fi

# Shared message parser — extracts new messages as "sender\tcontent" lines.
print_new_messages() {
  local file="$1" skip="$2"
  python3 "$SCRIPT_DIR/parse-messages.py" "$file" --skip "$skip" --max-content 500
}

# Get current line count (with truncation detection)
get_total() {
  local total
  total=$(wc -l < "$JSONL" 2>/dev/null | tr -d ' ' || echo 0)
  # If file was truncated/rotated, reset SEEN
  if [ "${total:-0}" -lt "$SEEN" ]; then
    SEEN=0
  fi
  echo "${total:-0}"
}

# Check if team is done
if [ -f "$FINISHED" ] || [ -f "$SUMMARY" ]; then
  if [ -f "$JSONL" ]; then
    TOTAL=$(get_total)
    if [ "$TOTAL" -gt "$SEEN" ]; then
      print_new_messages "$JSONL" "$SEEN"
      printf '%s\n' "$TOTAL" > "$SEEN_FILE"
    fi
  fi
  echo "---STATUS:DONE"
  [ -f "$SUMMARY" ] && cat "$SUMMARY"
  REPLAY="$(collab_runtime_dir "$TEAM_ID")/replay.html"
  [ -f "$REPLAY" ] && echo "---REPLAY:$REPLAY"
  exit 0
fi

# Check for new messages
[ -f "$JSONL" ] || { echo "---STATUS:WAITING"; exit 0; }
TOTAL=$(get_total)

if [ "$TOTAL" -gt "$SEEN" ]; then
  print_new_messages "$JSONL" "$SEEN"
  printf '%s\n' "$TOTAL" > "$SEEN_FILE"
  echo "---STATUS:ACTIVE"
else
  echo "---STATUS:QUIET"
fi
