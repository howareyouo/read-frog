export const MIN_TRANSLATE_RATE = 0.01
export const MIN_TRANSLATE_CAPACITY = 1
export const MIN_BATCH_CHARACTERS = 1
export const MIN_BATCH_ITEMS = 1
// Config unit is SECONDS; the queue converts to ms internally. Sub-second
// delays are allowed since minAccumulateMs was folded into batchDelay.
export const MIN_BATCH_DELAY_SECONDS = 0.1

export const DEFAULT_REQUEST_RATE = 8
export const DEFAULT_REQUEST_CAPACITY = 20

export const DEFAULT_MAX_CHARACTER_PER_BATCH = 1000
export const DEFAULT_MAX_ITEMS_PER_BATCH = 4
// 1 = no floor: the compose window and the size caps decide what merges.
export const DEFAULT_MIN_ITEMS_PER_BATCH = 1
// The batch compose window in seconds: how long a batch stays open for
// arrivals before it force-flushes. For the subtitles queue this doubles as
// the burst-compose window — a look-ahead tick's cues land back to back, and
// without a window the dispatch gate's free slot would flush each cue as its
// own request (deadlines preempt the window). The webpage queue runs the same
// value as a ROLLING window (timed from the latest paragraph, only while
// minItemsPerBatch is above 1 — see batchReadyAtMs).
export const DEFAULT_BATCH_DELAY_SECONDS = 0.1

export const DEFAULT_BATCH_CONFIG = {
  maxCharactersPerBatch: DEFAULT_MAX_CHARACTER_PER_BATCH,
  maxItemsPerBatch: DEFAULT_MAX_ITEMS_PER_BATCH,
  minItemsPerBatch: DEFAULT_MIN_ITEMS_PER_BATCH,
  batchDelay: DEFAULT_BATCH_DELAY_SECONDS,
}

// Request timeout for LLM batch translations scales with batch size: a full
// 4000-char batch on a slow free-tier model cannot finish in the 20s that fits
// a single paragraph. 4000 chars → 20s + 60s = 80s.
export const BATCH_TIMEOUT_BASE_MS = 20_000
export const BATCH_TIMEOUT_PER_CHAR_MS = 15
export const MAX_BATCH_TIMEOUT_MS = 120_000

export const DEFAULT_AUTO_TRANSLATE_SHORTCUT_KEY = "Alt+E"
export const DEFAULT_TRANSLATION_MODE_SHORTCUT_KEY = "Alt+Shift+M"
export const DEFAULT_SELECTION_TRANSLATION_SHORTCUT_KEY = "Alt+T"

export const MIN_PRELOAD_MARGIN = 0
export const MAX_PRELOAD_MARGIN = 10000
export const DEFAULT_PRELOAD_MARGIN = 1000

export const MIN_PRELOAD_THRESHOLD = 0
export const MAX_PRELOAD_THRESHOLD = 1
export const DEFAULT_PRELOAD_THRESHOLD = 0

// A single observed paragraph taller than this many viewports is split into
// its descendant paragraphs before observation, otherwise one flat giant
// container (e.g. docs.docker.com's 185k-px <article>) defeats viewport-lazy
// translation and enqueues the whole page at once (#1881).
export const GIANT_PARAGRAPH_SPLIT_VIEWPORT_MULTIPLIER = 3
// Floor for the viewport height used in the split cap, so tiny embedded
// frames don't shred normal paragraphs into fragments.
export const GIANT_PARAGRAPH_SPLIT_MIN_VIEWPORT_PX = 800
// Defensive bound on split recursion.
export const GIANT_PARAGRAPH_MAX_SPLIT_DEPTH = 10
// Safety valve on the stranded-text refusal: #1881's harm metric is
// units-enqueued-at-once, so bound the refusal by exactly that. Measured
// separation is two orders of magnitude — the containers the refusal exists
// for yield 11 (a Blogger post body), 77 (paulgraham.com/greatwork.html) and
// ~100 (a tc39 <li>) units, while the containers #1881 exists for yield 1.8k
// (a Wikipedia <body>), 4k (docs.docker.com's <main>) and 28k (tc39's <body>).
// Above this, keeping viewport gating beats rescuing a stray sentence.
export const GIANT_SPLIT_STRANDED_TEXT_MAX_UNITS = 128

export const MIN_CHARACTERS_PER_NODE = 0
export const MAX_CHARACTERS_PER_NODE = 1000
export const DEFAULT_MIN_CHARACTERS_PER_NODE = 0

export const MIN_WORDS_PER_NODE = 0
export const MAX_WORDS_PER_NODE = 100
export const DEFAULT_MIN_WORDS_PER_NODE = 0
