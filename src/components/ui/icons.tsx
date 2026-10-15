// Hand-drawn 1.5px-stroke icon set (24px grid). Decorative: always aria-hidden.
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

/** Brand mark: two offset brackets closing on a hashed block. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="6" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5" />
      <path d="M11 8H7.5v16H11M21 8h3.5v16H21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
      <rect x="12.5" y="12.5" width="7" height="7" fill="currentColor" />
    </svg>
  );
}

export const IconEvidence = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21H11" /><path d="M14 3l5 5v2.5M14 3v5h5" /><path d="M8.5 11h4M8.5 14.5h2.5" /><circle cx="16.5" cy="16.5" r="3" /><path d="M18.7 18.7 21 21" /></Svg>
);
export const IconReconcile = (p: IconProps) => (
  <Svg {...p}><path d="M12 3v18M5 21h14" /><path d="M4 7h16" /><path d="M7 7l-3 7a3 3 0 0 0 6 0L7 7zM17 7l-3 7a3 3 0 0 0 6 0l-3-7z" /></Svg>
);
export const IconChallenge = (p: IconProps) => (
  <Svg {...p}><path d="M4 4l9 9M4 4h4M4 4v4" /><path d="M20 20l-9-9" opacity=".35" /><path d="M20 4l-9 9M20 4h-4M20 4v4" /><path d="M4 20l5.5-5.5M20 20l-5.5-5.5" /></Svg>
);
export const IconResolution = (p: IconProps) => (
  <Svg {...p}><path d="M14.5 4.5l5 5L9 20H4v-5L14.5 4.5z" /><path d="M12.5 6.5l5 5" /><path d="M4 20l5-5" opacity=".35" /></Svg>
);
export const IconGate = (p: IconProps) => (
  <Svg {...p}><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.3-7.5 9.5-4.3-1.2-7.5-5-7.5-9.5V6L12 3z" /><circle cx="12" cy="10.5" r="2" /><path d="M12 12.5V15" /></Svg>
);
export const IconChain = (p: IconProps) => (
  <Svg {...p}><path d="M9.5 14.5l5-5" /><path d="M11 6.5l1.8-1.8a3.9 3.9 0 0 1 5.5 5.5L16.5 12M13 17.5l-1.8 1.8a3.9 3.9 0 0 1-5.5-5.5L7.5 12" /></Svg>
);
export const IconBlock = (p: IconProps) => (
  <Svg {...p}><path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4l8-4.6z" /><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2" /></Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
);
export const IconX = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>
);
export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
);
export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconPlay = (p: IconProps) => (
  <Svg {...p}><path d="M7 4.5v15L19.5 12 7 4.5z" fill="currentColor" stroke="none" /></Svg>
);
export const IconFolder = (p: IconProps) => (
  <Svg {...p}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12z" /></Svg>
);
export const IconTerminal = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M12.5 15H17" /></Svg>
);
export const IconWarning = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5l9.5 16.5h-19L12 3.5z" /><path d="M12 10v4.5M12 17.2v.1" /></Svg>
);
export const IconSkull = (p: IconProps) => (
  <Svg {...p}><path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z" /><circle cx="9" cy="11.5" r="1.5" /><circle cx="15" cy="11.5" r="1.5" /><path d="M10.5 20v-2M13.5 20v-2" /></Svg>
);
export const IconScan = (p: IconProps) => (
  <Svg {...p}><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M4 12h16" /></Svg>
);
