/**
 * Porta da leitura de PDF e de foto de nota por IA (spec, decisão 6). Produção = a IA cuja chave a empresa cadastrou em Configurações
 * (Claude, ChatGPT ou Gemini; sem ela, a ANTHROPIC_API_KEY do servidor); testes injetam um falso — nenhum teste faz rede.
 */
export const LEITOR_PDF = Symbol('LEITOR_PDF');

export type MimeArquivo = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

export interface ArquivoLeitura {
  base64: string;
  mime: MimeArquivo;
  nome: string;
}

export interface PedidoLeitura {
  /** Um PDF ou 1 a 4 imagens, na ordem em que a IA deve ler. */
  arquivos: ArquivoLeitura[];
  /** Instruções do protótipo (o "instructions" do gateway da Lovable), em pt-BR. */
  instrucoes: string;
  /** A frase do usuário que acompanha o arquivo. */
  pedido: string;
  /** JSON Schema da resposta (o mesmo SCHEMA do protótipo). */
  schema: Record<string, unknown>;
}

export interface LeitorPdf {
  /** Devolve o objeto já parseado, ou lança `LeituraPdfErro` com a mensagem de tela (sem chave: "Leitura de PDF não configurada"). */
  ler(pedido: PedidoLeitura): Promise<unknown>;
}

/** Erro com a mensagem que a tela mostra (mesmos textos do protótipo). */
export class LeituraPdfErro extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** O que o provedor respondeu (status + mensagem dele, sem a chave): só aparece no teste ao salvar a chave, para dar para diagnosticar. */
    readonly detalhe?: string,
  ) {
    super(message);
  }
}

export const MSG = {
  naoConfigurada: 'Leitura de PDF não configurada: cadastre a chave de uma IA em Configurações.',
  chaveRecusada: 'A IA recusou a chave cadastrada. Confira a chave em Configurações.',
  semCredito: 'A conta da IA está sem créditos. Adicione saldo no site da IA e tente de novo.',
  modelo: 'O modelo de IA configurado não está disponível para esta chave.',
  chaveIlegivel: 'A chave de IA salva não pode mais ser lida. Cadastre a chave de novo em Configurações.',
  muitas: 'Muitas leituras seguidas, tente de novo em instantes.',
  indisponivel: 'Não foi possível ler o PDF agora.',
  ilegivel: 'Não consegui identificar os dados deste PDF.',
} as const;

/** Mesmo erro de "não li nada útil" para os três provedores. */
export const pdfIlegivel = () => new LeituraPdfErro(MSG.ilegivel, 422, 'PDF_ILEGIVEL');
