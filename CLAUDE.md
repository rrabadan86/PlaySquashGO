# Play Squash — Agenda de Squash

Sistema da Play Squash (escola de squash, 2 quadras): **painel** web do administrador e dos
professores, **Sofia** (IA que atende leads novos no WhatsApp e marca a aula experimental),
**avisos automáticos** pelo mesmo número de WhatsApp, **app do aluno** e do professor (web,
instalável no celular), **Google Agenda** como espelho das aulas (uma agenda por quadra) e
**cobrança por Pix** com baixa manual.

O dono escreve em português: **responda em português, em linguagem simples**.

## Documentos de referência (Drive do dono, pasta "Play Squash")
- Proposta Agenda de Squash (24/11/2026) — o que foi vendido ao cliente.
- Termo de aprovação de escopo — os requisitos com código, para o cliente aprovar no kickoff.
- Documento interno de requisitos v2 — decisões e requisitos; as regras deste repositório saíram dele.
- Matriz de rastreabilidade (planilha) — versão de leitura; **a matriz oficial é `docs/rastreabilidade.md`**.

## Organização
| Parte | Onde |
|---|---|
| Regras por área (fonte única, com código) | `.claude/rules/*.md` |
| Casos de teste planejados | `docs/casos-de-teste.md` |
| Matriz regra → teste | `docs/rastreabilidade.md` (gerada por `npm run matriz`) |
| Modelo de dados e histórico | `docs/modelo-de-dados.md`, `db/migrations/` |
| Padrão visual e mockups | `.claude/rules/visual.md`, `docs/design/mockups.html` |
| Painel (Node `http`, HTML montado no servidor) | `src/servidor.js` (rotas, sessão, origem), `src/painel/rotas.js` (telas), `src/painel/html.js` (layout e visual) |
| Login e sessão | `src/auth/senha.js` (scrypt), `src/auth/sessao.js` (cookie assinado + tabela `sessao`) |
| Banco e histórico | `src/db.js` (transação), `src/historico.js` (registrar), `src/config.js` (regras com versão) |
| Telas da etapa 1b | `src/painel/rotas-aulas.js` (nova aula, cancelar, contatos, anonimizar, exportar) |
| Google Agenda | `src/agenda/google.js` (conta de serviço), `src/agenda/fila.js` (o que entra na fila), `src/agenda/sincronizar.js` (envio com nova tentativa), `src/agenda/evento.js` (título e cor) |
| Rotinas automáticas | `src/rotinas.js` (feriados nacionais por dia, fila do Google a cada 30 s) |
| Regras de negócio puras | `src/regras/` (permissões, disponibilidade, reposição, confirmação, feriados) |
| "Agora" e "hoje" (Brasília) | `src/relogio.js` (fonte única, TST-06) |
| Simuladores de WhatsApp, IA e Google | `testes/simuladores/` |
| Testes | `testes/unidade/`, `testes/integracao/`, `testes/tela/` (ajuda comum em `testes/ajuda.js`) |
| Skills e hooks do Claude | `.claude/skills/`, `.claude/hooks/` (ligados em `.claude/settings.json`) |

A Sofia e o cliente de WhatsApp vêm do projeto SlimFit (`rrabadan86/SF-Chat_Experimental-Mensagens`,
pasta `ChatBot/` e `Experimental/src/wa-client.js`). Diferenças: aqui **não há EVO** (o banco
PostgreSQL é a fonte da verdade) e **um só número** de WhatsApp para Sofia e avisos.

## Regras por área (carregadas pelo caminho do arquivo)
| Arquivo | Códigos |
|---|---|
| `sofia.md` — Sofia, confirmação, lista de espera | SOF, CNF, LES |
| `agenda.md` — grade, Google Agenda, perfis | AGD, PER |
| `app.md` — app do aluno, reposição | APP, REP |
| `contratos.md` — planos e contratos | CON |
| `financeiro.md` — cobrança, Pix, caixa | FIN |
| `indicadores.md` | IND |
| `operacao.md` — WhatsApp, dados, operação | OPR |
| `dados-e-segredos.md` | DAD |
| `testes.md` | TST |
| `deploy.md` | DEP |
| `visual.md` | VIS |

Regras marcadas com **⏳ kickoff** dependem de resposta do cliente: não implemente a parte pendente sem a resposta.

## Regras que não mudam
- **Regra de negócio**: não mudar sem perguntar ao dono. Achou erro ou contradição? Registrar em "Achados" de `docs/rastreabilidade.md` e mostrar ao dono.
- **Segredos e dados**: nada de `.env`, dados de alunos, sessão do WhatsApp ou comprovantes no Git (DAD-01, DAD-02).
- **Histórico**: nada é apagado; tudo que muda grava em `historico` (DAD-03, DAD-04, OPR-07).
- **Mensagem a aluno/lead**: registrar o envio na hora, nunca em dobro; respeitar o ritmo de envio (OPR-02).
- **Perfis**: permissão conferida no servidor (PER-03).
- **Google Agenda**: só Sistema → Google; nada é lido de volta (AGD-09).

## Antes de cada commit
1. `node --check` em cada `.js` mexido.
2. `npm test`; se mexeu em banco ou rota, `npm run test:integracao`; se mexeu em tela, `npm run test:telas` (os dois com `DATABASE_URL_TESTE`).
3. Regra nova/alterada → teste com o código no título (TST-02) e `npm run matriz`.
4. Branch de trabalho → PR → CI ✓ → squash merge (skill `subir-versao`, DEP-01).
