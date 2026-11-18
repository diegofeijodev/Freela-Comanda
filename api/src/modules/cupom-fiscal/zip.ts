// Zip sem compressão (método 0, "stored"), escrito à mão para o XML do mês do contador (desenho §7.4): sem dependência nova na API. O
// CRC-32 é o do `zlib.crc32` (Node 20.15+ e 22.2+). Formato PKWARE APPNOTE §4.3: para cada arquivo, cabeçalho local + bytes; depois o
// diretório central (uma entrada por arquivo, com a posição do cabeçalho local) e o registro de fim. Zip32 simples: até 65 535 arquivos
// e 4 GB (um mês de cupons fica em poucos MB). Os nomes vão em UTF-8 (bit 11 ligado); data e hora do DOS, no horário de Brasília.

import { crc32 } from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const FIM = 0x06054b50;
const VERSAO = 20; // 2.0: o mínimo que lê o bit 11 (nomes em UTF-8)
const NOMES_UTF8 = 0x0800;
const LIMITE_32 = 0xffffffff;
const BRASILIA_MS = 3 * 60 * 60_000; // UTC−3 fixo (sem horário de verão desde 2019)

/** Data e hora do DOS (resolução de 2 s), no relógio de Brasília. */
function dataHoraDos(quando: Date): { data: number; hora: number } {
  const d = new Date(quando.getTime() - BRASILIA_MS);
  const ano = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    data: ((ano - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    hora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

export function zipSemCompressao(arquivos: { nome: string; dados: Buffer }[], quando: Date = new Date()): Buffer {
  if (arquivos.length > 0xffff) throw new Error('Arquivos demais para um zip simples.');
  const vistos = new Set<string>();
  for (const a of arquivos) {
    // só nomes simples, sem pasta: o leitor de zip nunca escreve fora da pasta escolhida
    const controle = Array.from(a.nome).some((c) => c.charCodeAt(0) < 0x20);
    if (a.nome === '' || controle || /[\\/:]/.test(a.nome) || a.nome === '.' || a.nome === '..' || vistos.has(a.nome)) {
      throw new Error('Nome de arquivo fora do padrão do zip.');
    }
    vistos.add(a.nome);
  }
  const { data, hora } = dataHoraDos(quando);
  const partes: Buffer[] = [];
  const centrais: Buffer[] = [];
  let posicao = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const crc = crc32(a.dados) >>> 0;
    if (a.dados.length > LIMITE_32 || posicao > LIMITE_32) throw new Error('Zip grande demais.');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(VERSAO, 4);
    local.writeUInt16LE(NOMES_UTF8, 6);
    local.writeUInt16LE(0, 8); // método 0: sem compressão
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(a.dados.length, 18); // tamanho guardado
    local.writeUInt32LE(a.dados.length, 22); // tamanho original
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28); // sem campo extra

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(VERSAO, 4); // feito por: 2.0 (MS-DOS, atributos sem permissão de Unix)
    central.writeUInt16LE(VERSAO, 6);
    central.writeUInt16LE(NOMES_UTF8, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(data, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(a.dados.length, 20);
    central.writeUInt32LE(a.dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    // extra, comentário, disco, atributos internos e externos = 0
    central.writeUInt32LE(posicao, 42);

    partes.push(local, nome, a.dados);
    centrais.push(central, nome);
    posicao += local.length + nome.length + a.dados.length;
  }
  const tamanhoCentral = centrais.reduce((s, b) => s + b.length, 0);
  if (posicao > LIMITE_32 || tamanhoCentral > LIMITE_32) throw new Error('Zip grande demais.');
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(FIM, 0);
  fim.writeUInt16LE(0, 4); // este disco
  fim.writeUInt16LE(0, 6); // disco do diretório central
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(posicao, 16);
  fim.writeUInt16LE(0, 20); // sem comentário
  return Buffer.concat([...partes, ...centrais, fim]);
}
