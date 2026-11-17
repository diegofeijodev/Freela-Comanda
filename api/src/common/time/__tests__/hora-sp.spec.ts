import { horaSp } from '../dates';

describe('horaSp', () => {
  it('formata a hora de Brasília em 24 h', () => {
    expect(horaSp(new Date('2026-11-17T18:10:00Z'))).toBe('15h10');
    expect(horaSp(new Date('2026-11-17T02:30:00Z'))).toBe('23h30');
    expect(horaSp(new Date('2026-11-17T12:05:00Z'))).toBe('09h05');
  });
  it('meia-noite é 00h, não 24h', () => {
    expect(horaSp(new Date('2026-11-17T03:07:00Z'))).toBe('00h07');
  });
});
