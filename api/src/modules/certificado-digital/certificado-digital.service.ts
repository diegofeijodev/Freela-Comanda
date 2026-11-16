import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { cifrar, decifrar } from '../../common/cripto/cripto';
import { PrismaService } from '../../common/database/prisma.service';
import { CADEIA_ICP, type CadeiaIcp } from './cadeia';
import { compararCnpj } from './cnpj';
import { conferirCertificado } from './conferencia';
import { CertificadoRecusado, MSG_CERTIFICADO } from './mensagens';
import { type CertificadoStatus, diasRestantes, type ItemHistorico, situacaoDe } from './situacao';

/** Rótulo do HKDF do certificado: NÃO mudar (um certificado já gravado deixaria de abrir). */
export const ROTULO_CERTIFICADO = 'erp-freela/certificado-a1/v1';

const HISTORICO_MAX = 5;
type Quem = { id: string; nome: string };

/**
 * Certificado digital A1 da empresa (Configurações → Certificado digital): confere o .pfx, guarda chave + certificado + cadeia
 * CIFRADOS na tabela `certificado_digital` (uma linha) e registra quem fez o quê. A senha e o arquivo original não são gravados.
 */
@Injectable()
export class CertificadoDigitalService {
  private readonly logger = new Logger(CertificadoDigitalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(CADEIA_ICP) private readonly icp: CadeiaIcp,
  ) {}

  private segredo(): string {
    return this.config.get<string>('CERTIFICADO_SECRET') || '';
  }

  private async cnpjDaEmpresa(): Promise<string> {
    const c = await this.prisma.configuracoes.findUnique({ where: { id: 1 }, select: { cnpj: true } });
    return c?.cnpj ?? '';
  }

  /** O GET decifra só para classificar `ilegivel`; o conteúdo nunca sai daqui. */
  private legivel(material: string): boolean {
    const texto = decifrar(material, this.segredo(), ROTULO_CERTIFICADO);
    if (texto === null) return false;
    try {
      const m = JSON.parse(texto) as { chave_pkcs8_pem?: unknown; certificado_pem?: unknown; cadeia_pem?: unknown };
      return typeof m.chave_pkcs8_pem === 'string' && typeof m.certificado_pem === 'string' && Array.isArray(m.cadeia_pem);
    } catch {
      return false;
    }
  }

  async status(agora: Date = new Date()): Promise<CertificadoStatus> {
    const temSegredo = this.segredo().length > 0;
    const [linha, cnpjEmpresa, hist] = await Promise.all([
      this.prisma.certificado_digital.findUnique({ where: { id: 1 } }),
      this.cnpjDaEmpresa(),
      this.prisma.certificado_digital_historico.findMany({ orderBy: { feito_em: 'desc' }, take: HISTORICO_MAX }),
    ]);
    const historico: ItemHistorico[] = hist.map((h) => ({
      evento: h.evento as ItemHistorico['evento'],
      feito_por_nome: h.feito_por_nome,
      feito_em: h.feito_em,
      valido_ate: h.valido_ate,
      cnpj: h.cnpj,
      titular: h.titular,
    }));
    const situacao = situacaoDe({
      temLinha: !!linha,
      temSegredo,
      legivel: !!linha && temSegredo && this.legivel(linha.material_cifrado),
      validoAte: linha?.valido_ate ?? null,
      agora,
    });
    if (!linha) {
      return {
        situacao, titular: null, cnpj: null, cnpj_confere: null, tipo: null, politica_oid: null, emissor: null, valido_de: null,
        valido_ate: null, dias_restantes: null, cadeia_conferida: null, enviado_em: null, enviado_por_nome: null, historico,
      };
    }
    return {
      situacao,
      titular: linha.titular,
      cnpj: linha.cnpj,
      cnpj_confere: compararCnpj(linha.cnpj, cnpjEmpresa),
      tipo: linha.tipo as CertificadoStatus['tipo'],
      politica_oid: linha.politica_oid,
      emissor: linha.emissor,
      valido_de: linha.valido_de,
      valido_ate: linha.valido_ate,
      dias_restantes: diasRestantes(linha.valido_ate, agora),
      cadeia_conferida: linha.cadeia_conferida,
      enviado_em: linha.enviado_em,
      enviado_por_nome: linha.enviado_por_nome,
      historico,
    };
  }

