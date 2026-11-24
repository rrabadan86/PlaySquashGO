-- 0003_google_agenda.sql — fila do Google Agenda com conta de serviço (AGD-09, decisão do dono 24/11/2026).
-- A mesma fila leva: criar agenda da quadra, compartilhar/descompartilhar com professores e
-- criar/atualizar/apagar eventos das aulas. Sempre Sistema → Google.

ALTER TABLE aula ADD COLUMN google_evento_id text;

ALTER TABLE fila_google ALTER COLUMN aula_id DROP NOT NULL;
ALTER TABLE fila_google ADD COLUMN quadra_id bigint REFERENCES quadra(id);
ALTER TABLE fila_google ADD COLUMN email text;
ALTER TABLE fila_google ADD COLUMN criado_em timestamptz NOT NULL DEFAULT now();
ALTER TABLE fila_google DROP CONSTRAINT fila_google_acao_check;
ALTER TABLE fila_google ADD CONSTRAINT fila_google_acao_check
  CHECK (acao IN ('criar','atualizar','apagar','criar_agenda','compartilhar','descompartilhar'));
ALTER TABLE fila_google ADD CONSTRAINT fila_google_alvo CHECK (
  (acao IN ('criar','atualizar','apagar') AND aula_id IS NOT NULL) OR
  (acao = 'criar_agenda' AND quadra_id IS NOT NULL) OR
  (acao IN ('compartilhar','descompartilhar') AND quadra_id IS NOT NULL AND email IS NOT NULL));
CREATE INDEX fila_google_pendente ON fila_google (proxima_tentativa, id) WHERE feito_em IS NULL;
CREATE TRIGGER fila_google_sem_apagar BEFORE DELETE ON fila_google FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();

-- Com quem cada agenda de quadra está compartilhada (para saber o que falta compartilhar ou tirar).
CREATE TABLE google_compartilhamento (
  id        bigserial PRIMARY KEY,
  quadra_id bigint NOT NULL REFERENCES quadra(id),
  email     text NOT NULL,
  desde     timestamptz NOT NULL DEFAULT now(),
  ate       timestamptz
);
CREATE UNIQUE INDEX google_compartilhamento_ativo ON google_compartilhamento (quadra_id, lower(email)) WHERE ate IS NULL;
CREATE TRIGGER google_compartilhamento_sem_apagar BEFORE DELETE ON google_compartilhamento FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();
