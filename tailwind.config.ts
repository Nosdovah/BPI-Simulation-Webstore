import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0E0E0E",
        charcoal: "#181818",
        smoke: "#4D4E4F",
        bone: "#F6F4F0",
        mist: "#EFEDE9",
        brass: "#B08D57",
        alert: "#B3261E",
      },
      fontFamily: {
        display: ["Cormorant Garamond", "Georgia", "ui-serif", "serif"],
        sans: ["Inter", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        widest2: "0.22em",
      },
    },
  },
  plugins: [],
};

export default config;