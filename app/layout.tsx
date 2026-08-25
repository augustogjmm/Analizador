import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './lab.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Liquidity Lab · Binance Market Intelligence',
  description: 'Análisis operativo de liquidez, order flow, estructura y derivados de Binance.',
  openGraph: {
    title: 'Liquidity Lab · Binance Market Intelligence',
    description: 'Análisis operativo de liquidez, order flow, estructura y derivados de Binance.',
    images: [{ url: '/og.png', width: 1729, height: 910, alt: 'Liquidity Lab' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Liquidity Lab · Binance Market Intelligence',
    description: 'Análisis operativo de liquidez, order flow, estructura y derivados de Binance.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
