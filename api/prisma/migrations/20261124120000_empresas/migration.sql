-- Cadastro de empresas (admin). A marcada como principal (no máximo uma) espelha razão social, fantasia, CNPJ e endereço
-- em `configuracoes` (o resto do sistema — SEFAZ, cupom, telas — continua lendo de lá). Colaboradores do ponto podem
-- apontar para a empresa empregadora (sai no espelho).

CREATE TABLE empresas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social        text NOT NULL,
  nome_fantasia       text,
  cnpj                text NOT NULL CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  inscricao_estadual  text,
  inscricao_municipal text,
  regime_tributario   text CHECK (regime_tributario IN ('mei', 'simples', 'simples_excesso', 'presumido', 'real')),
  cnae                text,
  data_abertura       date,
  cep                 text CHECK (cep ~ '^[0-9]{8}$'),
  logradouro          text,
  numero              text,
  complemento         text,
  bairro              text,
  cidade              text,
  uf                  char(2) CHECK (uf ~ '^[A-Z]{2}$'),
  cod_municipio       char(7) CHECK (cod_municipio ~ '^[0-9]{7}$'),
  telefone            text,
  celular             text,
  email               text,
  site                text,
  responsavel_nome    text,
  responsavel_cpf     text CHECK (responsavel_cpf ~ '^[0-9]{11}$'),
  contador_nome       text,
  contador_email      text,
  contador_telefone   text,
  observacoes         text,
  principal           boolean NOT NULL DEFAULT false,
  ativo               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX empresas_cnpj_key ON empresas (cnpj);
CREATE UNIQUE INDEX empresas_uma_principal ON empresas (principal) WHERE principal;

ALTER TABLE ponto_colaboradores ADD COLUMN empresa_id uuid;
ALTER TABLE ponto_colaboradores ADD CONSTRAINT ponto_colaboradores_empresa_id_fkey
  FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE SET NULL ON UPDATE CASCADE;
