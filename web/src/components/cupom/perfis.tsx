'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert, Loader2, Plus } from 'lucide-react';
import { atualizarPerfilFiscal, criarPerfilFiscal, type PerfilFiscal } from '@/lib/erp-api';
import { errMsg } from '@/lib/db';
import {
  ajudaDoCfop, CHAVES_CUPOM, errosDoPerfil, formDoPerfil, linhaDoPerfil, motivoCfopFora, OPCOES_CFOP, OPCOES_CSOSN, OPCOES_CST, OPCOES_PIS_COFINS,
  perfilParaSalvar, textoDesativarPerfil, usaCsosn, type FormPerfil, type OpcaoFiscal,
} from '@/lib/cupom';
import { semToqueDuplo } from '@/lib/notas-sefaz';
import { useIsMobile } from '@/hooks/use-mobile';
import { Panel, Tag } from '@/components/ui-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export const CHAVE_PERFIS = ['cupom-fiscal', 'perfis'] as const;
export const CHAVE_EMITENTE = ['cupom-fiscal', 'emitente'] as const;
const SELECT = 'h-11 w-full rounded-md border bg-background px-3 text-sm';
/** Sem o "X" padrão do shadcn (alvo de 16 px, "Close" em inglês): a folha tem "Fechar" (como em `conferir-sheet.tsx`). */
export const SEM_X = '[&>button.absolute]:hidden';
const ERRO_CAIXA = 'flex min-w-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm';

/**
 * "Perfis fiscais" no alto da aba Produtos (UX 5.6): aberto quando não há perfil, recolhido ("3 perfis") quando há. O regime da empresa
 * (`crt`) decide os códigos (CSOSN no Simples e no MEI; CST no regime normal); sem regime, não há "+ Novo perfil".
 */
export function Perfis({ perfis, crt, carregando, erro, onTentar }: {
  perfis: PerfilFiscal[] | undefined;
  crt: number | null | undefined;
  carregando: boolean;
  erro: boolean;
  onTentar(): void;
}) {
  const [folha, setFolha] = useState<{ perfil: PerfilFiscal | null } | null>(null);
  const lista = perfis ?? [];
  const n = lista.length;
  const semRegime = crt === null;

  return (
    <Panel>
      {/* aberto sem perfil (e com erro ou sem regime: o recado precisa aparecer); recolhido com o resumo quando há perfis */}
      <details open={(perfis !== undefined && n === 0) || erro || semRegime || undefined} className="group">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Perfis fiscais{n > 0 ? ` (${n} ${n === 1 ? 'perfil' : 'perfis'})` : ''}
        </summary>
        <div className="mt-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            Um perfil junta os códigos de imposto que se repetem, como “Prato da casa” ou “Bebida com imposto já pago”. O contador diz quais a
            casa precisa (costumam ser poucos); depois você só escolhe o perfil de cada produto.
          </p>
          {carregando && <div className="space-y-2" aria-busy="true"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-6 w-1/2" /></div>}
          {erro && !perfis && (
            <div className="space-y-2 text-sm">
              <p>Não consegui ver os perfis agora. Toque em Tentar de novo.</p>
              <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={onTentar}>Tentar de novo</Button>
            </div>
          )}
          {semRegime && (
            <div role="status" className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p>Escolha primeiro o regime da empresa em Configurações → Cupom fiscal: ele decide os códigos dos perfis.</p>
                <Link href="/configuracoes?aba=cupom#cupom-crt" className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">
                  Ir para Configurações
                </Link>
              </div>
            </div>
          )}
          {perfis && n === 0 && !semRegime && <p className="text-sm">Nenhum perfil ainda. Peça ao contador os perfis da casa.</p>}
          {n > 0 && (
            <ul className="divide-y rounded-lg border">
              {lista.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-sm">{linhaDoPerfil(p)}</p>
                    <div className="flex flex-wrap gap-1">
                      {!p.ativo && <Tag tone="muted">Desativado</Tag>}
                      {p.ativo && p.vale_no_regime === false && (
                        <Tag tone="warn"><CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />Não vale no regime da empresa</Tag>
                      )}
                    </div>
                  </div>
                  <Button variant="outline" className="h-11" aria-label={`Editar o perfil ${p.nome}`} onClick={() => setFolha({ perfil: p })}>Editar</Button>
                </li>
              ))}
            </ul>
          )}
          {perfis && !semRegime && crt !== undefined && (
            <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setFolha({ perfil: null })}>
              <Plus className="mr-1 h-4 w-4" aria-hidden />Novo perfil
            </Button>
          )}
        </div>
      </details>
      {folha && <FolhaPerfil perfil={folha.perfil} crt={crt ?? null} onFechar={() => setFolha(null)} />}
    </Panel>
  );
}

