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

## Models — KayKit, by Kay Lousberg

<https://kaylousberg.com/> · CC0

| Pack | Source |
|---|---|
| KayKit Dungeon (Remastered) | <https://kaylousberg.itch.io/kaykit-dungeon-remastered> |
| KayKit Skeletons | <https://kaylousberg.itch.io/kaykit-skeletons> |
| KayKit Adventurers | <https://kaylousberg.itch.io/kaykit-adventurers> |
| KayKit Character Animations | <https://kaylousberg.itch.io/kaykit-animations> |

Extracted under `public/assets/kaykit/`. Indexed by `npm run assets`.

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
