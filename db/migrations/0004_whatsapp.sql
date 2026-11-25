-- 0004_whatsapp.sql — fila de envio do WhatsApp com ritmo e registro em duas etapas (OPR-02, OPR-10).

-- Envio em duas etapas: "enviando_em" é gravado ANTES de mandar; "enviado_em" depois.
-- Item com enviando_em e sem enviado_em (o sistema caiu no meio) fica "a conferir" e
-- nunca é reenviado sozinho (OPR-10).
ALTER TABLE fila_envio ADD COLUMN enviando_em timestamptz;
ALTER TABLE fila_envio ADD COLUMN erro text;
ALTER TABLE fila_envio ADD COLUMN cancelado_motivo text;
ALTER TABLE fila_envio ADD COLUMN criado_em timestamptz NOT NULL DEFAULT now();
ALTER TABLE fila_envio DROP CONSTRAINT fila_envio_tipo_check;
ALTER TABLE fila_envio ADD CONSTRAINT fila_envio_tipo_check
  CHECK (tipo IN ('sofia','aviso','cobranca','campanha','fixa','professor'));
CREATE INDEX fila_envio_pendente ON fila_envio (agendado_para, id) WHERE enviado_em IS NULL AND cancelado_em IS NULL;
CREATE TRIGGER fila_envio_sem_apagar BEFORE DELETE ON fila_envio FOR EACH ROW EXECUTE FUNCTION trava_sem_apagar();

-- Destinatário pode ser um usuário (professor/admin) em vez de um contato.
ALTER TABLE fila_envio ALTER COLUMN contato_id DROP NOT NULL;
ALTER TABLE fila_envio ADD COLUMN usuario_id bigint REFERENCES usuario(id);
ALTER TABLE fila_envio ADD CONSTRAINT fila_envio_destino CHECK ((contato_id IS NULL) <> (usuario_id IS NULL));

ALTER TABLE mensagem ALTER COLUMN contato_id DROP NOT NULL;
ALTER TABLE mensagem ADD COLUMN usuario_id bigint REFERENCES usuario(id);
ALTER TABLE mensagem ADD COLUMN fila_envio_id bigint REFERENCES fila_envio(id);
CREATE INDEX mensagem_contato_em ON mensagem (contato_id, em);
CREATE INDEX mensagem_saida_em ON mensagem (em) WHERE direcao = 'saida';

-- Ritmo de envio (OPR-02): valores iniciais, editáveis com versão (DAD-06).
INSERT INTO regra_config (chave, valor) VALUES
  ('whatsapp.intervalo_min_s', '20'),
  ('whatsapp.intervalo_max_s', '60'),
  ('whatsapp.limite_hora', '40'),
  ('whatsapp.limite_dia', '300'),
  ('whatsapp.campanha_janela', '"08:00-20:00"'),
  ('whatsapp.conversando_min', '30'),
  ('whatsapp.mensagem_fixa', '"Oi! Este número é do atendimento a novos alunos da Play Squash. Para suas aulas, use o app ou fale com o seu professor."'),
  ('whatsapp.mensagem_sair', '"Pronto, você não vai mais receber nossas campanhas. Avisos das suas aulas continuam chegando normalmente."');
