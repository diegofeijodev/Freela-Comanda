import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { MODULOS, MODULOS_KEY, PERMISSAO_KEY } from '../decorators/permissao.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { HealthController } from '../health/health.controller';
import { AuthController } from '../../modules/auth/auth.controller';
import { CadastrosController } from '../../modules/cadastros/cadastros.controller';
import { CaixaController } from '../../modules/caixa/caixa.controller';
import { CertificadoDigitalController } from '../../modules/certificado-digital/certificado-digital.controller';
import { CardapioController } from '../../modules/cardapio/cardapio.controller';
import { ComprasController } from '../../modules/compras/compras.controller';
import { ContasController } from '../../modules/contas/contas.controller';
import { CupomFiscalController } from '../../modules/cupom-fiscal/cupom-fiscal.controller';
import { EmpresasController } from '../../modules/empresas/empresas.controller';
import { EstoqueController } from '../../modules/estoque/estoque.controller';
import { ImportacoesController } from '../../modules/importacoes/importacoes.controller';
import { InventariosController } from '../../modules/inventarios/inventarios.controller';
import { IaChaveController } from '../../modules/leitura-pdf/ia/ia-chave.controller';
import { LeituraPdfController } from '../../modules/leitura-pdf/leitura-pdf.controller';
import { NotasController } from '../../modules/notas/notas.controller';
import { NotasSefazController } from '../../modules/notas-sefaz/notas-sefaz.controller';
import { PontoController } from '../../modules/ponto/ponto.controller';
import { UsuariosController } from '../../modules/usuarios/usuarios.controller';
import { VendasController } from '../../modules/vendas/vendas.controller';

const CONTROLLERS = [
  HealthController,
  AuthController,
  CadastrosController,
  CaixaController,
  CardapioController,
  CertificadoDigitalController,
  ComprasController,
  ContasController,
  CupomFiscalController,
  EmpresasController,
  EstoqueController,
  ImportacoesController,
  InventariosController,
  IaChaveController,
  LeituraPdfController,
  NotasController,
  NotasSefazController,
  PontoController,
  UsuariosController,
  VendasController,
];

type Rota = { rota: string; marca: string; modulos?: string[] };

