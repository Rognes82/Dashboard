import { forwardRef, type SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "stroke"> {
  size?: number;
  active?: boolean;
}

function makeIcon(name: string, paths: React.ReactNode) {
  const C = forwardRef<SVGSVGElement, IconProps>(({ size = 14, active, className, ...rest }, ref) => (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "#7dd3fc" : "currentColor"}
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {paths}
    </svg>
  ));
  C.displayName = `Icon.${name}`;
  return C;
}

export const ChatIcon = makeIcon(
  "Chat",
  <path d="M4 5h16v12H7l-3 3V5z" />
);

export const BinsIcon = makeIcon(
  "Bins",
  <>
    <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" />
  </>
);

export const ReviewIcon = makeIcon(
  "Review",
  <>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </>
);

export const SettingsIcon = makeIcon(
  "Settings",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2" />
  </>
);

export const SearchIcon = makeIcon(
  "Search",
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>
);

export const CloseIcon = makeIcon(
  "Close",
  <path d="M6 6l12 12M18 6L6 18" />
);

export const ChevronIcon = makeIcon(
  "Chevron",
  <path d="M9 6l6 6-6 6" />
);

export const ChevronDownIcon = makeIcon(
  "ChevronDown",
  <path d="M6 9l6 6 6-6" />
);

export const ExternalIcon = makeIcon(
  "External",
  <path d="M14 3l7 7M21 3l-7 7M14 3h7v7M10 21l-7-7M3 21l7-7M10 21H3v-7" />
);

export const SendIcon = makeIcon(
  "Send",
  <path d="M4 20l16-8L4 4v6l8 2-8 2z" />
);
