import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSAO_KEY } from '../decorators/permissao.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { HealthController } from '../health/health.controller';
import { AuthController } from '../../modules/auth/auth.controller';
import { CadastrosController } from '../../modules/cadastros/cadastros.controller';
import { CaixaController } from '../../modules/caixa/caixa.controller';
import { CertificadoDigitalController } from '../../modules/certificado-digital/certificado-digital.controller';
import { CardapioController } from '../../modules/cardapio/cardapio.controller';
import { ComprasController } from '../../modules/compras/compras.controller';
import { ContasController } from '../../modules/contas/contas.controller';
import { EstoqueController } from '../../modules/estoque/estoque.controller';
import { ImportacoesController } from '../../modules/importacoes/importacoes.controller';
import { InventariosController } from '../../modules/inventarios/inventarios.controller';
import { IaChaveController } from '../../modules/leitura-pdf/ia/ia-chave.controller';
import { LeituraPdfController } from '../../modules/leitura-pdf/leitura-pdf.controller';
import { NotasController } from '../../modules/notas/notas.controller';
import { NotasSefazController } from '../../modules/notas-sefaz/notas-sefaz.controller';
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
  EstoqueController,
  ImportacoesController,
  InventariosController,
  IaChaveController,
  LeituraPdfController,
  NotasController,
  NotasSefazController,
  UsuariosController,
  VendasController,
];

type Rota = { rota: string; marca: string };

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
      out.push({ rota: `${metodo} /${[base, path].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/\/$/, ''), marca });
    }
  }
  return out;
}

describe('proteção das rotas (substitui as políticas RLS do Supabase)', () => {
  const todas = rotas();

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
      { rota: 'POST /v1/dda/ler-pdf', marca: 'admin' },
    ]);
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

  it('só estas rotas são públicas', () => {
    expect(todas.filter((r) => r.marca === 'public').map((r) => r.rota).sort()).toEqual(
      ['GET /health', 'GET /v1/auth/existe-admin', 'POST /v1/auth/login', 'POST /v1/auth/primeiro-acesso'].sort(),
    );
  });

  // A fronteira da loja (is_staff no protótipo): nada aqui devolve custo, preço, teórico ou financeiro.
  it('a loja alcança exatamente estas rotas', () => {
    expect(todas.filter((r) => r.marca === 'staff').map((r) => r.rota).sort()).toEqual(
      [
        'GET /v1/auth/me',
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
      ].sort(),
    );
  });
});
