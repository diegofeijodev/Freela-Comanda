import { diasRestantes, situacaoDe } from '../situacao';

const AGORA = new Date('2027-06-01T12:00:00Z');
const base = { temLinha: true, temSegredo: true, legivel: true, validoAte: new Date('2030-01-01T00:00:00Z'), agora: AGORA };

describe('situacaoDe (precedência)', () => {
  it('sem segredo vence tudo, com ou sem linha', () => {
    expect(situacaoDe({ ...base, temSegredo: false })).toBe('sem_segredo');
    expect(situacaoDe({ ...base, temSegredo: false, temLinha: false, validoAte: null })).toBe('sem_segredo');
  });
  it('sem linha e com segredo = ausente', () => {
    expect(situacaoDe({ ...base, temLinha: false, validoAte: null })).toBe('ausente');
  });
  it('ilegível vence vencido', () => {
    expect(situacaoDe({ ...base, legivel: false, validoAte: new Date('2020-01-01T00:00:00Z') })).toBe('ilegivel');
  });
  it('vencido vence vencendo; vencendo até 30 dias; senão válido', () => {
    expect(situacaoDe({ ...base, validoAte: new Date('2027-05-31T00:00:00Z') })).toBe('vencido');
    expect(situacaoDe({ ...base, validoAte: AGORA })).toBe('vencido');
    expect(situacaoDe({ ...base, validoAte: new Date('2027-06-10T12:00:00Z') })).toBe('vencendo');
    expect(situacaoDe({ ...base, validoAte: new Date('2027-07-01T12:00:00Z') })).toBe('vencendo'); // 30 dias
    expect(situacaoDe({ ...base, validoAte: new Date('2027-07-02T12:00:00Z') })).toBe('valido'); // 31 dias
  });
});

describe('diasRestantes (dias civis de São Paulo)', () => {
  it('o mesmo dia 09/03 em SP = 0; no dia seguinte = 1', () => {
    expect(diasRestantes(new Date('2027-03-10T02:59:59Z'), new Date('2027-03-09T03:00:00Z'))).toBe(0);
    expect(diasRestantes(new Date('2027-03-10T03:00:00Z'), new Date('2027-03-09T03:00:00Z'))).toBe(1);
  });
});
