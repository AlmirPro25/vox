
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
        nexus: {
          black: "#050505",
          gray: "#121212",
          border: "#262626",
          accent: "#00F2FF", // Cyan futurista
          magenta: "#FF00E5",
          safe: "#00FF66"
        }
      },
      backgroundImage: {
        'nexus-gradient': "radial-gradient(circle at 50% 50%, #1a1a1a 0%, #050505 100%)",
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 8s linear infinite',
        'spin-reverse-slow': 'spin-reverse 12s linear infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: 1, filter: 'brightness(1)' },
          '50%': { opacity: 0.7, filter: 'brightness(1.5)' },
        },
        'spin-reverse': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(-360deg)' },
        }
      }
    },
  },
  plugins: [require("tailwindcss-animate")],
}
