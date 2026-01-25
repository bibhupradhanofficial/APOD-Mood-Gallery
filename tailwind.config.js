/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          black: '#050510',
          void: '#090a1a',
          deepBlue: '#0b1026',
          indigo: '#20114d',
          purple: '#4b1f7a',
          nebula: '#7c3aed',
          aurora: '#22d3ee',
          stardust: '#e9d5ff',
        },
      },
      backgroundImage: {
        'space-radial':
          'radial-gradient(1200px circle at 20% 10%, rgba(124, 58, 237, 0.28), transparent 55%), radial-gradient(900px circle at 80% 30%, rgba(34, 211, 238, 0.16), transparent 50%), radial-gradient(800px circle at 50% 90%, rgba(75, 31, 122, 0.18), transparent 55%)',
      },
    },
  },
  plugins: [],
}
