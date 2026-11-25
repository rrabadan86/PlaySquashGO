/**
 * IA da Sofia pela API da Anthropic (SDK oficial @anthropic-ai/sdk). Isolada neste arquivo:
 * o resto da Sofia fala com a mesma interface do simulador (testes/simuladores/ia-falsa.js):
 *
 *   ia.responder({ modelo, sistemaFixo, sistemaDoMomento, mensagens, ferramentas })
 *     → { texto, chamadas:[{id,nome,entrada}], bruto, parada, modelo,
 *         tokensEntrada, tokensSaida, cacheLeitura, cacheEscrita }
 *
 * mensagens (formato neutro):
 *   { papel:'usuario'|'assistente', texto }                 — histórico do WhatsApp
 *   { papel:'assistente', bruto }                            — resposta da IA com pedido de ferramenta
 *   { papel:'ferramenta', resultados:[{id,conteudo,erro}] }  — resultados das ferramentas
 *
 * A chave fica no ambiente (ANTHROPIC_API_KEY), nunca no repositório (DAD-01). Só a Anthropic
 * recebe a conversa (DAD-09).
 * Recusa por segurança: a API tenta de novo em outro modelo sozinha (fallbacks "default");
 * se ainda assim recusar, a Sofia passa a conversa para a equipe.
 */
const Anthropic = require('@anthropic-ai/sdk');

const AnthropicCliente = Anthropic.default || Anthropic;

function paraApi(mensagens) {
  return mensagens.map(m => {
    if (m.papel === 'ferramenta') {
      return { role: 'user', content: m.resultados.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.conteudo, is_error: !!r.erro })) };
    }
    if (m.papel === 'assistente') return { role: 'assistant', content: m.bruto || m.texto };
    return { role: 'user', content: m.texto };
  });
}

function criarIaAnthropic({ cliente = null, maxTokens = 16000 } = {}) {
  const api = cliente || new AnthropicCliente();
  return {
    async responder({ modelo, sistemaFixo, sistemaDoMomento, mensagens, ferramentas }) {
      const r = await api.beta.messages.create({
        model: modelo,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        // Ferramentas + instruções fixas ficam em cache; o contexto do momento vem depois.
        system: [
          { type: 'text', text: sistemaFixo, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: sistemaDoMomento },
        ],
        tools: ferramentas,
        messages: paraApi(mensagens),
      });
      const u = r.usage || {};
      const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const chamadas = r.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, nome: b.name, entrada: b.input }));
      return {
        texto: r.stop_reason === 'refusal' ? '' : texto,
        chamadas: r.stop_reason === 'tool_use' ? chamadas : [],
        bruto: r.content,
        parada: r.stop_reason,
        modelo: r.model || modelo,
        tokensEntrada: u.input_tokens || 0,
        tokensSaida: u.output_tokens || 0,
        cacheLeitura: u.cache_read_input_tokens || 0,
        cacheEscrita: u.cache_creation_input_tokens || 0,
      };
    },
  };
}

// Só cria a IA real se a chave estiver no ambiente.
function iaDoAmbiente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return criarIaAnthropic();
}

module.exports = { criarIaAnthropic, iaDoAmbiente, paraApi };
