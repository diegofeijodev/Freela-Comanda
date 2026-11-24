import { empresaAtual } from '../../common/database/empresa-contexto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { dayToDb } from '../../common/time/dates';
import { diasEntre, instanteSp } from './calculo';
import type {
  AnularMarcacaoDto,
  AtualizarColaboradorDto,
  CorrigirMarcacaoDto,
  EscalaDto,
  JustificativaAdminDto,
  MarcacaoManualDto,
  NovaFolgaDto,
  NovoColaboradorDto,
  NovoTerminalDto,
  ResponderJustificativaDto,
} from './dto/ponto.dto';

const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** Nunca devolver o hash do PIN. */
const COLAB_SELECT = {
  id: true,
  nome: true,
  cpf: true,
  cargo: true,
  admissao: true,
  escala_id: true,
  empresa_id: true,
  ativo: true,
  created_at: true,
} satisfies Prisma.ponto_colaboradoresSelect;

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const soDigitos = (s: string | null | undefined) => (s ? s.replace(/\D/g, '') || null : null);
const regra = (message: string) => new BadRequestException({ code: 'REGRA', message });

/** Cadastros e ajustes do administrador: colaboradores, escalas, folgas, marcações manuais, justificativas e terminais. */
@Injectable()
export class PontoService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- escalas
  listarEscalas() {
    return this.prisma.ponto_escalas.findMany({
      orderBy: { nome: 'asc' },
      include: { dias: { orderBy: { dia_semana: 'asc' } }, _count: { select: { colaboradores: true } } },
    });
  }

  async criarEscala(dto: EscalaDto) {
    const dias = this.validarDias(dto);
    return this.prisma.ponto_escalas.create({
      data: { nome: dto.nome.trim(), tolerancia_min: dto.tolerancia_min ?? 10, ativo: dto.ativo ?? true, dias: { create: dias } },
      include: { dias: true },
    });
  }

  async atualizarEscala(id: string, dto: EscalaDto) {
    await this.escalaExiste(id);
    const dias = this.validarDias(dto);
    return this.prisma.$transaction(async (tx) => {
      await tx.ponto_escala_dias.deleteMany({ where: { escala_id: id } });
      return tx.ponto_escalas.update({
        where: { id },
        data: { nome: dto.nome.trim(), tolerancia_min: dto.tolerancia_min ?? 10, ativo: dto.ativo ?? true, dias: { create: dias } },
        include: { dias: true },
      });
    });
  }

  async excluirEscala(id: string) {
    await this.escalaExiste(id);
    const usando = await this.prisma.ponto_colaboradores.count({ where: { escala_id: id } });
    if (usando > 0) throw new ConflictException({ code: 'EM_USO', message: 'Há colaboradores nesta escala. Troque a escala deles antes de excluir.' });
    await this.prisma.ponto_escalas.delete({ where: { id } });
    return { ok: true };
  }

  private validarDias(dto: EscalaDto) {
    const vistos = new Set<number>();
    const dias = dto.dias.map((d) => {
      if (vistos.has(d.dia_semana)) throw regra(`O dia ${NOMES_DIA[d.dia_semana]} aparece duas vezes`);
      vistos.add(d.dia_semana);
      if (d.folga) return { dia_semana: d.dia_semana, folga: true, entrada: null, saida: null, intervalo_min: 0 };
      if (!d.entrada || !d.saida) throw regra(`Preencha entrada e saída de ${NOMES_DIA[d.dia_semana]}`);
      if (d.entrada === d.saida) throw regra(`Entrada e saída de ${NOMES_DIA[d.dia_semana]} não podem ser iguais`);
      return { dia_semana: d.dia_semana, folga: false, entrada: d.entrada, saida: d.saida, intervalo_min: d.intervalo_min ?? 0 };
    });
    // Dia ausente = folga (a tela sempre manda os 7).
    for (let i = 0; i < 7; i++) if (!vistos.has(i)) dias.push({ dia_semana: i, folga: true, entrada: null, saida: null, intervalo_min: 0 });
    return dias;
  }

  private async escalaExiste(id: string) {
    const e = await this.prisma.ponto_escalas.findUnique({ where: { id }, select: { id: true } });
    if (!e) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Escala não encontrada' });
  }

  // ---------- colaboradores
  listarColaboradores() {
    return this.prisma.ponto_colaboradores.findMany({ orderBy: [{ ativo: 'desc' }, { nome: 'asc' }], select: COLAB_SELECT });
  }

  async criarColaborador(dto: NovoColaboradorDto) {
    if (dto.escala_id) await this.escalaExiste(dto.escala_id);
    if (dto.empresa_id) await this.empresaExiste(dto.empresa_id);
    try {
      return await this.prisma.ponto_colaboradores.create({
        data: {
          nome: dto.nome.trim(),
          cpf: soDigitos(dto.cpf),
          cargo: dto.cargo?.trim() || null,
          admissao: dto.admissao ? dayToDb(dto.admissao) : null,
          escala_id: dto.escala_id ?? null,
          empresa_id: dto.empresa_id ?? null,
          pin_hash: await bcrypt.hash(dto.pin, 10),
        },
        select: COLAB_SELECT,
      });
    } catch (e) {
      throw this.cpfRepetido(e);
    }
  }

  async atualizarColaborador(id: string, dto: AtualizarColaboradorDto) {
    const atual = await this.colaboradorExiste(id);
    if (dto.escala_id) await this.escalaExiste(dto.escala_id);
    if (dto.empresa_id && dto.empresa_id !== atual.empresa_id) await this.empresaExiste(dto.empresa_id);
    const data: Prisma.ponto_colaboradoresUncheckedUpdateInput = {};
    if (dto.nome !== undefined) data.nome = dto.nome.trim();
    if (dto.cpf !== undefined) data.cpf = soDigitos(dto.cpf);
    if (dto.cargo !== undefined) data.cargo = dto.cargo?.trim() || null;
    if (dto.admissao !== undefined) data.admissao = dto.admissao ? dayToDb(dto.admissao) : null;
    if (dto.escala_id !== undefined) data.escala_id = dto.escala_id;
    if (dto.empresa_id !== undefined) data.empresa_id = dto.empresa_id;
    if (dto.ativo !== undefined) data.ativo = dto.ativo;
    if (dto.pin) data.pin_hash = await bcrypt.hash(dto.pin, 10);
    try {
      return await this.prisma.ponto_colaboradores.update({ where: { id }, data, select: COLAB_SELECT });
    } catch (e) {
      throw this.cpfRepetido(e);
    }
  }

  async excluirColaborador(id: string) {
    await this.colaboradorExiste(id);
    const marcas = await this.prisma.ponto_marcacoes.count({ where: { colaborador_id: id } });
    if (marcas > 0) throw new ConflictException({ code: 'EM_USO', message: 'Colaborador com marcações de ponto não pode ser excluído. Desative o cadastro.' });
    await this.prisma.ponto_colaboradores.delete({ where: { id } });
    return { ok: true };
  }

  private cpfRepetido(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      return new ConflictException({ code: 'DUPLICADO', message: 'Já existe colaborador com este CPF' });
    return e;
  }

  /** Multiempresa: o empregador é a própria empresa da requisição (no schema `public` o cadastro tem as outras também). */
  private async empresaExiste(id: string) {
    const daRequisicao = empresaAtual().empresaId;
    const e = daRequisicao && id !== daRequisicao ? null : await this.prisma.empresas.findUnique({ where: { id }, select: { id: true } });
    if (!e) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Empresa não encontrada' });
  }

  private async colaboradorExiste(id: string) {
    const c = await this.prisma.ponto_colaboradores.findUnique({ where: { id }, select: { id: true, empresa_id: true } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Colaborador não encontrado' });
    return c;
  }

  // ---------- folgas / feriados
  listarFolgas(ini: string, fim: string) {
    return this.prisma.ponto_folgas.findMany({
      where: { data: { gte: dayToDb(ini), lte: dayToDb(fim) } },
      orderBy: [{ data: 'asc' }],
      include: { colaborador: { select: { nome: true } } },
    });
  }

  async criarFolga(dto: NovaFolgaDto) {
    if (dto.colaborador_id) await this.colaboradorExiste(dto.colaborador_id);
    if (!dto.colaborador_id && dto.tipo !== 'feriado') throw regra('Escolha o colaborador (sem colaborador, só feriado)');
    const ate = dto.ate ?? dto.data;
    if (ate < dto.data) throw regra('A data final é antes da inicial');
    const dias = diasEntre(dto.data, ate);
    if (dias.length > 60) throw regra('No máximo 60 dias por lançamento');
    const r = await this.prisma.ponto_folgas.createMany({
      data: dias.map((d) => ({ colaborador_id: dto.colaborador_id ?? null, data: dayToDb(d), tipo: dto.tipo, observacao: dto.observacao?.trim() || null })),
      skipDuplicates: true,
    });
    return { criadas: r.count, ja_existiam: dias.length - r.count };
  }

  async excluirFolga(id: string) {
    const f = await this.prisma.ponto_folgas.findUnique({ where: { id }, select: { id: true } });
    if (!f) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Folga não encontrada' });
    await this.prisma.ponto_folgas.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- marcações (inclui as anuladas, para a auditoria)
  listarMarcacoes(colaboradorId: string, ini: string, fim: string) {
    return this.prisma.ponto_marcacoes.findMany({
      where: { colaborador_id: colaboradorId, data: { gte: dayToDb(ini), lte: dayToDb(fim) } },
      orderBy: [{ data: 'asc' }, { momento: 'asc' }],
      include: { terminal: { select: { nome: true } } },
    });
  }

  async marcacaoManual(dto: MarcacaoManualDto, userId: string) {
    await this.colaboradorExiste(dto.colaborador_id);
    const momento = instanteSp(dto.data, dto.hora, dto.dia_seguinte ? 1 : 0);
    if (momento.getTime() > Date.now()) throw regra('Não dá para lançar marcação no futuro');
    return this.prisma.ponto_marcacoes.create({
      data: {
        colaborador_id: dto.colaborador_id,
        data: dayToDb(dto.data),
        momento,
        tipo: dto.tipo,
        origem: 'manual',
        motivo: dto.motivo.trim(),
        criado_por: userId,
      },
    });
  }

  /** Correção = anula a original (com o motivo) e cria a manual que a substitui. A original nunca some. */
  async corrigirMarcacao(id: string, dto: CorrigirMarcacaoDto, userId: string) {
    const m = await this.marcacaoValida(id);
    const data = m.data.toISOString().slice(0, 10);
    const momento = instanteSp(data, dto.hora, dto.dia_seguinte ? 1 : 0);
    if (momento.getTime() > Date.now()) throw regra('Não dá para lançar marcação no futuro');
    const motivo = dto.motivo.trim();
    return this.prisma.$transaction(async (tx) => {
      await tx.ponto_marcacoes.update({
        where: { id },
        data: { anulada: true, anulada_motivo: `Corrigida: ${motivo}`, anulada_em: new Date(), anulada_por: userId },
      });
      return tx.ponto_marcacoes.create({
        data: { colaborador_id: m.colaborador_id, data: m.data, momento, tipo: dto.tipo, origem: 'manual', motivo, substitui_id: id, criado_por: userId },
      });
    });
  }

  async anularMarcacao(id: string, dto: AnularMarcacaoDto, userId: string) {
    await this.marcacaoValida(id);
    return this.prisma.ponto_marcacoes.update({
      where: { id },
      data: { anulada: true, anulada_motivo: dto.motivo.trim(), anulada_em: new Date(), anulada_por: userId },
    });
  }

  private async marcacaoValida(id: string) {
    const m = await this.prisma.ponto_marcacoes.findUnique({ where: { id } });
    if (!m) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Marcação não encontrada' });
    if (m.anulada) throw new ConflictException({ code: 'ANULADA', message: 'Esta marcação já foi anulada' });
    return m;
  }

  // ---------- justificativas
  listarJustificativas(status?: string) {
    return this.prisma.ponto_justificativas.findMany({
      where: status ? { status } : {},
      orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
      take: 500,
      include: { colaborador: { select: { nome: true } } },
    });
  }

  /** O admin registra (já aceita) a justificativa — atestado entregue no balcão, por exemplo. */
  async justificarPeloAdmin(dto: JustificativaAdminDto, userId: string) {
    await this.colaboradorExiste(dto.colaborador_id);
    const dados = {
      texto: dto.texto.trim(),
      status: 'aceita',
      abonar: dto.abonar ?? false,
      resposta: 'Lançada pelo administrador',
      respondida_por: userId,
      respondida_em: new Date(),
    };
    return this.prisma.ponto_justificativas.upsert({
      where: { colaborador_id_data_tipo: { colaborador_id: dto.colaborador_id, data: dayToDb(dto.data), tipo: dto.tipo } },
      create: { colaborador_id: dto.colaborador_id, data: dayToDb(dto.data), tipo: dto.tipo, ...dados },
      update: dados,
    });
  }

  async responderJustificativa(id: string, dto: ResponderJustificativaDto, userId: string) {
    const j = await this.prisma.ponto_justificativas.findUnique({ where: { id }, select: { id: true } });
    if (!j) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Justificativa não encontrada' });
    return this.prisma.ponto_justificativas.update({
      where: { id },
      data: {
        status: dto.aceita ? 'aceita' : 'recusada',
        abonar: dto.aceita ? (dto.abonar ?? false) : false,
        resposta: dto.resposta?.trim() || null,
        respondida_por: userId,
        respondida_em: new Date(),
      },
    });
  }

  // ---------- terminais (computadores liberados para bater ponto)
  listarTerminais() {
    return this.prisma.ponto_terminais.findMany({
      orderBy: [{ ativo: 'desc' }, { created_at: 'desc' }],
      select: { id: true, nome: true, ativo: true, ultimo_uso: true, created_at: true },
    });
  }

  /** O token só sai aqui, uma vez: a tela grava no navegador deste computador. O banco guarda só o SHA-256. */
  async criarTerminal(dto: NovoTerminalDto, userId: string) {
    const token = randomBytes(32).toString('base64url');
    const t = await this.prisma.ponto_terminais.create({
      data: { nome: dto.nome.trim(), token_hash: hashToken(token), criado_por: userId },
      select: { id: true, nome: true, ativo: true, ultimo_uso: true, created_at: true },
    });
    return { ...t, token };
  }

  async revogarTerminal(id: string) {
    const t = await this.prisma.ponto_terminais.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Terminal não encontrado' });
    await this.prisma.ponto_terminais.update({ where: { id }, data: { ativo: false } });
    return { ok: true };
  }
}
