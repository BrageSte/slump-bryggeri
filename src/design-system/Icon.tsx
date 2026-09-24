import type { SVGProps } from "react";

/** Small hand-drawn 24×24 stroke icon set, so the app has no icon-library dependency. */
const paths = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  kettle: "M5 8h14l-1.2 11.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8L5 8Zm0 0V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V8M9 5V3m6 2V3M9 12h6",
  box: "M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Zm0 0L12 12m0 0 8.5-4.5M12 12v9",
  sparkles: "M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.2 2.2m7 7 2.2 2.2m0-11.4-2.2 2.2m-7 7-2.2 2.2",
  menu: "M4 6h16M4 12h16M4 18h16",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  check: "M4.5 12.5l5 5 10-11",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 8v5m0 3.5h.01M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z",
  arrowUp: "M12 19V5m-6 6 6-6 6 6",
  arrowDown: "M12 5v14m-6-6 6 6 6-6",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  thermometer: "M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z",
  droplet: "M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5Z",
  camera: "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  comment: "M4 5h16v11H9l-5 4V5Z",
  flask: "M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 15h9",
  gauge: "M12 14l4-4M3.5 17a9 9 0 1 1 17 0",
  leaf: "M5 19c0-8 5-14 15-14 0 10-6 15-14 15H5Zm0 0 7-7",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19m16 0v-1.5a3.5 3.5 0 0 0-2.6-3.4M14.5 4.1a3.5 3.5 0 0 1 0 6.8M13.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  sliders: "M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4m8 2v4",
  wrench: "M14.5 5.5a4 4 0 0 0 5 5L12 18a2.1 2.1 0 1 1-3-3l7.5-7.5Zm0 0L17 3M9 15l-5 5",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4m-4-4h11",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 14a2 2 0 0 1 2-2h13",
  file: "M14 3H6v18h12V7l-4-4Zm0 0v4h4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1m-2 7.4-1 1a4 4 0 0 1-5.7-5.7l3-3a4 4 0 0 1 5.7 0",
  clipboard: "M9 4h6v3H9V4Zm-2 1H5v16h14V5h-2M8 12h8m-8 4h5",
  image: "M4 5h16v14H4V5Zm0 11 4-4 3 3 3-4 6 6M9 9.5h.01",
  split: "M6 3v6a6 6 0 0 0 6 6m0 0a6 6 0 0 0 6-6V3m-6 12v6",
  play: "M7 5v14l11-7L7 5Z",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4.5 4.5",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 24, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "dots" ? 3.5 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
