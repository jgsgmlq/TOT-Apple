module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  important: true,
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#EBEAE4',
          green: '#3C6A4B',
          lightGreen: '#E6E9DD',
        },
        status: {
          urgent: { main: '#954D24', light: '#F4E7DA' },
          nudging: { main: '#A99E64', light: '#F3EAD5' },
          normal: { main: '#E5E7EB', text: '#6B7280' },
          new: { main: '#3C6A4B' }
        },
        accent: {
          red: '#E25438'
        }
      }
    },
  },
};
