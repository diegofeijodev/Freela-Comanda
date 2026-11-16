'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** O que desenhar se algo dentro quebrar. Sem `fallback`, não desenha nada. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Barreira de erro simples: uma exceção na renderização dos filhos vira o `fallback` (ou nada) em vez de derrubar a tela inteira.
 * Não registra o erro em console (o erro pode carregar dados da tela); só isola.
 */
export class ErrorBoundary extends Component<Props, { falhou: boolean }> {
  state = { falhou: false };

  static getDerivedStateFromError(): { falhou: boolean } {
    return { falhou: true };
  }

  componentDidCatch(_erro: Error, _info: ErrorInfo): void {
    // intencionalmente vazio: sem console.* com dados
  }

  render(): ReactNode {
    return this.state.falhou ? (this.props.fallback ?? null) : this.props.children;
  }
}
