-- Ponto (registro de jornada): colaboradores, escalas, folgas/feriados, marcações, justificativas e terminais.
-- Não existe no protótipo Lovable. Marcação nunca é apagada: corrigir = anular a original (com motivo) e lançar outra manual.
-- O cálculo (horas, atrasos, extras, noturno) é função pura em api/src/modules/ponto/calculo.ts (testada sem banco).

CREATE TABLE ponto_escalas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  -- Tolerância diária (CLT art. 58 §1º: até 10 min no dia não contam como atraso nem extra).
  tolerancia_min  integer NOT NULL DEFAULT 10 CHECK (tolerancia_min BETWEEN 0 AND 60),
  ativo           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Um dia da semana da escala (0 = domingo … 6 = sábado). Saída menor que a entrada = vira a noite.
CREATE TABLE ponto_escala_dias (
  escala_id      uuid NOT NULL REFERENCES ponto_escalas(id) ON DELETE CASCADE ON UPDATE CASCADE,
  dia_semana     smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  folga          boolean NOT NULL DEFAULT false,
  entrada        text CHECK (entrada ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  saida          text CHECK (saida ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  intervalo_min  integer NOT NULL DEFAULT 0 CHECK (intervalo_min BETWEEN 0 AND 600),
  PRIMARY KEY (escala_id, dia_semana),
  CHECK (folga OR (entrada IS NOT NULL AND saida IS NOT NULL AND entrada <> saida))
);

CREATE TABLE ponto_colaboradores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  cpf         text,
  cargo       text,
  admissao    date,
  escala_id   uuid REFERENCES ponto_escalas(id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- PIN de 4 a 6 dígitos, só o hash (bcrypt). Nunca sai do servidor.
  pin_hash    text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ponto_colaboradores_cpf_uq ON ponto_colaboradores (cpf) WHERE cpf IS NOT NULL;

-- Folga avulsa, férias, atestado ou feriado. colaborador_id nulo = vale para todos (feriado da loja).
CREATE TABLE ponto_folgas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id  uuid REFERENCES ponto_colaboradores(id) ON DELETE CASCADE ON UPDATE CASCADE,
  data            date NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('folga', 'feriado', 'ferias', 'atestado')),
  observacao      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ponto_folgas_data_idx ON ponto_folgas (data);
CREATE UNIQUE INDEX ponto_folgas_uq ON ponto_folgas (COALESCE(colaborador_id, '00000000-0000-0000-0000-000000000000'::uuid), data);

-- Computador autorizado a bater ponto. O token só aparece uma vez (fica no navegador da loja); aqui só o SHA-256.
CREATE TABLE ponto_terminais (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  ativo       boolean NOT NULL DEFAULT true,
  ultimo_uso  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid
);

-- data = dia da jornada (a saída de um turno que vira a noite fica no dia em que o turno começou).
CREATE TABLE ponto_marcacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id  uuid NOT NULL REFERENCES ponto_colaboradores(id) ON DELETE CASCADE ON UPDATE CASCADE,
  data            date NOT NULL,
  momento         timestamptz NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('entrada', 'intervalo_inicio', 'intervalo_fim', 'saida')),
  origem          text NOT NULL CHECK (origem IN ('terminal', 'manual')),
  terminal_id     uuid REFERENCES ponto_terminais(id) ON DELETE SET NULL ON UPDATE CASCADE,
  motivo          text,            -- obrigatório na manual (ajuste do admin)
  anulada         boolean NOT NULL DEFAULT false,
  anulada_motivo  text,
  anulada_em      timestamptz,
  anulada_por     uuid,
  substitui_id    uuid REFERENCES ponto_marcacoes(id) ON DELETE SET NULL ON UPDATE CASCADE,
  criado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (origem <> 'manual' OR motivo IS NOT NULL),
  CHECK (NOT anulada OR anulada_motivo IS NOT NULL)
);
CREATE INDEX ponto_marcacoes_colaborador_id_data_idx ON ponto_marcacoes (colaborador_id, data);
CREATE INDEX ponto_marcacoes_colaborador_id_momento_idx ON ponto_marcacoes (colaborador_id, momento);

-- Justificativa de falta, atraso ou saída antecipada. Aceita com abono = o tempo não vira débito.
CREATE TABLE ponto_justificativas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id  uuid NOT NULL REFERENCES ponto_colaboradores(id) ON DELETE CASCADE ON UPDATE CASCADE,
  data            date NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('falta', 'atraso', 'saida_antecipada')),
  texto           text NOT NULL,
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aceita', 'recusada')),
  abonar          boolean NOT NULL DEFAULT false,
  resposta        text,
  respondida_por  uuid,
  respondida_em   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ponto_justificativas_colaborador_id_data_tipo_key ON ponto_justificativas (colaborador_id, data, tipo);
CREATE INDEX ponto_justificativas_status_idx ON ponto_justificativas (status);
