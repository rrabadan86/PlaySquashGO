# Modelo de dados e histórico

Banco: **PostgreSQL 16** na VPS (Hostinger), um banco por ambiente (homologação e produção, DEP-02).
O banco é a fonte da verdade; o Google Agenda é só espelho (AGD-09). Esquema em `db/migrations/`.

## Tabelas por grupo

| Grupo | Tabelas | Observações |
|---|---|---|
| Pessoas | `contato`, `aluno`, `usuario`, `usuario_tela` | `contato` é lead, aluno, responsável ou ex-aluno; `aluno.responsavel_contato_id` para kids (CON-06); um telefone vê todos os alunos ligados a ele (APP-02); `usuario` pode ser admin e professor (PER-01). |
| Agenda | `quadra`, `tipo_aula`, `grade_faixa`, `grade_faixa_tipo`, `feriado`, `bloqueio`, `aula`, `aula_participante`, `lista_espera`, `fila_google`, `google_compartilhamento` | `aula.periodo` é um intervalo de horário; o banco recusa duas aulas ativas sobrepostas na mesma quadra (SOF-05, AGD-04). Participantes ficam em `aula_participante` (dupla/turma). `fila_google` leva ao Google (conta de serviço) a criação da agenda de cada quadra, o compartilhamento com admins e professores e os eventos das aulas, com nova tentativa (AGD-09); `google_compartilhamento` guarda com quem cada agenda está compartilhada. |
| Comercial | `modelo_contrato`, `plano`, `contrato`, `horario_fixo`, `trancamento`, `credito_reposicao` | `contrato.plano_retrato` e `regras_retrato` guardam o plano e as regras do momento (DAD-05, CON-01a). Um crédito por desmarcação (REP-04, chave única). |
| Financeiro | `parcela`, `comprovante`, `venda_material` | Parcela paga exige data e quem deu a baixa (FIN-03); competência × recebimento (FIN-08). |
| Sofia e WhatsApp | `conversa`, `mensagem`, `fila_envio`, `custo_ia`, `lead_resultado`, `sofia_anexo`, `experimental_liberacao` | `fila_envio.chave_unica` evita mensagem em dobro; ritmo de envio (OPR-02). `aula.marcada_por_contato_id` liga a experimental ao lead que marcou (SOF-07/08); `experimental_liberacao` é a exceção da SOF-06 liberada pelo admin; `sofia_anexo` guarda só o caminho do arquivo, que fica fora do Git (SOF-10). Andamento da confirmação e do pós-aula em `aula.conf_*` e `aula.pos_*` (CNF-01, CNF-06); `lista_espera.avisado_em`/`preenchida_em` (LES-02). |
| Configuração | `regra_config` | Uma linha por versão de cada regra, com data (DAD-06). Valores iniciais = Anexo A da proposta. |
| Histórico | `historico` | Só inclusão (DAD-04, OPR-07). |

## Estados

- **Aula:** `marcada` → `confirmada` (experimental) → `dada`; ou `cancelada` (com motivo). Cancelada libera o horário.
- **Participante:** `ativo` ou `desmarcado` (quando, por quem, motivo); presença `presente`/`falta`; sem marcação no fim do dia conta presença (AGD-10).
- **Contrato:** `aguardando_aceite` → `ativo` ⇄ `trancado` / `bloqueado` → `encerrado` (motivo obrigatório).
- **Parcela:** `a_vencer` → `aguardando_conferencia` → `paga`; ou `em_atraso`; ou `cancelada`.
- **Crédito de reposição:** `aberto` → `usado` ou `vencido`.

## Como o histórico é mantido

1. **Nada é apagado** (DAD-03): as tabelas principais têm trava contra `DELETE`. O que acaba muda de situação, com data e motivo.
2. **Registro de histórico** (DAD-04): `historico` guarda quem (`ator_tipo`, `ator_id`), por onde (`origem`), quando (`em`), o quê (`acao`, `entidade`, `entidade_id`), `antes`/`depois` em JSON e o `motivo`. `UPDATE`, `DELETE` e `TRUNCATE` são barrados por trava no banco.
3. **Retrato do contrato** (DAD-05): mudar plano ou regra nunca altera contrato já feito.
4. **Regras com versão** (DAD-06): mudar uma regra cria uma nova linha com data; dá para saber qual regra valia em cada momento.
5. **Anonimização** (DAD-07): apaga dados pessoais do contato e mantém IDs, aulas e parcelas.
6. **Migrações** (DAD-08): só para a frente, numeradas, aplicadas primeiro na homologação.
7. **Cópias** (DEP-06): cópia diária criptografada fora do servidor (30 diárias + 12 mensais) e teste de restauração mensal.

Volume esperado: ~70 alunos → ~15 mil aulas e ~1 mil parcelas por ano. Não há necessidade de partição.

**Aulas fixas (AGD-06):** `horario_fixo` (contrato, quadra, dia da semana, hora) gera as aulas das próximas `grade.semanas_geradas` (4) semanas; a aula guarda `horario_fixo_id` e o participante, `contrato_id`. Aula desmarcada ou cancelada não é gerada de novo; dia pulado (feriado, bloqueio, horário ocupado) fica no histórico como `aula.fixa_pulada`.
