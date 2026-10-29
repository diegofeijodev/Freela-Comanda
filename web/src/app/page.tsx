'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessao } from '@/modules/auth/application/use-auth';

export default function Inicio() {
  const router = useRouter();
  const { user, carregando } = useSessao();
  useEffect(() => {
    if (!carregando) router.replace(user ? '/painel' : '/auth');
  }, [carregando, user, router]);
  return null;
}
