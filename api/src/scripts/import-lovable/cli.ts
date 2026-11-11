export type Modo = 'carga' | 'ensaio' | 'verificacao';
export type Opcoes = { arquivo: string; expectDb: string; modo: Modo; pularSemPapel: boolean; ignorarTabelas: string[] };

export const USO =
  'uso: node dist/src/scripts/import-lovable/main.js --file <exportacao.json> --expect-db <banco> [--dry-run | --verify] [--pular-sem-papel] [--ignorar-tabela <nome>]...';
const COM_VALOR = new Set(['--file', '--expect-db', '--ignorar-tabela']);
const CONHECIDAS = new Set([...COM_VALOR, '--dry-run', '--verify', '--pular-sem-papel']);

export function parseArgs(argv: string[]): Opcoes {
  const desconhecidas = argv.filter((a, i) => a.startsWith('--') && !CONHECIDAS.has(a) && !COM_VALOR.has(argv[i - 1] ?? ''));
  if (desconhecidas.length) throw new Error(`opção desconhecida: ${desconhecidas.join(', ')}\n${USO}`);
  const val = (f: string) => {
    const i = argv.indexOf(f);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${f} precisa de um valor\n${USO}`);
    return v;
  };
  const arquivo = val('--file');
  const expectDb = val('--expect-db');
  if (!arquivo || !expectDb) throw new Error(USO);
  if (argv.includes('--dry-run') && argv.includes('--verify')) throw new Error(`escolha só um entre --dry-run e --verify\n${USO}`);
  // --ignorar-tabela (pode repetir): tabela que o Lovable ganhou depois do port e o sistema novo não tem; a exportação confere o resto.
  const ignorarTabelas = argv.flatMap((a, i) => (a === '--ignorar-tabela' ? [argv[i + 1] ?? ''] : []));
  for (const t of ignorarTabelas) {
    if (!t || t.startsWith('--')) throw new Error(`--ignorar-tabela precisa de um valor\n${USO}`);
    if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`--ignorar-tabela: nome de tabela inválido: ${t}`);
  }
  const modo: Modo = argv.includes('--dry-run') ? 'ensaio' : argv.includes('--verify') ? 'verificacao' : 'carga';
  return {
    arquivo,
    expectDb,
    modo,
    pularSemPapel: argv.includes('--pular-sem-papel'),
    ignorarTabelas: [...new Set(ignorarTabelas)],
  };
}
