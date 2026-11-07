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
        bg: "#0F172A",
        surface: "#1E293B",
        text: "#F1F5F9",
        muted: "#94A3B8",
        accent: "#14B8A6",
        pending: "#F59E0B",
        failed: "#EF4444",
        info: "#38BDF8",
      },
    },
  },
  plugins: [],
};


