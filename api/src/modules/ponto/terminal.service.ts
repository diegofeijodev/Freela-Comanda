import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/database/prisma.service';
import { addDays, dateToString, dayToDb, todaySp } from '../../common/time/dates';
import { horaSpHHMM, proximosTipos, type TipoMarcacao, type TipoOcorrencia } from './calculo';
import type { IdentificarDto, JustificarDto, MarcarDto } from './dto/ponto.dto';
import { EspelhoService } from './espelho.service';
import { hashToken } from './ponto.service';

export const TERMINAL_HEADER = 'x-ponto-terminal';
const MSG_TERMINAL = 'Este computador não está liberado para bater ponto. Peça ao administrador para liberar em Ponto → Terminais.';
const JANELA_JORNADA_MS = 16 * 60 * 60_000; // turno aberto há menos de 16 h continua no dia em que começou
const INTERVALO_MINIMO_MS = 60_000; // duas batidas no mesmo minuto = clique repetido
const DIAS_JUSTIFICAR = 45;
const MAX_ERROS_PIN = 5;
const BLOQUEIO_PIN_MS = 5 * 60_000;

/** Batida de ponto no computador da loja: exige o token do terminal (cabeçalho X-Ponto-Terminal) e o PIN do colaborador. */
@Injectable()
export class TerminalService {
  /** Erros de PIN por colaborador (memória do processo; reinício zera — o throttle da rota segura o resto). */
  private readonly erros = new Map<string, { n: number; ate: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly espelho: EspelhoService,
  ) {}

  async validarTerminal(token: string | undefined) {
    if (!token || token.length < 20 || token.length > 200) throw new ForbiddenException({ code: 'TERMINAL_NAO_AUTORIZADO', message: MSG_TERMINAL });
    const t = await this.prisma.ponto_terminais.findUnique({ where: { token_hash: hashToken(token) }, select: { id: true, nome: true, ativo: true } });
    if (!t || !t.ativo) throw new ForbiddenException({ code: 'TERMINAL_NAO_AUTORIZADO', message: MSG_TERMINAL });
    await this.prisma.ponto_terminais.update({ where: { id: t.id }, data: { ultimo_uso: new Date() } });
    return t;
  }

