import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Trava de fonte: nada em modules/sefaz ou modules/notas-sefaz desliga a conferência do certificado do servidor.
const MODULOS = join(__dirname, '..', '..');
const PASTAS = [join(MODULOS, 'sefaz'), join(MODULOS, 'notas-sefaz')];

function fontes(pasta: string): string[] {
  if (!existsSync(pasta)) return []; // notas-sefaz nasce numa tarefa seguinte
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === '__tests__' ? [] : fontes(join(pasta, e.name));
    return e.name.endsWith('.ts') ? [join(pasta, e.name)] : [];
  });
}

describe('verificação TLS sempre ligada', () => {
  const arquivos = PASTAS.flatMap(fontes);

  it('acha os fontes do transporte', () => {
    expect(arquivos.map((a) => relative(MODULOS, a))).toContain(join('sefaz', 'transporte-soap12.ts'));
  });

  it('nenhum fonte desliga rejectUnauthorized nem mexe na variável de ambiente do Node', () => {
    const culpados = arquivos.filter((a) => {
      const texto = readFileSync(a, 'utf8');
      return /rejectUnauthorized\s*:\s*false/.test(texto) || texto.includes('NODE_TLS_REJECT_UNAUTHORIZED');
    });
    expect(culpados.map((a) => relative(MODULOS, a))).toEqual([]);
  });

  it('o transporte liga rejectUnauthorized explicitamente', () => {
    expect(readFileSync(join(MODULOS, 'sefaz', 'transporte-soap12.ts'), 'utf8')).toContain('rejectUnauthorized: true');
  });
});
