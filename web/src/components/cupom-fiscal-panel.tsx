'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleAlert, Eye, EyeOff, Loader2, X } from 'lucide-react';
import {
  ambienteCupom, emitenteCupom, ligarEmissaoCupom, listarCupons, perfisFiscais, salvarAmbienteCupom, salvarEmitenteCupom, situacaoCupomFiscal,
  testarConexaoCupom, type AmbienteCupom, type AmbienteSefaz, type EmitenteCupom, type SalvarEmitenteCupom, type SituacaoCupomFiscal,
} from '@/lib/erp-api';
import { errMsg } from '@/lib/db';
import {
  alvoDaFalta, avisoTrocaRegime, botaoDaEmissao, CHAVES_CUPOM, HREF_PRECISAM, linhaCscGuardado, linhaDoServidor, linhaLigadaPor,
  linhasHistoricoCupom, mascaraCep, mascaraIe, OPCOES_CRT, ordenarFalta, soNumeros, tagDaEmissao, textoVendasPendentes, type AlvoFalta,
} from '@/lib/cupom';
import { dataHoraSp, formatarCnpj } from '@/lib/certificado';
import { cnpjValido } from '@/lib/fiscal';
import { horaSp, semToqueDuplo } from '@/lib/notas-sefaz';
import { CHAVE_EMITENTE, CHAVE_PERFIS } from '@/components/cupom/perfis';
import { Panel, Tag } from '@/components/ui-kit';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const chaveAmbiente = (a: AmbienteSefaz) => ['cupom-fiscal', 'ambiente', a] as const;
const ERRO_CAIXA = 'flex min-w-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm';
const AVISO_CAIXA = 'flex min-w-0 items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm';
const LINK = 'inline-flex min-h-11 items-center text-left text-primary underline underline-offset-2';
const DESLIGADO =
  'A emissão de cupom fiscal não está ativada neste servidor. Você já pode cadastrar os dados fiscais dos produtos e da empresa; para ativar, fale com o suporte do Freela Comanda.';
const vazioNulo = (s: string) => (s.trim() === '' ? null : s.trim());
/** Foco no 1º campo com erro: abre o bloco recolhido em volta; num grupo de opções, a 1ª opção. */
function focarErro(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  (el.matches('input, textarea, select, button') ? el : el.querySelector<HTMLElement>('button, input'))?.focus();
}

/** Erro de uma ação do quadro: caixa vermelha com o foco nela (UX 5). Uma ação por vez (`semToqueDuplo`). */
function useAcao() {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => { if (erro) caixa.current?.focus(); }, [erro]);
  const rodar = (fn: () => Promise<void>) => semToqueDuplo(emCurso, async () => {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });
  return { erro, setErro, ocupado, rodar, caixa };
}

function CaixaErro({ erro, caixa }: { erro: string | null; caixa: React.RefObject<HTMLDivElement | null> }) {
  if (!erro) return null;
  return (
    <div ref={caixa} tabIndex={-1} role="alert" className={ERRO_CAIXA}>
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden /><span className="min-w-0 break-words">{erro}</span>
    </div>
  );
}

