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
  | "sell"
  | "leak"
  | "error"
  | "raidStart"
  | "hit"
  | "trap"
  | "victory"
  | "defeat"
  /** A bow or crossbow tower looses. */
  | "shoot"
  /** A blade or axe tower swings. */
  | "swing"
  /** The mage tower casts. */
  | "cast"
  | "upgrade"
  /** A wave cleared: its bonus gold. */
  | "coins"
  /** A champion comes in. */
  | "roar"
  /** Dragonlings come in. */
  | "dragon";

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
  // A tower taken down: the lowest, longest thing in the mix.
  sell: [
    { from: 150, to: 45, seconds: 0.34, type: "sawtooth", gain: 0.1 },
    { from: 70, to: 40, seconds: 0.5, type: "sine", gain: 0.08 },
  ],
  // One through to the core: a hollow drop, clearly not a kill.
  leak: [{ from: 260, to: 110, seconds: 0.2, type: "triangle", gain: 0.07 }],
  error: [{ from: 200, to: 120, seconds: 0.18, type: "square", gain: 0.06 }],
  raidStart: [
    { from: 110, to: 220, seconds: 0.35, type: "sawtooth", gain: 0.08 },
    { from: 55, seconds: 0.5, type: "sine", gain: 0.09 },
  ],
  hit: [{ from: 240, to: 90, seconds: 0.07, type: "square", gain: 0.05 }],
  trap: [{ from: 320, to: 60, seconds: 0.16, type: "sawtooth", gain: 0.07 }],
  victory: [
    { from: 330, seconds: 0.12, type: "triangle", gain: 0.08 },
    { from: 440, seconds: 0.12, type: "triangle", gain: 0.08 },
    { from: 550, seconds: 0.26, type: "triangle", gain: 0.08 },
  ],
  defeat: [
    { from: 220, seconds: 0.16, type: "sawtooth", gain: 0.07 },
    { from: 150, seconds: 0.32, type: "sawtooth", gain: 0.07 },
  ],
  shoot: [{ from: 900, to: 300, seconds: 0.06, type: "triangle", gain: 0.03 }],
  swing: [{ from: 500, to: 150, seconds: 0.08, type: "sawtooth", gain: 0.03 }],
  cast: [{ from: 300, to: 900, seconds: 0.14, type: "sine", gain: 0.05 }],
  upgrade: [
    { from: 440, seconds: 0.08, type: "triangle", gain: 0.07 },
    { from: 660, seconds: 0.14, type: "triangle", gain: 0.07 },
  ],
  coins: [{ from: 1200, to: 1500, seconds: 0.1, type: "square", gain: 0.03 }],
  roar: [{ from: 120, to: 60, seconds: 0.6, type: "sawtooth", gain: 0.1 }],
  dragon: [{ from: 300, to: 120, seconds: 0.4, type: "sawtooth", gain: 0.07 }],
};

/**
 * File patterns per cue, matched against the audio manifest the same way
 * models are. Kenney's packs use these kinds of names.
 */
const FILE_PATTERNS: Record<Cue, RegExp[]> = {
  click: [/click_00[12]/, /^click/, /select/, /^tick/],
  place: [/^drop_00/, /^switch/, /^bong/, /place/],
  sell: [/^sfx_stone/, /rubble/, /^rock/, /impact.*heavy/, /^footstep/],
  // Nothing in the packs reads as this, and a wrong sound is worse than the
  // synthesised one the engine falls back to.
  leak: [],
  error: [/error/, /^back_00/, /^close/, /wrong/],
  // The portcullis chains: the door opening for the wave.
  raidStart: [/^sfx_gate/, /^jingles_steel/, /^jingles_pizzi/, /horn/, /alarm/],
  hit: [/impact.*generic/, /^impact/, /^hit/, /punch/],
  trap: [/impact.*plate/, /explosion/, /^spike/, /metal/],
  victory: [/jingles.*win/, /win/, /^success/, /^complete/],
  defeat: [/jingles.*lose/, /lose/, /^fail/, /^gameover/],
  shoot: [/^sfx_bow/],
  swing: [/^sfx_swing/],
  cast: [/^sfx_cast/],
  upgrade: [/^sfx_upgrade/],
  coins: [/^sfx_coins/],
  roar: [/^sfx_roar/],
  dragon: [/^sfx_dragon/],
};

/**
 * The background music, one loop per mood.
 *
 * Building has its own track; a wave has another, and
 * the two crossfade when the defence starts and when it is over. Matched out of
 * the same manifest as the cues. The build mood falls back to the room tone
 * that shipped before there was music, and a raid with no track of its own
 * keeps whatever is already playing.
 */
export type MusicMood = "build" | "raid";

const MUSIC_PATTERNS: Record<MusicMood, RegExp[]> = {
  build: [/^music_build/, /ambience/, /ambient/],
  raid: [/^music_raid/, /battle/],
};

