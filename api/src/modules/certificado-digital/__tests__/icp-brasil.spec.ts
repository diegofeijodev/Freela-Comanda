import { carregarCadeiaIcp, impressaoDigital, montarCadeia } from '../cadeia';
import { PACOTE_GERADO_EM, PACOTE_ICP_BRASIL } from '../icp-brasil.gerado';

// Offline: só confere o módulo gerado por api/scripts/atualizar-cadeia-icp.sh (nenhum teste faz rede).
const RAIZES = [
  '1406710058180FA4081AAB3F246F1702429C552A11FA3143B84C88CB3AB8E5E7', // v11
  '2B07D0BC02C4A6E0478ED22D0D99E8F97E1827B269097696A7FEB6AAD30C3AC8', // v13
  '3BDB9B509352F1D3D71C2BF64D9A38A4E6CEBDA27809D77F7AC476CBDE6E314A', // v6
  '6E0BFF069A26994C15DE2C4888CC54AF84882E5495B7FBF66BE9CCFFEC7489F6', // v10
  'CAA53FC6091C6951887C976E378F6EF89AA6377C55D97B6475422B71ED7E9B17', // v5
  'D8478E37CE19C690CF657381E68FE600E4E1A042536830F06847E03E554C4B01', // v12
  'F0C15AFD258FB674E7A96E1A50FF873149364B9EC70D4D93C7A9F1EB6060D020', // v4
];

describe('cadeia ICP-Brasil embutida', () => {
  const icp = carregarCadeiaIcp();

  it('as âncoras são exatamente as 7 raízes fixadas (v7 fora)', () => {
    expect(icp.ancoras.map(impressaoDigital).sort()).toEqual(RAIZES);
  });

  it('o pacote de apoio tem mais de 150 certificados e a data de geração', () => {
    expect(PACOTE_ICP_BRASIL.length).toBeGreaterThan(150);
    expect(PACOTE_GERADO_EM).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('todo certificado do pacote fecha numa âncora, sem nenhum apoio externo', () => {
    const agora = new Date(PACOTE_GERADO_EM + 'T12:00:00Z');
    const falhas = icp.pacote.filter((c) => montarCadeia(c, [], icp, agora).situacao !== 'conferida').map((c) => c.subject);
    expect(falhas).toEqual([]);
  });
});
