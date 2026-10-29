/**
 * Seed de DESENVOLVIMENTO: contas demo + um cardápio pequeno de espetaria com vendas dos últimos 35 dias, para as telas
 * terem o que mostrar. Em produção não roda (o primeiro acesso cria o admin pela tela, como no protótipo).
 * Idempotente: se já existe alguma conta, não faz nada.
 *
 *   admin@erpfreela.local / erpfreela123  (admin)
 *   loja@erpfreela.local  / erpfreela123  (loja)
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const dia = (s: string) => new Date(`${s}T00:00:00Z`);
const menos = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.log('seed: produção — nada a fazer (o administrador é criado pelo primeiro acesso na tela).');
    return;
  }
  if ((await prisma.users.count()) > 0) {
    console.log('seed: já existem contas — nada a fazer.');
    return;
  }
  const hash = await bcrypt.hash('erpfreela123', 10);
  await prisma.users.createMany({
    data: [
      { email: 'admin@erpfreela.local', nome: 'Admin Demo', password_hash: hash, perfil: 'admin' },
      { email: 'loja@erpfreela.local', nome: 'Loja Valinhos', password_hash: hash, perfil: 'loja' },
    ],
  });

  await prisma.configuracoes.update({
    where: { id: 1 },
    data: { razao_social: 'Chopp & Espeto Valinhos Ltda', nome_fantasia: 'Chopp & Espeto Valinhos', cnpj: '00.000.000/0001-00', endereco: 'Valinhos/SP' },
  });

  const insumos = [
    { codigo: 'I001', nome: 'Picanha', subgrupo: 'Carnes e Proteínas', unidade: 'KG', preco_unitario: 69.9, fornecedor: 'Frigorífico Boa Carne', embalagem_compra: 'Peça 1,2 kg', qtd_por_embalagem: 1.2 },
    { codigo: 'I002', nome: 'Alcatra', subgrupo: 'Carnes e Proteínas', unidade: 'KG', preco_unitario: 44.5, fornecedor: 'Frigorífico Boa Carne' },
    { codigo: 'I003', nome: 'Linguiça Toscana', subgrupo: 'Carnes e Proteínas', unidade: 'KG', preco_unitario: 24.9, fornecedor: 'Frigorífico Boa Carne' },
    { codigo: 'I004', nome: 'Pão de Alho', subgrupo: 'Padaria', unidade: 'UN', preco_unitario: 1.8, fornecedor: 'Padaria Central', embalagem_compra: 'Pacote 10', qtd_por_embalagem: 10 },
    { codigo: 'I005', nome: 'Farofa Pronta', subgrupo: 'Mercearia', unidade: 'KG', preco_unitario: 12.0, fornecedor: 'Atacadão' },
    { codigo: 'I006', nome: 'Vinagrete', subgrupo: 'Hortifruti', unidade: 'KG', preco_unitario: 9.5, fornecedor: 'Hortifruti Valinhos' },
    { codigo: 'I007', nome: 'Chopp Pilsen (barril 50L)', tipo: 'Produto de venda', subgrupo: 'Chopp', unidade: 'L', preco_unitario: 9.8, fornecedor: 'Cervejaria', embalagem_compra: 'Barril 50 L', qtd_por_embalagem: 50 },
    { codigo: 'I008', nome: 'Refrigerante Lata', tipo: 'Produto de venda', subgrupo: 'Bebidas', unidade: 'UN', preco_unitario: 3.2, fornecedor: 'Atacadão', embalagem_compra: 'Fardo 12', qtd_por_embalagem: 12 },
    { codigo: 'I009', nome: 'Gelo', subgrupo: 'Mercearia', unidade: 'KG', preco_unitario: null },
  ];
  for (const i of insumos) await prisma.itens_estoque.create({ data: i });
  const ins = new Map((await prisma.itens_estoque.findMany()).map((i) => [i.nome, i.id]));

  const fichas: { nome: string; categoria: string; grupo?: string; preco_venda: number; ings: [string, number][] }[] = [
    { nome: 'Espeto de Picanha', categoria: 'Espetinhos', preco_venda: 22, ings: [['Picanha', 0.12], ['Farofa Pronta', 0.02]] },
    { nome: 'Espeto de Alcatra', categoria: 'Espetinhos', preco_venda: 15, ings: [['Alcatra', 0.12], ['Farofa Pronta', 0.02]] },
    { nome: 'Espeto de Linguiça', categoria: 'Espetinhos', preco_venda: 10, ings: [['Linguiça Toscana', 0.12]] },
    { nome: 'Pão de Alho (porção)', categoria: 'Porções', preco_venda: 14, ings: [['Pão de Alho', 2], ['Vinagrete', 0.05]] },
    { nome: 'Chopp Pilsen 300ml', categoria: 'Chopp', grupo: 'Bebidas', preco_venda: 9.9, ings: [['Chopp Pilsen (barril 50L)', 0.3]] },
    { nome: 'Refrigerante Lata', categoria: 'Bebidas', grupo: 'Bebidas', preco_venda: 7, ings: [['Refrigerante Lata', 1]] },
  ];
  for (const f of fichas) {
    const c = await prisma.itens_cardapio.create({ data: { nome: f.nome, categoria: f.categoria, grupo: f.grupo ?? 'Alimentos', preco_venda: f.preco_venda } });
    await prisma.ficha_ingredientes.createMany({
      data: f.ings.map(([n, q], k) => ({ item_cardapio_id: c.id, item_estoque_id: ins.get(n)!, quantidade: q, unidade: null, ordem: k + 1 })),
    });
    await prisma.de_para_produtos.create({ data: { produto_relatorio: f.nome.toUpperCase(), item_cardapio_id: c.id } });
  }
  await prisma.de_para_produtos.create({ data: { produto_relatorio: 'TAXA DE ROLHA', item_cardapio_id: null } });
  const cards = new Map((await prisma.itens_cardapio.findMany()).map((c) => [c.nome.toUpperCase(), c]));

  // 35 dias de vendas determinísticas (sem Math.random: o seed repete igual).
  const h = hoje();
  let pedido = 1000;
  const vendas = [];
  for (let d = 34; d >= 0; d--) {
    const data = menos(h, d);
    const nPedidos = 6 + ((d * 7) % 5);
    for (let p = 0; p < nPedidos; p++) {
      pedido++;
      const hora = `${String(18 + (p % 5)).padStart(2, '0')}:${String((p * 13) % 60).padStart(2, '0')}:00`;
      const itens = [...cards.values()].filter((_, k) => (k + p + d) % 3 !== 0).slice(0, 3);
      for (const [k, c] of itens.entries()) {
        const qtd = 1 + ((p + k + d) % 3);
        const preco = Number(c.preco_venda ?? 0);
        vendas.push({
          pedido: String(pedido), data: dia(data), hora: new Date(`1970-01-01T${hora}Z`), produto_relatorio: c.nome.toUpperCase(),
          item_cardapio_id: c.id, preco_unitario: preco, quantidade: qtd, valor_total: preco * qtd,
        });
      }
      if (p % 4 === 0) {
        vendas.push({
          pedido: String(pedido), data: dia(data), hora: null, produto_relatorio: 'TAXA DE ROLHA', item_cardapio_id: null,
          preco_unitario: 15, quantidade: 1, valor_total: 15,
        });
      }
    }
  }
  await prisma.vendas.createMany({ data: vendas });

  // Financeiro: subgrupos do DRE, plano de contas, centro de custo, caixa e contas.
  const subs = [
    { nome: 'CMV', sigla: 'CMV', meta_pct: 32, ordem: 1, is_cmv: true },
    { nome: 'DESPESAS COM PESSOAL', sigla: 'DP', meta_pct: 25, ordem: 2 },
    { nome: 'DESPESAS ADMINISTRATIVAS', sigla: 'DA', meta_pct: 12, ordem: 3 },
    { nome: 'IMPOSTOS', sigla: 'IMP', meta_pct: 6, ordem: 4, is_imposto: true },
  ];
  await prisma.dre_subgrupos.createMany({ data: subs });
  await prisma.plano_contas.createMany({
    data: [
      { grupo: 'DRE', subgrupo: 'CMV', conta: 'COMPRA DE CARNES' },
      { grupo: 'DRE', subgrupo: 'CMV', conta: 'COMPRA DE BEBIDAS' },
      { grupo: 'DRE', subgrupo: 'DESPESAS COM PESSOAL', conta: 'FREELAS' },
      { grupo: 'DRE', subgrupo: 'DESPESAS ADMINISTRATIVAS', conta: 'ALUGUEL' },
      { grupo: 'DRE', subgrupo: 'IMPOSTOS', conta: 'SIMPLES NACIONAL' },
    ],
  });
  await prisma.centros_custo.createMany({ data: [{ nome: 'Loja Valinhos' }, { nome: 'Delivery' }] });
  await prisma.fornecedores.createMany({ data: [{ nome: 'Frigorífico Boa Carne', telefone: '(19) 99999-0000' }, { nome: 'Atacadão' }] });
  for (let d = 10; d >= 1; d--) {
    await prisma.caixa_fechamentos.create({
      data: { data: dia(menos(h, d)), dinheiro: 300 + d * 10, debito: 900 + d * 25, credito: 1200 + d * 30, pix: 800 + d * 20, ifood: 450, delivery_proprio: 120, cartao_alimentacao: 80, sangria: 150, sangria_cofre: 100 },
    });
  }
  await prisma.contas_pagar.createMany({
    data: [
      { descricao: 'Aluguel do mês', fornecedor_nome: 'Imobiliária', valor: 6500, vencimento: dia(menos(h, -5)), categoria: 'Aluguel' },
      { descricao: 'Energia', fornecedor_nome: 'CPFL', valor: 1830.42, vencimento: dia(menos(h, 2)), categoria: 'Energia/Água' },
    ],
  });
  console.log(`seed: 2 contas, ${insumos.length} insumos, ${fichas.length} fichas, ${vendas.length} linhas de venda.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
