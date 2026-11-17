import { afterEach, describe, expect, it } from "vitest";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { api, errCode, errMsg } from "@/modules/shared/infrastructure/http";
import { xmlNotaSefaz } from "../erp-api";

// Sem rede: o adaptador do axios responde como a API. Com `responseType: 'text'` o corpo do erro chega como TEXTO.
const original = api.defaults.adapter;
afterEach(() => {
  api.defaults.adapter = original;
});

function servidor(status: number, corpo: string): void {
  api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    const response = { data: corpo, status, statusText: "", headers: {}, config };
    if (status === 200) return response;
    throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response);
  }) as AxiosAdapter;
}

const falha = (p: Promise<unknown>) => p.then(() => { throw new Error("não falhou"); }, (e: unknown) => e);

describe("xmlNotaSefaz (o XML do Conferir)", () => {
  it("200: devolve o XML em texto", async () => {
    servidor(200, "<nfeProc/>");
    await expect(xmlNotaSefaz("id")).resolves.toBe("<nfeProc/>");
  });

  it("erro com o corpo da API em texto: errMsg e errCode mostram a frase e o código do servidor, não o texto do axios", async () => {
    servidor(409, JSON.stringify({ error: { code: "SEFAZ_CANCELADA", message: "Esta nota foi cancelada pelo fornecedor e não entra no estoque." } }));
    const e = await falha(xmlNotaSefaz("id"));
    expect(errMsg(e)).toBe("Esta nota foi cancelada pelo fornecedor e não entra no estoque.");
    expect(errCode(e)).toBe("SEFAZ_CANCELADA");
  });

  it("erro cujo corpo não é o da API (ex.: HTML de um proxy): frase fixa em português", async () => {
    servidor(502, "<html>Bad Gateway</html>");
    const e = await falha(xmlNotaSefaz("id"));
    expect(errMsg(e)).toBe("Não consegui abrir o XML desta nota. Tente de novo.");
    expect(errMsg(e)).not.toMatch(/Request failed/);
  });
});
