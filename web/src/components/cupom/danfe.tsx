'use client';

import { memo, useEffect, useMemo } from 'react';
import type { Danfe } from '@/lib/erp-api';
import { formatarCnpj } from '@/lib/certificado';
import { chaveEmBlocos, dataHoraDanfe, decimal2, documentoFormatado, NOME_OFICIAL_PAGAMENTO, qtdDanfe, valorDanfe } from '@/lib/cupom';
import { qrSvg } from '@/lib/qrcode';

/** Texto alternativo do QR (UX 3.3): o link aparece escrito logo abaixo. */
export const ALT_QR = 'QR Code do cupom. O link de consulta está logo abaixo.';

/** O QR como imagem (data URI do SVG): tem `alt` e avisa quando desenhou (`onLoad`), para a impressão esperar por ele. */
export function QrDoCupom({ texto, className, onPronto }: { texto: string; className?: string; onPronto?: () => void }) {
  const src = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(texto))}`, [texto]);
  // eslint-disable-next-line @next/next/no-img-element -- data URI gerado aqui; o otimizador de imagem do Next não se aplica
  return <img src={src} alt={ALT_QR} className={className} onLoad={onPronto} />;
}

/** "12.34" → 1234n (o valor do XML, sem passar por `Number`). */
const centavosXml = (v: string) => {
  const [i, f = ''] = v.split('.');
  return BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2));
};
const somaPositiva = (...v: string[]) => v.some((x) => /[1-9]/.test(x));

/**
 * DANFE NFC-e de 80 mm (UX 3.3; Manual do DANFE NFC-e, divisões I a IX), montado SÓ do XML guardado (`GET …/danfe`): dentro do papel,
 * nada que não esteja no XML (ou no protocolo). Sempre papel branco com texto preto, sem herdar o tema escuro; encolhe sem rolagem lateral
 * até 320 px. Os textos fixos ficam como o Manual manda.
 */
function DanfePapelBase({ danfe, onQrPronto }: { danfe: Danfe; onQrPronto?: () => void }) {
  const e = danfe.emit;
  const end = e.enderEmit;
  const endereco = [end.xLgr, end.nro, end.xCpl, end.xBairro, end.xMun, end.UF].filter(Boolean).join(', ');
  const acrescimos = somaPositiva(danfe.total.vOutro, danfe.total.vFrete, danfe.total.vSeg);
  const temDesconto = somaPositiva(danfe.total.vDesc);
  const consumidor = danfe.dest;

  // sem QR (não deve acontecer: o QR é obrigatório), a impressão não espera por ele
  useEffect(() => {
    if (!danfe.qrCode) onQrPronto?.();
  }, [danfe.qrCode, onQrPronto]);

  return (
    <section
      aria-label={`Cupom fiscal nº ${danfe.ide.nNF}`}
      className="danfe mx-auto w-full max-w-[80mm] break-words bg-white p-3 font-sans text-[12px] leading-snug text-black print:p-0"
    >
      {/* I: emitente */}
      <div className="space-y-0.5 text-center">
        <p className="font-bold uppercase">{e.xNome}</p>
        <p>CNPJ {formatarCnpj(e.CNPJ)}{e.IE ? ` · IE ${e.IE}` : ''}</p>
        {endereco && <p>{endereco}</p>}
        <p className="pt-1">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</p>
      </div>

      {/* II: itens */}
      <div className="mt-2 border-t border-dashed border-black pt-2">
        <div className="flex gap-2 font-bold"><span className="w-12 shrink-0">Código</span><span>Descrição</span></div>
        <div className="flex gap-2 font-bold">
          <span className="w-12 shrink-0">Qtde</span><span className="w-6 shrink-0">Un</span><span>Vl unit</span><span className="ml-auto">Vl total</span>
        </div>
        <ul className="mt-1 space-y-1">
          {danfe.det.map((i) => (
            <li key={i.nItem}>
              <div className="flex gap-2"><span className="w-12 shrink-0 truncate">{i.cProd}</span><span className="min-w-0">{i.xProd}</span></div>
              <div className="flex gap-2">
                <span className="w-12 shrink-0">{qtdDanfe(i.qCom)}</span><span className="w-6 shrink-0">{i.uCom}</span>
                <span>{valorDanfe(i.vUnCom)}</span><span className="ml-auto">{valorDanfe(i.vProd)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* III: totais e pagamento */}
      <div className="mt-2 space-y-0.5 border-t border-dashed border-black pt-2">
        <p className="flex justify-between gap-2"><span>Qtde. total de itens</span><span>{danfe.total.qItens}</span></p>
        <p className="flex justify-between gap-2"><span>Valor total R$</span><span>{valorDanfe(danfe.total.vProd)}</span></p>
        {temDesconto && <p className="flex justify-between gap-2"><span>Desconto R$</span><span>{valorDanfe(danfe.total.vDesc)}</span></p>}
        {acrescimos && (
          <p className="flex justify-between gap-2">
            <span>Acréscimos R$</span>
            <span>{valorDanfe(decimal2(centavosXml(danfe.total.vOutro) + centavosXml(danfe.total.vFrete) + centavosXml(danfe.total.vSeg)))}</span>
          </p>
        )}
        <p className="flex justify-between gap-2 font-bold"><span>Valor a pagar R$</span><span>{valorDanfe(danfe.total.vNF)}</span></p>
        <p className="flex justify-between gap-2 pt-1 font-bold"><span>FORMA PAGAMENTO</span><span>VALOR PAGO R$</span></p>
        {danfe.pag.detPag.map((p, k) => (
          <p key={k} className="flex justify-between gap-2">
            <span>{p.xPag ?? NOME_OFICIAL_PAGAMENTO[p.tPag] ?? p.tPag}</span><span>{valorDanfe(p.vPag)}</span>
          </p>
        ))}
        {danfe.pag.vTroco && <p className="flex justify-between gap-2"><span>Troco R$</span><span>{valorDanfe(danfe.pag.vTroco)}</span></p>}
      </div>

      {/* IV: consulta pela chave */}
      <div className="mt-2 space-y-0.5 border-t border-dashed border-black pt-2 text-center">
        <p className="font-bold">Consulte pela Chave de Acesso em</p>
        {danfe.urlChave && <p className="break-all">{danfe.urlChave}</p>}
        <p className="font-mono text-[11px] tracking-tight">{chaveEmBlocos(danfe.chave)}</p>
      </div>

      {/* V: QR Code (margem branca de 4 módulos, nível M; ≥ 96 px na tela, ≥ 25 mm no papel) */}
      {danfe.qrCode && (
        <div className="mt-2 flex justify-center">
          <QrDoCupom texto={danfe.qrCode} className="h-auto w-32 print:w-[30mm]" onPronto={onQrPronto} />
        </div>
      )}

      {/* VI: consumidor */}
      <div className="mt-2 text-center">
        {consumidor === null || (!consumidor.CPF && !consumidor.CNPJ && !consumidor.idEstrangeiro) ? (
          <p className="font-bold">CONSUMIDOR NÃO IDENTIFICADO</p>
        ) : (
          <p className="font-bold">
            {consumidor.CPF
              ? `CONSUMIDOR CPF: ${documentoFormatado(consumidor.CPF)}`
              : consumidor.CNPJ
                ? `CONSUMIDOR CNPJ: ${formatarCnpj(consumidor.CNPJ)}`
                : `CONSUMIDOR Id. Estrangeiro: ${consumidor.idEstrangeiro}`}
            {consumidor.xNome ? ` ${consumidor.xNome}` : ''}
          </p>
        )}
      </div>

      {/* VII: identificação e protocolo */}
      <div className="mt-2 space-y-0.5 text-center">
        <p className="font-bold">NFC-e nº {danfe.ide.nNF} Série {danfe.ide.serie} {dataHoraDanfe(danfe.ide.dhEmi)}</p>
        <p>Protocolo de autorização:</p>
        <p>{danfe.nProt ?? '—'} {danfe.dhRecbto ? dataHoraDanfe(danfe.dhRecbto) : ''}</p>
      </div>

      {/* VIII: homologação */}
      {danfe.homologacao && <p className="mt-2 text-center font-bold">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL</p>}

      {/* IX: informações complementares */}
      {danfe.infCpl && <p className="mt-2 whitespace-pre-line border-t border-dashed border-black pt-2 text-center">{danfe.infCpl}</p>}
    </section>
  );
}

export const DanfePapel = memo(DanfePapelBase);
