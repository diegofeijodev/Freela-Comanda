import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  // Só no `next dev`: páginas compiladas saem da memória logo (a máquina de desenvolvimento tem 7,6 GB).
  onDemandEntries: { maxInactiveAge: 30_000, pagesBufferLength: 2 },
  // Endereço antigo do protótipo (link de redefinição do Supabase) → troca de senha logada.
  async redirects() {
    return [{ source: '/reset-password', destination: '/trocar-senha', permanent: false }];
  },
};

export default nextConfig;
