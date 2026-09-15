/**
 * Game audio.
 *
 * Sounds come from CC0 files when they have been dropped into
 * public/assets/audio, and are synthesised with WebAudio when they have not.
 * The synthesised fallback is not a placeholder to be removed later — it keeps
 * the game audible with no download step, and the two paths use the same cue
 * names so swapping in files changes nothing else.
 */

import { publicUrl } from "./assets/publicUrl";

export type Cue =
  | "click"
  | "place"
  | "dig"
  | "minionDown"
  | "captured"
  | "error"
  | "raidStart"
  | "hit"
  | "trap"
  | "skill"
  | "victory"
  | "defeat"
  // Down in a ridden body. First person is half sound: a swing nobody hears
  // is a swing that did not happen, and a corridor walked in silence is a
  // camera being moved.
  | "swing"
  | "possess"
  | "bodyLost"
  | "step";

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
  // Rock coming out: the lowest, longest thing in the mix.
  dig: [
    { from: 150, to: 45, seconds: 0.34, type: "sawtooth", gain: 0.1 },
    { from: 70, to: 40, seconds: 0.5, type: "sine", gain: 0.08 },
  ],
  // Bone giving out — short, dry, and clearly not an adventurer dying.
  minionDown: [{ from: 260, to: 110, seconds: 0.2, type: "triangle", gain: 0.07 }],
  // Taking one alive is the good outcome, so it rises where a kill falls.
  captured: [
    { from: 300, seconds: 0.1, type: "triangle", gain: 0.07 },
    { from: 480, seconds: 0.18, type: "triangle", gain: 0.07 },
  ],
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
  // Air moving, not a hit: the blow lands or it does not, and the hit cue is
  // what says it landed.
  swing: [{ from: 520, to: 140, seconds: 0.12, type: "sawtooth", gain: 0.035 }],
  // Dropping into a body: a low fall, then the room closing round you.
  possess: [
    { from: 480, to: 90, seconds: 0.28, type: "triangle", gain: 0.07 },
    { from: 60, seconds: 0.4, type: "sine", gain: 0.08 },
  ],
  // Thrown out of one: the same fall, cut short and dropping further.
  bodyLost: [
    { from: 300, to: 40, seconds: 0.45, type: "sawtooth", gain: 0.08 },
    { from: 45, seconds: 0.6, type: "sine", gain: 0.09 },
  ],
  // Bone on stone. Quiet, because it repeats.
  step: [{ from: 110, to: 70, seconds: 0.05, type: "triangle", gain: 0.03 }],
};

/**
 * File patterns per cue, matched against the audio manifest the same way
 * models are. Kenney's packs use these kinds of names.
 */
const FILE_PATTERNS: Record<Cue, RegExp[]> = {
  click: [/click_00[12]/, /^click/, /select/, /^tick/],
  place: [/^drop_00/, /^switch/, /^bong/, /place/],
  dig: [/rubble/, /^rock/, /impact.*heavy/, /^footstep/],
  // No file matches these on purpose: the packs have nothing that reads as
  // bone breaking or a body being dragged away, and a wrong sound is worse
  // than the synthesised one the engine falls back to.
  minionDown: [],
  captured: [],
  error: [/error/, /^back_00/, /^close/, /wrong/],
  raidStart: [/^jingles_steel/, /^jingles_pizzi/, /horn/, /alarm/],
  hit: [/impact.*generic/, /^impact/, /^hit/, /punch/],
  trap: [/impact.*plate/, /explosion/, /^spike/, /metal/],
  skill: [/^powerup/, /^magic/, /^spell/, /confirm/],
  victory: [/jingles.*win/, /win/, /^success/, /^complete/],
  defeat: [/jingles.*lose/, /lose/, /^fail/, /^gameover/],
  swing: [/swoosh/, /^swing/, /whoosh/],
  possess: [],
  bodyLost: [],
  step: [/^footstep_concrete/, /^footstep/],
};

/**
 * The background loop, matched out of the same manifest as the cues.
 *
 * There is only one, so it does not need a cue name — anything that reads as
 * ambience or a loop is it.
 */
const MUSIC_PATTERNS: RegExp[] = [/ambience/, /ambient/, /^music/, /loop/];

/**
 * How loud the loop sits under everything else.
 *
 * Well under the cues: this is a room tone, and a player should notice it stop
 * rather than notice it start. The duck is what the raid does to it, so a
 * fight is still carried by its own hits.
 */
const MUSIC_LEVEL = 0.34;
const MUSIC_DUCKED = 0.15;
/** Long enough that neither end of the loop is an event. */
const MUSIC_FADE = 1.8;