/** Um `select` com as opções que não combinam desabilitadas (o motivo vai no texto da opção e na linha de baixo). */
function SelectFiscal({ id, valor, opcoes, vazio, onMudar, onBlur, desabilitar, erro, ajuda }: {
  id: string;
  valor: string;
  opcoes: readonly OpcaoFiscal[];
  vazio: string;
  onMudar(v: string): void;
  onBlur?(): void;
  desabilitar?(o: OpcaoFiscal): boolean;
  erro?: string;
  ajuda?: string | null;
}) {
  const descr = [ajuda ? `${id}-ajuda` : null, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <select
        id={id} className={cn(SELECT, erro && 'border-destructive')} value={valor} aria-invalid={erro ? true : undefined} aria-describedby={descr}
        onChange={(e) => onMudar(e.target.value)} onBlur={onBlur}
      >
        <option value="">{vazio}</option>
        {opcoes.map((o) => {
          const fora = !!o.motivo || (desabilitar?.(o) ?? false);
          return <option key={o.codigo} value={o.codigo} disabled={fora && o.codigo !== valor}>{fora ? `${o.texto} (${o.motivo ? 'ainda não pode ser usado' : 'não combina'})` : o.texto}</option>;
        })}
      </select>
      {ajuda && <p id={`${id}-ajuda`} className="text-sm text-muted-foreground">{ajuda}</p>}
      {erro && <p id={`${id}-erro`} className="text-sm text-destructive">{erro}</p>}
    </>
  );
}

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id}>{rotulo}</Label>{children}</div>;
}

/**
 * A folha do perfil (UX 5.6): evita a combinação errada em vez de avisar depois (CFOP filtrado pelo CSOSN/CST; CST 20 e os CST de
 * PIS/COFINS que pedem alíquota desabilitados, com o motivo). Validação no blur; o servidor confere tudo de novo (a frase dele aparece na
 * caixa vermelha). Desativar um perfil em uso pede confirmação.
 */
