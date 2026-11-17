import { Inject, Injectable } from '@nestjs/common';
import { CADEIA_ICP, type CadeiaIcp } from '../certificado-digital/cadeia';
import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
import { confiancaSefaz } from './confianca';
import {
  SEFAZ_DFE,
  type AmbienteSefaz,
  type DocumentoDistribuido,
  type RespostaDistribuicao,
  type SefazDfePort,
} from './distribuicao.port';
import { sefazErro } from './sefaz-erro';
import {
  CHAMAR_SOAP12,
  TEMPO_LIMITE_MS,
  TETO_RESPOSTA_BYTES,
  type ChamarSoap12,
} from './transporte-soap12';
import { descompactarDocZip, elementos, lerXml, primeiro, texto, XmlInvalido } from './xml-leitura';

export { SEFAZ_DFE };

export const URL_DISTRIBUICAO: Record<AmbienteSefaz, string> = {
  producao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
};
export const ACTION_DIST_NSU = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';
export const C_UF_AUTOR = '35';
const MAX_DOCZIP = 50;
const FORMATO_CNPJ = /^[0-9A-Z]{12}[0-9]{2}$/;

/** Conteúdo do <soap12:Body>: sem prefixo de namespace na área de dados (prefixo = rejeição 404). */
export function corpoDistNsu(ambiente: AmbienteSefaz, cnpj: string, ultNsu: bigint): string {
  if (!FORMATO_CNPJ.test(cnpj)) throw new Error('CNPJ inválido para a distribuição.');
  if (ultNsu < 0n || ultNsu >= 10n ** 15n) throw new Error('NSU fora do intervalo de 15 dígitos.');
  const tpAmb = ambiente === 'producao' ? '1' : '2';
  return (
    '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>' +
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${tpAmb}</tpAmb><cUFAutor>${C_UF_AUTOR}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${ultNsu.toString().padStart(15, '0')}</ultNSU></distNSU></distDFeInt>` +
    '</nfeDadosMsg></nfeDistDFeInteresse>'
  );
}

function nsuOuNulo(v: string | null): bigint | null {
  if (v === null) return null;
  if (!/^[0-9]{1,15}$/.test(v)) throw new XmlInvalido();
  return BigInt(v);
}

/** Lê o corpo HTTP (envelope SOAP) e devolve a resposta; qualquer defeito vira SEFAZ_RESPOSTA_INVALIDA (já enviado). */
export function lerRetornoDistribuicao(corpoHttp: string): RespostaDistribuicao {
  try {
    const doc = lerXml(corpoHttp);
    const ret = primeiro(doc, 'retDistDFeInt');
    if (!ret) throw new XmlInvalido();
    const cStatTxt = texto(ret, 'cStat');
    if (cStatTxt === null || !/^[0-9]{1,5}$/.test(cStatTxt)) throw new XmlInvalido();
    const zips = elementos(ret, 'docZip');
    if (zips.length > MAX_DOCZIP) throw new XmlInvalido();
    const documentos: DocumentoDistribuido[] = zips.map((z) => {
      const nsu = nsuOuNulo(z.getAttribute('NSU')?.trim() || null);
      if (nsu === null) throw new XmlInvalido();
      const r = descompactarDocZip(z.textContent ?? '');
      return {
        nsu,
        schema: z.getAttribute('schema') ?? '',
        xml: 'xml' in r ? r.xml : null,
        bruto: 'bruto' in r ? r.bruto : null,
      };
    });
    return {
      cStat: Number(cStatTxt),
      xMotivo: texto(ret, 'xMotivo') ?? '',
      dhResp: texto(ret, 'dhResp') ?? '',
      ultNsu: nsuOuNulo(texto(ret, 'ultNSU')),
      maxNsu: nsuOuNulo(texto(ret, 'maxNSU')),
      documentos,
    };
  } catch {
    throw sefazErro('SEFAZ_RESPOSTA_INVALIDA', true);
  }
}

@Injectable()
export class SefazDfeAdapter implements SefazDfePort {
  constructor(
    @Inject(CADEIA_ICP) private readonly icp: CadeiaIcp,
    @Inject(CHAMAR_SOAP12) private readonly chamar: ChamarSoap12,
  ) {}

  async distribuirPorNsu(
    cert: CertificadoEmUso,
    ambiente: AmbienteSefaz,
    cnpj: string,
    ultNsu: bigint,
  ): Promise<RespostaDistribuicao> {
    const corpoHttp = await this.chamar({
      url: URL_DISTRIBUICAO[ambiente],
      action: ACTION_DIST_NSU,
      corpo: corpoDistNsu(ambiente, cnpj, ultNsu),
      certificado: cert,
      confianca: confiancaSefaz(this.icp),
      tempoLimiteMs: TEMPO_LIMITE_MS,
      tetoRespostaBytes: TETO_RESPOSTA_BYTES,
    });
    return lerRetornoDistribuicao(corpoHttp);
  }
}
