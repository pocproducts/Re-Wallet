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
  title: 'ReWALLET | Guardá, enviá y cobrá en dólares',
  description:
    'ReWALLET es una billetera digital donde guardás tus dólares, los enviás con el @nombre de la persona, compartís un link para que te paguen o escaneás un QR. Un solo saldo sobre Ethereum, Monad y Solana, con todos tus movimientos a la vista.',
  keywords: [
    'ReWALLET',
    'billetera digital',
    'billetera cripto',
    'cuenta en dólares digitales',
    'dólares digitales',
    'enviar dinero por @nombre',
    'links de cobro',
    'pagar con QR',
    'recibir con QR',
    'passkey',
    'registro con passkey',
    'Ethereum',
    'Monad',
    'Solana',
    'un solo saldo',
    'historial de movimientos',
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
    title: 'ReWALLET | Guardá. Enviá. Cobrá.',
    description:
      'ReWALLET es una billetera digital donde guardás tus dólares, los enviás con el @nombre de la persona, compartís un link para que te paguen o escaneás un QR. Un solo saldo sobre Ethereum, Monad y Solana, con todos tus movimientos a la vista.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ReWALLET | Guardá. Enviá. Cobrá.',
    description:
      'ReWALLET es una billetera digital donde guardás tus dólares, los enviás con el @nombre de la persona, compartís un link para que te paguen o escaneás un QR. Un solo saldo sobre Ethereum, Monad y Solana, con todos tus movimientos a la vista.',
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