/** Rótulo sempre visível, ajuda curta e o erro junto do campo (`aria-describedby`, `aria-invalid`). */
function Campo({ id, rotulo, ajuda, erro, children }: { id: string; rotulo: string; ajuda?: ReactNode; erro?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {ajuda && <p id={`${id}-ajuda`} className="text-sm text-muted-foreground">{ajuda}</p>}
      {erro && <p id={`${id}-erro`} className="text-sm text-destructive">{erro}</p>}
    </div>
  );
}
const descr = (id: string, ajuda: boolean, erro: string | null | undefined) =>
  [ajuda ? `${id}-ajuda` : null, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;

function Carregando() {
  return <div className="space-y-2" aria-busy="true"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /></div>;
}

function useSituacao() {
  return useQuery({ queryKey: CHAVES_CUPOM.situacao, queryFn: situacaoCupomFiscal });
}

/**
 * Configurações → Cupom fiscal (UX 5.1 a 5.5; só admin): Situação (ligar/desligar e o que falta), Empresa no cupom, Numeração e código de
 * segurança (os dois ambientes), Caixa de hoje e os quadros recolhidos. Cada quadro salva só os seus campos, com o próprio botão. `irPara`
 * leva ao campo de cada item que falta (troca de aba, abre o bloco recolhido, rola e põe o foco).
 */
export function CupomFiscalPanel({ irPara }: { irPara(alvo: AlvoFalta): void }) {
  return (
    <div id="cupom-fiscal" className="max-w-[720px] scroll-mt-4 space-y-4">
      <QuadroSituacao irPara={irPara} />
      <QuadroEmpresa />
      <QuadroNumeracao />
      <QuadroCaixaDeHoje />
      <QuadroResponsavel />
      <QuadroReforma />
    </div>
  );
}

// ======================================================================================================================= Situação (5.1)

function QuadroSituacao({ irPara }: { irPara(alvo: AlvoFalta): void }) {
  const qc = useQueryClient();
  const situacaoQ = useSituacao();
  const s = situacaoQ.data;
  const servidor = s?.ambiente;
  const ligado: AmbienteSefaz | null = servidor === 'homologacao' || servidor === 'producao' ? servidor : null;
  const ambienteQ = useQuery({ queryKey: chaveAmbiente(ligado ?? 'producao'), queryFn: () => ambienteCupom(ligado!), enabled: ligado !== null });
  const pendentesQ = useQuery({
    queryKey: ['cupom-fiscal', 'cupons', { ambiente: 'producao', atencao: true, limite: 500 }],
    queryFn: () => listarCupons({ ambiente: 'producao', atencao: true, limite: 500 }),
    enabled: servidor === 'producao',
  });
  const nVendaPendente = (pendentesQ.data ?? []).filter((c) => c.venda_estoque === 'pendente').length;
  const acao = useAcao();
  const [valendo, setValendo] = useState(false);
  // a hora do servidor (o bloqueio do 656 não depende do relógio do aparelho)
  const agora = new Date(Date.now() + (s && situacaoQ.dataUpdatedAt > 0 ? new Date(s.agora).getTime() - situacaoQ.dataUpdatedAt : 0));

  const guardar = (r: SituacaoCupomFiscal) => {
    qc.setQueryData(CHAVES_CUPOM.situacao, r);
    if (ligado) void qc.invalidateQueries({ queryKey: chaveAmbiente(ligado) });
  };
  const ligar = (a: AmbienteSefaz, confirmado?: boolean) => acao.rodar(async () => {
    guardar(await ligarEmissaoCupom(a, true, confirmado));
    setValendo(false);
    if (a === 'homologacao') {
      toast.success('Emissão ligada no modo de teste.', {
        duration: 8_000,
        action: { label: 'Desfazer', onClick: () => { ligarEmissaoCupom(a, false).then(guardar, (e) => acao.setErro(errMsg(e))); } },
      });
    } else toast.success('Emissão ligada valendo.');
  });
  const desligar = (a: AmbienteSefaz) => acao.rodar(async () => {
    guardar(await ligarEmissaoCupom(a, false));
    if (a === 'homologacao') {
      toast.success('Emissão desligada.', {
        duration: 8_000,
        action: { label: 'Desfazer', onClick: () => { ligarEmissaoCupom(a, true).then(guardar, (e) => acao.setErro(errMsg(e))); } },
      });
    } else toast.success('Emissão desligada.'); // valendo: religar pede as três confirmações de novo
  });

  if (situacaoQ.isPending) return <Panel title="Cupom fiscal (NFC-e)"><Carregando /></Panel>;
  if (!s) {
    return (
      <Panel title="Cupom fiscal (NFC-e)">
        <div className="space-y-2 text-sm">
          <p>Não consegui ver a situação do cupom fiscal agora. Toque em Tentar de novo.</p>
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => void situacaoQ.refetch()}>Tentar de novo</Button>
        </div>
      </Panel>
    );
  }

  const tag = tagDaEmissao(s, agora);
  const botao = botaoDaEmissao(s);
  const falta = ordenarFalta(s.falta);
  const parada = s.situacao !== 'ok';
  const historico = ambienteQ.data?.historico ?? [];
  const ligadaPor = s.emissao_ligada ? linhaLigadaPor(historico) : null;
  const avisoVenda = servidor === 'producao' ? textoVendasPendentes(nVendaPendente) : null;
  const alvoDaParada: AlvoFalta | null =
    s.situacao === 'parada_certificado' ? alvoDaFalta('certificado', ligado ?? 'producao')
      : s.situacao === 'parada_serie_em_uso' ? { rotulo: 'Trocar a série', aba: 'cupom', id: `cupom-serie-${ligado ?? 'producao'}` }
        : s.situacao === 'parada_configuracao' ? { rotulo: 'Ir para o código de segurança', aba: 'cupom', id: `cupom-csc-${ligado ?? 'producao'}` }
          : null;

  return (
    <Panel title="Cupom fiscal (NFC-e)">
      <div className="min-w-0 space-y-4">
        {parada && s.mensagem && (
          <div role="alert" className={ERRO_CAIXA}>
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 space-y-1">
              <p className="break-words">{s.mensagem}</p>
              {alvoDaParada && <button type="button" className={LINK} onClick={() => irPara(alvoDaParada)}>{alvoDaParada.rotulo}</button>}
            </div>
          </div>
        )}
        <div className="space-y-1">
          <p className="font-medium">{linhaDoServidor(s.ambiente)}</p>
          <p className="text-sm text-muted-foreground">Quem muda é o suporte do Freela Comanda, com a sua autorização.</p>
        </div>
        {s.ambiente === 'desligado' ? (
          <p className="text-sm">{DESLIGADO}</p>
        ) : (
          <>
            <div>
              <Tag tone={tag.tom}>
                {tag.tom === 'ok' ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> : <CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />}
                {tag.texto}
              </Tag>
            </div>
            {!parada && s.mensagem && (
              <div role="status" className={AVISO_CAIXA}><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden /><p className="min-w-0 break-words">{s.mensagem}</p></div>
            )}
          </>
        )}

        {falta.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Para ligar a emissão, falta:</p>
            <ul className="space-y-1">
              {falta.map((f) => {
                const alvo = alvoDaFalta(f.codigo, ligado ?? 'producao');
                return (
                  <li key={f.codigo} className="flex flex-wrap items-center gap-x-3 text-sm">
                    <span className="flex min-w-0 items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden /><span className="break-words">{f.texto}</span></span>
                    {'href' in alvo
                      ? <Link href={alvo.href} className={LINK}>{alvo.rotulo}</Link>
                      : <button type="button" className={LINK} onClick={() => irPara(alvo)}>{alvo.rotulo}</button>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {avisoVenda && (
          <div role="status" className={AVISO_CAIXA}>
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <div className="min-w-0 space-y-1"><p>{avisoVenda}</p><Link href={HREF_PRECISAM} className={LINK}>Ver os cupons</Link></div>
          </div>
        )}

        {/* com o diálogo "Ligar valendo" aberto, o erro aparece DENTRO dele (o resto da página fica atrás do overlay e sem foco) */}
        {!valendo && <CaixaErro erro={acao.erro} caixa={acao.caixa} />}

        {botao && ligado && (
          <div className="space-y-1">
            {botao === 'desligar' ? (
              <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto" disabled={acao.ocupado} onClick={() => void desligar(ligado)}>
                {acao.ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Desligando…</> : 'Desligar a emissão'}
              </Button>
            ) : (
              <Button
                className="h-11 w-full whitespace-normal sm:w-auto" disabled={acao.ocupado || falta.length > 0} aria-describedby={falta.length > 0 ? 'cupom-ligar-ajuda' : undefined}
                onClick={() => (ligado === 'producao' ? setValendo(true) : void ligar(ligado))}
              >
                {acao.ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Ligando…</>
                  : botao === 'ligar_de_novo' ? 'Ligar a emissão de novo' : 'Ligar a emissão de cupons'}
              </Button>
            )}
            {botao !== 'desligar' && falta.length > 0 && <p id="cupom-ligar-ajuda" className="text-sm text-muted-foreground">Complete os itens acima para ligar.</p>}
          </div>
        )}

        {ligado && <TestarConexao />}

        {ligadaPor && <p className="text-sm text-muted-foreground">{ligadaPor}</p>}
        {historico.length > 0 && (
          <details className="text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center text-primary">Ver histórico</summary>
            <ul className="mt-1 space-y-1 break-words">{linhasHistoricoCupom(historico).map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}</ul>
          </details>
        )}
      </div>

      {valendo && (
        <LigarValendo
          serie={s.serie} ocupado={acao.ocupado} erro={acao.erro} caixa={acao.caixa}
          onFechar={() => { setValendo(false); acao.setErro(null); }} onLigar={() => void ligar('producao', true)}
        />
      )}
    </Panel>
  );
}

/**
 * "Ligar a emissão valendo?" (UX 5.1, E13): as três confirmações obrigatórias; o foco começa em "Agora não". Se o servidor recusar, a
 * frase dele aparece numa caixa vermelha DENTRO do diálogo, com o foco nela (rodada de correção 1, I1); as marcas ficam, e dá para tentar
 * de novo ou desistir.
 */
function LigarValendo({ serie, ocupado, erro, caixa, onFechar, onLigar }: {
  serie: number | null;
  ocupado: boolean;
  erro: string | null;
  caixa: React.RefObject<HTMLDivElement | null>;
  onFechar(): void;
  onLigar(): void;
}) {
  const [marcas, setMarcas] = useState([false, false, false]);
  const todas = marcas.every(Boolean);
  const textos = [
    `A série ${serie ?? ''} não é usada pelo caixa de hoje (confirmei com quem instalou o caixa).`,
    'O código de segurança (CSC) é um dos dois da empresa, e não apaguei (revoguei) nenhum no portal da SEFAZ.',
    'O contador sabe que o Freela Comanda vai emitir cupons.',
  ];
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !ocupado) onFechar(); }}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto" onEscapeKeyDown={(e) => { if (ocupado) e.preventDefault(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Ligar a emissão valendo?</AlertDialogTitle>
          <AlertDialogDescription>Os cupons passam a valer como documento fiscal, emitidos em nome da empresa e com o certificado digital.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          {textos.map((t, i) => (
            <label key={t} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
              <Checkbox className="mt-1" checked={marcas[i]} onCheckedChange={(v) => setMarcas((m) => m.map((x, k) => (k === i ? v === true : x)))} />
              <span>{t}</span>
            </label>
          ))}
          <p className="text-sm font-semibold">Se a SEFAZ bloquear este sistema por excesso de recusas, o caixa da loja pode parar junto por até 1 hora.</p>
        </div>
        <CaixaErro erro={erro} caixa={caixa} />
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-11" disabled={ocupado}>Agora não</AlertDialogCancel>
          <Button className="h-11" disabled={!todas || ocupado} aria-describedby={!todas ? 'ligar-valendo-ajuda' : undefined} onClick={onLigar}>
            {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Ligando…</> : 'Ligar valendo'}
          </Button>
        </AlertDialogFooter>
        {!todas && <p id="ligar-valendo-ajuda" className="text-sm text-muted-foreground">Marque as três confirmações.</p>}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Testar a conexão com a SEFAZ" (UX 5.1): a frase do servidor na linha de baixo; na espera de 5 min, o botão fica travado com a hora. */
function TestarConexao() {
  const [linha, setLinha] = useState<string | null>(null);
  const [esperaAte, setEsperaAte] = useState<{ fim: number; hora: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  useEffect(() => {
    if (!esperaAte) return;
    const t = setTimeout(() => setEsperaAte(null), Math.max(0, esperaAte.fim - Date.now()));
    return () => clearTimeout(t);
  }, [esperaAte]);
  const testar = () => semToqueDuplo(emCurso, async () => {
    setOcupado(true);
    try {
      const r = await testarConexaoCupom();
      setLinha(r.frase);
      const resta = new Date(r.testar_de_novo_em).getTime() - new Date(r.agora).getTime();
      if (resta > 0) setEsperaAte({ fim: Date.now() + resta, hora: horaSp(r.testar_de_novo_em) });
    } catch (e) {
      setLinha(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });
  return (
    <div className="space-y-1">
      <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto" disabled={ocupado || esperaAte !== null} onClick={() => void testar()}>
        {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Testando…</> : 'Testar a conexão com a SEFAZ'}
      </Button>
      <div aria-live="polite" className="space-y-1 text-sm">
        {linha && <p className="break-words">{linha}</p>}
        {esperaAte && <p className="text-muted-foreground">Pode testar de novo às {esperaAte.hora}.</p>}
      </div>
    </div>
  );
}

// ============================================================================================================ Empresa no cupom (5.2)

function useEmitente() {
  return useQuery({ queryKey: CHAVE_EMITENTE, queryFn: emitenteCupom });
}

/** Grava o emitente (PUT com só os campos do quadro) e atualiza o que depende dele: a situação, os perfis (regime) e os produtos. */
function useSalvarEmitente() {
  const qc = useQueryClient();
  return async (dto: SalvarEmitenteCupom) => {
    const r = await salvarEmitenteCupom(dto);
    qc.setQueryData(CHAVE_EMITENTE, r);
    await Promise.all([
      qc.invalidateQueries({ queryKey: CHAVES_CUPOM.situacao }),
      qc.invalidateQueries({ queryKey: CHAVE_PERFIS }),
      qc.invalidateQueries({ queryKey: CHAVES_CUPOM.produtos }),
    ]);
  };
}

function QuadroEmpresa() {
  const q = useEmitente();
  const e = q.data;
  return (
    <Panel title="Empresa no cupom">
      {q.isPending ? <Carregando /> : !e ? (
        <div className="space-y-2 text-sm">
          <p>Não consegui ver os dados da empresa no cupom agora. Toque em Tentar de novo.</p>
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => void q.refetch()}>Tentar de novo</Button>
        </div>
      ) : (
        <FormEmpresa
          key={JSON.stringify([e.ie, e.crt, e.logradouro, e.numero, e.complemento, e.bairro, e.cep, e.cod_municipio, e.municipio, e.telefone, e.nat_op, e.inf_cpl])}
          e={e}
        />
      )}
    </Panel>
  );
}

type FormEmp = {
  ie: string; crt: number | null; logradouro: string; numero: string; complemento: string; bairro: string; cep: string;
  cod_municipio: string; municipio: string; telefone: string; nat_op: string; inf_cpl: string;
};

/** Os erros da UX 5.2 (no blur e ao salvar): IE, regime, rua, número, bairro e CEP são obrigatórios; complemento e telefone, opcionais. */
function errosEmpresa(f: FormEmp, mudarMunicipio: boolean): Partial<Record<keyof FormEmp, string>> {
  const r: Partial<Record<keyof FormEmp, string>> = {};
  if (soNumeros(f.ie).length !== 12) r.ie = 'A inscrição estadual de SP tem 12 números.';
  if (f.crt === null) r.crt = 'Escolha o regime da empresa.';
  const vazio = { logradouro: 'Preencha a rua.', numero: 'Preencha o número.', bairro: 'Preencha o bairro.' } as const;
  for (const k of ['logradouro', 'numero', 'complemento', 'bairro'] as const) {
    const t = f[k].trim();
    if (t === '' && k !== 'complemento') r[k] = vazio[k];
    else if (Array.from(t).length > 60) r[k] = 'Use até 60 letras.';
  }
  if (soNumeros(f.cep).length !== 8) r.cep = 'O CEP tem 8 números.';
  if (mudarMunicipio) {
    if (!/^\d{7}$/.test(soNumeros(f.cod_municipio))) r.cod_municipio = 'O código do município tem 7 números.';
    if (f.municipio.trim() === '') r.municipio = 'Preencha o nome do município.';
  }
  const fone = soNumeros(f.telefone);
  if (f.telefone.trim() !== '' && (fone.length < 10 || fone.length > 11)) r.telefone = 'Use DDD + número.';
  if (f.nat_op.trim() === '') r.nat_op = 'Preencha a natureza da operação (por exemplo, VENDA).';
  else if (Array.from(f.nat_op.trim()).length > 60) r.nat_op = 'Use até 60 letras.';
  if (Array.from(f.inf_cpl.trim()).length > 500) r.inf_cpl = 'Use no máximo 500 letras.';
  return r;
}

function FormEmpresa({ e }: { e: EmitenteCupom }) {
  const salvarEmitente = useSalvarEmitente();
  const perfisQ = useQuery({ queryKey: CHAVE_PERFIS, queryFn: perfisFiscais });
  const acao = useAcao();
  const inicial: FormEmp = {
    ie: e.ie ? mascaraIe(e.ie) : '', crt: e.crt, logradouro: e.logradouro ?? '', numero: e.numero ?? '', complemento: e.complemento ?? '',
    bairro: e.bairro ?? '', cep: e.cep ? mascaraCep(e.cep) : '', cod_municipio: e.cod_municipio, municipio: e.municipio, telefone: e.telefone ?? '',
    nat_op: e.nat_op, inf_cpl: e.inf_cpl ?? '',
  };
  const [f, setF] = useState<FormEmp>(inicial);
  const [tocados, setTocados] = useState<Set<keyof FormEmp>>(new Set());
  const [mudarMunicipio, setMudarMunicipio] = useState(false);
  const [trocaRegime, setTrocaRegime] = useState<{ crt: number; texto: string } | null>(null);
  const erros = errosEmpresa(f, mudarMunicipio);
  const ver = (k: keyof FormEmp) => (tocados.has(k) ? erros[k] : undefined);
  const tocar = (k: keyof FormEmp) => setTocados((t) => new Set(t).add(k));
  const mudar = <K extends keyof FormEmp>(k: K, v: FormEmp[K]) => setF((x) => ({ ...x, [k]: v }));

  const escolherRegime = (v: string) => {
    const crt = Number(v);
    const aviso = avisoTrocaRegime(perfisQ.data ?? [], f.crt, crt);
    if (aviso) setTrocaRegime({ crt, texto: aviso });
    else mudar('crt', crt);
  };

  const salvar = () => acao.rodar(async () => {
    const todos = Object.keys(erros) as (keyof FormEmp)[];
    if (todos.length > 0) {
      setTocados(new Set(todos));
      focarErro(`cupom-${todos[0]}`);
      return;
    }
    const dto: SalvarEmitenteCupom = {};
    const ie = vazioNulo(soNumeros(f.ie));
    if (ie !== e.ie) dto.ie = ie;
    if (f.crt !== e.crt && f.crt !== null) dto.crt = f.crt;
    for (const k of ['logradouro', 'numero', 'complemento', 'bairro', 'telefone', 'inf_cpl'] as const) {
      const v = k === 'telefone' ? vazioNulo(soNumeros(f[k])) : vazioNulo(f[k]);
      if (v !== e[k]) dto[k] = v;
    }
    const cep = vazioNulo(soNumeros(f.cep));
    if (cep !== e.cep) dto.cep = cep;
    if (f.nat_op.trim() !== e.nat_op) dto.nat_op = f.nat_op.trim();
    if (mudarMunicipio) {
      if (soNumeros(f.cod_municipio) !== e.cod_municipio) dto.cod_municipio = soNumeros(f.cod_municipio);
      if (f.municipio.trim() !== e.municipio) dto.municipio = f.municipio.trim();
    }
    if (Object.keys(dto).length > 0) await salvarEmitente(dto);
    toast.success('Dados salvos.');
  });

  const texto = (k: keyof FormEmp & ('logradouro' | 'numero' | 'complemento' | 'bairro'), rotulo: string) => (
    <Campo id={`cupom-${k}`} rotulo={rotulo} erro={ver(k)}>
      <Input
        id={`cupom-${k}`} className="h-11" value={f[k]} aria-invalid={ver(k) ? true : undefined} aria-describedby={descr(`cupom-${k}`, false, ver(k))}
        onChange={(ev) => mudar(k, ev.target.value)} onBlur={() => tocar(k)}
      />
    </Campo>
  );

  return (
    <form className="space-y-4" noValidate onSubmit={(ev) => { ev.preventDefault(); void salvar(); }}>
      <div className="space-y-1 text-sm">
        <p className="font-medium">{e.razao_social || '—'}</p>
        {e.nome_fantasia && <p>{e.nome_fantasia}</p>}
        <p>CNPJ {e.cnpj ? formatarCnpj(e.cnpj) : '—'}</p>
        <p className="text-muted-foreground">Mudam na aba Geral, quadro Empresa.</p>
      </div>
      <Campo id="cupom-ie" rotulo="Inscrição estadual" ajuda="Está no cadastro da empresa na SEFAZ; o contador sabe." erro={ver('ie')}>
        <Input
          id="cupom-ie" className="h-11" inputMode="numeric" autoComplete="off" value={f.ie} aria-invalid={ver('ie') ? true : undefined}
          aria-describedby={descr('cupom-ie', true, ver('ie'))} onChange={(ev) => mudar('ie', mascaraIe(ev.target.value))} onBlur={() => tocar('ie')}
        />
      </Campo>
      <div className="space-y-1">
        <Label id="cupom-crt-rotulo">Regime da empresa</Label>
        <RadioGroup
          id="cupom-crt" aria-labelledby="cupom-crt-rotulo" aria-describedby={descr('cupom-crt', true, ver('crt'))} aria-invalid={ver('crt') ? true : undefined}
          value={f.crt === null ? '' : String(f.crt)} onValueChange={escolherRegime} className="gap-0"
        >
          {OPCOES_CRT.map((o) => (
            <label key={o.crt} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <RadioGroupItem value={String(o.crt)} />{o.texto}
            </label>
          ))}
        </RadioGroup>
        <p id="cupom-crt-ajuda" className="text-sm text-muted-foreground">Pergunte ao contador. O regime decide quais códigos aparecem nos perfis fiscais.</p>
        {ver('crt') && <p id="cupom-crt-erro" className="text-sm text-destructive">{ver('crt')}</p>}
      </div>
      {texto('logradouro', 'Rua')}
      {texto('numero', 'Número')}
      {texto('complemento', 'Complemento (opcional)')}
      {texto('bairro', 'Bairro')}
      <Campo id="cupom-cep" rotulo="CEP" erro={ver('cep')}>
        <Input
          id="cupom-cep" className="h-11 sm:w-40" inputMode="numeric" autoComplete="off" value={f.cep} aria-invalid={ver('cep') ? true : undefined}
          aria-describedby={descr('cupom-cep', false, ver('cep'))} onChange={(ev) => mudar('cep', mascaraCep(ev.target.value))} onBlur={() => tocar('cep')}
        />
      </Campo>
      <div className="space-y-1 text-sm">
        <p>{e.municipio}, {e.uf} (código {e.cod_municipio})</p>
        {!mudarMunicipio && <button type="button" className={LINK} onClick={() => setMudarMunicipio(true)}>Mudar município</button>}
      </div>
      {mudarMunicipio && (
        <>
          <Campo id="cupom-cod_municipio" rotulo="Código do município (IBGE)" erro={ver('cod_municipio')}>
            <Input
              id="cupom-cod_municipio" className="h-11 sm:w-40" inputMode="numeric" value={f.cod_municipio} aria-invalid={ver('cod_municipio') ? true : undefined}
              aria-describedby={descr('cupom-cod_municipio', false, ver('cod_municipio'))}
              onChange={(ev) => mudar('cod_municipio', soNumeros(ev.target.value).slice(0, 7))} onBlur={() => tocar('cod_municipio')}
            />
          </Campo>
          <Campo id="cupom-municipio" rotulo="Nome do município" erro={ver('municipio')}>
            <Input
              id="cupom-municipio" className="h-11" value={f.municipio} aria-invalid={ver('municipio') ? true : undefined}
              aria-describedby={descr('cupom-municipio', false, ver('municipio'))} onChange={(ev) => mudar('municipio', ev.target.value)} onBlur={() => tocar('municipio')}
            />
          </Campo>
        </>
      )}
      <Campo id="cupom-telefone" rotulo="Telefone (opcional)" erro={ver('telefone')}>
        <Input
          id="cupom-telefone" className="h-11 sm:w-56" inputMode="tel" value={f.telefone} aria-invalid={ver('telefone') ? true : undefined}
          aria-describedby={descr('cupom-telefone', false, ver('telefone'))} onChange={(ev) => mudar('telefone', ev.target.value)} onBlur={() => tocar('telefone')}
        />
      </Campo>
      <details className="rounded-lg border p-3" open={!!(ver('nat_op') || ver('inf_cpl')) || undefined}>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm">Mais opções</summary>
        <div className="mt-2 space-y-4">
          <Campo id="cupom-nat_op" rotulo="Natureza da operação" ajuda="Deixe VENDA, a não ser que o contador peça outra." erro={ver('nat_op')}>
            <Input
              id="cupom-nat_op" className="h-11" value={f.nat_op} aria-invalid={ver('nat_op') ? true : undefined}
              aria-describedby={descr('cupom-nat_op', true, ver('nat_op'))} onChange={(ev) => mudar('nat_op', ev.target.value)} onBlur={() => tocar('nat_op')}
            />
          </Campo>
          <Campo
            id="cupom-inf_cpl" rotulo="Texto no pé do cupom (opcional)" erro={ver('inf_cpl')}
            ajuda={<>Sai no pé do cupom. Use se o contador pedir algum texto. <span>{Array.from(f.inf_cpl).length} de 500 letras.</span></>}
          >
            <Textarea
              id="cupom-inf_cpl" rows={3} value={f.inf_cpl} aria-invalid={ver('inf_cpl') ? true : undefined}
              aria-describedby={descr('cupom-inf_cpl', true, ver('inf_cpl'))} onChange={(ev) => mudar('inf_cpl', ev.target.value)} onBlur={() => tocar('inf_cpl')}
            />
          </Campo>
        </div>
      </details>
      <CaixaErro erro={acao.erro} caixa={acao.caixa} />
      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={acao.ocupado}>
        {acao.ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Salvando…</> : 'Salvar empresa no cupom'}
      </Button>

      {trocaRegime && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setTrocaRegime(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Mudar o regime da empresa?</AlertDialogTitle>
              <AlertDialogDescription>{trocaRegime.texto}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel className="h-11">Manter o regime</AlertDialogCancel>
              <Button className="h-11" onClick={() => { mudar('crt', trocaRegime.crt); setTrocaRegime(null); }}>Mudar o regime</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </form>
  );
}

// ============================================================================================ Numeração e código de segurança (5.3)

function QuadroNumeracao() {
  const situacaoQ = useSituacao();
  const emitenteQ = useEmitente();
  const servidor = situacaoQ.data?.ambiente;
  // o do servidor vem aberto e primeiro; desligado: os dois abertos
  const ordem: AmbienteSefaz[] = servidor === 'producao' ? ['producao', 'homologacao'] : ['homologacao', 'producao'];
  return (
    <Panel title="Numeração e código de segurança">
      {situacaoQ.isPending ? <Carregando /> : (
        <div className="space-y-3">
          {ordem.map((a) => (
            <BlocoAmbiente
              key={a} ambiente={a} aberto={servidor === undefined || servidor === 'desligado' || servidor === a}
              aviso={servidor === 'homologacao' && a === 'producao' ? 'Preencha quando for emitir de verdade: o valendo tem série, número e código próprios.' : null}
              seriesDoCaixa={emitenteQ.data?.series_outro_sistema ?? []}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function BlocoAmbiente({ ambiente: a, aberto, aviso, seriesDoCaixa }: { ambiente: AmbienteSefaz; aberto: boolean; aviso: string | null; seriesDoCaixa: number[] }) {
  const q = useQuery({ queryKey: chaveAmbiente(a), queryFn: () => ambienteCupom(a) });
  const titulo = a === 'homologacao' ? 'Modo de teste (homologação)' : 'Valendo (produção)';
  return (
    <details className="rounded-lg border p-3" open={aberto || undefined}>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">{titulo}</summary>
      <div className="mt-2 space-y-4">
        {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}
        {q.isPending ? <Carregando /> : !q.data ? (
          <div className="space-y-2 text-sm">
            <p>Não consegui ver a numeração agora. Toque em Tentar de novo.</p>
            <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => void q.refetch()}>Tentar de novo</Button>
          </div>
        ) : (
          <FormAmbiente
            key={JSON.stringify([q.data.serie, q.data.proximo_numero, q.data.id_csc, q.data.csc_dica])} amb={q.data} seriesDoCaixa={seriesDoCaixa}
          />
        )}
      </div>
    </details>
  );
}

const inteiro = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

function FormAmbiente({ amb, seriesDoCaixa }: { amb: AmbienteCupom; seriesDoCaixa: number[] }) {
  const qc = useQueryClient();
  const a = amb.ambiente;
  const acao = useAcao();
  const [serie, setSerie] = useState(amb.serie === null ? '' : String(amb.serie));
  const [proximo, setProximo] = useState(String(amb.proximo_numero));
  const [idCsc, setIdCsc] = useState(amb.id_csc === null ? '' : String(amb.id_csc));
  const [csc, setCsc] = useState('');
  const [trocando, setTrocando] = useState(amb.csc_dica === null);
  const [mostrar, setMostrar] = useState(false);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const tocar = (k: string) => setTocados((t) => new Set(t).add(k));
  const travada = amb.pendentes_na_serie.total > 0;
  const mudouSerie = serie.trim() !== (amb.serie === null ? '' : String(amb.serie));
  const mudouProximo = proximo.trim() !== String(amb.proximo_numero);
  const mudouId = idCsc.trim() !== (amb.id_csc === null ? '' : String(amb.id_csc));
  const guardado = linhaCscGuardado(amb);
  const ids = { serie: `cupom-serie-${a}`, proximo: `cupom-proximo-${a}`, csc: `cupom-csc-${a}`, idCsc: `cupom-idcsc-${a}` };

  const erros: Record<string, string | undefined> = {};
  const nSerie = inteiro(serie);
  if (serie.trim() !== '' && (nSerie === null || nSerie > 889)) erros.serie = 'A série vai de 0 a 889.';
  else if (nSerie !== null && mudouSerie && seriesDoCaixa.includes(nSerie)) erros.serie = `A série ${nSerie} é do caixa de hoje. Escolha outra.`;
  const nProximo = inteiro(proximo);
  if (mudouProximo && (nProximo === null || nProximo < 1 || nProximo > 999_999_999)) erros.proximo = 'O número do próximo cupom vai de 1 a 999999999.';
  else if (mudouProximo && !mudouSerie && amb.serie !== null && amb.ultimo_numero_usado !== null && nProximo !== null && nProximo <= amb.ultimo_numero_usado) {
    erros.proximo = `O próximo número tem de ser maior que ${amb.ultimo_numero_usado}, o último usado na série ${amb.serie}.`;
  }
  if (csc !== '' && !/^[0-9A-Za-z]{16,36}$/.test(csc.trim())) erros.csc = 'O código de segurança tem de 16 a 36 letras e números.';
  const nId = inteiro(idCsc);
  if (mudouId && (nId === null || nId < 1 || nId > 999_999)) erros.idCsc = 'O número do código vai de 1 a 999999.';
  const ver = (k: string) => (tocados.has(k) ? erros[k] : undefined);

  const salvar = () => acao.rodar(async () => {
    const com = Object.keys(erros).filter((k) => erros[k]);
    if (com.length > 0) {
      setTocados(new Set(com));
      focarErro(ids[com[0] as keyof typeof ids]);
      return;
    }
    // só o que mudou: trocar a série sem mexer no número começa a série nova no 1 (o servidor decide)
    const dto: { serie?: number; proximo_numero?: number; id_csc?: number; csc?: string } = {};
    if (mudouSerie && nSerie !== null && !travada) dto.serie = nSerie;
    if (mudouProximo && nProximo !== null) dto.proximo_numero = nProximo;
    if (mudouId && nId !== null) dto.id_csc = nId;
    if (csc.trim() !== '') dto.csc = csc.trim();
    if (Object.keys(dto).length > 0) {
      const r = await salvarAmbienteCupom(a, dto);
      setCsc('');
      qc.setQueryData(chaveAmbiente(a), r);
      await qc.invalidateQueries({ queryKey: CHAVES_CUPOM.situacao });
    }
    toast.success('Dados salvos.');
  });

  return (
    <form className="space-y-4" noValidate onSubmit={(ev) => { ev.preventDefault(); void salvar(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          id={ids.serie} rotulo="Série" erro={ver('serie')}
          ajuda={travada ? (
            <>
              Há {amb.pendentes_na_serie.total} {amb.pendentes_na_serie.total === 1 ? 'cupom pendente' : 'cupons pendentes'} nesta série. Resolva antes de trocar a série.{' '}
              {amb.pendentes_na_serie.primeiro_id && <Link href={`/cupom/${amb.pendentes_na_serie.primeiro_id}`} className={LINK}>Ver o cupom</Link>}
            </>
          ) : 'Número de 0 a 889 que separa os cupons daqui dos do caixa de hoje. Tem de ser diferente da série do caixa de hoje (por exemplo, 2, se ele usa 1).'}
        >
          <Input
            id={ids.serie} className="h-11" inputMode="numeric" value={serie} readOnly={travada} aria-disabled={travada || undefined}
            aria-invalid={ver('serie') ? true : undefined} aria-describedby={descr(ids.serie, true, ver('serie'))}
            onChange={(ev) => !travada && setSerie(ev.target.value)} onBlur={() => tocar('serie')}
          />
        </Campo>
        <Campo
          id={ids.proximo} rotulo="Número do próximo cupom" erro={ver('proximo')}
          ajuda={`Numa série nova, comece em 1.${amb.ultimo_numero_usado !== null ? ` Último usado nesta série: ${amb.ultimo_numero_usado}.` : ''}`}
        >
          <Input
            id={ids.proximo} className="h-11" inputMode="numeric" value={proximo} aria-invalid={ver('proximo') ? true : undefined}
            aria-describedby={descr(ids.proximo, true, ver('proximo'))} onChange={(ev) => setProximo(ev.target.value)} onBlur={() => tocar('proximo')}
          />
        </Campo>
      </div>

      {!trocando && guardado ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Código de segurança (CSC)</p>
          <p className="text-sm">{guardado}</p>
          <button id={ids.csc} type="button" className={LINK} onClick={() => setTrocando(true)}>Trocar o código</button>
        </div>
      ) : (
        <Campo
          id={ids.csc} rotulo="Código de segurança (CSC)" erro={ver('csc')}
          ajuda={
            <>
              Código que a SEFAZ dá à empresa para o QR Code do cupom (16 a 36 letras e números). Pegue no portal da NFC-e da SEFAZ-SP, em “Gerenciar
              Cód. Segurança”, ou com quem instalou o caixa de hoje: pode usar o mesmo código dele ou o segundo. O modo de teste tem código próprio.{' '}
              <strong>Não apague (revogue) no portal o código que o caixa de hoje usa: ele para de emitir.</strong>
            </>
          }
        >
          <div className="flex gap-2">
            <Input
              id={ids.csc} className="h-11 min-w-0 flex-1" type={mostrar ? 'text' : 'password'} value={csc} autoComplete="off" spellCheck={false}
              autoCapitalize="none" autoCorrect="off" aria-invalid={ver('csc') ? true : undefined} aria-describedby={descr(ids.csc, true, ver('csc'))}
              onChange={(ev) => setCsc(ev.target.value)} onBlur={() => tocar('csc')}
            />
            <Button
              type="button" variant="outline" className="h-11 w-11 shrink-0 p-0" aria-pressed={mostrar} aria-label={mostrar ? 'Ocultar código' : 'Mostrar código'}
              onClick={() => setMostrar((m) => !m)}
            >
              {mostrar ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </Campo>
      )}

      <Campo id={ids.idCsc} rotulo="Número do código (IdCSC)" erro={ver('idCsc')} ajuda="O número que aparece junto do código no portal (por exemplo, 000001 ou 1).">
        <Input
          id={ids.idCsc} className="h-11 sm:w-40" inputMode="numeric" value={idCsc} aria-invalid={ver('idCsc') ? true : undefined}
          aria-describedby={descr(ids.idCsc, true, ver('idCsc'))} onChange={(ev) => setIdCsc(ev.target.value)} onBlur={() => tocar('idCsc')}
        />
      </Campo>
      <CaixaErro erro={acao.erro} caixa={acao.caixa} />
      <Button type="submit" className="h-auto min-h-11 w-full whitespace-normal sm:w-auto" disabled={acao.ocupado}>
        {acao.ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Salvando…</>
          : a === 'homologacao' ? 'Salvar numeração do modo de teste' : 'Salvar numeração valendo'}
      </Button>
    </form>
  );
}

// ============================================================================================================== Caixa de hoje (5.4)

function QuadroCaixaDeHoje() {
  const q = useEmitente();
  const e = q.data;
  return (
    <Panel title="Caixa de hoje">
      {q.isPending ? <Carregando /> : !e ? (
        <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => void q.refetch()}>Tentar de novo</Button>
      ) : (
        <FormCaixaDeHoje key={JSON.stringify([e.series_outro_sistema, e.sem_outro_sistema, e.cupom_lanca_venda])} e={e} />
      )}
    </Panel>
  );
}

function FormCaixaDeHoje({ e }: { e: EmitenteCupom }) {
  const salvarEmitente = useSalvarEmitente();
  const acao = useAcao();
  const [series, setSeries] = useState<number[]>(e.series_outro_sistema);
  const [semOutro, setSemOutro] = useState(e.sem_outro_sistema);
  const [nova, setNova] = useState('');
  const [erroSerie, setErroSerie] = useState<string | null>(null);
  const [lanca, setLanca] = useState<boolean | null>(e.cupom_lanca_venda);

  const adicionar = () => {
    const n = inteiro(nova);
    if (n === null || n > 889) return setErroSerie('A série vai de 0 a 889.');
    setErroSerie(null);
    setSeries((s) => (s.includes(n) ? s : [...s, n].sort((x, y) => x - y)));
    setNova('');
  };

  const salvar = () => acao.rodar(async () => {
    if (!semOutro && series.length === 0) {
      setErroSerie('Informe as séries do caixa de hoje ou marque que não há outro sistema.');
      focarErro('cupom-series');
      return;
    }
    const dto: SalvarEmitenteCupom = { series_outro_sistema: semOutro ? [] : series, sem_outro_sistema: semOutro };
    if (lanca !== null && lanca !== e.cupom_lanca_venda) dto.cupom_lanca_venda = lanca;
    await salvarEmitente(dto);
    toast.success('Dados salvos.');
  });

  return (
    <form className="space-y-4" noValidate onSubmit={(ev) => { ev.preventDefault(); void salvar(); }}>
      <div className="space-y-2">
        <Label htmlFor="cupom-series">Séries usadas pelo caixa de hoje</Label>
        <div className="flex gap-2">
          <Input
            id="cupom-series" className="h-11 w-28" inputMode="numeric" value={nova} disabled={semOutro} aria-invalid={erroSerie ? true : undefined}
            aria-describedby={descr('cupom-series', true, erroSerie)} onChange={(ev) => setNova(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); adicionar(); } }}
          />
          <Button type="button" variant="outline" className="h-11" disabled={semOutro} onClick={adicionar}>Adicionar</Button>
        </div>
        {!semOutro && series.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {series.map((n) => (
              <li key={n}>
                <Button type="button" variant="secondary" className="h-11" aria-label={`Tirar a série ${n}`} onClick={() => setSeries((s) => s.filter((x) => x !== n))}>
                  Série {n} <X className="ml-1 h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <Checkbox checked={semOutro} onCheckedChange={(v) => { setSemOutro(v === true); setErroSerie(null); }} />
          Nenhum outro sistema emite cupom fiscal neste CNPJ
        </label>
        <p id="cupom-series-ajuda" className="text-sm text-muted-foreground">
          Pergunte a quem instalou o caixa de hoje. Com a mesma série nos dois, a SEFAZ recusa os cupons.
        </p>
        {erroSerie && <p id="cupom-series-erro" className="text-sm text-destructive">{erroSerie}</p>}
      </div>

      <div className="space-y-1">
        <Label id="cupom-lanca-venda-rotulo">Quem conta no estoque as vendas emitidas aqui?</Label>
        <RadioGroup
          id="cupom-lanca-venda" aria-labelledby="cupom-lanca-venda-rotulo" value={lanca === null ? '' : String(lanca)}
          onValueChange={(v) => setLanca(v === 'true')} className="gap-2"
        >
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <RadioGroupItem value="true" className="mt-1" />
            <span><strong>O Freela Comanda, pelo cupom</strong><span className="block text-muted-foreground">Use se a venda NÃO passa no caixa de hoje. Cada cupom autorizado baixa o estoque pela ficha técnica.</span></span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <RadioGroupItem value="false" className="mt-1" />
            <span><strong>A importação de vendas do caixa de hoje</strong><span className="block text-muted-foreground">Use se a venda também fica registrada no caixa de hoje (pedido, mesa ou cozinha). O cupom não mexe no estoque.</span></span>
          </label>
        </RadioGroup>
        <p className="text-sm text-muted-foreground">
          {e.cupom_lanca_venda === null
            ? 'Ainda sem resposta. Precisa responder antes de ligar valendo.'
            : `Respondido${e.cupom_lanca_venda_por_nome ? ` por ${e.cupom_lanca_venda_por_nome}` : ''}${e.cupom_lanca_venda_em ? ` em ${dataHoraSp(e.cupom_lanca_venda_em)}` : ''}.`}
        </p>
      </div>
      <CaixaErro erro={acao.erro} caixa={acao.caixa} />
      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={acao.ocupado}>
        {acao.ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Salvando…</> : 'Salvar caixa de hoje'}
      </Button>
    </form>
  );
}

// ======================================================================================================= quadros recolhidos (5.5)

function QuadroResponsavel() {
  const q = useEmitente();
  const e = q.data;
  if (!e) return null;
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">Responsável técnico (opcional)</summary>
      <FormResponsavel key={JSON.stringify([e.resp_tec_cnpj, e.resp_tec_contato, e.resp_tec_email, e.resp_tec_fone])} e={e} />
    </details>
  );
}

function FormResponsavel({ e }: { e: EmitenteCupom }) {
  const salvarEmitente = useSalvarEmitente();
  const acao = useAcao();
  const [f, setF] = useState({
    cnpj: e.resp_tec_cnpj ? formatarCnpj(e.resp_tec_cnpj) : '', contato: e.resp_tec_contato ?? '', email: e.resp_tec_email ?? '', fone: e.resp_tec_fone ?? '',
  });
  const [aviso, setAviso] = useState<string | null>(null);
  const salvar = () => acao.rodar(async () => {
    const vals = [f.cnpj, f.contato, f.email, f.fone].map((x) => x.trim());
    const cheios = vals.filter((x) => x !== '').length;
    if (cheios !== 0 && cheios !== 4) return setAviso('Preencha os quatro campos, ou deixe todos vazios.');
    const cnpj = f.cnpj.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (cheios === 4 && !cnpjValido(cnpj)) return setAviso('Este CNPJ não confere.');
    setAviso(null);
    await salvarEmitente({
      resp_tec_cnpj: cheios === 0 ? null : cnpj,
      resp_tec_contato: vazioNulo(f.contato),
      resp_tec_email: vazioNulo(f.email),
      resp_tec_fone: cheios === 0 ? null : vazioNulo(soNumeros(f.fone)),
    });
    toast.success('Dados salvos.');
  });
  const campo = (k: keyof typeof f, rotulo: string, extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <Campo id={`resp-${k}`} rotulo={rotulo}>
      <Input id={`resp-${k}`} className="h-11" value={f[k]} aria-describedby={aviso ? 'resp-aviso' : 'resp-ajuda'} onChange={(ev) => setF((x) => ({ ...x, [k]: ev.target.value }))} {...extra} />
    </Campo>
  );
  return (
    <form className="mt-2 space-y-4" noValidate onSubmit={(ev) => { ev.preventDefault(); void salvar(); }}>
      <p id="resp-ajuda" className="text-sm text-muted-foreground">A empresa responsável pelo sistema. Em SP não é obrigatório; deixe vazio se não souber.</p>
      {campo('cnpj', 'CNPJ', { autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false, onBlur: () => setF((x) => ({ ...x, cnpj: formatarCnpj(x.cnpj) })) })}
      {campo('contato', 'Nome do contato')}
      {campo('email', 'E-mail', { type: 'email', autoComplete: 'off' })}
      {campo('fone', 'Telefone', { inputMode: 'tel' })}
      {aviso && <p id="resp-aviso" role="alert" className="text-sm text-destructive">{aviso}</p>}
      <CaixaErro erro={acao.erro} caixa={acao.caixa} />
      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={acao.ocupado}>Salvar responsável técnico</Button>
    </form>
  );
}

/**
 * "Reforma tributária (a partir de 2027)" (UX 5.5). As opções da NT 2026.005 não estão no projeto: até lá, o código que o contador passar
 * (0 a 9, o formato que o servidor confere) num campo numérico; vazio = "Não informar (o caso comum)".
 */
function QuadroReforma() {
  const q = useEmitente();
  const e = q.data;
  if (!e) return null;
  return (
    <details className={cn('rounded-xl border bg-card p-4')}>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">Reforma tributária (a partir de 2027)</summary>
      <FormReforma key={String(e.tp_regime_ibscbs)} e={e} />
    </details>
  );
}

function FormReforma({ e }: { e: EmitenteCupom }) {
  const salvarEmitente = useSalvarEmitente();
  const acao = useAcao();
  const [v, setV] = useState(e.tp_regime_ibscbs === null ? '' : String(e.tp_regime_ibscbs));
  const [aviso, setAviso] = useState<string | null>(null);
  const salvar = () => acao.rodar(async () => {
    const t = v.trim();
    if (t !== '' && !/^\d$/.test(t)) return setAviso('O regime do IBS/CBS não confere.');
    setAviso(null);
    await salvarEmitente({ tp_regime_ibscbs: t === '' ? null : Number(t) });
    toast.success('Dados salvos.');
  });
  return (
    <form className="mt-2 space-y-4" noValidate onSubmit={(ev) => { ev.preventDefault(); void salvar(); }}>
      <Campo
        id="cupom-tp-regime" rotulo="Regime do IBS/CBS (código)" erro={aviso}
        ajuda="Deixe vazio para não informar (o caso comum). Só para empresa do Simples que optou pelo regime regular do IBS/CBS. O contador informa. Guardamos agora; ainda não vai no cupom."
      >
        <Input
          id="cupom-tp-regime" className="h-11 w-28" inputMode="numeric" value={v} aria-invalid={aviso ? true : undefined}
          aria-describedby={descr('cupom-tp-regime', true, aviso)} onChange={(ev) => setV(ev.target.value)}
        />
      </Campo>
      <CaixaErro erro={acao.erro} caixa={acao.caixa} />
      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={acao.ocupado}>Salvar reforma tributária</Button>
    </form>
  );
}
