import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { dateToString, dayToDb, todaySp } from '../../common/time/dates';
import {
  calcularDia,
  diasEntre,
  totalizar,
  type DiaCalculado,
  type EscalaCalc,
  type StatusJustificativa,
  type TipoFolga,
  type TipoMarcacao,
  type TipoOcorrencia,
  type TotaisPeriodo,
} from './calculo';

export interface Espelho {
  colaborador: { id: string; nome: string; cpf: string | null; cargo: string | null; escala: string | null; ativo: boolean };
  ini: string;
  fim: string;
  dias: DiaCalculado[];
  totais: TotaisPeriodo;
}

/** Junta escala, folgas, marcações válidas e justificativas e passa para o cálculo puro. */
@Injectable()
export class EspelhoService {
  constructor(private readonly prisma: PrismaService) {}

  async espelho(colaboradorId: string, ini: string, fim: string, agora = new Date()): Promise<Espelho> {
    const c = await this.prisma.ponto_colaboradores.findUnique({
      where: { id: colaboradorId },
      include: { escala: { include: { dias: true } } },
    });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Colaborador não encontrado' });
    const [folgas, marcacoes, justificativas] = await Promise.all([
      this.prisma.ponto_folgas.findMany({
        where: { data: { gte: dayToDb(ini), lte: dayToDb(fim) }, OR: [{ colaborador_id: colaboradorId }, { colaborador_id: null }] },
      }),
      this.prisma.ponto_marcacoes.findMany({
        where: { colaborador_id: colaboradorId, anulada: false, data: { gte: dayToDb(ini), lte: dayToDb(fim) } },
        orderBy: { momento: 'asc' },
      }),
      this.prisma.ponto_justificativas.findMany({
        where: { colaborador_id: colaboradorId, data: { gte: dayToDb(ini), lte: dayToDb(fim) } },
      }),
    ]);

    const escala: EscalaCalc | null = c.escala
      ? {
          tolerancia_min: c.escala.tolerancia_min,
          dias: Object.fromEntries(
            c.escala.dias.map((d) => [d.dia_semana, { folga: d.folga, entrada: d.entrada, saida: d.saida, intervalo_min: d.intervalo_min }]),
          ),
        }
      : null;

    // Folga do próprio colaborador vale sobre o feriado geral.
    const folgaDia = new Map<string, TipoFolga>();
    for (const f of folgas.filter((x) => x.colaborador_id === null)) folgaDia.set(dateToString(f.data), f.tipo as TipoFolga);
    for (const f of folgas.filter((x) => x.colaborador_id !== null)) folgaDia.set(dateToString(f.data), f.tipo as TipoFolga);

    const hoje = todaySp(agora);
    const admissao = c.admissao ? dateToString(c.admissao) : null;
    const dias = diasEntre(ini, fim).map((data) =>
      calcularDia({
        data,
        hoje,
        agora,
        escala,
        admissao,
        folga: folgaDia.get(data) ?? null,
        marcacoes: marcacoes.filter((m) => dateToString(m.data) === data).map((m) => ({ momento: m.momento, tipo: m.tipo as TipoMarcacao })),
        justificativas: justificativas
          .filter((j) => dateToString(j.data) === data)
          .map((j) => ({ tipo: j.tipo as TipoOcorrencia, status: j.status as StatusJustificativa, abonar: j.abonar })),
      }),
    );

    return {
      colaborador: { id: c.id, nome: c.nome, cpf: c.cpf, cargo: c.cargo, escala: c.escala?.nome ?? null, ativo: c.ativo },
      ini,
      fim,
      dias,
      totais: totalizar(dias),
    };
  }

  /** Resumo do período de todos (ativos, ou que tenham marcação no período). Para a tela de fechamento e a exportação geral. */
  async geral(ini: string, fim: string, agora = new Date()) {
    const comMarca = await this.prisma.ponto_marcacoes.findMany({
      where: { anulada: false, data: { gte: dayToDb(ini), lte: dayToDb(fim) } },
      distinct: ['colaborador_id'],
      select: { colaborador_id: true },
    });
    const colaboradores = await this.prisma.ponto_colaboradores.findMany({
      where: { OR: [{ ativo: true }, { id: { in: comMarca.map((m) => m.colaborador_id) } }] },
      orderBy: { nome: 'asc' },
      select: { id: true },
    });
    const out: Espelho[] = [];
    for (const c of colaboradores) out.push(await this.espelho(c.id, ini, fim, agora));
    return out;
  }
}
