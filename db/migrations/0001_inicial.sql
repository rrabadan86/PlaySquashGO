-- 0001_inicial.sql — esquema inicial da Play Squash (Fase 0).
-- Fonte: docs/modelo-de-dados.md. Regras: DAD-03 (nada é apagado), DAD-04 (histórico só inclui),
-- DAD-05 (retrato no contrato), DAD-06 (regras com versão), SOF-05 (vaga nunca em dobro).
-- Nunca editar esta migração depois de aplicada: mudanças vão em 0002, 0003... (DAD-08).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ───────────── Travas gerais ─────────────
CREATE FUNCTION trava_sem_apagar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DAD-03: registros de % não são apagados; mude a situação', TG_TABLE_NAME;
END $$;

CREATE FUNCTION trava_so_inclusao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DAD-04: % só recebe inclusões', TG_TABLE_NAME;
END $$;

CREATE FUNCTION marcar_atualizacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

-- ───────────── Pessoas ─────────────
CREATE TABLE contato (
  id               bigserial PRIMARY KEY,
  tipo             text NOT NULL DEFAULT 'lead' CHECK (tipo IN ('lead','aluno','responsavel','ex_aluno')),
  nome             text,
  telefone         text UNIQUE,               -- formato E.164 (+55...)
  email            text,
  data_nascimento  date,
  origem           text,                      -- whatsapp, instagram, site, indicação...
  ja_jogou         boolean,                   -- SOF-02 / SOF-03
  sem_campanha     boolean NOT NULL DEFAULT false, -- OPR-03 ("SAIR")
  anonimizado_em   timestamptz,               -- OPR-05 / DAD-07
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE aluno (
  id                     bigserial PRIMARY KEY,
  contato_id             bigint NOT NULL REFERENCES contato(id),
  responsavel_contato_id bigint REFERENCES contato(id),   -- kids: quem recebe as mensagens (CON-06)
  nivel                  text,
  situacao               text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','inativo')),
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now()
);
-- APP-02: um telefone acessa todos os alunos ligados a ele (o próprio ou como responsável).

CREATE TABLE usuario (
  id            bigserial PRIMARY KEY,
  nome          text NOT NULL,
  email         text UNIQUE NOT NULL,
  telefone      text,
  eh_admin      boolean NOT NULL DEFAULT false,  -- PER-01
  eh_professor  boolean NOT NULL DEFAULT false,
  cor_agenda    text,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario_tela (                       -- PER-02: telas liberadas a cada professor
  usuario_id bigint NOT NULL REFERENCES usuario(id),
  tela       text NOT NULL,
  PRIMARY KEY (usuario_id, tela)
);

-- ───────────── Agenda ─────────────
CREATE TABLE quadra (
  id                 bigserial PRIMARY KEY,
  nome               text NOT NULL,
  ativa              boolean NOT NULL DEFAULT true,
  google_agenda_id   text                         -- AGD-09
);

CREATE TABLE tipo_aula (
  id               bigserial PRIMARY KEY,
  nome             text NOT NULL,
  categoria        text NOT NULL CHECK (categoria IN ('individual','dupla','turma','kids','experimental')),
  duracao_min      int  NOT NULL DEFAULT 30,
  alunos_por_aula  int  NOT NULL DEFAULT 1 CHECK (alunos_por_aula > 0)  -- ⏳ kickoff: capacidade por tipo
);

CREATE TABLE grade_faixa (                        -- AGD-01, AGD-07
  id             bigserial PRIMARY KEY,
  quadra_id      bigint NOT NULL REFERENCES quadra(id),
  dia_semana     smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  inicio         time NOT NULL,
  fim            time NOT NULL CHECK (fim > inicio),
  professor_id   bigint NOT NULL REFERENCES usuario(id),
  vigente_desde  date NOT NULL DEFAULT current_date,
  vigente_ate    date
);

CREATE TABLE grade_faixa_tipo (
  grade_faixa_id bigint NOT NULL REFERENCES grade_faixa(id),
  tipo_aula_id   bigint NOT NULL REFERENCES tipo_aula(id),
  PRIMARY KEY (grade_faixa_id, tipo_aula_id)
);

CREATE TABLE feriado (                            -- AGD-03
  data        date PRIMARY KEY,
  nome        text NOT NULL,
  abrangencia text NOT NULL DEFAULT 'nacional'
);

CREATE TABLE bloqueio (                           -- AGD-03
  id           bigserial PRIMARY KEY,
  quadra_id    bigint REFERENCES quadra(id),      -- nulo = todas
  professor_id bigint REFERENCES usuario(id),     -- nulo = todos
  periodo      tstzrange NOT NULL,
  motivo       text NOT NULL,
  criado_por   bigint REFERENCES usuario(id),
  cancelado_em timestamptz,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Comercial ─────────────
CREATE TABLE modelo_contrato (                    -- CON-07 (⏳ kickoff: texto)
  id        bigserial PRIMARY KEY,
  nome      text NOT NULL,
  publico   text NOT NULL CHECK (publico IN ('adulto','kids')),
  versao    int  NOT NULL DEFAULT 1,
  texto     text NOT NULL,
  ativo     boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plano (                              -- CON-01, CON-01a
  id                  bigserial PRIMARY KEY,
  nome                text NOT NULL,
  tipo_aula_id        bigint NOT NULL REFERENCES tipo_aula(id),
  aulas_semana        int NOT NULL CHECK (aulas_semana BETWEEN 1 AND 7),
  vigencia_meses      int NOT NULL CHECK (vigencia_meses BETWEEN 1 AND 12),
  valor_referencia    numeric(10,2),             -- opcional: só pré-preenche o contrato
  parcelas_max        int NOT NULL DEFAULT 1,
  modelo_contrato_id  bigint REFERENCES modelo_contrato(id),
  reposicoes_mes      int,                       -- nulo = regra geral (REP-06)
  tranc_permite       boolean NOT NULL DEFAULT false,
  tranc_dias          int NOT NULL DEFAULT 0,
  tranc_minimo        int NOT NULL DEFAULT 7,
  tranc_aluno         boolean NOT NULL DEFAULT false,
  ativo_venda         boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CHECK (parcelas_max BETWEEN 1 AND vigencia_meses)
);

CREATE TABLE contrato (                           -- CON-02..CON-11
  id               bigserial PRIMARY KEY,
  aluno_id         bigint NOT NULL REFERENCES aluno(id),
  plano_id         bigint NOT NULL REFERENCES plano(id),
  plano_retrato    jsonb  NOT NULL,              -- DAD-05: cópia do plano no momento
  regras_retrato   jsonb  NOT NULL,              -- DAD-05: regras vigentes no momento
  modelo_contrato_id bigint REFERENCES modelo_contrato(id),
  inicio           date NOT NULL,
  fim              date NOT NULL CHECK (fim >= inicio),     -- estendido pelo trancamento
  valor_mensal     numeric(10,2) NOT NULL,
  desconto_valor   numeric(10,2) NOT NULL DEFAULT 0,
  desconto_motivo  text,
  forma            text NOT NULL CHECK (forma IN ('avista','parcelado')),
  parcelas         int  NOT NULL DEFAULT 1,
  dia_vencimento   smallint NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  tranc_permite    boolean NOT NULL DEFAULT false,
  tranc_dias       int NOT NULL DEFAULT 0,
  tranc_minimo     int NOT NULL DEFAULT 7,
  tranc_aluno      boolean NOT NULL DEFAULT false,
  renovacao_de_id  bigint REFERENCES contrato(id), -- CON-08
  situacao         text NOT NULL DEFAULT 'aguardando_aceite'
                   CHECK (situacao IN ('aguardando_aceite','ativo','trancado','bloqueado','encerrado')),
  aceito_em        timestamptz,                   -- CON-07
  encerrado_em     timestamptz,
  encerrado_motivo text,                          -- CON-10
  criado_por       bigint REFERENCES usuario(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CHECK (desconto_valor = 0 OR desconto_motivo IS NOT NULL),
  CHECK (situacao <> 'encerrado' OR encerrado_motivo IS NOT NULL)
);

CREATE TABLE horario_fixo (                       -- AGD-06
  id           bigserial PRIMARY KEY,
  contrato_id  bigint NOT NULL REFERENCES contrato(id),
  quadra_id    bigint NOT NULL REFERENCES quadra(id),
  dia_semana   smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora         time NOT NULL,
  desde        date NOT NULL,
  liberado_em  timestamptz,                       -- fim do contrato, D+15, encerramento
  liberado_motivo text
);

CREATE TABLE trancamento (                        -- CON-11
  id           bigserial PRIMARY KEY,
  contrato_id  bigint NOT NULL REFERENCES contrato(id),
  inicio       date NOT NULL,
  fim          date NOT NULL CHECK (fim >= inicio),
  encerrado_antes_em date,
  origem       text NOT NULL CHECK (origem IN ('painel','app')),
  lancado_por_tipo text NOT NULL,
  lancado_por_id   bigint,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE aula (
  id               bigserial PRIMARY KEY,
  quadra_id        bigint NOT NULL REFERENCES quadra(id),
  professor_id     bigint NOT NULL REFERENCES usuario(id),
  tipo_aula_id     bigint NOT NULL REFERENCES tipo_aula(id),
  periodo          tstzrange NOT NULL,
  origem           text NOT NULL CHECK (origem IN ('fixa','experimental','reposicao','avulsa')),
  situacao         text NOT NULL DEFAULT 'marcada'
                   CHECK (situacao IN ('marcada','confirmada','cancelada','dada')),
  horario_fixo_id  bigint REFERENCES horario_fixo(id),
  cancelada_motivo text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  -- SOF-05 / AGD-05: nunca duas aulas ativas na mesma quadra no mesmo horário.
  EXCLUDE USING gist (quadra_id WITH =, periodo WITH &&) WHERE (situacao <> 'cancelada')
);

CREATE TABLE aula_participante (
  id              bigserial PRIMARY KEY,
  aula_id         bigint NOT NULL REFERENCES aula(id),
  contato_id      bigint NOT NULL REFERENCES contato(id),
  contrato_id     bigint REFERENCES contrato(id),
  situacao        text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','desmarcado')),
  presenca        text CHECK (presenca IN ('presente','falta')),   -- AGD-10: nulo no fim do dia = presença
  confirmacao     text CHECK (confirmacao IN ('confirmou','nao_vai','sem_resposta')), -- CNF
  desmarcado_em   timestamptz,
  desmarcado_por_tipo text,
  desmarcado_motivo   text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aula_id, contato_id)
);

CREATE TABLE credito_reposicao (                  -- REP-01..REP-06
  id              bigserial PRIMARY KEY,
  aluno_id        bigint NOT NULL REFERENCES aluno(id),
  contrato_id     bigint REFERENCES contrato(id),
  aula_origem_id  bigint NOT NULL REFERENCES aula(id),
  motivo          text NOT NULL CHECK (motivo IN ('aluno','escola')),
  valido_ate      date NOT NULL,
  usado_aula_id   bigint REFERENCES aula(id),
  situacao        text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto','usado','vencido')),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aula_origem_id, aluno_id)                -- REP-04: um crédito por desmarcação
);

CREATE TABLE lista_espera (                       -- LES-01..LES-04
  id            bigserial PRIMARY KEY,
  contato_id    bigint NOT NULL REFERENCES contato(id),
  quadra_id     bigint REFERENCES quadra(id),
  inicio        timestamptz NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('experimental','reposicao')),
  credito_id    bigint REFERENCES credito_reposicao(id),
  entrou_em     timestamptz NOT NULL DEFAULT now(),
  saiu_em       timestamptz,
  motivo_saida  text
);

CREATE TABLE fila_google (                        -- AGD-09: Sistema → Google, com nova tentativa
  id                bigserial PRIMARY KEY,
  aula_id           bigint NOT NULL REFERENCES aula(id),
  acao              text NOT NULL CHECK (acao IN ('criar','atualizar','apagar')),
  google_evento_id  text,
  tentativas        int NOT NULL DEFAULT 0,
  proxima_tentativa timestamptz NOT NULL DEFAULT now(),
  feito_em          timestamptz,
  erro              text
);

-- ───────────── Financeiro ─────────────
CREATE TABLE parcela (                            -- FIN-01..FIN-08
  id           bigserial PRIMARY KEY,
  contrato_id  bigint NOT NULL REFERENCES contrato(id),
  numero       int NOT NULL,
  competencia  date NOT NULL,                     -- FIN-08: mês de competência
  vencimento   date NOT NULL,
  valor        numeric(10,2) NOT NULL CHECK (valor >= 0),
  situacao     text NOT NULL DEFAULT 'a_vencer'
               CHECK (situacao IN ('a_vencer','aguardando_conferencia','paga','em_atraso','cancelada')),
  pago_em      date,                              -- FIN-08: mês de recebimento
  baixa_por    bigint REFERENCES usuario(id),     -- FIN-03: baixa manual
  pix_txid     text,                              -- FIN-02
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contrato_id, numero),
  CHECK (situacao <> 'paga' OR (pago_em IS NOT NULL AND baixa_por IS NOT NULL))
);

CREATE TABLE comprovante (
  id          bigserial PRIMARY KEY,
  parcela_id  bigint NOT NULL REFERENCES parcela(id),
  arquivo     text NOT NULL,                      -- caminho fora do Git (DAD-02)
  enviado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE venda_material (                     -- FIN-07
  id            bigserial PRIMARY KEY,
  aluno_id      bigint REFERENCES aluno(id),
  descricao     text NOT NULL,
  valor         numeric(10,2) NOT NULL,
  forma         text NOT NULL DEFAULT 'pix',
  vendido_em    date NOT NULL,
  registrado_por bigint REFERENCES usuario(id),
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Sofia e WhatsApp ─────────────
CREATE TABLE conversa (
  id          bigserial PRIMARY KEY,
  contato_id  bigint NOT NULL REFERENCES contato(id),
  estado      text NOT NULL DEFAULT 'sofia' CHECK (estado IN ('sofia','humano')),  -- SOF-09
  iniciada_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mensagem (
  id          bigserial PRIMARY KEY,
  contato_id  bigint NOT NULL REFERENCES contato(id),
  conversa_id bigint REFERENCES conversa(id),
  direcao     text NOT NULL CHECK (direcao IN ('entrada','saida')),
  tipo        text NOT NULL DEFAULT 'texto',
  texto       text,
  motivo      text,                               -- sofia, aviso, cobranca, campanha, fixa...
  situacao    text NOT NULL DEFAULT 'registrada',
  em          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fila_envio (                         -- OPR-02: ritmo de envio
  id            bigserial PRIMARY KEY,
  contato_id    bigint NOT NULL REFERENCES contato(id),
  tipo          text NOT NULL CHECK (tipo IN ('sofia','aviso','cobranca','campanha')),
  texto         text NOT NULL,
  chave_unica   text UNIQUE,                       -- evita envio em dobro
  agendado_para timestamptz NOT NULL DEFAULT now(),
  enviado_em    timestamptz,
  tentativas    int NOT NULL DEFAULT 0,
  cancelado_em  timestamptz
);

CREATE TABLE custo_ia (                           -- SOF-12, IND-05
  id              bigserial PRIMARY KEY,
  conversa_id     bigint REFERENCES conversa(id),
  em              timestamptz NOT NULL DEFAULT now(),
  modelo          text NOT NULL,
  tokens_entrada  int NOT NULL,
  tokens_saida    int NOT NULL,
  custo_usd       numeric(12,6) NOT NULL
);

CREATE TABLE lead_resultado (                     -- CNF-06, IND-01
  contato_id     bigint PRIMARY KEY REFERENCES contato(id),
  resultado      text NOT NULL CHECK (resultado IN ('matriculou','perdido')),
  motivo_perda   text,
  registrado_por bigint REFERENCES usuario(id),
  em             timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Configuração e histórico ─────────────
CREATE TABLE regra_config (                       -- DAD-06: nova versão com data, nunca editar
  chave          text NOT NULL,
  valor          jsonb NOT NULL,
  vigente_desde  timestamptz NOT NULL DEFAULT now(),
  alterado_por   bigint REFERENCES usuario(id),
  PRIMARY KEY (chave, vigente_desde)
);

CREATE TABLE historico (                          -- DAD-04, OPR-07
  id          bigserial PRIMARY KEY,
  em          timestamptz NOT NULL DEFAULT now(),
  ator_tipo   text NOT NULL CHECK (ator_tipo IN ('aluno','professor','admin','sofia','sistema')),
  ator_id     bigint,
  origem      text NOT NULL CHECK (origem IN ('app','painel','whatsapp','sistema')),
  acao        text NOT NULL,
  entidade    text NOT NULL,
  entidade_id bigint,
  antes       jsonb,
  depois      jsonb,
  motivo      text
);
CREATE INDEX historico_entidade ON historico (entidade, entidade_id, em);

-- Valores iniciais das regras (Anexo A da proposta).
INSERT INTO regra_config (chave, valor) VALUES
  ('grade.intervalo_min', '30'),
  ('marcar.antecedencia_min.experimental', '180'),
  ('marcar.antecedencia_min.reposicao', '180'),
  ('marcar.antecedencia_min.lista_espera', '180'),
  ('marcar.antecedencia_max_dias', '14'),
  ('confirmacao.pedido_hora', '"19:00"'),
  ('confirmacao.reenvio_min', '180'),
  ('confirmacao.cancelamento_min', '90'),
  ('reposicao.antecedencia_min', '180'),
  ('reposicao.validade_dias', '7'),
  ('cobranca.lembrete_dias_antes', '3'),
  ('cobranca.hora_cobranca', '"09:00"'),
  ('cobranca.segundo_aviso_dias', '2'),
  ('cobranca.desmarcar_aulas_dias', '5'),
  ('cobranca.liberar_horario_dias', '15'),
  ('contrato.aviso_fim_vigencia_dias', '10'),
  ('professor.resumo_hora', '"06:00"');

-- ───────────── Travas: nada é apagado; histórico só inclui ─────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contato','aluno','usuario','quadra','tipo_aula','grade_faixa','plano',
    'modelo_contrato','contrato','horario_fixo','trancamento','aula','aula_participante',
    'credito_reposicao','lista_espera','parcela','comprovante','venda_material','conversa',
    'mensagem','custo_ia','lead_resultado','regra_config','bloqueio']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar()', t || '_sem_apagar', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['contato','aluno','usuario','plano','contrato','aula','parcela']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao()', t || '_atualizado', t);
  END LOOP;
END $$;

CREATE TRIGGER historico_so_inclusao BEFORE UPDATE OR DELETE ON historico
  FOR EACH ROW EXECUTE FUNCTION trava_so_inclusao();
CREATE TRIGGER historico_sem_truncate BEFORE TRUNCATE ON historico
  FOR EACH STATEMENT EXECUTE FUNCTION trava_so_inclusao();
CREATE TRIGGER regra_config_so_inclusao BEFORE UPDATE ON regra_config
  FOR EACH ROW EXECUTE FUNCTION trava_so_inclusao();