const MANIFEST_URL = publicUrl("assets/audio/manifest.json");
const STORAGE_KEY = "dw.volume";

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
  /** 0 to 1. Zero is muted; there is no separate flag. */
  private volume = 1;
  /** Cues fired within this window collapse into one, so a wave of hits does not roar. */
  private lastPlayed = new Map<Cue, number>();

  /** The background loop. `undefined` means "not looked for yet". */
  private musicBuffer: AudioBuffer | null | undefined = undefined;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicWanted = false;
  private musicTarget = MUSIC_LEVEL;
  /** The player's music fader, multiplied into every ramp below. */
  private musicScale = 1;

  constructor() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) this.volume = clamp01(Number(stored));
      // Carried over from when this was a switch, so a player who muted the
      // game before it had a slider does not get a faceful of sound.
      else if (localStorage.getItem("dw.muted") === "1") this.volume = 0;
    } catch {
      // Private browsing or blocked storage: default to audible.
      this.volume = 1;
    }
  }

  get level(): number {
    return this.volume;
  }

  get usingFiles(): boolean {
    return this.entries.length > 0;
  }

  /** Master level, 0 to 1. Everything — cues and music — rides on this. */
  setVolume(level: number): void {
    this.volume = clamp01(level);
    try {
      localStorage.setItem(STORAGE_KEY, String(this.volume));
    } catch {
      /* preference is per-session then */
    }
    if (this.master) this.master.gain.value = this.volume;
  }

  /**
   * Must be called from a user gesture: browsers refuse to start an
   * AudioContext otherwise.
   */
  async unlock(): Promise<void> {
    if (this.initialised) {
      if (this.context?.state === "suspended") await this.context.resume();
      if (this.musicWanted) void this.startMusic();
      return;
    }
    this.initialised = true;

    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    } catch {
      this.context = null;
      return;
    }

    try {
      const response = await fetch(MANIFEST_URL);
      if (response.ok) {
        const data = (await response.json()) as { sounds?: ManifestEntry[] };
        this.entries = (data.sounds ?? []).map((entry) => ({
          ...entry,
          url: publicUrl(entry.url),
        }));
      }
    } catch {
      this.entries = [];
    }

    // The player may have reached the dungeon before the manifest did — the
    // gesture that unlocks the context is usually the same tap that enters it.
    if (this.musicWanted) void this.startMusic();
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
    if (this.volume <= 0 || !this.context || !this.master) return;

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

  /**
   * Starts the background loop, or does nothing if there is no music file.
   *
   * Deliberately not synthesised when the file is missing, unlike the cues: a
   * missing click can be a beep and still be a click, but two minutes of
   * generated room tone is not music, it is a fault the player would want to
   * turn off.
   */
  async startMusic(): Promise<void> {
    this.musicWanted = true;
    // No context yet means no gesture yet. The wish is recorded and `unlock`
    // honours it, rather than this failing quietly and never being retried.
    if (!this.context || !this.master || this.musicSource) return;

    const buffer = await this.loadMusic();
    // The player may have left, or muted and unmuted, while this was loading.
    if (!buffer || !this.musicWanted || this.musicSource) return;
    if (!this.context || !this.master) return;

    const gain = this.context.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();

    this.musicGain = gain;
    this.musicSource = source;
    this.rampMusic(this.musicTarget, MUSIC_FADE);
  }

  /** Fades the loop out and releases it. */
  stopMusic(): void {
    this.musicWanted = false;
    const source = this.musicSource;
    const gain = this.musicGain;
    if (!source || !gain || !this.context) return;

    this.musicSource = null;
    this.musicGain = null;

    const end = this.context.currentTime + MUSIC_FADE * 0.5;
    gain.gain.cancelScheduledValues(this.context.currentTime);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    // Stopped after the fade, not with it, or the fade is never heard.
    source.stop(end + 0.05);
  }

  /**
   * Pulls the loop down while something louder is happening.
   *
   * The raid is the case: hits, traps and the result jingle all have to cut
   * through, and they do it by the music getting out of the way rather than by
   * everything else getting louder.
   */
  /** The music fader, kept apart from the master so it can sit under the cues. */
  setMusicLevel(level: number): void {
    this.musicScale = Math.min(1, Math.max(0, level));
    this.rampMusic(this.musicTarget, 0.5);
  }

  duckMusic(ducked: boolean): void {
    this.musicTarget = ducked ? MUSIC_DUCKED : MUSIC_LEVEL;
    this.rampMusic(this.musicTarget, 0.9);
  }

  private rampMusic(level: number, seconds: number): void {
    if (!this.musicGain || !this.context) return;
    const now = this.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(Math.max(this.musicGain.gain.value, 0.0001), now);
    const scaled = level * this.musicScale;
    this.musicGain.gain.exponentialRampToValueAtTime(Math.max(scaled, 0.0001), now + seconds);
  }

  private async loadMusic(): Promise<AudioBuffer | null> {
    if (this.musicBuffer !== undefined) return this.musicBuffer;
    if (!this.context) return null;

    // An empty list is "the manifest has not arrived", not "there is no music
    // file". Caching a null here is what kept the loop permanently silent:
    // startMusic ran the instant the player entered the dungeon, which is the
    // same gesture that starts the manifest fetch, so it lost the race and
    // then remembered losing it.
    if (this.entries.length === 0) return null;

    const entry = MUSIC_PATTERNS.map((pattern) =>
      this.entries.find((candidate) => pattern.test(candidate.name)),
    ).find(Boolean);

    if (!entry) {
      this.musicBuffer = null;
      return null;
    }

    try {
      const response = await fetch(entry.url);
      const bytes = await response.arrayBuffer();
      this.musicBuffer = await this.context.decodeAudioData(bytes);
    } catch {
      this.musicBuffer = null;
    }
    return this.musicBuffer;
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

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

export const audio = new AudioEngine();
