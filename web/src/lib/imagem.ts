export const MAX_FOTOS = 4;
const MAX_LADO = 2000;
const QUALIDADE = 0.85;

export function medidasReduzidas(w: number, h: number, max = MAX_LADO): { w: number; h: number } {
  const maior = Math.max(w, h);
  if (maior <= max) return { w: Math.round(w), h: Math.round(h) };
  const k = max / maior;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export const ehImagem = (f: File): boolean => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type);

/** Parece foto (tipo image/* ou extensão de imagem, mesmo com o tipo vazio): segue pelo caminho da foto, que dá a frase certa se o navegador não abrir. */
export const pareceImagem = (f: File): boolean => f.type.startsWith('image/') || /\.(heic|heif|gif|bmp|jpe?g|png|webp)$/i.test(f.name);

/** Reduz a foto no navegador (maior lado 2000 px) e recodifica em JPEG, já com a orientação aplicada. */
export async function reduzirImagem(f: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(f, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não consegui abrir esta imagem. Envie em JPG ou PNG.');
  }
  try {
    const { w, h } = medidasReduzidas(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não consegui abrir esta imagem. Envie em JPG ou PNG.');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALIDADE));
    if (!blob) throw new Error('Não consegui abrir esta imagem. Envie em JPG ou PNG.');
    const nome = f.name.replace(/\.[^./\\]+$/, '') || 'foto';
    return new File([blob], `${nome}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
