-- 0008_app_aluno.sql — app do aluno: login por código no WhatsApp e sessão longa (APP-01, APP-02).

-- Código de uso único (guardado só o hash), com validade e limite de tentativas.
CREATE TABLE app_codigo (
  id           bigserial PRIMARY KEY,
  telefone     text NOT NULL,
  codigo_hash  text NOT NULL,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  expira_em    timestamptz NOT NULL,
  usado_em     timestamptz,
  tentativas   int NOT NULL DEFAULT 0
);
CREATE INDEX app_codigo_telefone ON app_codigo (telefone, criado_em);
CREATE TRIGGER app_codigo_sem_apagar BEFORE DELETE ON app_codigo FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();

-- Sessão do app (cookie com token aleatório; guardado só o hash). Sair = revogada_em.
CREATE TABLE app_sessao (
  id             bigserial PRIMARY KEY,
  telefone       text NOT NULL,
  token_hash     text NOT NULL UNIQUE,
  aluno_id       bigint REFERENCES aluno(id),     -- APP-02: aluno escolhido no seletor
  criada_em      timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em  timestamptz NOT NULL DEFAULT now(),
  revogada_em    timestamptz,
  ip             text
);
CREATE TRIGGER app_sessao_sem_apagar BEFORE DELETE ON app_sessao FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();

CREATE INDEX credito_reposicao_aluno ON credito_reposicao (aluno_id, situacao);

INSERT INTO regra_config (chave, valor) VALUES
  ('app.codigo_validade_min', '10'),
  ('app.sessao_dias', '180'),
  ('app.mensagem_codigo', '"Seu código para entrar no app da Play Squash é {codigo}. Ele vale por {minutos} minutos. Não passe para ninguém."');
