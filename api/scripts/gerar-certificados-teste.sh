#!/usr/bin/env bash
# api/scripts/gerar-certificados-teste.sh <pasta>: .pfx de TESTE (ACs falsas, CNPJs fictícios com DV válido)
# api/scripts/gerar-certificados-teste.sh --tls <pasta>: só os PEM do servidor HTTPS LOCAL do teste do transporte da SEFAZ
#   (ac-teste assina servidor, cliente e servidor-outro-nome, este emitido só para outro nome; ac-estranha assina servidor-estranho,
#   que fica fora da confiança). Tudo fictício.
set -euo pipefail
if [ "${1:-}" = "--tls" ]; then
  mkdir -p "${2:?pasta de saída}"; OUT=$(cd "$2" && pwd)
  cd "$(mktemp -d)"
  k() { openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$1.key" 2>/dev/null; }
  ac() {
    k "$1"; openssl req -new -x509 -key "$1.key" -out "$1.pem" -days 7300 -subj "$2" \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
  }
  # folha <nome> <CN> <EKU> <emissor> [SAN]
  folha() {
    k "$1"; openssl req -new -key "$1.key" -out "$1.csr" -subj "/C=BR/O=TESTE NAO CONFIAVEL/CN=$2"
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=%s\n%s' \
      "$3" "${5:+subjectAltName=$5}" > "$1.ext"
    openssl x509 -req -in "$1.csr" -CA "$4.pem" -CAkey "$4.key" -CAcreateserial -days 7300 -sha256 -extfile "$1.ext" \
      -out "$1.pem" 2>/dev/null
  }
  SAN_LOCAL=IP:127.0.0.1,DNS:localhost
  ac ac-teste "/C=BR/O=TESTE NAO CONFIAVEL/CN=AC de Teste do Transporte"
  ac ac-estranha "/C=BR/O=TESTE NAO CONFIAVEL/CN=AC Estranha de Teste"
  folha servidor localhost serverAuth ac-teste "$SAN_LOCAL"
  folha cliente cliente-teste clientAuth ac-teste
  folha servidor-estranho localhost serverAuth ac-estranha "$SAN_LOCAL"
  # cadeia confiável, mas o nome não é o do endereço chamado (127.0.0.1): prova que o transporte confere o nome do servidor
  folha servidor-outro-nome outro-nome.teste serverAuth ac-teste DNS:outro-nome.teste
  cp ac-teste.pem servidor.pem servidor.key cliente.pem cliente.key ac-estranha.pem servidor-estranho.pem servidor-estranho.key \
    servidor-outro-nome.pem servidor-outro-nome.key "$OUT/"
  ls "$OUT"
  exit 0
fi
mkdir -p "${1:?pasta de saída}"; OUT=$(cd "$1" && pwd)
cd "$(mktemp -d)"; mkdir db; : > db/index.txt; echo 1000 > db/serial
P=pass:senha-de-teste; A1=2.16.76.1.2.1.999; CNPJ_SAN='otherName:2.16.76.1.3.3;OCTETSTRING:'
DN="/C=BR/O=ICP-Brasil/OU=TESTE/CN=EMPRESA DE TESTE LTDA:12345678000195"
export POL=$A1 SAN="otherName:2.16.76.1.3.4;OCTETSTRING:01011980111444777350000000000000000000000000000000000SSPSP,\
otherName:2.16.76.1.3.2;OCTETSTRING:FULANO DE TAL,${CNPJ_SAN}12345678000195,otherName:2.16.76.1.3.7;OCTETSTRING:000000000000"
cat > ca.cnf <<'EOF'
[ca]
default_ca = ac
[ac]
database = db/index.txt
serial = db/serial
new_certs_dir = .
default_md = sha256
policy = livre
unique_subject = no
[livre]
countryName = optional
organizationName = optional
organizationalUnitName = optional
commonName = supplied
serialNumber = optional
[ac_teste]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[folha]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation,keyEncipherment
extendedKeyUsage = clientAuth,emailProtection
certificatePolicies = ${ENV::POL}
subjectAltName = ${ENV::SAN}
[folha_sem_san]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
extendedKeyUsage = clientAuth
certificatePolicies = ${ENV::POL}
EOF
k() { openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$1.key" 2>/dev/null; }
ac() { k "$1"; openssl req -new -x509 -key "$1.key" -out "$1.pem" -days 7300 -config ca.cnf -extensions ac_teste -subj "$2"; }
# folha <nome> <DN> <seção> [início] [fim] [emissor]
folha() {
  k "$1"; openssl req -new -key "$1.key" -out "$1.csr" -subj "$2"
  openssl ca -batch -notext -config ca.cnf -cert "${6:-inter}.pem" -keyfile "${6:-inter}.key" -extensions "$3" \
    -in "$1.csr" -out "$1.pem" -startdate "${4:-20260101000000Z}" -enddate "${5:-20360101000000Z}" 2>/dev/null
}
pfx() { openssl pkcs12 -export -inkey "$1.key" -in "$1.pem" -passout $P -out "$OUT/$2" "${@:3}"; }

ac raiz "/C=BR/O=ICP-Brasil/OU=TESTE NAO CONFIAVEL/CN=AC Raiz de Teste"
k inter; openssl req -new -key inter.key -out inter.csr -subj "/C=BR/O=ICP-Brasil/OU=TESTE NAO CONFIAVEL/CN=AC Intermediaria de Teste"
openssl ca -batch -notext -config ca.cnf -cert raiz.pem -keyfile raiz.key -extensions ac_teste -in inter.csr -out inter.pem \
  -startdate 20250101000000Z -enddate 20400101000000Z 2>/dev/null
cat inter.pem raiz.pem > cadeia.pem; cp raiz.pem "$OUT/raiz-teste.pem"

folha a1 "$DN" folha
pfx a1 valido.pfx -certfile cadeia.pem                  # PBES2/AES-256-CBC, MAC SHA-256 (padrão do OpenSSL 3)
pfx a1 legado.pfx -certfile cadeia.pem -legacy          # RC2-40 nos certificados, 3DES na chave, MAC SHA-1
pfx a1 so-certificado-final.pfx                         # sem a cadeia
for _ in 1 2 3 4 5 6 7 8 9 10; do cat inter.pem raiz.pem; done > muitas.pem
pfx a1 muitos-certificados.pfx -certfile muitas.pem     # folha + 20 extras = 21 certificados (teto de abrirPfx é 20)
openssl pkcs12 -export -nokeys -in a1.pem -certfile cadeia.pem -passout $P -out "$OUT/sem-chave.p12"
folha venc "$DN" folha 20200101000000Z 20210101000000Z && pfx venc vencido.pfx -certfile cadeia.pem
folha fut "$DN" folha 20350101000000Z 20360101000000Z && pfx fut ainda-nao-vale.pfx -certfile cadeia.pem
export SAN="${CNPJ_SAN}99888777000100"
folha outro "/C=BR/O=ICP-Brasil/OU=TESTE/CN=OUTRA EMPRESA SA:99888777000100" folha && pfx outro outro-cnpj.pfx -certfile cadeia.pem
export SAN="otherName:2.16.76.1.3.3;PRINTABLESTRING:12345678000276"
folha filial "/C=BR/O=ICP-Brasil/OU=TESTE/CN=EMPRESA DE TESTE LTDA:12345678000276" folha && pfx filial mesma-raiz-filial.pfx -certfile cadeia.pem
export SAN="${CNPJ_SAN}12ABC34501DE35"
folha alfa "/C=BR/O=ICP-Brasil/OU=TESTE/CN=EMPRESA ALFA LTDA:12ABC34501DE35" folha && pfx alfa cnpj-alfanumerico.pfx -certfile cadeia.pem
export SAN="otherName:2.16.76.1.3.1;OCTETSTRING:01011980123456789090000000000000000000000000000000000SSPSP"
folha pf "/C=BR/O=ICP-Brasil/OU=TESTE/CN=FULANO DE TAL:12345678909" folha && pfx pf ecpf.pfx -certfile cadeia.pem
export POL=2.16.76.1.2.3.999 SAN="${CNPJ_SAN}12345678000195"
folha a3 "$DN" folha && pfx a3 politica-a3.pfx -certfile cadeia.pem
export POL=2.16.76.1.2.201.999
folha se "/C=BR/O=ICP-Brasil/CN=EMPRESA DE TESTE LTDA/serialNumber=12345678000195" folha_sem_san && pfx se selo-se-s.pfx -certfile cadeia.pem
export POL=$A1
ac falsa "/C=BR/O=ICP-Brasil/OU=TESTE NAO CONFIAVEL/CN=AC Intermediaria de Teste"   # mesmo nome, outra chave
folha adult "$DN" folha 20260101000000Z 20360101000000Z falsa && pfx adult cadeia-adulterada.pfx -certfile cadeia.pem
k fora; openssl req -new -x509 -key fora.key -out fora.pem -days 3650 -subj "/C=BR/O=Qualquer/CN=EMPRESA DE TESTE LTDA:12345678000195" \
  -addext "subjectAltName=${CNPJ_SAN}12345678000195"
pfx fora fora-da-icp.pfx
# senha com acento: o OpenSSL grava em UTF-8; a biblioteca do app pode ler em latin1 (ver pkcs12.adapter.ts)
openssl pkcs12 -export -inkey a1.key -in a1.pem -certfile cadeia.pem -passout 'pass:açaí-de-teste' -out "$OUT/senha-acentuada.pfx"
openssl pkcs12 -export -inkey a1.key -in a1.pem -certfile cadeia.pem -passout 'pass:açaí-de-teste' -legacy -out "$OUT/senha-acentuada-legado.pfx"
# sem bloco de MAC (sem prova de senha nem de integridade): o app recusa como FORMATO
openssl pkcs12 -export -inkey a1.key -in a1.pem -certfile cadeia.pem -passout $P -nomac -out "$OUT/sem-mac.pfx"
ls "$OUT"
