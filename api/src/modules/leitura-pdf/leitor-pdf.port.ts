/** Porta da leitura de PDF por IA (spec, decisão 6). Produção = Claude; testes injetam um falso — nenhum teste faz rede. */
export const LEITOR_PDF = Symbol('LEITOR_PDF');

export interface PedidoLeitura {
  pdfBase64: string;
  nomeArquivo: string;
  /** Instruções do protótipo (o "instructions" do gateway da Lovable), em pt-BR. */
  instrucoes: string;
  /** A frase do usuário que acompanha o arquivo. */
  pedido: string;
  /** JSON Schema da resposta (o mesmo SCHEMA do protótipo). */
  schema: Record<string, unknown>;
}

export interface LeitorPdf {
  /** `false` = sem chave: a rota responde "Leitura de PDF não configurada" sem chamar ninguém. */
  configurado(): boolean;
  /** Devolve o objeto já parseado, ou lança `LeituraPdfErro` com a mensagem de tela. */
  ler(pedido: PedidoLeitura): Promise<unknown>;
}

/** Erro com a mensagem que a tela mostra (mesmos textos do protótipo). */
export class LeituraPdfErro extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export const MSG = {
  naoConfigurada: 'Leitura de PDF não configurada',
  muitas: 'Muitas leituras seguidas, tente de novo em instantes.',
  indisponivel: 'Não foi possível ler o PDF agora.',
} as const;
