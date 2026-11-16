import { cifrar, decifrar } from '../cripto';

const SEGREDO = 'segredo-de-teste-com-mais-de-16';
const ROTULO_IA = 'erp-freela/ia-chave/v1';
const ROTULO_CERT = 'erp-freela/certificado-a1/v1';
/** Gerado pelo código ANTES da cifra ser movida: uma chave de IA já gravada em produção tem que continuar decifrável. */
const ENVELOPE_IA_ANTIGO = 'v1.k--djqVE-o57838p.uL653fD2FqNieJzQi2LA7Q.B-k5W8ypxaOGijfPphsVeBZ0uVPlkePy_cylWi-BOgcL';

describe('cripto compartilhada', () => {
  it('decifra o envelope da chave de IA gerado antes da mudança', () => {
    expect(decifrar(ENVELOPE_IA_ANTIGO, SEGREDO, ROTULO_IA)).toBe('sk-proj-vetor-fixo-1234567890abcd');
  });

  it('ida e volta com o rótulo do certificado', () => {
    const c = cifrar('conteudo-qualquer', SEGREDO, ROTULO_CERT);
    expect(c.startsWith('v1.')).toBe(true);
    expect(decifrar(c, SEGREDO, ROTULO_CERT)).toBe('conteudo-qualquer');
  });

  it('rótulo diferente ou segredo errado dão null', () => {
    const c = cifrar('conteudo-qualquer', SEGREDO, ROTULO_CERT);
    expect(decifrar(c, SEGREDO, ROTULO_IA)).toBeNull();
    expect(decifrar(c, 'outro-segredo-com-mais-de-16-xx', ROTULO_CERT)).toBeNull();
  });
});
