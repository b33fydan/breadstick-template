#!/bin/bash
# ============================================================
# Breadstick — Full Automated Video Pipeline
# kie.ai (Sora 2) → Download → ffmpeg Stitch → Google Drive
# ============================================================
#
# Usage:
#   ./generate.sh
#
# Reads prompts from pipeline/prompts/clip_*.txt
# Submits each to kie.ai Sora 2 API
# Polls for completion, downloads clips
# Stitches with ffmpeg, uploads to Google Drive

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLIPS_DIR="$SCRIPT_DIR/clips"
OUTPUT_DIR="$SCRIPT_DIR/output"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="$OUTPUT_DIR/video_${TIMESTAMP}.mp4"

# Load API key from .env
source "$PROJECT_DIR/.env"
KIE_KEY="${KIE_API_KEY:?KIE_API_KEY not set in .env}"

KIE_BASE="https://api.kie.ai/api/v1/jobs"
POLL_INTERVAL=30
MAX_POLLS=40  # 30s * 40 = 20 min max wait per clip

echo "=== Breadstick — Automated Video Pipeline ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# Clean clips dir
rm -f "$CLIPS_DIR"/clip_*.mp4

# ---- Step 1: Submit all 4 clips to kie.ai ----
echo "--- Step 1: Submitting clips to kie.ai (Sora 2) ---"
echo ""

TASK_IDS=()
CLIP_NUM=0

for prompt_file in "$PROMPTS_DIR"/clip_*.txt; do
  CLIP_NUM=$((CLIP_NUM + 1))

  # Extract the DIALOGUE line as the core prompt, plus the VISUAL PROMPT
  VISUAL=$(sed -n '/^VISUAL PROMPT:/,/^$/p' "$prompt_file" | tail -n +2 | head -1 | xargs)
  SETTING=$(sed -n '/^SETTING:/p' "$prompt_file" | head -1 | sed 's/^SETTING: //')
  LIGHTING=$(sed -n '/^LIGHTING:/p' "$prompt_file" | head -1 | sed 's/^LIGHTING: //')
  DIALOGUE=$(sed -n '/^"/{p;q}' <(sed -n '/^DIALOGUE:/,/^$/p' "$prompt_file") | tr -d '"')

  # Build a clean Sora 2 prompt
  SORA_PROMPT="$VISUAL $SETTING $LIGHTING Speaking dialogue: $DIALOGUE iPhone 15 Pro front-camera selfie with natural handheld micro-shake. Single continuous take. Skin texture preserved, no smoothing. Stable eye tracking. Natural breathing bounce."

  echo "Clip $CLIP_NUM: Submitting to kie.ai..."
  echo "  Prompt preview: ${SORA_PROMPT:0:120}..."

  # Submit to kie.ai
  RESPONSE=$(curl -s -X POST "$KIE_BASE/createTask" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $KIE_KEY" \
    -d "$(cat <<ENDJSON
{
  "model": "sora-2-text-to-video",
  "input": {
    "prompt": $(echo "$SORA_PROMPT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))"),
    "aspect_ratio": "portrait",
    "n_frames": "10",
    "remove_watermark": true
  }
}
ENDJSON
)")

  TASK_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('taskId',''))" 2>/dev/null || echo "")

  if [ -z "$TASK_ID" ]; then
    echo "  ERROR: Failed to create task. Response: $RESPONSE"
    exit 1
  fi

  TASK_IDS+=("$TASK_ID")
  echo "  Task ID: $TASK_ID"
  echo ""
done

echo "All ${#TASK_IDS[@]} clips submitted."
echo "Task IDs: ${TASK_IDS[*]}"
echo ""

# ---- Step 2: Poll for completion & download ----
echo "--- Step 2: Waiting for generation (polling every ${POLL_INTERVAL}s) ---"
echo ""

for i in "${!TASK_IDS[@]}"; do
  CLIP_INDEX=$((i + 1))
  TASK_ID="${TASK_IDS[$i]}"
  echo "Polling clip $CLIP_INDEX (task: $TASK_ID)..."

  POLLS=0
  VIDEO_URL=""

  while [ $POLLS -lt $MAX_POLLS ]; do
    POLLS=$((POLLS + 1))

    STATUS_RESPONSE=$(curl -s "$KIE_BASE/recordInfo?taskId=$TASK_ID" \
      -H "Authorization: Bearer $KIE_KEY")

    # Check status
    STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
