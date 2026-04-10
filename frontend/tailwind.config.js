module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        gray: {
          950: '#030712',
          900: '#0f1419',
          850: '#1a1f2e',
          800: '#1f2937',
          700: '#374151',
          600: '#4b5563',
        },
      },
    },
  },
  plugins: [],
};
