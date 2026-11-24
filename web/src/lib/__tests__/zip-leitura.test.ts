import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FRASE_ZIP, lerZip, TETO_ARQUIVOS, ZipErro } from "../zip-leitura";

type Entrada = { nome: string; dados?: Uint8Array; metodo?: 0 | 8; flags?: number };

/** Monta um .zip mínimo (local headers + diretório central + fim), como o PDV gera. */
function zip(entradas: Entrada[], total?: number): ArrayBuffer {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const dir: Uint8Array[] = [];
  let off = 0;
  for (const e of entradas) {
    const nome = enc.encode(e.nome);
    const cru = e.dados ?? new Uint8Array();
    const metodo = e.metodo ?? 0;
    const dados = metodo === 8 ? new Uint8Array(deflateRawSync(cru)) : cru;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(6, e.flags ?? 0, true); lh.setUint16(8, metodo, true);
    lh.setUint32(18, dados.length, true); lh.setUint32(22, cru.length, true); lh.setUint16(26, nome.length, true);
    partes.push(new Uint8Array(lh.buffer), nome, dados);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(8, e.flags ?? 0, true); ch.setUint16(10, metodo, true);
    ch.setUint32(20, dados.length, true); ch.setUint32(24, cru.length, true); ch.setUint16(28, nome.length, true); ch.setUint32(42, off, true);
    dir.push(new Uint8Array(ch.buffer), nome);
    off += 30 + nome.length + dados.length;
  }
  const tamDir = dir.reduce((s, x) => s + x.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, total ?? entradas.length, true); fim.setUint16(10, total ?? entradas.length, true);
  fim.setUint32(12, tamDir, true); fim.setUint32(16, off, true);
  const tudo = [...partes, ...dir, new Uint8Array(fim.buffer)];
  const out = new Uint8Array(tudo.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of tudo) { out.set(x, p); p += x.length; }
  return out.buffer;
}
const txt = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

describe("leitor de .zip (sem dependência nova)", () => {
  it("método 0 (armazenado): lê os arquivos e pula as pastas", async () => {
    const r = await lerZip(zip([{ nome: "2026-11/" }, { nome: "2026-11/a.xml", dados: txt("<a/>") }, { nome: "leia.txt", dados: txt("oi") }]));
    expect(r.arquivos.map((a) => [a.nome, dec(a.dados)])).toEqual([["2026-11/a.xml", "<a/>"], ["leia.txt", "oi"]]);
  });
  it.runIf(typeof DecompressionStream !== "undefined")("método 8 (deflate) com o DecompressionStream do ambiente", async () => {
    const xml = `<nfeProc>${"x".repeat(5000)}</nfeProc>`;
    const r = await lerZip(zip([{ nome: "b.xml", dados: txt(xml), metodo: 8 }]));
    expect(dec(r.arquivos[0]!.dados)).toBe(xml);
  });
  it("com senha = a frase de exportar sem senha", async () => {
    await expect(lerZip(zip([{ nome: "a.xml", dados: txt("<a/>"), flags: 1 }]))).rejects.toThrow(FRASE_ZIP.senha);
  });
  it("tetos: mais de 5.000 arquivos = a frase do limite; XML acima de 1 MB vai para 'grandes'", async () => {
    await expect(lerZip(zip([{ nome: "a.xml", dados: txt("<a/>") }], TETO_ARQUIVOS + 1))).rejects.toThrow(FRASE_ZIP.teto);
    const r = await lerZip(zip([{ nome: "g.xml", dados: new Uint8Array(1024 * 1024 + 1) }, { nome: "p.xml", dados: txt("<p/>") }]));
    expect([r.grandes, r.arquivos.map((a) => a.nome)]).toEqual([["g.xml"], ["p.xml"]]);
  });
  it("arquivo que não é .zip = ZipErro ilegível", async () => {
    const e = await lerZip(txt("não sou zip").buffer as ArrayBuffer).catch((x) => x);
    expect(e instanceof ZipErro && e.tipo).toBe("ilegivel");
  });
});