function rotas(): Rota[] {
  const out: Rota[] = [];
  for (const c of CONTROLLERS) {
    const base = String(Reflect.getMetadata(PATH_METADATA, c) ?? '');
    for (const nome of Object.getOwnPropertyNames(c.prototype)) {
      const h = (c.prototype as unknown as Record<string, unknown>)[nome];
      if (nome === 'constructor' || typeof h !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, h);
      if (path === undefined) continue;
      const metodo = RequestMethod[Reflect.getMetadata(METHOD_METADATA, h) as number];
      const publica = Reflect.getMetadata(IS_PUBLIC_KEY, h) ?? Reflect.getMetadata(IS_PUBLIC_KEY, c);
      const marca = publica ? 'public' : (Reflect.getMetadata(PERMISSAO_KEY, h) ?? Reflect.getMetadata(PERMISSAO_KEY, c) ?? 'SEM MARCA');
      const modulos: string[] | undefined = Reflect.getMetadata(MODULOS_KEY, h) ?? Reflect.getMetadata(MODULOS_KEY, c);
      out.push({ rota: `${metodo} /${[base, path].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/\/$/, ''), marca, ...(modulos?.length ? { modulos } : {}) });
    }
  }
  return out;
}

describe('proteção das rotas (substitui as políticas RLS do Supabase)', () => {
  const comModulos = rotas();
  const todas = comModulos.map(({ rota, marca }) => ({ rota, marca }));

  it('encontra as rotas', () => {
    expect(todas.length).toBeGreaterThan(60);
  });

  it('toda rota tem marca de permissão ou é pública de propósito', () => {
    expect(todas.filter((r) => r.marca === 'SEM MARCA')).toEqual([]);
  });

  it('a chave de IA é só do admin', () => {
    expect(todas.filter((r) => r.rota.includes('/ia-chave'))).toEqual([
      { rota: 'GET /v1/ia-chave', marca: 'admin' },
      { rota: 'PUT /v1/ia-chave', marca: 'admin' },
      { rota: 'DELETE /v1/ia-chave', marca: 'admin' },
    ]);
  });

  it('o certificado digital é só do admin', () => {
    expect(todas.filter((r) => r.rota.includes('/certificado-digital'))).toEqual([
      { rota: 'GET /v1/certificado-digital', marca: 'admin' },
      { rota: 'PUT /v1/certificado-digital', marca: 'admin' },
      { rota: 'DELETE /v1/certificado-digital', marca: 'admin' },
    ]);
  });

  it('a sugestão de insumo por IA dos itens do XML é só do admin', () => {
    expect(todas.filter((r) => r.rota.includes('/sugerir-insumos'))).toEqual([{ rota: 'POST /v1/notas/sugerir-insumos', marca: 'admin' }]);
  });

  it('a leitura de nota e de DDA por IA é só do admin', () => {
    expect(todas.filter((r) => r.rota.includes('/ler-'))).toEqual([
      { rota: 'POST /v1/notas/ler-pdf', marca: 'admin' },
      { rota: 'POST /v1/notas/ler-foto', marca: 'admin' },
      { rota: 'POST /v1/importacoes/vendas/ler-pdf', marca: 'admin' },
      { rota: 'POST /v1/dda/ler-pdf', marca: 'admin' },
    ]);
  });

  it('importar vendas de outros sistemas é só do admin (origens, prévia, confirmar, recentes, leitura do PDF)', () => {
    const r = todas.filter((x) => /\/v1\/importacoes\/(origens|vendas\/)/.test(x.rota));
    expect(r.map((x) => x.rota).sort()).toEqual([
      'GET /v1/importacoes/origens',
      'GET /v1/importacoes/vendas/recentes',
      'POST /v1/importacoes/origens',
      'POST /v1/importacoes/vendas/confirmar',
      'POST /v1/importacoes/vendas/ler-pdf',
      'POST /v1/importacoes/vendas/previa',
      'PUT /v1/importacoes/origens/:id',
    ]);
    expect(r.every((x) => x.marca === 'admin')).toBe(true);
  });

  it('a consulta de nota repetida é só do admin', () => {
    expect(todas.filter((r) => r.rota.includes('/notas/repetidas'))).toEqual([{ rota: 'GET /v1/notas/repetidas', marca: 'admin' }]);
  });

  it('as notas da SEFAZ são só do admin', () => {
    expect(todas.filter((r) => r.rota.includes('/notas-sefaz'))).toEqual([
      { rota: 'GET /v1/notas-sefaz/situacao', marca: 'admin' },
      { rota: 'PUT /v1/notas-sefaz/configuracao', marca: 'admin' },
      { rota: 'PUT /v1/notas-sefaz/respostas', marca: 'admin' },
      { rota: 'POST /v1/notas-sefaz/buscar', marca: 'admin' },
      { rota: 'GET /v1/notas-sefaz', marca: 'admin' },
      { rota: 'GET /v1/notas-sefaz/:id/xml', marca: 'admin' },
      { rota: 'POST /v1/notas-sefaz/:id/ignorar', marca: 'admin' },
      { rota: 'POST /v1/notas-sefaz/:id/reabrir', marca: 'admin' },
      { rota: 'POST /v1/notas-sefaz/:id/responder-de-novo', marca: 'admin' },
    ]);
  });

  it('o cupom fiscal é só do admin (cadastro e emissão; o cupom mostra preço de venda)', () => {
    expect(todas.filter((r) => r.rota.includes('/cupom-fiscal'))).toEqual([
      { rota: 'GET /v1/cupom-fiscal/situacao', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/emitente', marca: 'admin' },
      { rota: 'PUT /v1/cupom-fiscal/emitente', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/ambientes/:ambiente', marca: 'admin' },
      { rota: 'PUT /v1/cupom-fiscal/ambientes/:ambiente', marca: 'admin' },
      { rota: 'PUT /v1/cupom-fiscal/ambientes/:ambiente/emissao', marca: 'admin' },
      { rota: 'POST /v1/cupom-fiscal/testar-conexao', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/vendas-no-periodo', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/xml-do-mes', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/cupons', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/cupons/:id', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/cupons/:id/danfe', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/cupons/:id/xml', marca: 'admin' },
      { rota: 'POST /v1/cupom-fiscal/cupons', marca: 'admin' },
      { rota: 'POST /v1/cupom-fiscal/cupons/:id/reenviar', marca: 'admin' },
      { rota: 'POST /v1/cupom-fiscal/cupons/:id/consultar', marca: 'admin' },
      { rota: 'POST /v1/cupom-fiscal/cupons/:id/cancelar', marca: 'admin' },
      { rota: 'POST /v1/cupom-fiscal/cupons/:id/descartar', marca: 'admin' },
      { rota: 'POST /v1/cupom-fiscal/cupons/:id/lancar-venda', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/perfis', marca: 'admin' },
      { rota: 'POST /v1/cupom-fiscal/perfis', marca: 'admin' },
      { rota: 'PATCH /v1/cupom-fiscal/perfis/:id', marca: 'admin' },
      { rota: 'GET /v1/cupom-fiscal/produtos', marca: 'admin' },
      { rota: 'PUT /v1/cupom-fiscal/produtos/perfil', marca: 'admin' },
      { rota: 'PUT /v1/cupom-fiscal/produtos/:itemCardapioId', marca: 'admin' },
    ]);
  });

  // O ponto: a loja só bate (com o token do terminal e o PIN); cadastros, ajustes, cálculo e exportação são do admin.
  it('do ponto, a loja só alcança o terminal', () => {
    const ponto = todas.filter((r) => r.rota.includes('/ponto'));
    expect(ponto.filter((r) => r.marca === 'staff').map((r) => r.rota)).toEqual([
      'GET /v1/ponto/terminal',
      'POST /v1/ponto/terminal/identificar',
      'POST /v1/ponto/terminal/marcar',
      'POST /v1/ponto/terminal/justificar',
    ]);
    expect(ponto.filter((r) => r.marca !== 'staff').every((r) => r.marca === 'admin')).toBe(true);
    expect(ponto.length).toBe(27);
  });

  it('o cadastro de empresas é só do master (vale para todas as empresas)', () => {
    expect(todas.filter((r) => r.rota.includes('/v1/empresas'))).toEqual([
      { rota: 'GET /v1/empresas', marca: 'master' },
      { rota: 'GET /v1/empresas/:id', marca: 'master' },
      { rota: 'POST /v1/empresas', marca: 'master' },
      { rota: 'PUT /v1/empresas/:id', marca: 'master' },
      { rota: 'DELETE /v1/empresas/:id', marca: 'master' },
    ]);
    expect(todas.filter((r) => r.marca === 'master').length).toBe(5);
  });

  // Multiempresa: o colaborador entra numa rota de admin só pela tela liberada. Estas nunca são liberáveis (só o admin da loja).
  it('usuários, chave de IA, certificado, compras, ponto e a gravação das configurações nunca são liberados ao colaborador', () => {
    const soAdmin = new Set(comModulos.filter((r) => r.marca === 'admin' && !r.modulos).map((r) => r.rota));
    for (const r of [
      'GET /v1/usuarios', 'POST /v1/usuarios', 'PATCH /v1/usuarios/:id/perfil', 'PATCH /v1/usuarios/:id/modulos', 'PUT /v1/usuarios/:id/senha',
      'DELETE /v1/usuarios/:id', 'GET /v1/ia-chave', 'PUT /v1/ia-chave', 'DELETE /v1/ia-chave', 'GET /v1/certificado-digital',
      'PUT /v1/certificado-digital', 'DELETE /v1/certificado-digital', 'PATCH /v1/configuracoes', 'POST /v1/listas-compra/gerar',
      'POST /v1/inventarios/:id/fechar', 'GET /v1/ponto/colaboradores',
    ])
      expect([r, soAdmin.has(r)]).toEqual([r, true]);
  });

  // A fronteira da loja continua: as telas que têm "visão da loja" (Início, Fichas, Inventário, Compras, Ponto) liberam só essa
  // visão. Com elas, o colaborador não alcança NENHUMA rota de admin (custo, preço, teórico, financeiro).
  it('o colaborador com as telas da loja não alcança rota de admin', () => {
    const daLoja = ['painel', 'fichas', 'inventario', 'compras', 'ponto'];
    expect(comModulos.filter((r) => r.marca === 'admin' && r.modulos?.some((m) => daLoja.includes(m)))).toEqual([]);
  });

  it('as telas das rotas de admin existem no menu (mesmas chaves do web)', () => {
    const usadas = new Set(comModulos.flatMap((r) => r.modulos ?? []));
    expect([...usadas].filter((m) => !(MODULOS as readonly string[]).includes(m))).toEqual([]);
  });

  it('só estas rotas são públicas', () => {
    expect(
      todas
        .filter((r) => r.marca === 'public')
        .map((r) => r.rota)
        .sort(),
    ).toEqual(['GET /health', 'GET /v1/auth/existe-admin', 'POST /v1/auth/login', 'POST /v1/auth/primeiro-acesso'].sort());
  });

  // A fronteira da loja (is_staff no protótipo): nada aqui devolve custo, preço, teórico ou financeiro.
  it('a loja alcança exatamente estas rotas', () => {
    expect(
      todas
        .filter((r) => r.marca === 'staff')
        .map((r) => r.rota)
        .sort(),
    ).toEqual(
      [
        'GET /v1/auth/me',
        'GET /v1/auth/empresas',
        'POST /v1/auth/trocar-senha',
        'GET /v1/configuracoes',
        'GET /v1/subgrupos',
        'GET /v1/fichas/loja',
        'GET /v1/inventarios',
        'GET /v1/inventarios/atual',
        'POST /v1/inventarios',
        'GET /v1/inventarios/:id',
        'GET /v1/inventarios/:id/contagem',
        'POST /v1/inventario-itens/:id/contagem',
        'GET /v1/listas-compra',
        'GET /v1/listas-compra/:id',
        'GET /v1/listas-compra/:id/itens',
        'GET /v1/ponto/terminal',
        'POST /v1/ponto/terminal/identificar',
        'POST /v1/ponto/terminal/marcar',
        'POST /v1/ponto/terminal/justificar',
      ].sort(),
    );
  });
});
