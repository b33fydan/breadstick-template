#!/bin/bash
# ============================================================
# Breadstick — Video Stitch Pipeline
# Stitches Sora 2 clips → final video → uploads to Google Drive
# ============================================================
#
# Usage:
#   ./stitch.sh [character_name] [--captions] [--upload]
#
# Example:
#   ./stitch.sh video --captions --upload
#
# Prerequisites:
#   - ffmpeg installed
#   - gws CLI authenticated (for --upload)
#   - Clip files in pipeline/clips/ named: clip_1.mp4, clip_2.mp4, etc.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIPS_DIR="$SCRIPT_DIR/clips"
OUTPUT_DIR="$SCRIPT_DIR/output"
CHARACTER="${1:-video}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="$OUTPUT_DIR/${CHARACTER}_${TIMESTAMP}.mp4"

# Parse flags
CAPTIONS=false
UPLOAD=false
for arg in "$@"; do
  case $arg in
    --captions) CAPTIONS=true ;;
    --upload) UPLOAD=true ;;
  esac
done

echo "=== Breadstick — Video Pipeline ==="
echo "Character: $CHARACTER"
echo "Clips dir: $CLIPS_DIR"
echo "Output:    $OUTPUT_FILE"
echo "Captions:  $CAPTIONS"
echo "Upload:    $UPLOAD"
echo ""

# ---- Step 1: Validate clips exist ----
CLIP_FILES=()
for f in "$CLIPS_DIR"/clip_*.mp4; do
  if [ -f "$f" ]; then
    CLIP_FILES+=("$f")
  fi
done

if [ ${#CLIP_FILES[@]} -eq 0 ]; then
  echo "ERROR: No clip files found in $CLIPS_DIR"
  echo "Expected files named: clip_1.mp4, clip_2.mp4, clip_3.mp4, clip_4.mp4"
  exit 1
fi

echo "Found ${#CLIP_FILES[@]} clips:"
for f in "${CLIP_FILES[@]}"; do
  echo "  - $(basename "$f")"
done
echo ""

# ---- Step 2: Build concat list ----
CONCAT_LIST="$CLIPS_DIR/concat_list.txt"
> "$CONCAT_LIST"
for f in "${CLIP_FILES[@]}"; do
  # Use forward slashes for ffmpeg compatibility on Windows
  echo "file '$(echo "$f" | sed 's/\\/\//g')'" >> "$CONCAT_LIST"
done

echo "Concat list:"
cat "$CONCAT_LIST"
echo ""

# ---- Step 3: Stitch clips with ffmpeg ----
echo "Stitching clips..."

if [ "$CAPTIONS" = true ]; then
  # Stitch with caption placeholder (white bar at top 30%)
  # In production, you'd use ASS/SRT subtitles or drawtext
  ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" \
    -vf "drawtext=text='':fontsize=1:fontcolor=white" \
    -c:v libx264 -preset fast -crf 18 \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    "$OUTPUT_FILE" 2>&1 | tail -5
else
  # Simple concat — hard cuts, no filters
  ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" \
    -c:v libx264 -preset fast -crf 18 \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    "$OUTPUT_FILE" 2>&1 | tail -5
fi

if [ ! -f "$OUTPUT_FILE" ]; then
  echo "ERROR: ffmpeg failed to produce output"
  exit 1
fi

FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
echo ""
echo "Stitched: $OUTPUT_FILE ($FILE_SIZE)"

# ---- Step 4: Upload to Google Drive ----
if [ "$UPLOAD" = true ]; then
  echo ""
  echo "Uploading to Google Drive..."

  # Upload to a Breadstick folder on Drive
  # First check if folder exists, create if not
  FOLDER_NAME="Breadstick"

  # Search for existing folder
  FOLDER_ID=$(gws drive files list \
    --query "name='$FOLDER_NAME' and mimeType='application/vnd.google-apps.folder' and trashed=false" \
    --fields "files(id)" 2>/dev/null | grep -oP '"id":\s*"\K[^"]+' | head -1 || echo "")

  if [ -z "$FOLDER_ID" ]; then
    echo "Creating '$FOLDER_NAME' folder on Drive..."
    FOLDER_ID=$(gws drive files create \
      --name "$FOLDER_NAME" \
      --mime-type "application/vnd.google-apps.folder" \
      --fields "id" 2>/dev/null | grep -oP '"id":\s*"\K[^"]+' || echo "")
  fi

  if [ -n "$FOLDER_ID" ]; then
    echo "Uploading to folder: $FOLDER_NAME ($FOLDER_ID)"
    gws drive +upload "$OUTPUT_FILE" --parent "$FOLDER_ID"
  else
    echo "Uploading to Drive root..."
    gws drive +upload "$OUTPUT_FILE"
  fi

  echo ""
  echo "Upload complete."
fi

# ---- Cleanup ----
rm -f "$CONCAT_LIST"

echo ""
echo "=== Pipeline complete ==="
echo "Final video: $OUTPUT_FILE"
