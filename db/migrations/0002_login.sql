-- 0002_login.sql — login do painel (PER-01..03).
-- Senha guardada só como hash scrypt (nunca a senha). Sessão revogada, nunca apagada (DAD-03).

ALTER TABLE usuario ADD COLUMN senha_hash text;

CREATE TABLE sessao (
  id           text PRIMARY KEY,              -- aleatório; o cookie leva id + assinatura HMAC
  usuario_id   bigint NOT NULL REFERENCES usuario(id),
  criada_em    timestamptz NOT NULL DEFAULT now(),
  ultimo_uso   timestamptz NOT NULL DEFAULT now(),
  revogada_em  timestamptz,
  ip           text
);
CREATE INDEX sessao_usuario ON sessao (usuario_id);
CREATE TRIGGER sessao_sem_apagar BEFORE DELETE ON sessao FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();
CREATE TRIGGER feriado_sem_apagar BEFORE DELETE ON feriado FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();
ALTER TABLE feriado ADD COLUMN cancelado_em timestamptz;
ALTER TABLE grade_faixa ADD COLUMN cancelada_em timestamptz;
