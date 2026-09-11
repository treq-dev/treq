/** @type {import('tailwindcss').Config} */
export default {
  // Docusaurus sets data-theme="dark" on <html>, not a .dark class
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  corePlugins: {
    // Disable Tailwind's CSS reset — Infima/Docusaurus handles base styles
    preflight: false,
  },
  theme: {
    extend: {
      // Mirror the app's CSS variable–driven color system so shared components
      // render identically on both the desktop app and the docs site.
      colors: {
        border:       'hsl(var(--border))',
        input:        'hsl(var(--input))',
        ring:         'hsl(var(--ring))',
        background:   'hsl(var(--background))',
        foreground:   'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
      },
      fontFamily: {
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
    },
  },
};
