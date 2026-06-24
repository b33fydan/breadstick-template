# Instagram Carousel

Generate a branded Instagram carousel. Request: $ARGUMENTS

---

## Input Parsing

Parse `$ARGUMENTS` to determine the input type:

- **YouTube URL** (contains `youtube.com` or `youtu.be`): Pull transcript, extract key insights
- **Topic string** (anything else): Research the topic, write original content

If no arguments, ask the user what topic they want a carousel about.

---

## Pipeline

Run stages 1-3 automatically, then STOP for user approval before rendering.

### 1. INPUT

**If YouTube URL:**
- Extract the video ID from the URL
- Pull transcript using `youtube-transcript-api`:
  ```bash
  cd "$CLAUDE_PROJECT_DIR" && python -c "
  from youtube_transcript_api import YouTubeTranscriptApi
  ytt = YouTubeTranscriptApi()
  transcript = ytt.fetch('<VIDEO_ID>')
  text = ' '.join([s.text for s in transcript.snippets])
  print(text)
  "
  ```
- Extract the video title and transcript text

**If topic string:**
- Use the topic directly as the content brief

### 2. RESEARCH

- Search for relevant context, stats, and facts about the topic using web search
- Find 3-5 relevant images using web search (product screenshots, diagrams, relevant visuals)
- Download images to `carousels/workspace/<carousel-name>/reference/`
- Name images descriptively (e.g., `ai-dashboard.jpg`, `comparison-chart.png`)

### 3. WRITE + PREVIEW

Structure the content into carousel slides, then present a **text preview** for the user to approve before rendering.

**Slide 1 (hook):** Bold, attention-grabbing title (MAX 4 WORDS). Must have an `image` — ideally a Remotion-rendered 8-bit pixel art animation frame (Final Fantasy NES/SNES style). Generate the pixel art asset using the Pixel Art Forge on the classic dashboard or reference existing assets. The `tag` field is the one-word topic label for upper-left corner.





**Slides 2-N (body):** Mix of:
- Text-only slides for key statements
- Bullet slides for lists/comparisons (max 4 bullets per slide)
- Image slides for visual evidence
- Each slide MUST have a `tag` (one word, upper-left corner — the main idea of that slide)
- Titles are MAX 4 WORDS (Audiowide gets big fast)
- Use `*asterisks*` around exactly ONE word per slide for accent highlight

**Last slide (CTA):** Call to action with `button_text` (e.g., "Follow for more")

