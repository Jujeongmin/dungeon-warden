/**
 * Game audio.
 *
 * Sounds come from CC0 files when they have been dropped into
 * public/assets/audio, and are synthesised with WebAudio when they have not.
 * The synthesised fallback is not a placeholder to be removed later — it keeps
 * the game audible with no download step, and the two paths use the same cue
 * names so swapping in files changes nothing else.
 */

export type Cue =
  | "click"
  | "place"
  | "dig"
  | "error"
  | "raidStart"
  | "hit"
  | "trap"
  | "skill"
  | "victory"
  | "defeat";

interface ToneSpec {
  /** Start frequency in Hz. */
  from: number;
  /** End frequency, for a sweep. Defaults to `from`. */
  to?: number;
  seconds: number;
  type: OscillatorType;
  gain: number;
}

/** Synthesised stand-ins, tuned so the dungeon reads as low and heavy. */
const TONES: Record<Cue, ToneSpec[]> = {
  click: [{ from: 420, seconds: 0.05, type: "square", gain: 0.05 }],
  place: [
    { from: 180, to: 260, seconds: 0.09, type: "triangle", gain: 0.09 },
    { from: 90, seconds: 0.14, type: "sine", gain: 0.07 },
  ],
  dig: [{ from: 130, to: 70, seconds: 0.12, type: "sawtooth", gain: 0.06 }],
  error: [{ from: 200, to: 120, seconds: 0.18, type: "square", gain: 0.06 }],
  raidStart: [
    { from: 110, to: 220, seconds: 0.35, type: "sawtooth", gain: 0.08 },
    { from: 55, seconds: 0.5, type: "sine", gain: 0.09 },
  ],
  hit: [{ from: 240, to: 90, seconds: 0.07, type: "square", gain: 0.05 }],
  trap: [{ from: 320, to: 60, seconds: 0.16, type: "sawtooth", gain: 0.07 }],
  skill: [{ from: 300, to: 600, seconds: 0.22, type: "triangle", gain: 0.07 }],
  victory: [
    { from: 330, seconds: 0.12, type: "triangle", gain: 0.08 },
    { from: 440, seconds: 0.12, type: "triangle", gain: 0.08 },
    { from: 550, seconds: 0.26, type: "triangle", gain: 0.08 },
  ],
  defeat: [
    { from: 220, seconds: 0.16, type: "sawtooth", gain: 0.07 },
    { from: 150, seconds: 0.32, type: "sawtooth", gain: 0.07 },
  ],
};

/**
 * File patterns per cue, matched against the audio manifest the same way
 * models are. Kenney's packs use these kinds of names.
 */
const FILE_PATTERNS: Record<Cue, RegExp[]> = {
  click: [/click_00[12]/, /^click/, /select/, /^tick/],
  place: [/^drop_00/, /^switch/, /^bong/, /place/],
  dig: [/^footstep/, /impact.*soft/, /^scrape/, /rock/],
  error: [/error/, /^back_00/, /^close/, /wrong/],
  raidStart: [/^jingles_steel/, /^jingles_pizzi/, /horn/, /alarm/],
  hit: [/impact.*generic/, /^impact/, /^hit/, /punch/],
  trap: [/impact.*plate/, /explosion/, /^spike/, /metal/],
  skill: [/^powerup/, /^magic/, /^spell/, /confirm/],
  victory: [/jingles.*win/, /win/, /^success/, /^complete/],
  defeat: [/jingles.*lose/, /lose/, /^fail/, /^gameover/],
};

const MANIFEST_URL = "/assets/audio/manifest.json";
const STORAGE_KEY = "dw.muted";

interface ManifestEntry {
  url: string;
  name: string;
}

class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private entries: ManifestEntry[] = [];
  private buffers = new Map<Cue, AudioBuffer | null>();
  private loading = new Set<Cue>();
  private initialised = false;
  private muted = false;
  /** Cues fired within this window collapse into one, so a wave of hits does not roar. */
  private lastPlayed = new Map<Cue, number>();

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private browsing or blocked storage: default to audible.
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get usingFiles(): boolean {
    return this.entries.length > 0;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch {
      /* preference is per-session then */
    }
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  /**
   * Must be called from a user gesture: browsers refuse to start an
   * AudioContext otherwise.
   */
  async unlock(): Promise<void> {
    if (this.initialised) {
      if (this.context?.state === "suspended") await this.context.resume();
      return;
    }
    this.initialised = true;

    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.context.destination);
    } catch {
      this.context = null;
      return;
    }

    try {
      const response = await fetch(MANIFEST_URL);
      if (response.ok) {
        const data = (await response.json()) as { sounds?: ManifestEntry[] };
        this.entries = data.sounds ?? [];
      }
    } catch {
      this.entries = [];
    }
  }

  private resolve(cue: Cue): ManifestEntry | null {
    for (const pattern of FILE_PATTERNS[cue]) {
      const hit = this.entries.find((entry) => pattern.test(entry.name));
      if (hit) return hit;
    }
    return null;
  }

  private async loadBuffer(cue: Cue): Promise<AudioBuffer | null> {
    if (this.buffers.has(cue)) return this.buffers.get(cue)!;
    if (this.loading.has(cue) || !this.context) return null;

    const entry = this.resolve(cue);
    if (!entry) {
      this.buffers.set(cue, null);
      return null;
    }

    this.loading.add(cue);
    try {
      const response = await fetch(entry.url);
      const bytes = await response.arrayBuffer();
      const buffer = await this.context.decodeAudioData(bytes);
      this.buffers.set(cue, buffer);
      return buffer;
    } catch {
      // A missing or unsupported file falls back to the synthesised cue.
      this.buffers.set(cue, null);
      return null;
    } finally {
      this.loading.delete(cue);
    }
  }

  play(cue: Cue, throttleMs = 60): void {
    if (this.muted || !this.context || !this.master) return;

    const now = performance.now();
    const previous = this.lastPlayed.get(cue) ?? -Infinity;
    if (now - previous < throttleMs) return;
    this.lastPlayed.set(cue, now);

    const buffer = this.buffers.get(cue);
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.master);
      source.start();
      return;
    }

    // Kick off the file load for next time, and use the tone right now.
    if (!this.buffers.has(cue)) void this.loadBuffer(cue);
    this.playTone(cue);
  }

  private playTone(cue: Cue): void {
    if (!this.context || !this.master) return;

    let offset = 0;
    for (const spec of TONES[cue]) {
      const start = this.context.currentTime + offset;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();

      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.from, start);
      if (spec.to !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(spec.to, 1), start + spec.seconds);
      }

      // A short attack and exponential decay keeps clicks from popping.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(spec.gain, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.seconds);

      osc.connect(gain);
      gain.connect(this.master);
      osc.start(start);
      osc.stop(start + spec.seconds + 0.02);

      offset += spec.seconds * 0.85;
    }
  }
}

export const audio = new AudioEngine();
