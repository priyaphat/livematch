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
          100: '#f4f0e4',
          900: '#191b18'
        },
        court: {
          500: '#1f8a70',
          600: '#17745e'
        },
        shuttle: {
          400: '#f5c542',
          500: '#eab308'
        }
      },
      boxShadow: {
        soft: '0 12px 30px rgba(34, 41, 37, 0.08)'
      }
    }
  },
  plugins: []
}