**Rules:**
- 5-8 slides total (including hook and CTA)
- EVERY slide has a `tag` field — one word, upper-left corner, describes the main idea
- Upper-right corner is EMPTY (Instagram puts its own slide index there)
- Titles: MAX 4 WORDS. Audiowide is a wide font — more than 4 words will overflow
- Accent highlight: use `*asterisks*` around exactly ONE word per slide — the word carrying the emphasis. Never highlight multiple words.
- Body text renders in Space Mono (monospace) — write short, punchy lines
- Max ~150 characters per text block
- Max 4 bullets per slide
- Slide 1 hook image: 8-bit pixel art (Final Fantasy NES/SNES style) rendered via Remotion at external/remotion or forged via the Pixel Art Forge in the classic Breadstick dashboard
- Skyframe dark theme: yellow (#ffff00) primary accent, cyan (#00ffff) secondary, pure black background with particle network
- Font stack: Audiowide (titles), Space Mono (body), Quantico (tag/footer chrome)

**>>> STOP HERE. Present the slide plan to the user as a numbered list:**

```
Slide 1 (hook): "4 Word Title"
  - Tag: "TOPIC"
  - Image: 8-bit pixel art description (will be generated)
  - Subtitle: "optional context line"

Slide 2 (body): Title: "MAX 4 WORDS."
  - Tag: "IDEA"
  - Text: "Body text here"
  - Bullets: ["bullet 1", "bullet 2"]
  ...

Slide N (cta): "CTA text"
  - Tag: "ACTION"
  - Button: "Follow for more"
```

Ask: **"Here's the slide plan. Want me to change anything before I render?"**

Wait for the user to approve or request changes. Iterate on the text plan until they're happy.

### 4. CONFIG + IMAGES

After user approves the slide plan:

- Create the workspace directory: `carousels/workspace/<carousel-name>/`
- Generate 8-bit pixel art for Slide 1 hook image (via Pixel Art Forge prompts or Remotion render)
- Download any reference images needed
- Generate `config.json` (see Config Schema below)

### 5. RENDER

```bash
cd "$CLAUDE_PROJECT_DIR"
python carousels/render.py "carousels/workspace/<carousel-name>"
```

### 6. REVIEW

After rendering, read each slide PNG and display them to the user.

Present a summary:
- Total slides
- Slide-by-slide breakdown (type, tag, has image, text preview)
- Ask: "Happy with this? Any changes needed?"

**If changes requested:**
- Edit the config.json as needed
- Add/swap/regenerate images in reference/ if needed
- Re-run the render script
- Show updated slides

---

## Config Schema

File: `workspace/<carousel-name>/config.json`

```json
{
  "title": "Carousel Title (for reference only)",
  "profile": {
    "display_name": "Your Name",
    "handle": "@yourhandle"
  },
  "theme": "dark",
  "slides": [
    {
      "type": "hook",
      "tag": "TOPIC",
      "text": "Max Four *Words*.",
      "subtitle": "Optional smaller context line.",
      "image": "hook-pixelart.png"
    },
    {
      "type": "body",
      "tag": "IDEA",
      "title": "MAX FOUR WORDS.",
      "text": "Body paragraph with *one* accent word.",
      "bullets": ["Point one with *accent*", "Point two", "Point three"],
      "annotation": "handwritten callout"
    },
    {
      "type": "cta",
      "tag": "ACTION",
      "text": "Call to action text.",
      "button_text": "Follow for more"
    }
  ]
}
```

### Slide Types

| Type | Purpose | Fields |
|------|---------|--------|
| `hook` | First slide, grabs attention | `tag` (required), `text` (required), `image` (required — 8-bit pixel art), `subtitle` (optional) |
| `body` | Content slides | `tag` (required), `title`, `text`, `bullets`, `image`, `annotation` (at least one content field required) |
| `cta` | Last slide, call to action | `tag` (required), `text` (required), `button_text` (optional) |

### Field Notes

- `tag`: One word, rendered in Quantico uppercase at upper-left corner. Every slide must have one. This is the main idea label (e.g., "PROBLEM", "SHIFT", "TOOLS", "ACTION")
- `image`: filename relative to `reference/` directory, or `asset:<filename>` for shared assets. Hook slide should use 8-bit pixel art (Final Fantasy NES/SNES style)
- `title`: rendered uppercase in Audiowide with yellow accent underline bar. MAX 4 WORDS — Audiowide is wide and will overflow past 4 words
- `text`: supports `*one accent word*` syntax — highlight exactly ONE word per slide in yellow (#ffff00)
- `subtitle`: hook slides only, rendered smaller in Quantico gray below the main text
- `bullets`: array of strings with single `*accent*` word support, rendered with yellow dots
- `button_text`: renders a cyan (#00ffff) pill button on CTA slide
- `annotation`: handwritten Caveat text with a curved arrow pointing down toward content
- Upper-right corner: ALWAYS EMPTY — Instagram renders its own slide counter (1/N) there

---

## Voice & Tone

When writing carousel content, aim for:
- Direct, confident, no fluff
- Data-driven when possible (specific numbers > vague claims)
- Slightly provocative hooks that challenge assumptions
- Educational but not preachy
- Short sentences, clear structure
- Titles that hit hard in 4 words or less

---

## Pixel Art Hook Image

The first slide (hook) must feature an 8-bit pixel art image inspired by Final Fantasy NES/SNES games. This is a signature visual element of the carousel brand.

**Sources for the pixel art:**
1. **Pixel Art Forge** (classic Breadstick dashboard) — generate Midjourney/Nano Banana Pro prompts for 8-bit assets
2. **Remotion** (at external/remotion) — render animated pixel art as a static frame or short clip
3. **Pre-made assets** — check `carousels/assets/` for reusable pixel art

The pixel art should relate to the carousel topic (e.g., a pixel knight for "strategy" topics, a pixel wizard for "AI" topics, a pixel treasure chest for "money" topics).
