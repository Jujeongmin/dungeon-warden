# Credits

Every asset shipped in this repository is **CC0 1.0 Universal** (public domain
dedication) unless noted otherwise below. No attribution is legally required
for CC0 assets; it is recorded here so the provenance of each file stays
checkable.

## Font — Pretendard, by Kil Hyung-jin

<https://github.com/orioncactus/pretendard> · SIL Open Font License 1.1

| File | Source |
|---|---|
| Pretendard-Regular.subset.woff2 | <https://github.com/orioncactus/pretendard/releases> |
| Pretendard-Bold.subset.woff2 | <https://github.com/orioncactus/pretendard/releases> |

Two weights only, from the "subset" build (KS X 1001 Hangul + Latin) rather
than the full weight files or the variable font — full coverage isn't needed
for a UI with a small, known string set, and the subset keeps a Korean-capable
face from doubling the bundle. Registered in `src/index.css`; the type scale
built on top of it lives in the same file (`--fs-*` / `--fw-*` / `--ls-*`) and
is used throughout `src/App.css`. Unlike the CC0 assets above, the OFL
requires this notice to travel with the font — that's this entry.

## Display fonts — Google Fonts, all SIL Open Font License 1.1

Titles, dialog heads, buttons and the purse. Each is cut down to the characters
its locale table uses by `scripts/build-fonts.mjs`; the full licence texts are
in `src/assets/fonts/licenses/`.

| File | Font | Designer | Source |
|---|---|---|---|
| Warden-Latin.woff2 | Cinzel (wght 700) | Natanael Gama | <https://github.com/google/fonts/tree/main/ofl/cinzel> |
| Warden-KR.woff2 | Hahmlet | Hypertype | <https://github.com/google/fonts/tree/main/ofl/hahmlet> |
| Warden-JP.woff2 | Zen Antique | Yoshimichi Ohira | <https://github.com/google/fonts/tree/main/ofl/zenantique> |
| Warden-SC.woff2 | Noto Serif SC (wght 700) | Google | <https://github.com/google/fonts/tree/main/ofl/notoserifsc> |
| Warden-TC.woff2 | Noto Serif TC (wght 700) | Google | <https://github.com/google/fonts/tree/main/ofl/notoseriftc> |

The subsets are Modified Versions under the OFL and keep the original names
out of their file names; they are not sold on their own.

## Textures — ambientCG, by Lennart Demes

<https://ambientcg.com/> · CC0

| File | Source material |
|---|---|
| rock051_color.webp, rock051_normal.webp | <https://ambientcg.com/view?id=Rock051> |
| pavingstones128_color.webp, pavingstones128_normal.webp | <https://ambientcg.com/view?id=PavingStones128> |

The rock the dungeon is cut out of, and the floor of the corridor cut into
it. Taken from the 1K JPG packs and baked down to 512px WebP by
`scripts/bake-textures.mjs`, which also drops everything but colour and
normal: the originals are one to two megabytes a map, which is more than the
rest of the game weighs, and what reaches the player is a tile a couple of
centimetres across lit by torchlight. Roughness is a constant in the material
instead — it is nearly flat across both stones.

## Models — KayKit, by Kay Lousberg

<https://kaylousberg.com/> · CC0

| Pack | Source |
|---|---|
| KayKit Dungeon (Remastered) | <https://kaylousberg.itch.io/kaykit-dungeon-remastered> |
| KayKit Skeletons | <https://kaylousberg.itch.io/kaykit-skeletons> |
| KayKit Adventurers | <https://kaylousberg.itch.io/kaykit-adventurers> |
| KayKit Character Animations | <https://kaylousberg.itch.io/kaykit-animations> |

Extracted under `public/assets/kaykit/`. Indexed by `npm run assets`.

Only the models the game actually draws are kept there — the packs ship 250+
and about forty are resolved, so the rest were removed rather than shipped to
every player. `node scripts/unused-assets.mjs` reports the difference; the
full packs are the archives in `art-src/`.

## Sound — Kenney

<https://kenney.nl/> · CC0

| Pack | Source |
|---|---|
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> |
| Impact Sounds | <https://kenney.nl/assets/impact-sounds> |
| Music Jingles | <https://kenney.nl/assets/music-jingles> |

Ten files in `public/assets/audio/`, one per cue. The audio engine matches them
by name, so the two jingles that carry no win/lose wording in the pack were
renamed on the way in — the originals are named below.

| Cue | File | Pack | Original name |
|---|---|---|---|
| click | `click_001.wav` | Interface Sounds | — |
| place | `drop_002.wav` | Interface Sounds | — |
| error | `error_004.wav` | Interface Sounds | — |
| skill | `confirmation_002.wav` | Interface Sounds | — |
| dig | `footstep_concrete_000.ogg` | Impact Sounds | — |
| hit | `impactGeneric_light_000.ogg` | Impact Sounds | — |
| trap | `impactPlate_medium_000.ogg` | Impact Sounds | — |
| raidStart | `jingles_STEEL00.ogg` | Music Jingles | — |
| victory | `win_jingle.ogg` | Music Jingles | `Steel jingles/jingles_STEEL07.ogg` |
| defeat | `lose_jingle.ogg` | Music Jingles | `Pizzicato jingles/jingles_PIZZI09.ogg` |

Dropping more CC0 files into `public/assets/audio/` and re-running
`npm run assets` is enough to extend or replace the set; the engine falls back
to synthesised tones for any cue it cannot match.

## Icons — Kenney "Board Game Icons"

<https://kenney.nl/assets/board-game-icons> · CC0

| File | Source |
|---|---|
| src/assets/icons/coin.svg | `Vector/Icons/token.svg` |

One file. The interface draws its own icons (see src/ui/Icon.tsx) because they
have to take the room's colour, but gold is a thing in the world rather than a
control, so it is Kenney's coin with a viewBox added and the fill fixed to the
game's amber. Geometry unchanged.

## Music — "Cave Theme", by Brandon75689

<https://opengameart.org/content/cave-theme> · CC0 (dual-licensed CC0 / OGA-BY 3.0; used under CC0)

| File | Source |
|---|---|
| music_build.ogg | <https://opengameart.org/sites/default/files/cave%20themeb4.ogg> |

The dungeon's own track, playing while the player builds and walks: a
4:40 mysterious cave piece with a soft start and a soft end, so it loops
without a gap. Re-encoded from the original Vorbis (about 92 kbps) to Vorbis
quality 1 (about 62 kbps, 44.1 kHz stereo) with `ffmpeg-static`: 3.1 MB to
2.1 MB. It replaced "Loopable Dungeon Ambience" by JaggedStone (CC0), a
room tone of wind and drips that stood in for music until there was some.

Music is not synthesised when missing, unlike the cues — a generated click is
still a click, but minutes of generated music is a fault rather than a
soundtrack, so the game simply runs silent without it.

## Music — "Epic Boss Battle [Seamlessly Looping]", by Juhani Junkala (SubspaceAudio)

<https://opengameart.org/content/boss-battle-music> · CC0

| File | Source |
|---|---|
| music_raid.ogg | `Juhani Junkala - Epic Boss Battle [Seamlessly Looping].wav` |

The raid track: a 2-minute orchestral loop that crossfades in when the defence
starts and back out to the dungeon's own loop when it ends (see `setMusicMood`
in `src/game/audio.ts`). Re-encoded from the 21 MB WAV to Vorbis quality 2
(about 96 kbps, 44.1 kHz stereo) with `ffmpeg-static`: 1.5 MB.
