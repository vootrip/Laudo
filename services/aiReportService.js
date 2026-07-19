const pool = require("../db/pool");

const ITEM_CATEGORY_TO_NORM_SCOPE = {
  estrutura: ["estrutural", "vistoria"],
  paredes: ["vistoria"],
  infiltracao: ["vistoria"],
  impermeabilizacao: ["vistoria"],
  instalacoes_eletricas: ["vistoria"],
  conclusao_obra: ["conclusao_obra"],
};

async function getCandidateNorms(itemCategories) {
  const scopes = new Set();
  for (const category of itemCategories) {
    const mapped = ITEM_CATEGORY_TO_NORM_SCOPE[category] || ["vistoria"];
    mapped.forEach((s) => scopes.add(s));
  }

  const { rows } = await pool.query(
    `SELECT code, title, scope_summary
     FROM technical_norms
     WHERE applies_to = ANY($1) AND status = 'vigente'
     ORDER BY code`,
    [Array.from(scopes)]
  );

  return rows;
}

function buildSystemPrompt(candidateNorms) {
  const normsList = candidateNorms
    .map((n) => `- ${n.code} (${n.title}): ${n.scope_summary}`)
    .join("\n");

  return `Você é um assistente de redação técnica para laudos de engenharia civil.

Sua tarefa é reformular a observação do engenheiro em linguagem técnica formal,
seguindo estas regras obrigatórias:

1. Use APENAS os fatos mencionados pelo engenheiro. Nunca adicione gravidade,
   causa, risco ou conclusão que ele não tenha escrito.
2. Reformule o vocabulário coloquial em terminologia técnica de engenharia civil.
3. Dentre as normas abaixo, escolha no máximo 1 que seja pertinente ao trecho,
   e cite apenas o código e título dela — nunca cite ou repita conteúdo do
   texto integral da norma, pois isso não está disponível para você.
   Se nenhuma norma listada for pertinente, não cite nenhuma.
4. Se não tiver certeza sobre um fato, mantenha a redação tão vaga quanto a
   observação original — não preencha lacunas.

Normas candidatas para este laudo:
${normsList}

Responda APENAS em JSON, sem markdown, com os campos: "generated_text" e
"cited_norm_code" (ou null se nenhuma norma se aplicar).`;
}

async function generateTechnicalText(rawObservation, itemCategories) {
  const candidateNorms = await getCandidateNorms(itemCategories);
  const systemPrompt = buildSystemPrompt(candidateNorms);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: `Observação do engenheiro: "${rawObservation}"` }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na API da IA: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, "").trim());

  return {
    generatedText: parsed.generated_text,
    citedNormCode: parsed.cited_norm_code,
    candidateNormsConsidered: candidateNorms.map((n) => n.code),
  };
}

module.exports = { generateTechnicalText, getCandidateNorms };
