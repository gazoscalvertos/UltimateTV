// A small set of line icons drawn for the TV (thick strokes read well from the sofa).

import type { JSX } from "solid-js";

// Functions, not elements: Solid elements are real DOM nodes and can only be in one place at once.
const PATHS: Record<string, () => JSX.Element> = {
  play: () => <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: () => (
    <>
      <rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  record: () => <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  series: () => (
    <>
      <circle cx="9" cy="12" r="5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="5" fill="none" />
    </>
  ),
  bell: () => <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  search: () => (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  edit: () => <path d="M5 19l1-4L16 5l3 3L9 18zM14 7l3 3" />,
  move: () => <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />,
  check: () => <path d="M5 12.5l4.5 4.5L19 7.5" />,
  lock: () => (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  download: () => <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
  rewind: () => <path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z" fill="currentColor" stroke="none" />,
  forward: () => <path d="M13 6l7 6-7 6zM4 6l7 6-7 6z" fill="currentColor" stroke="none" />,
  info: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  plus: () => <path d="M12 5v14M5 12h14" />,
  trash: () => <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
  star: () => <path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />,
  speaker: () => <path d="M4 9.5h4l5-4v13l-5-4H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />,
  subtitles: () => (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M7 14.5h4M13 14.5h4M7 11h10" />
    </>
  ),
  moon: () => <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />,
  restart: () => <path d="M5 12a7 7 0 1 0 2.1-5M5 4.5V9h4.5" />,
  list: () => <path d="M8 7h12M8 12h12M8 17h12M4 7h.5M4 12h.5M4 17h.5" />,
  close: () => <path d="M6 6l12 12M18 6 6 18" />,
  next: () => (
    <>
      <path d="M6 6l9 6-9 6z" fill="currentColor" stroke="none" />
      <path d="M17.5 6v12" />
    </>
  ),
  prev: () => (
    <>
      <path d="M18 6l-9 6 9 6z" fill="currentColor" stroke="none" />
      <path d="M6.5 6v12" />
    </>
  ),
  shuffle: () => <path d="M4 7h3.5c4 0 5 10 9 10H20M4 17h3.5c1.6 0 2.7-1.6 3.6-3.5M20 7h-3.5c-1.6 0-2.7 1.6-3.6 3.5M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />,
  repeat: () => <path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19M16 4l3 3-3 3M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5M8 20l-3-3 3-3" />,
  repeatOne: () => <path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19M16 4l3 3-3 3M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5M8 20l-3-3 3-3M11.5 10.5l1-0.5v4" />,
  music: () => (
    <>
      <path d="M9 17V6l10-2v11" />
      <circle cx="6.5" cy="17" r="2.5" />
      <circle cx="16.5" cy="15" r="2.5" />
    </>
  ),
  minus: () => <path d="M5 12h14" />,
};

export function Icon(props: { name: string; class?: string }) {
  return (
    <svg class={`icon ${props.class ?? ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {PATHS[props.name]?.()}
    </svg>
  );
}
