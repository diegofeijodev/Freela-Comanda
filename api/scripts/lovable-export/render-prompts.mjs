#!/usr/bin/env node
// Monta os prompts colados no chat do Lovable (o SQL da exportação e o da limpeza entram inteiros).
//   node scripts/lovable-export/render-prompts.mjs [--only exportacao|limpeza]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
if (only && only !== 'exportacao' && only !== 'limpeza') { console.error('--only exportacao | limpeza'); process.exit(1); }
const ler = (f) => readFileSync(join(AQUI, f), 'utf8');
// Substituição por função: o SQL tem `$$`, que num texto de substituição viraria `$`.
const exportacao = ler('prompt-exportacao.md').replace('__SQL__', () => ler('export_erpfreela.sql').trimEnd());
const limpeza = ler('prompt-limpeza.md').replace('__SQL_LIMPEZA__', () => ler('limpeza_erpfreela.sql').trimEnd());
if (only !== 'limpeza') console.log(exportacao);
if (only !== 'exportacao') console.log(limpeza);