state = data.get('state', '')
print(state)
" 2>/dev/null || echo "unknown")

    if [ "$STATUS" = "completed" ] || [ "$STATUS" = "success" ]; then
      VIDEO_URL=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rj = json.loads(d['data']['resultJson'])
print(rj['resultUrls'][0])
" 2>/dev/null || echo "")

      if [ -n "$VIDEO_URL" ]; then
        echo "  Clip $CLIP_INDEX ready after $((POLLS * POLL_INTERVAL))s"
        break
      fi
    elif [ "$STATUS" = "failed" ]; then
      echo "  ERROR: Clip $CLIP_INDEX generation failed."
      echo "  Response: $STATUS_RESPONSE"
      exit 1
    fi

    echo "  Poll $POLLS: status=$STATUS, waiting ${POLL_INTERVAL}s..."
    sleep $POLL_INTERVAL
  done

  if [ -z "$VIDEO_URL" ]; then
    echo "  ERROR: Clip $CLIP_INDEX timed out after $((MAX_POLLS * POLL_INTERVAL))s"
    exit 1
  fi

  # Download the clip
  CLIP_FILE="$CLIPS_DIR/clip_${CLIP_INDEX}.mp4"
  echo "  Downloading: $VIDEO_URL"
  curl -s -L -o "$CLIP_FILE" "$VIDEO_URL"
  FILE_SIZE=$(du -h "$CLIP_FILE" | cut -f1)
  echo "  Saved: $CLIP_FILE ($FILE_SIZE)"
  echo ""
done

echo "All clips downloaded."
echo ""

# ---- Step 3: Stitch with ffmpeg ----
echo "--- Step 3: Stitching clips with ffmpeg ---"

CONCAT_LIST="$CLIPS_DIR/concat_list.txt"
> "$CONCAT_LIST"
for f in "$CLIPS_DIR"/clip_*.mp4; do
  echo "file '$(cygpath -m "$f" 2>/dev/null || echo "$f")'" >> "$CONCAT_LIST"
done

ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" \
  -c:v libx264 -preset fast -crf 18 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUTPUT_FILE" 2>&1 | tail -3

rm -f "$CONCAT_LIST"

if [ ! -f "$OUTPUT_FILE" ]; then
  echo "ERROR: ffmpeg failed"
  exit 1
fi

FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
echo "Stitched: $OUTPUT_FILE ($FILE_SIZE)"
echo ""

# ---- Step 4: Upload to Google Drive ----
echo "--- Step 4: Uploading to Google Drive ---"

FOLDER_NAME="Breadstick"

# Search for existing folder
FOLDER_ID=$(gws drive files list \
  --params '{"q": "name='"'"''"$FOLDER_NAME"''"'"' and mimeType='"'"'application/vnd.google-apps.folder'"'"' and trashed=false", "fields": "files(id)"}' 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
files = d.get('files', [])
print(files[0]['id'] if files else '')
" 2>/dev/null || echo "")

if [ -z "$FOLDER_ID" ]; then
  echo "Creating '$FOLDER_NAME' folder on Drive..."
  FOLDER_ID=$(gws drive files create \
    --json '{"name": "'"$FOLDER_NAME"'", "mimeType": "application/vnd.google-apps.folder"}' 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
fi

if [ -n "$FOLDER_ID" ]; then
  echo "Uploading to folder: $FOLDER_NAME ($FOLDER_ID)"
  gws drive +upload "$OUTPUT_FILE" --parent "$FOLDER_ID"
else
  echo "Uploading to Drive root..."
  gws drive +upload "$OUTPUT_FILE"
fi

echo ""
echo "=== Pipeline complete ==="
echo "Final video: $OUTPUT_FILE"
echo "Clips: $CLIPS_DIR/clip_1.mp4 - clip_4.mp4"
echo "Uploaded to Google Drive: $FOLDER_NAME"
