/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "./index.html",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // Mirrors openclaw.ai marketing site exactly.
        display: ['"Clash Display"', 'Inter Variable', 'Inter', '-apple-system', 'BlinkMacSystemFont', "'SF Pro Display'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body:    ['Satoshi',         'Inter Variable', 'Inter', '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans:    ['Satoshi',         'Inter Variable', 'Inter', '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['ui-monospace', 'SFMono-Regular', "'SF Mono'", "'Fira Code'", "'JetBrains Mono'", 'Menlo', 'Monaco', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // OpenClaw coral — the primary brand red. Light mode uses the
        // crisper #ef4b58; dark mode uses the brighter #ff4d4d. Surfaced
        // here as a discrete ramp so we can apply it independently of
        // the semantic `--primary` token.
        brand: {
          50:  "#ffe5e8",
          100: "#ffc7cd",
          200: "#fb9ba4",
          300: "#f47080",
          400: "#ef4b58", // light mode base
          500: "#ff4d4d", // dark mode base
          600: "#de3f4d",
          700: "#c43645",
          800: "#991b1b",
          900: "#5e1015",
        },
        // OpenClaw teal — the secondary brand accent (used for the
        // cyan glow effects on the marketing site).
        teal: {
          50:  "#d8fff9",
          100: "#a8fff0",
          200: "#5cf3df",
          300: "#14b8a6",
          400: "#00e5cc", // dark mode base
          500: "#008f87", // light mode base
          600: "#00766e",
          700: "#0a5f5a",
          800: "#0b4845",
          900: "#093633",
        },
        // Cool slate ramp — matches the openclaw.ai text/background tones.
        // Used wherever a neutral surface or border is needed.
        ink: {
          50:  "#f5f9ff",
          100: "#f0f4ff",
          200: "#dde3f0",
          300: "#a0aec2",
          400: "#8892b0",
          500: "#5f7290",
          600: "#2e405c",
          700: "#1e293b",
          800: "#111827",
          900: "#0b1220",
          950: "#050810",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        'soft-sm':  '0 1px 3px rgba(11,18,32,0.04), 0 1px 2px rgba(11,18,32,0.02)',
        'soft-md':  '0 4px 14px rgba(11,18,32,0.06), 0 2px 6px rgba(11,18,32,0.03)',
        'soft-lg':  '0 12px 28px rgba(11,18,32,0.08), 0 4px 10px rgba(11,18,32,0.04)',
        'soft-xl':  '0 20px 40px rgba(11,18,32,0.10), 0 8px 16px rgba(11,18,32,0.05)',
        // Coral glow — matches `--shadow-coral-*` on openclaw.ai.
        'glow':         '0 0 20px rgba(239, 75, 88, 0.19)',
        'glow-strong':  '0 0 28px rgba(239, 75, 88, 0.33)',
        // Cyan glow — secondary accent, used on logo hover etc.
        'glow-teal':    '0 0 20px rgba(0, 143, 135, 0.22)',
        'glass':        '0 8px 32px rgba(11,18,32,0.12), inset 0 1px 0 rgba(255,255,255,0.10)',
        'glass-dark':   '0 8px 32px rgba(0,0,0,0.45),     inset 0 1px 0 rgba(255,255,255,0.05)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "sidebar-collapse": {
          from: { width: "var(--sidebar-w-expanded, 240px)" },
          to:   { width: "var(--sidebar-w-collapsed, 64px)" },
        },
        "sidebar-expand": {
          from: { width: "var(--sidebar-w-collapsed, 64px)" },
          to:   { width: "var(--sidebar-w-expanded, 240px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "sidebar-collapse": "sidebar-collapse 180ms cubic-bezier(0.4, 0, 0.2, 1)",
        "sidebar-expand":   "sidebar-expand 180ms cubic-bezier(0.4, 0, 0.2, 1)",
      },
      // Apple-style motion curves. `apple` is the smooth-out spring used
      // across openclaw.ai and the rest of the app (modals, ripple, page
      // transitions) — pulling sidebar onto the same curve keeps the
      // motion vocabulary consistent. `apple-spring` is a gentler
      // overshoot used on tactile flips like the chevron rotation.
      transitionTimingFunction: {
        'apple':        'cubic-bezier(0.16, 1, 0.3, 1)',
        'apple-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
