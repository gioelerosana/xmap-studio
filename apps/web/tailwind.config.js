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
          surface: 'var(--adw-surface)',
          sidebar: 'var(--adw-sidebar-bg)',
          fg: 'var(--adw-fg-color)',
          muted: 'var(--adw-muted-color)',
          card: 'var(--adw-card-bg)',
          cardBorder: 'var(--adw-card-border)',
          hairline: 'var(--adw-hairline)',
          headerbar: 'var(--adw-headerbar-bg)',
          headerbarBorder: 'var(--adw-headerbar-border)',
          accent: 'var(--adw-accent-color)',
          accentSoft: 'var(--adw-accent-soft)',
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