  /** Só nome e id dos ativos: a loja escolhe quem vai bater. */
  async inicio(token: string | undefined) {
    const t = await this.validarTerminal(token);
    const colaboradores = await this.prisma.ponto_colaboradores.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } });
    return { terminal: t.nome, agora: new Date().toISOString(), colaboradores };
  }

  async identificar(token: string | undefined, dto: IdentificarDto, agora = new Date()) {
    await this.validarTerminal(token);
    const c = await this.conferirPin(dto.colaborador_id, dto.pin);
    return this.situacao(c.id, c.nome, agora);
  }

  async marcar(token: string | undefined, dto: MarcarDto, agora = new Date()) {
    const t = await this.validarTerminal(token);
    const c = await this.conferirPin(dto.colaborador_id, dto.pin);

    const marcacao = await this.prisma.$transaction(async (tx) => {
      // Uma batida por vez por colaborador (dois cliques simultâneos não viram duas entradas).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.id}))`;
      const data = await this.dataDaJornada(tx, c.id, agora);
      const doDia = await tx.ponto_marcacoes.findMany({
        where: { colaborador_id: c.id, data: dayToDb(data), anulada: false },
        orderBy: { momento: 'asc' },
        select: { tipo: true, momento: true },
      });
      const ultima = doDia[doDia.length - 1];
      if (ultima && agora.getTime() - ultima.momento.getTime() < INTERVALO_MINIMO_MS)
        throw new ConflictException({ code: 'REPETIDA', message: `Você acabou de registrar ${rotulo(ultima.tipo as TipoMarcacao)}. Aguarde um minuto.` });
      const permitidos = proximosTipos(doDia.map((m) => m.tipo as TipoMarcacao));
      if (!permitidos.includes(dto.tipo))
        throw new BadRequestException({ code: 'REGRA', message: `A próxima marcação é ${permitidos.map(rotulo).join(' ou ')}` });
      return tx.ponto_marcacoes.create({
        data: { colaborador_id: c.id, data: dayToDb(data), momento: agora, tipo: dto.tipo, origem: 'terminal', terminal_id: t.id },
      });
    });

    // Ocorrência desta batida (atraso na entrada, saída antes da hora) — a tela pede a justificativa na hora.
    const data = dateToString(marcacao.data);
    const esp = await this.espelho.espelho(c.id, data, data, agora);
    const dia = esp.dias[0]!;
    const tipoOc: TipoOcorrencia | null =
      dto.tipo === 'entrada' && dia.marcacoes.length === 1 ? 'atraso' : dto.tipo === 'saida' ? 'saida_antecipada' : null;
    const oc = tipoOc ? dia.ocorrencias.find((o) => o.tipo === tipoOc && o.justificativa === null) : undefined;
    return {
      marcacao: { id: marcacao.id, data, tipo: marcacao.tipo, hora: horaSpHHMM(marcacao.momento) },
      ocorrencia: oc ? { data, tipo: oc.tipo, minutos: oc.minutos } : null,
      situacao: await this.situacao(c.id, c.nome, agora),
    };
  }

  async justificar(token: string | undefined, dto: JustificarDto, agora = new Date()) {
    await this.validarTerminal(token);
    const c = await this.conferirPin(dto.colaborador_id, dto.pin);
    const hoje = todaySp(agora);
    if (dto.data > hoje) throw new BadRequestException({ code: 'REGRA', message: 'Não dá para justificar um dia que ainda não chegou' });
    if (dto.data < addDays(hoje, -DIAS_JUSTIFICAR))
      throw new BadRequestException({ code: 'REGRA', message: `Só dá para justificar os últimos ${DIAS_JUSTIFICAR} dias. Fale com o administrador.` });
    const chave = { colaborador_id_data_tipo: { colaborador_id: c.id, data: dayToDb(dto.data), tipo: dto.tipo } };
    const existente = await this.prisma.ponto_justificativas.findUnique({ where: chave, select: { status: true } });
    if (existente?.status === 'aceita') throw new ConflictException({ code: 'JA_ACEITA', message: 'Essa justificativa já foi aceita pelo administrador' });
    const texto = dto.texto.trim();
    await this.prisma.ponto_justificativas.upsert({
      where: chave,
      create: { colaborador_id: c.id, data: dayToDb(dto.data), tipo: dto.tipo, texto },
      update: { texto, status: 'pendente', abonar: false, resposta: null, respondida_por: null, respondida_em: null },
    });
    return this.situacao(c.id, c.nome, agora);
  }

  /** O que a tela do terminal mostra depois do PIN: batidas do dia, próximas opções e o que falta justificar. */
  private async situacao(colaboradorId: string, nome: string, agora: Date) {
    const hoje = todaySp(agora);
    const data = await this.dataDaJornada(this.prisma, colaboradorId, agora);
    const esp = await this.espelho.espelho(colaboradorId, addDays(hoje, -DIAS_JUSTIFICAR), hoje, agora);
    const dia = esp.dias.find((d) => d.data === data);
    const tipos = (dia?.marcacoes ?? []).map((m) => m.tipo);
    const pendencias = esp.dias.flatMap((d) =>
      d.ocorrencias.filter((o) => o.justificativa === null || o.justificativa === 'recusada').map((o) => ({ data: d.data, ...o })),
    );
    return {
      colaborador: { id: colaboradorId, nome },
      data,
      previsto: dia?.previsto ?? null,
      marcacoes: (dia?.marcacoes ?? []).map((m) => ({ tipo: m.tipo, hora: horaSpHHMM(new Date(m.momento)) })),
      proximos: proximosTipos(tipos),
      pendencias: pendencias.reverse(),
    };
  }

  /** Dia da jornada: se a última batida (há menos de 16 h) deixou o dia dela aberto, a batida vai para aquele dia. */
  private async dataDaJornada(db: Pick<PrismaService, 'ponto_marcacoes'>, colaboradorId: string, agora: Date): Promise<string> {
    const hoje = todaySp(agora);
    const ultima = await db.ponto_marcacoes.findFirst({
      where: { colaborador_id: colaboradorId, anulada: false, momento: { gte: new Date(agora.getTime() - JANELA_JORNADA_MS), lte: agora } },
      orderBy: { momento: 'desc' },
      select: { data: true },
    });
    if (!ultima) return hoje;
    const data = dateToString(ultima.data);
    if (data === hoje) return hoje;
    const n = await db.ponto_marcacoes.count({ where: { colaborador_id: colaboradorId, anulada: false, data: ultima.data } });
    return n % 2 === 1 ? data : hoje;
  }

  private async conferirPin(colaboradorId: string, pin: string) {
    const agora = Date.now();
    const e = this.erros.get(colaboradorId);
    if (e && e.ate > agora)
      throw new HttpException({ code: 'PIN_BLOQUEADO', message: 'Muitas tentativas erradas. Tente de novo em alguns minutos.' }, HttpStatus.TOO_MANY_REQUESTS);
    const c = await this.prisma.ponto_colaboradores.findUnique({ where: { id: colaboradorId }, select: { id: true, nome: true, pin_hash: true, ativo: true } });
    const ok = !!c && c.ativo && (await bcrypt.compare(pin, c.pin_hash));
    if (!ok || !c) {
      const n = (e && e.ate <= agora && e.n >= MAX_ERROS_PIN ? 0 : (e?.n ?? 0)) + 1;
      this.erros.set(colaboradorId, { n, ate: n >= MAX_ERROS_PIN ? agora + BLOQUEIO_PIN_MS : 0 });
      // 400, não 401: o 401 derruba a sessão da loja no navegador.
      throw new BadRequestException({ code: 'PIN_INCORRETO', message: 'PIN incorreto' });
    }
    this.erros.delete(colaboradorId);
    return c;
  }
}

function rotulo(t: TipoMarcacao): string {
  return { entrada: 'entrada', intervalo_inicio: 'início do intervalo', intervalo_fim: 'volta do intervalo', saida: 'saída' }[t];
}
