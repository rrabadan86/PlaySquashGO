-- 0007_contratos.sql — contratos básicos e aulas fixas geradas (AGD-06, CON-01, CON-02, CON-04, CON-10).
CREATE INDEX aula_participante_contrato ON aula_participante (contrato_id) WHERE contrato_id IS NOT NULL;
CREATE INDEX horario_fixo_contrato ON horario_fixo (contrato_id);
CREATE INDEX contrato_aluno ON contrato (aluno_id);

INSERT INTO regra_config (chave, valor) VALUES ('grade.semanas_geradas', '4');
