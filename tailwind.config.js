/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--base)",
        surface: "var(--surface)",
        "surface-hover": "var(--surface-hover)",
        "surface-alt": "var(--surface-alt)",
        text: "var(--text)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        "accent-text": "var(--accent-text)",
        border: "var(--border)",
        "border-subtle": "var(--border-subtle)",
        "success-text": "var(--success-text)",
        "success-bg": "var(--success-bg)",
        "success-border": "var(--success-border)",
        "warning-text": "var(--warning-text)",
        "warning-bg": "var(--warning-bg)",
        "warning-border": "var(--warning-border)",
        "danger-text": "var(--danger-text)",
        "danger-bg": "var(--danger-bg)",
        "danger-border": "var(--danger-border)",
        "info-text": "var(--info-text)",
        "info-bg": "var(--info-bg)",
        "info-border": "var(--info-border)",
      },
    },
  },
  plugins: [],
};