function FolhaPerfil({ perfil, crt, onFechar }: { perfil: PerfilFiscal | null; crt: number | null; onFechar(): void }) {
  const qc = useQueryClient();
  const celular = useIsMobile();
  const [f, setF] = useState<FormPerfil>(() => formDoPerfil(perfil));
  const [tocados, setTocados] = useState<Set<keyof FormPerfil>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarDesativar, setConfirmarDesativar] = useState(false);
  const emCurso = useRef(false);
  const caixa = useRef<HTMLDivElement>(null);
  const simples = crt === null ? (perfil ? perfil.csosn !== null : true) : usaCsosn(crt);
  const crtEfetivo = crt ?? (simples ? 1 : 3);
  const erros = errosDoPerfil(f, crtEfetivo);
  const ver = (k: keyof FormPerfil) => (tocados.has(k) ? erros[k] : undefined);
  const tocar = (k: keyof FormPerfil) => setTocados((t) => new Set(t).add(k));
  const mudar = (k: keyof FormPerfil, v: string) => setF((x) => ({ ...x, [k]: v }));
  const codigo = simples ? { csosn: f.csosn, cst_icms: null } : { csosn: null, cst_icms: f.cst_icms };
  // o motivo das opções de CFOP desabilitadas (o mesmo para todas: depende só do código do imposto)
  const motivoDosCfops = OPCOES_CFOP.map((o) => motivoCfopFora(o.codigo, codigo)).find((m) => m !== null) ?? null;

  useEffect(() => { if (erro) caixa.current?.focus(); }, [erro]);

  const depois = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: CHAVE_PERFIS }),
      qc.invalidateQueries({ queryKey: CHAVES_CUPOM.produtos }),
      qc.invalidateQueries({ queryKey: CHAVES_CUPOM.situacao }),
    ]);
  };

  const salvar = () => semToqueDuplo(emCurso, async () => {
    const todos = Object.keys(erros) as (keyof FormPerfil)[];
    if (todos.length > 0) {
      setTocados(new Set(todos));
      const el = document.getElementById(`perfil-${todos[0]}`);
      const bloco = el?.closest('details');
      if (bloco) bloco.open = true; // os campos de 2027 ficam no bloco recolhido
      el?.focus();
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const corpo = perfilParaSalvar(f, crtEfetivo);
      if (perfil) await atualizarPerfilFiscal(perfil.id, corpo);
      else await criarPerfilFiscal(corpo);
      await depois();
      toast.success('Perfil salvo.');
      onFechar();
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });

  const mudarAtivo = (ativo: boolean) => semToqueDuplo(emCurso, async () => {
    if (!perfil) return;
    setOcupado(true);
    setErro(null);
    try {
      await atualizarPerfilFiscal(perfil.id, { ativo });
      await depois();
      toast.success(ativo ? 'Perfil ativado.' : 'Perfil desativado.');
      setConfirmarDesativar(false);
      onFechar();
    } catch (e) {
      setConfirmarDesativar(false);
      setErro(errMsg(e));
    } finally {
      setOcupado(false);
    }
  });

  return (
    <Sheet open onOpenChange={(o) => { if (!o && !ocupado) onFechar(); }}>
      <SheetContent
        side={celular ? 'bottom' : 'right'}
        className={cn('overflow-y-auto p-4', SEM_X, celular ? 'max-h-[90dvh] rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]' : 'w-full sm:max-w-md')}
      >
        <SheetTitle>{perfil ? `Perfil: ${perfil.nome}` : 'Novo perfil fiscal'}</SheetTitle>
        <SheetDescription className="sr-only">Os códigos de imposto do perfil. O contador informa.</SheetDescription>
        <form className="mt-4 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          {erro && (
            <div ref={caixa} tabIndex={-1} role="alert" className={ERRO_CAIXA}>
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden /><span className="min-w-0 break-words">{erro}</span>
            </div>
          )}
          <Campo id="perfil-nome" rotulo="Nome do perfil">
            <Input
              id="perfil-nome" className="h-11" value={f.nome} maxLength={80} aria-invalid={ver('nome') ? true : undefined}
              aria-describedby={`perfil-nome-ajuda${ver('nome') ? ' perfil-nome-erro' : ''}`}
              onChange={(e) => mudar('nome', e.target.value)} onBlur={() => tocar('nome')}
            />
            <p id="perfil-nome-ajuda" className="text-sm text-muted-foreground">Um nome que você reconheça, como “Prato da casa”.</p>
            {ver('nome') && <p id="perfil-nome-erro" className="text-sm text-destructive">{ver('nome')}</p>}
          </Campo>

          {simples ? (
            <Campo id="perfil-csosn" rotulo="Código do imposto no Simples (CSOSN)">
              <SelectFiscal
                id="perfil-csosn" valor={f.csosn} opcoes={OPCOES_CSOSN} vazio="Escolha o CSOSN" ajuda="O contador informa." erro={ver('csosn')}
                onMudar={(v) => mudar('csosn', v)} onBlur={() => tocar('csosn')}
              />
            </Campo>
          ) : (
            <>
              <Campo id="perfil-cst_icms" rotulo="Situação do ICMS (CST)">
                <SelectFiscal
                  id="perfil-cst_icms" valor={f.cst_icms} opcoes={OPCOES_CST} vazio="Escolha o CST" erro={ver('cst_icms')}
                  ajuda="O contador informa. O CST 20 ainda não pode ser usado no Comanda. Fale com o contador."
                  onMudar={(v) => mudar('cst_icms', v)} onBlur={() => tocar('cst_icms')}
                />
              </Campo>
              <Campo id="perfil-aliq_icms" rotulo="Alíquota do ICMS (%)">
                <Input
                  id="perfil-aliq_icms" className="h-11" inputMode="decimal" value={f.aliq_icms} aria-invalid={ver('aliq_icms') ? true : undefined}
                  aria-describedby={ver('aliq_icms') ? 'perfil-aliq_icms-erro' : undefined}
                  onChange={(e) => mudar('aliq_icms', e.target.value)} onBlur={() => tocar('aliq_icms')}
                />
                {ver('aliq_icms') && <p id="perfil-aliq_icms-erro" className="text-sm text-destructive">{ver('aliq_icms')}</p>}
              </Campo>
            </>
          )}

          <Campo id="perfil-cfop" rotulo="Tipo de venda (CFOP)">
            <SelectFiscal
              id="perfil-cfop" valor={f.cfop} opcoes={OPCOES_CFOP} vazio="Escolha o tipo de venda" erro={ver('cfop')}
              ajuda={ajudaDoCfop({ csosn: simples ? f.csosn : '', cst_icms: simples ? '' : f.cst_icms }) ?? motivoDosCfops}
              desabilitar={(o) => motivoCfopFora(o.codigo, codigo) !== null}
              onMudar={(v) => { mudar('cfop', v); tocar('cfop'); }} onBlur={() => tocar('cfop')}
            />
          </Campo>

          <Campo id="perfil-pis_cst" rotulo="CST do PIS (opcional)">
            <SelectFiscal
              id="perfil-pis_cst" valor={f.pis_cst} opcoes={OPCOES_PIS_COFINS} vazio="Sem PIS"
              ajuda="Deixe vazio se o contador não pedir: o cupom pode ir sem PIS e COFINS. Os que pedem alíquota ainda não podem ser usados no Comanda."
              erro={ver('pis_cst')} onMudar={(v) => mudar('pis_cst', v)} onBlur={() => tocar('pis_cst')}
            />
          </Campo>
          <Campo id="perfil-cofins_cst" rotulo="CST da COFINS (opcional)">
            <SelectFiscal
              id="perfil-cofins_cst" valor={f.cofins_cst} opcoes={OPCOES_PIS_COFINS} vazio="Sem COFINS"
              ajuda="Deixe vazio se o contador não pedir: o cupom pode ir sem PIS e COFINS."
              erro={ver('cofins_cst')} onMudar={(v) => mudar('cofins_cst', v)} onBlur={() => tocar('cofins_cst')}
            />
          </Campo>

          <details className="rounded-lg border p-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm">Reforma tributária (a partir de 2027) — ainda não vai no cupom</summary>
            <div className="mt-2 space-y-3">
              <p className="text-sm text-muted-foreground">O contador informa. Guardamos agora; só vai no cupom quando a SEFAZ começar a pedir.</p>
              {(simples
                ? ([['c_ativ_sn', 'Atividade no Simples (cAtivSN)', 'numeric'], ['ibs_sn_aliq', 'Alíquota efetiva do IBS (%)', 'decimal'], ['cbs_sn_aliq', 'Alíquota efetiva da CBS (%)', 'decimal']] as const)
                : ([['ibscbs_cst', 'CST do IBS/CBS', 'numeric'], ['ibscbs_cclass_trib', 'Classificação do IBS/CBS (cClassTrib)', 'numeric']] as const)
              ).map(([k, rotulo, modo]) => (
                <Campo key={k} id={`perfil-${k}`} rotulo={rotulo}>
                  <Input
                    id={`perfil-${k}`} className="h-11" inputMode={modo} value={f[k]} aria-invalid={ver(k) ? true : undefined}
                    aria-describedby={ver(k) ? `perfil-${k}-erro` : undefined}
                    onChange={(e) => mudar(k, e.target.value)} onBlur={() => tocar(k)}
                  />
                  {ver(k) && <p id={`perfil-${k}-erro`} className="text-sm text-destructive">{ver(k)}</p>}
                </Campo>
              ))}
            </div>
          </details>

          <div className="flex flex-col gap-2 pt-2">
            <Button type="submit" className="h-11 w-full" disabled={ocupado}>
              {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Salvando…</> : 'Salvar perfil'}
            </Button>
            {perfil?.ativo && (
              <Button
                type="button" variant="outline" className="h-11 w-full text-destructive" disabled={ocupado}
                onClick={() => (perfil.produtos > 0 ? setConfirmarDesativar(true) : void mudarAtivo(false))}
              >
                Desativar
              </Button>
            )}
            {perfil && !perfil.ativo && (
              <Button type="button" variant="outline" className="h-11 w-full" disabled={ocupado} onClick={() => void mudarAtivo(true)}>Ativar de novo</Button>
            )}
            <Button type="button" variant="ghost" className="h-11 w-full" disabled={ocupado} onClick={onFechar}>Fechar</Button>
          </div>
        </form>

        {perfil && (
          <AlertDialog open={confirmarDesativar} onOpenChange={(o) => { if (!ocupado) setConfirmarDesativar(o); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Desativar o perfil {perfil.nome}?</AlertDialogTitle>
                <AlertDialogDescription>{textoDesativarPerfil(perfil.produtos)}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2">
                <AlertDialogCancel className="h-11" disabled={ocupado}>Manter ativo</AlertDialogCancel>
                <Button variant="destructive" className="h-11" disabled={ocupado} onClick={() => void mudarAtivo(false)}>Desativar perfil</Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </SheetContent>
    </Sheet>
  );
}
