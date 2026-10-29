import type { Metadata, Viewport } from 'next';
import { Fraunces, Manrope } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

// As fontes do protótipo (Fraunces nos títulos, Manrope no texto), servidas do próprio domínio pelo next/font.
const fraunces = Fraunces({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-fraunces' });
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-manrope' });

export const metadata: Metadata = {
  title: 'Freela ERP — Chopp & Espeto Valinhos',
  description: 'Gestão de vendas, fichas técnicas, estoque e compras do restaurante.',
  openGraph: { title: 'Freela ERP', description: 'Gestão de vendas, fichas técnicas, estoque e compras do restaurante.', type: 'website' },
  twitter: { card: 'summary' },
};

export const viewport: Viewport = { themeColor: '#111111' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${fraunces.variable} ${manrope.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
