import { gzipSync } from 'node:zlib';
import { descompactarDocZip, lerXml, texto, XmlInvalido, TETO_DOCZIP_BYTES } from '../xml-leitura';
import { docZip } from './retorno-falso';

describe('lerXml', () => {
  it('recusa DOCTYPE e ENTITY, também em minúsculas', () => {
    expect(() => lerXml('<!DOCTYPE x><a/>')).toThrow(XmlInvalido);
    expect(() => lerXml('<!doctype x><a/>')).toThrow(XmlInvalido);
    expect(() => lerXml('<?xml version="1.0"?><!ENTITY a "b"><a/>')).toThrow(XmlInvalido);
    expect(() => lerXml('<a><!entity x "y"></a>')).toThrow(XmlInvalido);
  });
  it('recusa texto acima do teto e XML quebrado, com mensagem fixa', () => {
    expect(() => lerXml('<a>0123456789</a>', 10)).toThrow(XmlInvalido);
    expect(() => lerXml('<a><b></a>')).toThrow('XML inválido');
    expect(() => lerXml('texto solto')).toThrow(XmlInvalido);
  });
  it('acha pelo nome local, com e sem prefixo de namespace', () => {
    const sem = lerXml('<r xmlns="http://x"><chNFe> 123 </chNFe><vazio> </vazio></r>');
    const com = lerXml('<p:r xmlns:p="http://x"><p:chNFe>123</p:chNFe></p:r>');
    expect(texto(sem, 'chNFe')).toBe('123');
    expect(texto(com, 'chNFe')).toBe('123');
    expect(texto(sem, 'vazio')).toBeNull();
    expect(texto(sem, 'nada')).toBeNull();
  });
});

describe('descompactarDocZip', () => {
  it('descompacta gzip + base64', () => {
    expect(descompactarDocZip(docZip('<a>ç</a>'))).toEqual({ xml: '<a>ç</a>' });
  });
  it('base64 que não é gzip devolve o próprio base64 em bruto', () => {
    const b64 = Buffer.from('não sou gzip').toString('base64');
    expect(descompactarDocZip(b64)).toEqual({ bruto: b64 });
  });
  it('gzip de 4 MB + 1 byte vira bruto; 4 MB exatos passa', () => {
    const grande = gzipSync(Buffer.alloc(TETO_DOCZIP_BYTES + 1, 97)).toString('base64');
    expect(descompactarDocZip(grande)).toEqual({ bruto: grande });
    const limite = gzipSync(Buffer.alloc(TETO_DOCZIP_BYTES, 97)).toString('base64');
    expect('xml' in descompactarDocZip(limite)).toBe(true);
  });
});
