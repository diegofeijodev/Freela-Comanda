import { afterEach, describe, expect, it, vi } from 'vitest';
import { ehImagem, MAX_FOTOS, medidasReduzidas, pareceImagem, reduzirImagem } from '../imagem';

afterEach(() => vi.unstubAllGlobals());

describe('medidasReduzidas', () => {
  it('reduz paisagem para 2000 no maior lado', () => expect(medidasReduzidas(4000, 3000)).toEqual({ w: 2000, h: 1500 }));
  it('reduz retrato para 2000 no maior lado', () => expect(medidasReduzidas(3000, 4000)).toEqual({ w: 1500, h: 2000 }));
  it('nunca aumenta', () => expect(medidasReduzidas(800, 600)).toEqual({ w: 800, h: 600 }));
  it('arredonda para inteiro', () => expect(medidasReduzidas(3001, 2000)).toEqual({ w: 2000, h: 1333 }));
});

describe('pareceImagem', () => {
  it('heic sem tipo, outro image/* e extensões de imagem seguem como foto', () => {
    expect(pareceImagem(new File(['x'], 'IMG_1.HEIC', { type: '' }))).toBe(true);
    expect(pareceImagem(new File(['x'], 'a', { type: 'image/gif' }))).toBe(true);
    for (const n of ['a.heif', 'a.bmp', 'a.jpg', 'a.jpeg', 'a.png', 'a.webp']) expect(pareceImagem(new File(['x'], n, { type: '' }))).toBe(true);
  });
  it('xml e pdf não são foto', () => {
    expect(pareceImagem(new File(['x'], 'nota.xml', { type: 'text/xml' }))).toBe(false);
    expect(pareceImagem(new File(['x'], 'nota.pdf', { type: 'application/pdf' }))).toBe(false);
    expect(pareceImagem(new File(['x'], 'nota.xml', { type: '' }))).toBe(false);
  });
});

describe('ehImagem', () => {
  it('aceita jpeg, png e webp', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) expect(ehImagem(new File(['x'], 'a', { type: t }))).toBe(true);
  });
  it('recusa pdf', () => expect(ehImagem(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(false));
});

it('MAX_FOTOS = 4', () => expect(MAX_FOTOS).toBe(4));

describe('reduzirImagem', () => {
  it('falha ao abrir → mensagem amigável', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('x')));
    await expect(reduzirImagem(new File(['x'], 'a.heic', { type: 'image/heic' }))).rejects.toThrow(
      'Não consegui abrir esta imagem. Envie em JPG ou PNG.',
    );
  });

  it('abre com orientação da imagem, reduz e devolve JPEG .jpg', async () => {
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    const criar = vi.fn().mockResolvedValue(bitmap);
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb: (b: Blob | null) => void, tipo: string, q: number) => {
        expect([tipo, q]).toEqual(['image/jpeg', 0.85]);
        cb(new Blob(['jpg'], { type: 'image/jpeg' }));
      },
    };
    vi.stubGlobal('createImageBitmap', criar);
    vi.stubGlobal('document', { createElement: () => canvas });
    const f = new File(['x'], 'nota.final.PNG', { type: 'image/png' });
    const out = await reduzirImagem(f);
    expect(criar).toHaveBeenCalledWith(f, { imageOrientation: 'from-image' });
    expect([canvas.width, canvas.height]).toEqual([2000, 1500]);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2000, 1500);
    expect(out.name).toBe('nota.final.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(bitmap.close).toHaveBeenCalled();
  });
});
