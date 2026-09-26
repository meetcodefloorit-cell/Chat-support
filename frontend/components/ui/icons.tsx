import { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

/**
 * Hand-drawn Heroicons-outline-style icon set, matching the stroke conventions already used
 * ad hoc across the app (viewBox 0 0 24 24, strokeWidth 1.5–2, round joins). Centralizing them
 * here removes duplicated inline SVG paths without adding an icon package dependency.
 */
function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const MenuIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Base>
);

export const CloseIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M15 18l-6-6 6-6" />
  </Base>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 18l6-6-6-6" />
  </Base>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 9l6 6 6-6" />
  </Base>
);

export const SearchIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Base>
);

export const BellIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
    <path d="M9 17a3 3 0 0 0 6 0" />
  </Base>
);

export const PaperclipIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
  </Base>
);

export const SendIcon = (props: IconProps) => (
  <Base {...props} fill="currentColor" stroke="none">
    <path d="M3.4 20.6l17.45-8.3a.6.6 0 0 0 0-1.08L3.4 2.9a.6.6 0 0 0-.85.66L4.9 12l-2.35 8.44a.6.6 0 0 0 .85.16z" />
  </Base>
);

export const CheckIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 13l4 4L19 7" />
  </Base>
);

export const CheckDoubleIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M2 13l4 4L14.5 8" />
    <path d="M9 13l3.5 3.5L22 7" />
  </Base>
);

export const LogoutIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </Base>
);

export const InboxIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 12h4l2 3h6l2-3h4" />
    <path d="M5.5 5.5h13l2.5 6.5v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7l2.5-6.5z" />
  </Base>
);

export const MegaphoneIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 11v2a2 2 0 0 0 2 2h1l3 5V4L6 9H5a2 2 0 0 0-2 2z" />
    <path d="M13 8a4 4 0 0 1 0 8" />
    <path d="M17 5a8 8 0 0 1 0 14" />
  </Base>
);

export const UsersIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16.5 5.5c1.4.3 2.5 1.6 2.5 3.1 0 1.5-1.1 2.8-2.5 3.1" />
    <path d="M18 14c2.3.4 4 2.4 4 4.8" />
  </Base>
);

export const HeadsetIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
    <rect x="3" y="13" width="4" height="6" rx="1.5" />
    <rect x="17" y="13" width="4" height="6" rx="1.5" />
    <path d="M19 19v1a3 3 0 0 1-3 3h-3" />
  </Base>
);

export const HistoryIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l3.5 2" />
  </Base>
);

export const FolderIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </Base>
);

export const ImageIcon = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="M21 16l-5.5-5.5L4 21" />
  </Base>
);

export const KeyIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2 19 4M16 7l2.5 2.5M19 4l2 2-3 3" />
  </Base>
);

export const PlusIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const TrashIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 7h16" />
    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    <path d="M10 11v6M14 11v6" />
  </Base>
);

export const AlertTriangleIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M10.3 3.9 1.9 18a1.5 1.5 0 0 0 1.3 2.3h17.6a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0z" />
    <path d="M12 9v4" />
    <path d="M12 16.5h.01" />
  </Base>
);

export const SpinnerIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
);

export const ZapIcon = (props: IconProps) => (
  <Base {...props} fill="currentColor" stroke="none">
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
  </Base>
);

export const ShieldCheckIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9 12.5l2 2 4-4.5" />
  </Base>
);

export const ChatBubbleIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8z" />
  </Base>
);

export const ChartBarIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 20V10M10 20V4M16 20v-7M4 20h16" />
  </Base>
);

export const TrendUpIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 16l5-5 4 4 7-8" />
    <path d="M15 7h5v5" />
  </Base>
);

export const ClockIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Base>
);

export const GridIcon = (props: IconProps) => (
  <Base {...props}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Base>
);
