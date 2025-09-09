/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Noto Sans KR"', 'sans-serif'],
        mono: ['"SF Mono"', 'Monaco', '"Cascadia Code"', '"Roboto Mono"', 'monospace'],
      },
      fontSize: {
        'xxs': ['10px', '14px'],
        'xs': ['12px', '18px'],
        'sm': ['14px', '21px'],
        'base': ['15px', '24px'],
        'lg': ['18px', '28px'],
        'xl': ['20px', '30px'],
        '2xl': ['24px', '36px'],
        '3xl': ['30px', '42px'],
        '4xl': ['36px', '48px'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      boxShadow: {
        'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        'sm': '0 1px 3px 0 rgba(0, 0, 0, 0.04)',
        'md': '0 2px 4px 0 rgba(0, 0, 0, 0.06)',
        'lg': '0 4px 6px 0 rgba(0, 0, 0, 0.07)',
        'xl': '0 8px 10px 0 rgba(0, 0, 0, 0.08)',
      },
      colors: {
        // Professional HANSL Brand Color System
        hansl: {
          50: '#EEF5FD',   // Lightest blue for backgrounds
          100: '#D6E7FA',  // Very light blue for hover states
          200: '#B3D2F5',  // Light blue for selected states
          300: '#85B8EF',  // Medium light for accents
          400: '#4D96E5',  // Medium blue for interactive
          500: '#1777CB',  // Primary brand color
          600: '#1569B5',  // Hover state for primary
          700: '#105195',  // Active/pressed state
          800: '#0D4178',  // Deep blue for emphasis
          900: '#0A3361',  // Darkest blue for contrast
          950: '#062140',  // Ultra deep for special cases
        },
        // Professional Gray Scale
        gray: {
          50: '#FAFBFC',   // Subtle backgrounds
          100: '#F4F6F8',  // Light backgrounds
          200: '#E9ECF0',  // Borders and dividers
          300: '#D6DAE1',  // Disabled states
          400: '#A8B0BD',  // Placeholder text
          500: '#6B7687',  // Secondary text
          600: '#4E5968',  // Primary text
          700: '#394455',  // Headings
          800: '#2B3545',  // Dark headings
          900: '#1A2332',  // Darkest text
          950: '#0F1623',  // Ultra dark
        },
        // Status Colors - Professional Palette
        success: {
          50: '#EDFCF4',
          100: '#D3F8E3',
          500: '#16A34A',
          600: '#15803C',
          700: '#166534',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
        },
        error: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#DC2626',
          600: '#B91C1C',
          700: '#991B1B',
        },
        info: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        'professional': '0.375rem',
        'professional-lg': '0.5rem',
        'professional-xl': '0.75rem',
      },
      borderWidth: {
        '3': '3px',
      },
      transitionDuration: {
        '250': '250ms',
        '350': '350ms',
        '400': '400ms',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/forms')],
}