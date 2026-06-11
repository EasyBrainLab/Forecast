import type { Config } from 'tailwindcss';

// Eckert & Ziegler CI: Primärblau #0F516A, Akzentrot #AA003C, Arial.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ez: {
          primary: '#0F516A',
          'primary-fg': '#FFFFFF',
          accent: '#AA003C',
          ampelGruen: '#1E7B34',
          ampelGelb: '#C9A100',
          ampelRot: '#AA003C',
        },
      },
      fontFamily: {
        sans: ['Arial', 'Helvetica', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
