// Lê o .zip do mês (os XML que o PDV gera para o contador) no navegador, sem dependência nova: diretório central + inflate pelo
// `DecompressionStream('deflate-raw')` do próprio navegador (desenho 24/11, A.4; *não confirmado* em todo navegador: sem ele, a tela
// pede os .xml soltos). Tetos: 5.000 arquivos, 1 MB por XML descompactado, 100 MB no total.

export const TETO_ARQUIVOS = 5000;
export const TETO_POR_XML = 1024 * 1024;
export const TETO_TOTAL = 100 * 1024 * 1024;

export class ZipErro extends Error {
  constructor(readonly tipo: "ilegivel" | "senha" | "teto" | "sem_leitor", message: string) {
    super(message);
  }
}
export const FRASE_ZIP = {
  ilegivel: "Não consigo abrir este .zip. Exporte os XML sem senha, ou descompacte e escolha os .xml soltos.",
  senha: "Não consigo abrir este .zip. Exporte os XML sem senha, ou descompacte e escolha os .xml soltos.",
  teto: "Este .zip passa do limite (5.000 arquivos ou 100 MB). Exporte um mês de cada vez, ou menos.",
  sem_leitor: "Este navegador não abre .zip. Descompacte o arquivo no computador e escolha os .xml (dá para marcar todos de uma vez com Ctrl+A na pasta).",
} as const;
const erro = (t: keyof typeof FRASE_ZIP) => new ZipErro(t, FRASE_ZIP[t]);

export type ArquivoDoZip = { nome: string; dados: Uint8Array };

async function inflar(dados: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw erro("sem_leitor");
  let ds: DecompressionStream;
  try {
    ds = new DecompressionStream("deflate-raw" as CompressionFormat);
  } catch {
    throw erro("sem_leitor");
  }
  const saida = new Blob([dados.slice()]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(saida).arrayBuffer());
}

/** Os arquivos do .zip (pastas saem; o resto vem com o nome, para a tela contar os que não são XML). */
export async function lerZip(buf: ArrayBuffer): Promise<{ arquivos: ArquivoDoZip[]; grandes: string[] }> {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw erro("ilegivel");
  const total = v.getUint16(fim + 10, true);
  const tamanhoDir = v.getUint32(fim + 12, true);
  const inicioDir = v.getUint32(fim + 16, true);
  if (total === 0xffff || inicioDir === 0xffffffff || tamanhoDir === 0xffffffff) throw erro("ilegivel"); // zip64
  if (total > TETO_ARQUIVOS) throw erro("teto");
  const nomeDec = new TextDecoder("utf-8");
  const arquivos: ArquivoDoZip[] = [];
  const grandes: string[] = [];
  let soma = 0;
  let p = inicioDir;
  for (let k = 0; k < total; k++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) throw erro("ilegivel");
    const flags = v.getUint16(p + 8, true);
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const tamanho = v.getUint32(p + 24, true);
    const nLen = v.getUint16(p + 28, true);
    const eLen = v.getUint16(p + 30, true);
    const cLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = nomeDec.decode(b.subarray(p + 46, p + 46 + nLen));
    p += 46 + nLen + eLen + cLen;
    if (nome.endsWith("/")) continue;
    if (flags & 1) throw erro("senha");
    if (comprimido === 0xffffffff || tamanho === 0xffffffff) throw erro("ilegivel");
    if (tamanho > TETO_POR_XML) { grandes.push(nome); continue; }
    soma += tamanho;
    if (soma > TETO_TOTAL) throw erro("teto");
    if (local + 30 > b.length || v.getUint32(local, true) !== 0x04034b50) throw erro("ilegivel");
    const ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const bruto = b.subarray(ini, ini + comprimido);
    let dados: Uint8Array;
    if (metodo === 0) dados = bruto;
    else if (metodo === 8) {
      try {
        dados = await inflar(bruto);
      } catch (e) {
        if (e instanceof ZipErro) throw e;
        throw erro("ilegivel");
      }
    }
    else throw erro("ilegivel");
    if (dados.length > TETO_POR_XML) { grandes.push(nome); continue; }
    arquivos.push({ nome, dados });
  }
  return { arquivos, grandes };
}
