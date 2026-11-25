-- 0006_confirmacao.sql — confirmação da experimental, pós-aula e lista de espera (CNF-01..06, LES-02..04).

-- Andamento da confirmação e do pós-aula, por aula experimental (a mensagem vai para quem marcou).
ALTER TABLE aula ADD COLUMN conf_pedido_em    timestamptz;   -- CNF-01: pedido na véspera
ALTER TABLE aula ADD COLUMN conf_reenvio_em   timestamptz;   -- CNF-01: reenvio 3 h antes
ALTER TABLE aula ADD COLUMN conf_resposta     text CHECK (conf_resposta IN ('confirmou','nao_vai','sem_resposta'));
ALTER TABLE aula ADD COLUMN conf_resposta_em  timestamptz;
ALTER TABLE aula ADD COLUMN pos_dia_em        timestamptz;   -- CNF-06: contato no mesmo dia
ALTER TABLE aula ADD COLUMN pos_2d_em         timestamptz;   -- CNF-06: contato 2 dias depois

-- LES-02: quando a pessoa da lista foi avisada da vaga aberta (e de qual aula cancelada veio a vaga).
ALTER TABLE lista_espera ADD COLUMN avisado_em timestamptz;
ALTER TABLE lista_espera ADD COLUMN preenchida_em timestamptz;

-- lead_resultado (CNF-06): o mesmo contato pode ter o resultado corrigido; nada é apagado.
CREATE TRIGGER lead_resultado_atualizado BEFORE UPDATE ON lead_resultado FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
ALTER TABLE lead_resultado ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now();

INSERT INTO regra_config (chave, valor) VALUES
  ('confirmacao.pedido_ligado', 'true'),
  ('confirmacao.reenvio_ligado', 'true'),
  ('confirmacao.cancelamento_ligado', 'true'),
  ('confirmacao.mensagem_pedido', '"Oi, {nome}! Passando para confirmar sua aula experimental de squash {quando}, na {quadra}, com {professor}. Você vem? É só responder por aqui."'),
  ('confirmacao.mensagem_reenvio', '"Oi, {nome}! Sua aula experimental é hoje, {quando}. Consegue confirmar? Se não tivermos resposta, vamos liberar o horário."'),
  ('confirmacao.mensagem_cancelada', '"Oi, {nome}. Como não tivemos sua confirmação, liberamos o horário da aula experimental. Quando quiser marcar outro dia, é só chamar aqui!"'),
  ('pos_aula.contato_min', '60'),
  ('pos_aula.hora_2d', '"10:00"'),
  ('pos_aula.mensagem_dia', '"Oi, {nome}! Que bom que você veio hoje. O que achou da aula? Se quiser continuar, a gente te passa os horários e os planos."'),
  ('pos_aula.mensagem_falta', '"Oi, {nome}! Sentimos sua falta hoje. Quer marcar a aula experimental em outro dia?"'),
  ('pos_aula.mensagem_2d', '"Oi, {nome}! Ficou com alguma dúvida sobre as aulas? Estamos aqui para ajudar a escolher o melhor horário para você."'),
  ('lista_espera.mensagem_vaga', '"Oi, {nome}! Abriu uma vaga {quando}, que você estava esperando. Quer? Responda aqui: o primeiro que confirmar fica com ela."'),
  ('lista_espera.mensagem_preenchida', '"Oi, {nome}. A vaga de {quando} já foi preenchida. Você continua na lista e avisamos se abrir outra."');
