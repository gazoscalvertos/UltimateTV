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
};

export function Icon(props: { name: string; class?: string }) {
  return (
    <svg class={`icon ${props.class ?? ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {PATHS[props.name]?.()}
    </svg>
  );
}
