import { MSG_CERTIFICADO, msgAindaNaoVale, msgOutroCnpj, msgVencido } from '../mensagens';

// Frases do plano (Global Constraints, com a UX §6): valem literalmente.
describe('mensagens do certificado', () => {
  it('arquivo', () => {
    expect(MSG_CERTIFICADO.arquivo).toBe('Este arquivo não parece um certificado digital. Escolha o arquivo .pfx ou .p12 que o contador enviou.');
  });
  it('senha', () => {
    expect(MSG_CERTIFICADO.senha).toBe('Senha do certificado incorreta. Digite de novo.');
  });
  it('formato', () => {
    expect(MSG_CERTIFICADO.formato).toBe('Não consegui abrir este certificado. Peça ao contador para gerar o arquivo de novo.');
  });
  it('semChave', () => {
    expect(MSG_CERTIFICADO.semChave).toBe(
      'Este arquivo não serve: falta a parte secreta do certificado. Peça ao contador o certificado A1 (arquivo), não o de cartão ou token.',
    );
  });
  it('semCnpj', () => {
    expect(MSG_CERTIFICADO.semCnpj).toBe(
      'Este certificado não é de empresa: não encontrei um CNPJ nele. Peça o certificado da empresa, não o seu pessoal.',
    );
  });
  it('empresaSemCnpj', () => {
    expect(MSG_CERTIFICADO.empresaSemCnpj).toBe(
      'Preencha o CNPJ da empresa no quadro Empresa, toque em Salvar (no alto da página) e envie o certificado de novo.',
    );
  });
  it('naoIcp', () => {
    expect(MSG_CERTIFICADO.naoIcp).toBe(
      'Este certificado não foi emitido por uma certificadora brasileira credenciada; a SEFAZ não aceita. Peça outro ao contador.',
    );
  });
  it('cadeia', () => {
    expect(MSG_CERTIFICADO.cadeia).toBe('Este certificado parece alterado ou incompleto. Peça ao contador ou à certificadora um arquivo novo.');
  });
  it('semSegredo', () => {
    expect(MSG_CERTIFICADO.semSegredo).toBe('O servidor ainda não está pronto para guardar certificados. Fale com o suporte do Freela Comanda.');
  });
  it('vencido', () => {
    expect(msgVencido(new Date('2026-03-10T15:00:00Z'))).toBe('Este certificado venceu em 10/03/2026. Envie o certificado renovado.');
  });
  it('ainda não vale', () => {
    expect(msgAindaNaoVale(new Date('2026-11-20T15:00:00Z'))).toBe('Este certificado só vale a partir de 20/11/2026.');
  });
  it('outro CNPJ', () => {
    expect(msgOutroCnpj('99888777000100', 'OUTRA EMPRESA SA', '12.345.678/0001-95')).toBe(
      'Este certificado é do CNPJ 99.888.777/0001-00 (OUTRA EMPRESA SA). O CNPJ da empresa é 12.345.678/0001-95.',
    );
  });
});
