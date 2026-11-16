// Tipos mínimos do node-forge: só o que o pkcs12.adapter.ts usa (o resto da biblioteca não pode ser chamado por aqui).
declare module 'node-forge' {
  namespace asn1 {
    interface Asn1 {
      tagClass: number;
      type: number;
      constructed: boolean;
      /** Folhas: bytes em string "binary". Compostos: filhos. */
      value: string | Asn1[];
    }
    interface Buf {
      getBytes(): string;
    }
    const Class: { UNIVERSAL: number; APPLICATION: number; CONTEXT_SPECIFIC: number; PRIVATE: number };
    const Type: {
      BOOLEAN: number;
      OCTETSTRING: number;
      OID: number;
      UTF8: number;
      PRINTABLESTRING: number;
      IA5STRING: number;
      T61STRING: number;
      BMPSTRING: number;
      SEQUENCE: number;
      SET: number;
    };
    function fromDer(bytes: string, strict?: boolean): Asn1;
    function toDer(obj: Asn1): Buf;
    function derToOid(bytes: string): string;
  }
  namespace pki {
    interface Key {
      readonly __forgeKey?: never;
    }
    interface Certificate {
      readonly __forgeCert?: never;
    }
    function privateKeyToAsn1(key: Key): asn1.Asn1;
    function certificateToAsn1(cert: Certificate): asn1.Asn1;
  }
  namespace pkcs12 {
    interface Bag {
      type: string;
      key?: pki.Key | null;
      cert?: pki.Certificate | null;
      asn1?: asn1.Asn1;
    }
    interface Pkcs12Pfx {
      getBags(filter: { bagType: string }): Record<string, Bag[] | undefined>;
    }
    function pkcs12FromAsn1(obj: asn1.Asn1, strict: boolean, password: string): Pkcs12Pfx;
  }
}
