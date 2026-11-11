/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: { 950: '#060817', 900: '#0A0E22', 850: '#0E1330', 800: '#131A3B', 700: '#1C2450', 600: '#2A3368', 500: '#3A4585' },
        ink: '#E9ECFF',
        muted: '#A0A8D4',
        dim: '#6B74A6',
        indigo: '#7C87FF',
        viewer: '#5CE1E6',
        world: '#F0B866',
        rose: '#FF7A90',
        mint: '#6EE7A8',
        violet: '#C792FF',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['"Manrope Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(233,236,255,0.04) inset, 0 18px 40px -24px rgba(0,0,0,0.7)',
        glow: '0 0 0 1px rgba(124,135,255,0.5), 0 0 24px -4px rgba(124,135,255,0.45)',
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: { rise: 'rise 600ms cubic-bezier(0.2,0.7,0.2,1) both' },
    },
  },
  plugins: [],
};
