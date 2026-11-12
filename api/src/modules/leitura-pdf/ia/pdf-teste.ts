/**
 * PDF mínimo (1 página, Helvetica) gerado na hora para testar a chave: o teste de "salvar a chave" faz uma leitura DE VERDADE
 * — PDF + esquema, pelo mesmo código da leitura de nota —, não só um "oi" de texto, que passaria com chave/modelo que depois
 * falham na primeira nota.
 */
export const NUMERO_TESTE = '4321';

export function pdfDeTeste(): string {
  const conteudo = `BT /F1 18 Tf 20 80 Td (Freela Comanda teste ${NUMERO_TESTE}) Tj ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1').toString('base64');
}

/** Esquema do teste: um texto e um campo que aceita nulo (exercita a conversão de `type: [x, 'null']` de cada provedor). */
export const SCHEMA_TESTE = {
  type: 'object',
  additionalProperties: false,
  required: ['texto', 'numero'],
  properties: {
    texto: { type: 'string', description: 'O texto escrito no PDF' },
    numero: { type: ['string', 'null'], description: 'O número de 4 dígitos que aparece no texto, ou null' },
  },
};
