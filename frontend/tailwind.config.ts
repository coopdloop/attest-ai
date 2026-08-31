import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: { gridTemplateColumns: { '16': 'repeat(16, minmax(0, 1fr))' } } },
  plugins: [],
}

export default config