/**
 * How loud each loop sits under everything else.
 *
 * Under the cues in both: a fight is carried by its hits and traps, and the
 * raid track is there to raise the stakes, not to cover them.
 */
const MUSIC_LEVEL: Record<MusicMood, number> = { build: 0.34, raid: 0.28 };
/** Long enough that neither end of a loop, nor the handover, is an event. */
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

  /** Each mood's loop, once looked for. Absent means not looked for yet. */
  private musicBuffers = new Map<MusicMood, AudioBuffer | null>();
  private musicLoading = new Map<MusicMood, Promise<AudioBuffer | null>>();
  /** The loop playing now, and whose it is. */
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicPlaying: MusicMood | null = null;
  private musicWanted = false;
  private musicMood: MusicMood = "build";
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
   * Starts the current mood's loop, crossfading from whatever is playing.
   *
   * Deliberately not synthesised when the file is missing, unlike the cues: a
   * missing click can be a beep and still be a click, but two minutes of
   * generated music is a fault the player would want to turn off.
   */
  async startMusic(): Promise<void> {
    this.musicWanted = true;
    // No context yet means no gesture yet. The wish is recorded and `unlock`
    // honours it, rather than this failing quietly and never being retried.
    if (!this.context || !this.master) return;
    const mood = this.musicMood;
    if (this.musicPlaying === mood && this.musicSource) return;

    const buffer = await this.loadMusic(mood);
    // The player may have left, muted, or moved on to the other mood while
    // this was loading.
    if (!this.musicWanted || mood !== this.musicMood || !this.context || !this.master) return;
    if (this.musicPlaying === mood && this.musicSource) return;
    // A mood with no track of its own leaves the current loop playing.
    if (!buffer) return;

    this.fadeOutMusic();

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
    this.musicPlaying = mood;
    this.rampMusic(MUSIC_FADE);

    // The raid track is fetched while the dungeon is being built, so the
    // defence starts with its music rather than a second of silence.
    if (mood === "build") void this.loadMusic("raid");
  }

  /** Fades the loop out and releases it. */
  stopMusic(): void {
    this.musicWanted = false;
    this.fadeOutMusic();
  }

  /**
   * Which loop should be playing: the dungeon's own, or the raid's.
   *
   * Crossfades when it changes and music is on; otherwise it is remembered for
   * the next start.
   */
  setMusicMood(mood: MusicMood): void {
    if (this.musicMood === mood) return;
    this.musicMood = mood;
    if (this.musicWanted) void this.startMusic();
  }

  /** The music fader, kept apart from the master so it can sit under the cues. */
  setMusicLevel(level: number): void {
    this.musicScale = Math.min(1, Math.max(0, level));
    this.rampMusic(0.5);
  }

  private fadeOutMusic(): void {
    const source = this.musicSource;
    const gain = this.musicGain;
    this.musicSource = null;
    this.musicGain = null;
    this.musicPlaying = null;
    if (!source || !gain || !this.context) return;

    const end = this.context.currentTime + MUSIC_FADE * 0.5;
    gain.gain.cancelScheduledValues(this.context.currentTime);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    // Stopped after the fade, not with it, or the fade is never heard.
    source.stop(end + 0.05);
  }

  private rampMusic(seconds: number): void {
    if (!this.musicGain || !this.context || !this.musicPlaying) return;
    const now = this.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(Math.max(this.musicGain.gain.value, 0.0001), now);
    const scaled = MUSIC_LEVEL[this.musicPlaying] * this.musicScale;
    this.musicGain.gain.exponentialRampToValueAtTime(Math.max(scaled, 0.0001), now + seconds);
  }

  private loadMusic(mood: MusicMood): Promise<AudioBuffer | null> {
    if (this.musicBuffers.has(mood)) return Promise.resolve(this.musicBuffers.get(mood)!);
    const pending = this.musicLoading.get(mood);
    if (pending) return pending;
    if (!this.context) return Promise.resolve(null);

    // An empty list is "the manifest has not arrived", not "there is no music
    // file". Caching a null here is what kept the loop permanently silent:
    // startMusic ran the instant the player entered the dungeon, which is the
    // same gesture that starts the manifest fetch, so it lost the race and
    // then remembered losing it.
    if (this.entries.length === 0) return Promise.resolve(null);

    const entry = MUSIC_PATTERNS[mood]
      .map((pattern) => this.entries.find((candidate) => pattern.test(candidate.name)))
      .find(Boolean);
    if (!entry) {
      this.musicBuffers.set(mood, null);
      return Promise.resolve(null);
    }

    const context = this.context;
    const task = (async () => {
      try {
        const response = await fetch(entry.url);
        const bytes = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes);
        this.musicBuffers.set(mood, buffer);
        return buffer;
      } catch {
        this.musicBuffers.set(mood, null);
        return null;
      } finally {
        this.musicLoading.delete(mood);
      }
    })();
    this.musicLoading.set(mood, task);
    return task;
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