  /** Ordem: segredo → decodificar → conferir tudo → envelope → transação (troca + histórico). Falhou = nada muda. */
  async enviar(arquivoBase64: string, senha: string, quem: Quem, agora: Date = new Date()): Promise<CertificadoStatus> {
    const segredo = this.segredo();
    if (!segredo) {
      throw new ServiceUnavailableException({ code: 'CERTIFICADO_SEM_SEGREDO', message: MSG_CERTIFICADO.semSegredo });
    }
    const arquivo = this.decodificar(arquivoBase64);
    const cnpjEmpresa = await this.cnpjDaEmpresa();

    let c: ReturnType<typeof conferirCertificado>;
    try {
      c = conferirCertificado({ arquivo, senha, cnpjEmpresa, agora, icp: this.icp });
    } catch (e) {
      // Nunca repassa `e.message` de biblioteca (pode carregar a senha ou trecho do arquivo): só o code da tabela.
      if (e instanceof CertificadoRecusado) {
        this.logger.warn(`certificado recusado: ${e.code}`);
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      this.logger.warn('certificado recusado: CERTIFICADO_FORMATO');
      throw new BadRequestException({ code: 'CERTIFICADO_FORMATO', message: MSG_CERTIFICADO.formato });
    }

    const material = cifrar(
      JSON.stringify({
        chave_pkcs8_pem: c.chave.export({ type: 'pkcs8', format: 'pem' }) as string,
        certificado_pem: c.folha.toString(),
        cadeia_pem: c.cadeia.map((x) => x.toString()),
      }),
      segredo,
      ROTULO_CERTIFICADO,
    );
    const dados = {
      material_cifrado: material,
      titular: c.titular,
      cnpj: c.cnpj,
      tipo: c.tipo,
      politica_oid: c.politicaOid,
      emissor: c.emissor,
      numero_serie: c.numeroSerie,
      impressao_digital: c.impressaoDigital,
      valido_de: c.validoDe,
      valido_ate: c.validoAte,
      cadeia_conferida: c.cadeiaConferida,
      enviado_em: agora,
      enviado_por: quem.id,
      enviado_por_nome: quem.nome,
    };
    const evento = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const antes = await tx.certificado_digital.findUnique({ where: { id: 1 } });
      await tx.certificado_digital.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
      const ev = antes ? 'substituido' : 'enviado';
      await tx.certificado_digital_historico.create({
        data: {
          evento: ev,
          cnpj: c.cnpj,
          titular: c.titular,
          numero_serie: c.numeroSerie,
          impressao_digital: c.impressaoDigital,
          valido_ate: c.validoAte,
          feito_por: quem.id,
          feito_por_nome: quem.nome,
          feito_em: agora,
        },
      });
      return ev;
    });
    this.logger.log(`certificado ${evento}: ${c.impressaoDigital} por ${quem.id}`);
    return this.status(agora);
  }

  async remover(quem: Quem, agora: Date = new Date()): Promise<CertificadoStatus> {
    const removido = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const antes = await tx.certificado_digital.findUnique({ where: { id: 1 } });
      if (!antes) return null;
      await tx.certificado_digital.deleteMany({ where: { id: 1 } });
      await tx.certificado_digital_historico.create({
        data: {
          evento: 'removido',
          cnpj: antes.cnpj,
          titular: antes.titular,
          numero_serie: antes.numero_serie,
          impressao_digital: antes.impressao_digital,
          valido_ate: antes.valido_ate,
          feito_por: quem.id,
          feito_por_nome: quem.nome,
          feito_em: agora,
        },
      });
      return antes.impressao_digital;
    });
    if (removido) this.logger.log(`certificado removido: ${removido} por ${quem.id}`);
    return this.status(agora);
  }

  /** base64 estrito (nada de data URL nem texto solto); vazio ou inválido = "não parece um certificado". */
  private decodificar(b64: string): Buffer {
    const limpo = b64.replace(/\s+/g, '');
    if (!limpo || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) {
      throw new BadRequestException({ code: 'CERTIFICADO_ARQUIVO', message: MSG_CERTIFICADO.arquivo });
    }
    return Buffer.from(limpo, 'base64');
  }
}
