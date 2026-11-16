import { cifrar, decifrar } from '../cripto';

const SEGREDO = 'segredo-de-teste-com-mais-de-16';
const OUTRO_ROTULO = 'erp-freela/outra-finalidade/v1';
const ROTULO_CERT = 'erp-freela/certificado-a1/v1';

describe('cripto compartilhada', () => {
  it('ida e volta com o rótulo do certificado', () => {
    const c = cifrar('conteudo-qualquer', SEGREDO, ROTULO_CERT);
    expect(c.startsWith('v1.')).toBe(true);
    expect(decifrar(c, SEGREDO, ROTULO_CERT)).toBe('conteudo-qualquer');
  });

  it('rótulo diferente ou segredo errado dão null', () => {
    const c = cifrar('conteudo-qualquer', SEGREDO, ROTULO_CERT);
    expect(decifrar(c, SEGREDO, OUTRO_ROTULO)).toBeNull();
    expect(decifrar(c, 'outro-segredo-com-mais-de-16-xx', ROTULO_CERT)).toBeNull();
  });
});
