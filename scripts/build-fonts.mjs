/**
 * Builds the display faces: titles, dialog heads, buttons and big numbers.
 *
 * Body text stays Pretendard, which is built for small UI text on a phone.
 * The display faces are chosen for the dungeon instead - an inscription
 * face for Latin and an old-press serif for each CJK script:
 *
 *   Warden-Latin  Cinzel (wght 700)          Latin, digits, punctuation
 *   Warden-KR     Song Myung                 Hangul the Korean table uses
 *   Warden-JP     Zen Antique                kana and kanji the Japanese table uses
 *   Warden-SC     Noto Serif SC (wght 700)   hanzi the Simplified table uses
 *   Warden-TC     Noto Serif TC (wght 700)   hanzi the Traditional table uses
 *
 * The sources are full Google Fonts TTFs (all SIL OFL 1.1) of 0.1-25 MB each,
 * so they are not committed. Each is cut down to exactly the characters its
 * locale table can put on screen, which is what makes a CJK display face
 * affordable at all. Add a string with a new character and run this again.
 *
 *   node scripts/build-fonts.mjs <folder with the source .ttf files>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error("usage: node scripts/build-fonts.mjs <folder with the source .ttf files>");
  process.exit(1);
}
const outDir = join(root, "src/assets/fonts");

/** Every character a locale table holds. */
function localeChars(code) {
  const text = readFileSync(join(root, `src/i18n/locales/${code}.ts`), "utf8");
  const body = text.slice(text.indexOf("= {") + 2, text.lastIndexOf("}") + 1);
  const table = Function(`return (${body});`)();
  return Object.values(table).join("");
}

const ascii = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join("");
const marks = "·—–…×★☆♥•→←↑↓−°‘’“”«»";
const cjkMarks = "、。，．：；！？（）《》〈〉【】「」『』～・…—“”‘’";
const nonLatin = (text) => [...new Set(text)].filter((ch) => ch.codePointAt(0) > 0x2000).join("");

const faces = [
  { source: "Cinzel-wght.ttf", out: "Warden-Latin.woff2", text: ascii + marks, axes: { wght: 700 } },
  { source: "SongMyung-Regular.ttf", out: "Warden-KR.woff2", text: nonLatin(localeChars("ko")) + cjkMarks },
  { source: "ZenAntique-Regular.ttf", out: "Warden-JP.woff2", text: nonLatin(localeChars("ja")) + cjkMarks },
  { source: "NotoSerifSC-wght.ttf", out: "Warden-SC.woff2", text: nonLatin(localeChars("zh-Hans")) + cjkMarks, axes: { wght: 700 } },
  { source: "NotoSerifTC-wght.ttf", out: "Warden-TC.woff2", text: nonLatin(localeChars("zh-Hant")) + cjkMarks, axes: { wght: 700 } },
];

for (const face of faces) {
  const input = readFileSync(join(sourceDir, face.source));
  const options = { targetFormat: "woff2" };
  if (face.axes) options.variationAxes = face.axes;
  const output = await subsetFont(input, face.text, options);
  writeFileSync(join(outDir, face.out), output);
  console.log(
    `${face.out.padEnd(20)} ${String([...new Set(face.text)].length).padStart(4)} chars  ` +
      `${(input.byteLength / 1024).toFixed(0).padStart(6)} kB -> ${(output.byteLength / 1024).toFixed(1)} kB`,
  );
}
