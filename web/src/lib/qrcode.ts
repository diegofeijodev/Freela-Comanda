// QR Code do cupom fiscal: o ÚNICO import de `qrcode-generator` (versão exata no package.json; desenho §5.6). Correção de erros nível M
// e margem branca de 4 módulos (a "zona quieta" do padrão); o SVG escala com a caixa que o recebe (`scalable`).
import qrcode from 'qrcode-generator';

/** O QR do texto (a URL do QR v2 da NFC-e) como `<svg …>`, preto no branco. */
export function qrSvg(texto: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}
