/**
 * The interface's own icons.
 *
 * These were emoji. Emoji are somebody else's art: they change shape between
 * iOS, Android and Windows, they arrive in colours that fight the room, and a
 * 🛒 next to a dungeon reads as a web page rather than a game. Drawn here
 * instead — one flat path each, inheriting `currentColor`, so they take the
 * torchlight the rest of the interface is lit by.
 *
 * The one exception is gold, which is not chrome: it is an object in the game,
 * so it is photographed from the same coin model the dungeon draws. See
 * `bakeModelIcons`.
 */

export type IconName =
  | "sound"
  | "mute"
  | "trophy"
  | "shop"
  | "settings"
  | "help"
  | "home"
  | "lock"
  | "crown"
  | "eye"
  | "walk"
  | "chevronDown"
  | "chevronUp";

const PATHS: Record<IconName, string> = {
  // Speaker cone plus two arcs of sound.
  sound: "M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zm-2.5-8v2a6.5 6.5 0 0 1 0 12v2a8.5 8.5 0 0 0 0-16z",
  // The same cone, struck through.
  mute: "M4 9v6h4l5 4V5L8 9H4zm18.3-1.3-1.4-1.4L17 10.2l-3.9-3.9-1.4 1.4L15.6 12l-3.9 3.9 1.4 1.4 3.9-3.9 3.9 3.9 1.4-1.4-3.9-3.9 3.9-3.9z",
  // Two-handled cup on a foot.
  trophy: "M18 4h3v3a4 4 0 0 1-3.2 3.9A6 6 0 0 1 13 14.9V18h3v2H8v-2h3v-3.1a6 6 0 0 1-4.8-4A4 4 0 0 1 3 7V4h3V2h12v2zM6 6H5v1a2 2 0 0 0 1 1.7V6zm13 0h-1v2.7A2 2 0 0 0 19 7V6z",
  // Basket with a handle.
  shop: "M7 8V6a5 5 0 0 1 10 0v2h3l-1.2 12.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 8h3zm2 0h6V6a3 3 0 0 0-6 0v2z",
  // Cog: a ring with six teeth.
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm9 3.5a9 9 0 0 1-.1 1.3l2 1.6-2 3.5-2.4-1a9 9 0 0 1-2.2 1.3L16 21h-4l-.3-2.3a9 9 0 0 1-2.2-1.3l-2.4 1-2-3.5 2-1.6a9 9 0 0 1 0-2.6l-2-1.6 2-3.5 2.4 1a9 9 0 0 1 2.2-1.3L12 3h4l.3 2.3a9 9 0 0 1 2.2 1.3l2.4-1 2 3.5-2 1.6A9 9 0 0 1 21 12z",
  // A question mark in a ring: how the game works.
  help: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-.1 11.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM12 6a3.6 3.6 0 0 0-3.7 3.4h2.2A1.5 1.5 0 0 1 12 8.1c.9 0 1.5.6 1.5 1.3 0 .6-.3 1-1.1 1.5-1 .6-1.6 1.3-1.6 2.6v.5h2.1v-.3c0-.7.3-1 1.1-1.5 1-.6 1.7-1.4 1.7-2.8C15.7 7.4 14.1 6 12 6z",
  // Roof over a doorway.
  home: "M12 3 2 12h3v9h6v-6h2v6h6v-9h3L12 3z",
  // Shackle over a closed body.
  lock: "M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2zM9 7a3 3 0 0 1 6 0v2H9V7z",
  // Three peaks on a band. The party leader, at a size where a photograph
  // of the model itself is a smudge: a flat glyph still reads at 12px.
  crown: "M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8zm2.6 13h12.8v2H5.6v-2z",
  // An open eye: what the dungeon looks like from inside it.
  eye: "M12 5C6.5 5 2.7 9.2 1.5 12c1.2 2.8 5 7 10.5 7s9.3-4.2 10.5-7c-1.2-2.8-5-7-10.5-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  // A chevron pointing up, for the hold-to-walk control.
  walk: "M12 5l8 9h-5v5H9v-5H4l8-9z",
  chevronDown: "M6 9l6 6 6-6H6z",
  chevronUp: "M6 15l6-6 6 6H6z",
};

interface Props {
  name: IconName;
  /** Square edge in px. Defaults to the size of the surrounding text. */
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      // Decorative: every one of these sits inside a control that already has
      // a label or a title, so announcing it twice helps nobody.
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
