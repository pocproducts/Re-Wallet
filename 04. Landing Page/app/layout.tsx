import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import { GeistPixelGrid } from 'geist/font/pixel'
import { ThemeProvider } from '@/components/theme-provider'
import { LanguageProvider } from '@/components/language-provider'

import './globals.css'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'ReWALLET | Cuenta en dólares digitales que rinde',
  description:
    'ReWALLET es una cuenta en dólares digitales para ahorrar, enviar y hacer rendir tu dinero sin aprender cripto. Login con Face ID, wallet embebida en TEE, rendimiento automático y gas absorbido por paymaster. Envíos por tag, sin direcciones hexadecimales. Hoy en Monad, en beta privada.',
  keywords: [
    'ReWALLET',
    'cuenta en dólares digitales',
    'dólares digitales',
    'rendimiento automático',
    'ahorro cripto',
    'stablecoin account',
    'digital dollar account',
    'wallet embebida',
    'embedded wallet',
    'TEE wallet',
    'passkey wallet',
    'Face ID login',
    'paymaster',
    'gas abstraído',
    'abstracted gas',
    'envíos por tag',
    'Monad',
    'cripto para principiantes',
    'sin claves privadas',
    'beta privada',
  ],
  authors: [{ name: 'ReWALLET' }],
  creator: 'ReWALLET',
  publisher: 'ReWALLET',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'es_ES',
    url: 'https://rewallet.win',
    siteName: 'ReWALLET',
    title: 'ReWALLET | Dólares. Rindiendo. Al momento.',
    description:
      'Una cuenta en dólares digitales para ahorrar, enviar y hacer rendir tu dinero sin aprender cripto. Face ID como login, wallet embebida en TEE, rendimiento automático y gas absorbido.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ReWALLET | Dólares. Rindiendo. Al momento.',
    description:
      'Una cuenta en dólares digitales para ahorrar, enviar y hacer rendir tu dinero sin aprender cripto. Hoy en Monad, en beta privada.',
  },
  category: 'finance',
}

export const viewport: Viewport = {
  themeColor: '#F2F1EA',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${GeistPixelGrid.variable}`} suppressHydrationWarning>
      <body className="font-mono antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
