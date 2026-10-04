/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui-kit/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        adw: {
          bg: 'var(--adw-bg-color)',
          fg: 'var(--adw-fg-color)',
          card: 'var(--adw-card-bg)',
          cardBorder: 'var(--adw-card-border)',
          headerbar: 'var(--adw-headerbar-bg)',
          headerbarBorder: 'var(--adw-headerbar-border)',
          accent: 'var(--adw-accent-color)',
          accentHover: 'var(--adw-accent-hover)',
          accentActive: 'var(--adw-accent-active)',
          destructive: 'var(--adw-destructive-color)',
          success: 'var(--adw-success-color)',
          warning: 'var(--adw-warning-color)',
        },
      },
    },
  },
  plugins: [],
};
