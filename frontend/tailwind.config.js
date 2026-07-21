export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Noto Sans Thai"',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'sans-serif'
        ]
      },
      colors: {
        paper: {
          50: '#fbfaf4',
          100: '#f5f1e7',
          900: '#191b18'
        },
        court: {
          500: '#2f8068',
          600: '#276d59',
          700: '#1f5949'
        },
        shuttle: {
          400: '#e3b35b',
          500: '#d89c2f'
        },
        skycourt: {
          100: '#eef6f7',
          300: '#9fcbd3',
          500: '#5f9fb0'
        },
        coral: {
          100: '#fae8e2',
          300: '#e49b8e',
          500: '#cf5f4d'
        },
        mint: {
          100: '#e8f1ea',
          300: '#a9cabb',
          500: '#5f9d83'
        }
      },
      boxShadow: {
        soft: '0 8px 18px rgba(24, 48, 68, 0.07)',
        lift: '0 14px 30px rgba(24, 48, 68, 0.10)'
      }
    }
  },
  plugins: []
}
