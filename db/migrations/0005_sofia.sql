-- 0005_sofia.sql — Sofia marca a experimental (SOF-02..SOF-12).

-- Quem marcou a aula pela conversa (o lead). Na experimental de criança ou em dupla os
-- participantes podem ser outras pessoas; a conversa continua com quem marcou (SOF-07, SOF-08).
ALTER TABLE aula ADD COLUMN marcada_por_contato_id bigint REFERENCES contato(id);
CREATE INDEX aula_marcada_por ON aula (marcada_por_contato_id) WHERE marcada_por_contato_id IS NOT NULL;

-- SOF-06: 1 experimental por participante (nome + data de nascimento); exceção liberada pelo admin.
CREATE TABLE experimental_liberacao (
  id               bigserial PRIMARY KEY,
  nome_chave       text NOT NULL,                 -- nome sem acento, minúsculo, espaços simples
  data_nascimento  date NOT NULL,
  liberado_por     bigint NOT NULL REFERENCES usuario(id),
  motivo           text NOT NULL,
  usada_aula_id    bigint REFERENCES aula(id),
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER experimental_liberacao_sem_apagar BEFORE DELETE ON experimental_liberacao FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();

-- SOF-10: anexos que a Sofia pode mandar quando pedem (arquivo fora do Git, DAD-02).
CREATE TABLE sofia_anexo (
  id          bigserial PRIMARY KEY,
  nome        text NOT NULL,                      -- como a Sofia conhece o anexo (ex.: "tabela de preços")
  descricao   text NOT NULL,                      -- quando mandar
  arquivo     text NOT NULL,                      -- caminho na pasta de anexos do servidor
  tipo_mime   text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER sofia_anexo_sem_apagar BEFORE DELETE ON sofia_anexo FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();
ALTER TABLE fila_envio ADD COLUMN anexo_id bigint REFERENCES sofia_anexo(id);

-- SOF-09: quando e por que a conversa foi para atendimento humano.
ALTER TABLE conversa ADD COLUMN humano_desde timestamptz;
ALTER TABLE conversa ADD COLUMN humano_motivo text;

CREATE INDEX custo_ia_em ON custo_ia (em);
CREATE INDEX custo_ia_conversa ON custo_ia (conversa_id);

-- Configuração da Sofia (editável com versão, DAD-06). O texto de instruções começa vazio:
-- vale o padrão do sistema (src/sofia/prompt-padrao.txt) até o admin escrever o dele.
INSERT INTO regra_config (chave, valor) VALUES
  ('sofia.ligada', 'true'),
  ('sofia.modelo', '"claude-opus-5-5"'),
  ('sofia.agrupar_s', '8'),
  ('sofia.instrucoes', '""');
