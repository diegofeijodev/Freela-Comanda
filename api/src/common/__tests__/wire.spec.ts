import { Prisma } from '@prisma/client';
import { toWire } from '../http/wire';
import { addDays, dayToDb, isDateString, monthRange, todaySp } from '../time/dates';
import { parseNum } from '../parse/numero';

describe('formato de fio (igual ao PostgREST do protótipo)', () => {
  it('numeric vira number, date vira AAAA-MM-DD, time vira HH:MM:SS, timestamp vira ISO', () => {
    const r = toWire({
      valor: new Prisma.Decimal('12.50'),
      data: new Date('2026-10-28T00:00:00Z'),
      vencimento: new Date('2026-11-30T00:00:00Z'),
      hora: new Date('1970-01-01T19:30:00Z'),
      created_at: new Date('2026-10-28T13:00:00Z'),
      n: BigInt(3),
      itens: [{ pago_em: new Date('2026-02-28T00:00:00Z') }],
    });
    expect(r).toEqual({
      valor: 12.5,
      data: '2026-10-28',
      vencimento: '2026-11-30',
      hora: '19:30:00',
      created_at: '2026-10-28T13:00:00.000Z',
      n: 3,
      itens: [{ pago_em: '2026-02-28' }],
    });
  });
});

describe('datas só-dia', () => {
  it('hoje em Brasília vira o dia certo depois das 21h', () => {
    expect(todaySp(new Date('2026-10-29T01:30:00Z'))).toBe('2026-10-28');
  });
  it('mês de 30 dias e fevereiro (bug do protótipo com -31)', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('valida data existente', () => {
    expect(isDateString('2026-02-31')).toBe(false);
    expect(isDateString('2026-12-31')).toBe(true);
  });
  it('dia para a coluna date e soma de dias', () => {
    expect(dayToDb('2026-10-28').toISOString()).toBe('2026-10-28T00:00:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('parseNum (mesma regra do protótipo)', () => {
  it('lê decimal com vírgula e milhar com ponto', () => {
    expect(parseNum('41,9')).toBe(41.9);
    expect(parseNum('1.234,56')).toBe(1234.56);
    expect(parseNum('1234.56')).toBe(1234.56);
  });
  it('vazio vira nulo (a cotar)', () => {
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
  });
});
