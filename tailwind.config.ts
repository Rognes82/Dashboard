import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#0a0a0a",
        card: "#111111",
        hover: "#1a1a1a",
        border: "#222222",
        "text-primary": "#f5f5f5",
        "text-secondary": "#888888",
        "text-muted": "#555555",
        "accent-green": "#4ade80",
        "accent-amber": "#facc15",
        "accent-red": "#ef4444",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "monospace"],
        sans: ['"IBM Plex Sans"', "sans-serif"],
      },
      fontSize: {
        "2xs": "0.625rem",
        xs: "0.6875rem",
      },
      borderRadius: {
        card: "6px",
        badge: "4px",
      },
      transitionDuration: {
        "200": "200ms",
      },
    },
  },
  plugins: [],
};

export default config;
