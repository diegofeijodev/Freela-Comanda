export type Modo = 'carga' | 'ensaio' | 'verificacao';
export type Opcoes = { arquivo: string; expectDb: string; modo: Modo; importarSemSenha: boolean; pularSemPapel: boolean };

export const USO =
  'uso: node dist/src/scripts/import-lovable/main.js --file <exportacao.json> --expect-db <banco> [--dry-run | --verify] [--importar-sem-senha] [--pular-sem-papel]';
const COM_VALOR = new Set(['--file', '--expect-db']);
const CONHECIDAS = new Set([...COM_VALOR, '--dry-run', '--verify', '--importar-sem-senha', '--pular-sem-papel']);

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
  const modo: Modo = argv.includes('--dry-run') ? 'ensaio' : argv.includes('--verify') ? 'verificacao' : 'carga';
  return { arquivo, expectDb, modo, importarSemSenha: argv.includes('--importar-sem-senha'), pularSemPapel: argv.includes('--pular-sem-papel') };
}
