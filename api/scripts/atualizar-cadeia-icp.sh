#!/usr/bin/env bash
# api/scripts/atualizar-cadeia-icp.sh: regera src/modules/certificado-digital/icp-brasil.gerado.ts (âncoras ICP-Brasil + pacote de apoio).
# Usa rede (curl), unzip e openssl. Aborta se alguma raiz mudar de impressão SHA-256 ou se o SHA-512 do pacote não bater.
set -euo pipefail
command -v curl >/dev/null && command -v unzip >/dev/null && command -v openssl >/dev/null || { echo "precisa de curl, unzip e openssl" >&2; exit 1; }
DESTINO="$(cd "$(dirname "$0")/.." && pwd)/src/modules/certificado-digital/icp-brasil.gerado.ts"
BASE_RAIZ=https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ
BASE_PACOTE=https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# Passo 1: raízes fixadas por SHA-256 (tabela do desenho). A v7 (chave pós-quântica) fica de fora: o Node não lê a chave dela.
declare -A SHA=(
  [4]=F0C15AFD258FB674E7A96E1A50FF873149364B9EC70D4D93C7A9F1EB6060D020
  [5]=CAA53FC6091C6951887C976E378F6EF89AA6377C55D97B6475422B71ED7E9B17
  [6]=3BDB9B509352F1D3D71C2BF64D9A38A4E6CEBDA27809D77F7AC476CBDE6E314A
  [10]=6E0BFF069A26994C15DE2C4888CC54AF84882E5495B7FBF66BE9CCFFEC7489F6
  [11]=1406710058180FA4081AAB3F246F1702429C552A11FA3143B84C88CB3AB8E5E7
  [12]=D8478E37CE19C690CF657381E68FE600E4E1A042536830F06847E03E554C4B01
  [13]=2B07D0BC02C4A6E0478ED22D0D99E8F97E1827B269097696A7FEB6AAD30C3AC8
)
fingerprint() { openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/.*=//; s/://g' | tr a-f A-F; }
# DER ou PEM -> PEM
paraPem() { if head -c 64 "$1" | grep -q 'BEGIN CERTIFICATE'; then openssl x509 -in "$1" -out "$2"; else openssl x509 -inform DER -in "$1" -out "$2"; fi; }

mkdir -p "$T/ancoras"; : > "$T/ancoras.pem"
for v in 4 5 6 10 11 12 13; do
  curl -fsS -m 60 -o "$T/raw-$v" "$BASE_RAIZ/ICP-Brasilv$v.crt"
  paraPem "$T/raw-$v" "$T/ancoras/v$v.pem"
  [ "$(fingerprint "$T/ancoras/v$v.pem")" = "${SHA[$v]}" ] || { echo "ABORTADO: a raiz v$v mudou de impressão SHA-256" >&2; exit 1; }
  cat "$T/ancoras/v$v.pem" >> "$T/ancoras.pem"
done

# Passo 2: pacote de apoio + SHA-512 (confere o download; a confiança vem do passo 3)
curl -fsS -m 180 -o "$T/ac.zip" "$BASE_PACOTE/ACcompactado.zip"
curl -fsS -m 60 -o "$T/hash.txt" "$BASE_PACOTE/hashsha512.txt"
ESPERADO=$(grep -oiE '[0-9a-f]{128}' "$T/hash.txt" | head -1 | tr A-F a-f)
OBTIDO=$(sha512sum "$T/ac.zip" | cut -d' ' -f1)
[ -n "$ESPERADO" ] && [ "$ESPERADO" = "$OBTIDO" ] || { echo "ABORTADO: SHA-512 do pacote não confere" >&2; exit 1; }
mkdir "$T/zip"; unzip -q -o "$T/ac.zip" -d "$T/zip"

# Passo 3: só o que fecha nas âncoras e não é âncora
mkdir "$T/todos"; : > "$T/todos.pem"; n=0
while IFS= read -r -d '' f; do
  n=$((n + 1)); paraPem "$f" "$T/todos/$n.pem" 2>/dev/null || { rm -f "$T/todos/$n.pem"; continue; }
  cat "$T/todos/$n.pem" >> "$T/todos.pem"
done < <(find "$T/zip" -type f \( -iname '*.crt' -o -iname '*.cer' -o -iname '*.pem' \) -print0)
mkdir "$T/ok"; : > "$T/ok.lista"
for p in "$T"/todos/*.pem; do
  fp=$(fingerprint "$p")
  for a in "${SHA[@]}"; do [ "$fp" = "$a" ] && continue 2; done
  openssl verify -CAfile "$T/ancoras.pem" -untrusted "$T/todos.pem" "$p" >/dev/null 2>&1 || continue
  printf '%s %s\n' "$fp" "$p" >> "$T/ok.lista"
done
sort -u -k1,1 "$T/ok.lista" -o "$T/ok.lista"
echo "pacote: $(wc -l < "$T/ok.lista") certificados que fecham nas âncoras (de $n lidos)" >&2

# Passo 4: escreve o módulo (PEM ordenados pela impressão digital)
emitir() { # $1 = lista "fp arquivo"
  while read -r fp arq; do printf '  `%s`,\n' "$(cat "$arq")"; done < "$1"
}
{
  echo '// gerado por api/scripts/atualizar-cadeia-icp.sh — não editar'
  echo "export const PACOTE_GERADO_EM = '$(date -u +%F)';"
  echo
  echo 'export const ANCORAS_ICP_BRASIL: readonly string[] = ['
  for v in 4 5 6 10 11 12 13; do echo "$(fingerprint "$T/ancoras/v$v.pem") $T/ancoras/v$v.pem"; done | sort > "$T/anc.lista"
  emitir "$T/anc.lista"
  echo '];'
  echo
  echo 'export const PACOTE_ICP_BRASIL: readonly string[] = ['
  emitir "$T/ok.lista"
  echo '];'
} > "$DESTINO"
echo "escrito: $DESTINO" >&2
