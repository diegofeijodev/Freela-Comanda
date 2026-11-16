import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/database/prisma.service';
import { ClaudeLeitorPdf } from '../claude-leitor-pdf';
import { LeitorPdf, LeituraPdfErro, MSG } from '../leitor-pdf.port';
import { cifrar, decifrar, dicaDa } from './cripto';
import { GeminiLeitorPdf } from './gemini-leitor-pdf';
import { HTTP_IA, HttpIa } from './http-ia';
import { OpenAiLeitorPdf } from './openai-leitor-pdf';
import { pdfDeTeste, SCHEMA_TESTE } from './pdf-teste';

export const PROVEDORES = {
  anthropic: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)',
  gemini: 'Gemini (Google)',
} as const;
export type Provedor = keyof typeof PROVEDORES;
export const LISTA_PROVEDORES = Object.keys(PROVEDORES) as Provedor[];

/** O que a tela recebe: nunca a chave, só o provedor e os 4 últimos caracteres. */
export type StatusIa =
  | { origem: 'configuracoes'; provedor: Provedor; nome: string; dica: string; modelo: string; atualizado_em: Date }
  | { origem: 'servidor'; provedor: 'anthropic'; nome: string; dica: null; modelo: string; atualizado_em: null }
  | { origem: null; provedor: null; nome: null; dica: null; modelo: null; atualizado_em: null };

/** Mensagens do teste ao salvar (a chave ainda não está salva, então "confira em Configurações" não cabe). */
function erroDoTeste(e: unknown, modelo: string): string {
  if (!(e instanceof LeituraPdfErro)) return MSG.indisponivel;
  switch (e.code) {
    case 'PDF_CHAVE_RECUSADA':
      return 'A IA recusou esta chave. Confira se copiou a chave inteira.';
    case 'PDF_MODELO':
      return `Esta chave não tem acesso ao modelo ${modelo}.`;
    case 'PDF_ILEGIVEL':
      return 'A chave funciona, mas a IA não conseguiu ler o PDF de teste. Tente a chave de outra IA.';
    default:
      return e.detalhe ? `${e.message} (${e.detalhe})` : e.message;
  }
}

/**
 * Chave de IA da empresa (Configurações → Leitura de PDF por IA): guarda cifrada na tabela `ia_chave` (uma linha) e escolhe o leitor
 * a cada leitura. Sem chave salva, vale a `ANTHROPIC_API_KEY` do servidor (como antes desta tela).
 */
@Injectable()
export class IaChaveService {
  private readonly logger = new Logger(IaChaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(HTTP_IA) private readonly http: HttpIa,
  ) {}

  private segredo(): string {
    return this.config.get<string>('IA_CHAVES_SECRET') || this.config.get<string>('JWT_SECRET') || '';
  }

  modelo(p: Provedor): string {
    if (p === 'openai') return this.config.get<string>('AI_PDF_MODEL_OPENAI') || 'gpt-5-mini';
    if (p === 'gemini') return this.config.get<string>('AI_PDF_MODEL_GEMINI') || 'gemini-flash-latest';
    return this.config.get<string>('AI_PDF_MODEL') || 'claude-opus-5-5';
  }

  leitor(p: Provedor, chave: string): LeitorPdf {
    if (p === 'openai') return new OpenAiLeitorPdf(chave, this.modelo(p), this.http);
    if (p === 'gemini') return new GeminiLeitorPdf(chave, this.modelo(p), this.http);
    return new ClaudeLeitorPdf(chave, this.modelo(p));
  }

  async status(): Promise<StatusIa> {
    const r = await this.prisma.ia_chave.findUnique({ where: { id: 1 } });
    if (r && LISTA_PROVEDORES.includes(r.provedor as Provedor)) {
      const p = r.provedor as Provedor;
      return { origem: 'configuracoes', provedor: p, nome: PROVEDORES[p], dica: r.dica, modelo: this.modelo(p), atualizado_em: r.atualizado_em };
    }
    if (this.config.get<string>('ANTHROPIC_API_KEY'))
      return { origem: 'servidor', provedor: 'anthropic', nome: PROVEDORES.anthropic, dica: null, modelo: this.modelo('anthropic'), atualizado_em: null };
    return { origem: null, provedor: null, nome: null, dica: null, modelo: null, atualizado_em: null };
  }

  /** A chave em uso: a da tela (decifrada) ou, sem ela, a do servidor. `null` = nenhuma. */
  async resolver(): Promise<{ provedor: Provedor; chave: string } | null> {
    const r = await this.prisma.ia_chave.findUnique({ where: { id: 1 } });
    if (r) {
      const chave = decifrar(r.chave_cifrada, this.segredo());
      if (!chave || !LISTA_PROVEDORES.includes(r.provedor as Provedor)) {
        this.logger.error('a chave de IA salva não pôde ser decifrada (o segredo do servidor mudou?)');
        throw new LeituraPdfErro(MSG.chaveIlegivel, 503, 'PDF_CHAVE_ILEGIVEL');
      }
      return { provedor: r.provedor as Provedor, chave };
    }
    const doServidor = this.config.get<string>('ANTHROPIC_API_KEY');
    return doServidor ? { provedor: 'anthropic', chave: doServidor } : null;
  }

  /** Leitura real de um PDF de 1 página com esquema, pelo mesmo leitor das notas. Lança `BadRequestException` com a frase de tela. */
  async testar(p: Provedor, chave: string): Promise<void> {
    let r: unknown;
    try {
      r = await this.leitor(p, chave).ler({
        arquivos: [{ base64: pdfDeTeste(), mime: 'application/pdf', nome: 'teste.pdf' }],
        instrucoes: 'Você lê PDFs e devolve exatamente o que está escrito neles.',
        pedido: 'Qual é o texto deste PDF e qual número de 4 dígitos aparece nele?',
        schema: SCHEMA_TESTE,
      });
    } catch (e) {
      throw new BadRequestException({ code: 'CHAVE_IA_INVALIDA', message: erroDoTeste(e, this.modelo(p)) });
    }
    if (!r || typeof r !== 'object' || typeof (r as { texto?: unknown }).texto !== 'string')
      throw new BadRequestException({ code: 'CHAVE_IA_INVALIDA', message: erroDoTeste(new LeituraPdfErro(MSG.ilegivel, 422, 'PDF_ILEGIVEL'), '') });
  }

  /** Testa e só então grava (chave recusada ou sem crédito não é salva). */
  async salvar(p: Provedor, chave: string, quem: string): Promise<StatusIa> {
    const limpa = chave.trim();
    await this.testar(p, limpa);
    const dados = { provedor: p, chave_cifrada: cifrar(limpa, this.segredo()), dica: dicaDa(limpa), atualizado_em: new Date(), atualizado_por: quem };
    await this.prisma.ia_chave.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
    this.logger.log(`chave de IA salva: ${p} ${dicaDa(limpa)}`);
    return this.status();
  }

  async remover(): Promise<StatusIa> {
    await this.prisma.ia_chave.deleteMany({ where: { id: 1 } });
    return this.status();
  }
}

/** O leitor da porta `LEITOR_PDF`: a cada leitura, usa a chave que estiver valendo naquele momento. */
export class LeitorPorIa implements LeitorPdf {
  constructor(private readonly chaves: IaChaveService) {}

  async ler(p: Parameters<LeitorPdf['ler']>[0]): Promise<unknown> {
    const c = await this.chaves.resolver();
    if (!c) throw new LeituraPdfErro(MSG.naoConfigurada, 503, 'PDF_NAO_CONFIGURADO');
    return this.chaves.leitor(c.provedor, c.chave).ler(p);
  }
}
