import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0d0d0d",
        raised: "#0a0a0a",
        sunken: "#111111",
        hover: "#141414",
        "border-subtle": "#1a1a1a",
        "border-default": "#1f1f1f",
        "border-strong": "#333333",
        "text-primary": "#ede8d8",
        "text-secondary": "#c9c6b7",
        "text-tertiary": "#a09e96",
        "text-muted": "#8e8c85",
        "text-subtle": "#6e6c66",
        "text-dim": "#4a4944",
        accent: "#7dd3fc",
        "accent-glow": "rgba(125, 211, 252, 0.06)",
        "accent-tint": "rgba(125, 211, 252, 0.04)",
        "accent-border": "rgba(125, 211, 252, 0.08)",
      },
      fontFamily: {
        sans: ['"Inter"', "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": "0.625rem",
        xs: "0.6875rem",
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
      },
      keyframes: {
        "caret-blink": {
          "0%, 50%": { opacity: "1" },
          "50.01%, 100%": { opacity: "0" },
        },
      },
      animation: {
        "caret-blink": "caret-blink 1s infinite",
      },
    },
  },
  plugins: [],
};
export default config;
