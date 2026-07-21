const pool = require("../db/pool");

const ITEM_CATEGORY_TO_NORM_SCOPE = {
  estrutura: ["estrutural", "vistoria"],
  paredes: ["vistoria"],
  infiltracao: ["vistoria"],
  impermeabilizacao: ["vistoria"],
  instalacoes_eletricas: ["vistoria"],
  conclusao_obra: ["conclusao_obra"],
};

async function getCandidateNorms(itemCategories, rawObservation, engineerId) {
  const scopes = new Set();
  for (const category of itemCategories) {
    const mapped = ITEM_CATEGORY_TO_NORM_SCOPE[category] || ["vistoria"];
    mapped.forEach((s) => scopes.add(s));
  }

  const { rows } = await pool.query(
    `SELECT code, title, scope_summary, keywords
     FROM technical_norms
     WHERE (applies_to = ANY($1) OR engineer_id = $2)
       AND status = 'vigente'
       AND (engineer_id IS NULL OR engineer_id = $2)
     ORDER BY code`,
    [Array.from(scopes), engineerId]
  );

  const observationLower = (rawObservation || "").toLowerCase();

  const scored = rows.map((norm) => {
    const keywordHits = (norm.keywords || []).filter((kw) =>
      observationLower.includes(kw.toLowerCase())
    );
    return {
      code: norm.code,
      title: norm.title,
      scope_summary: norm.scope_summary,
      score: 1 + keywordHits.length * 2,
      matchedKeywords: keywordHits,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 4);
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
3. Dentre as normas abaixo (já pré-selecionadas e ordenadas por relevância ao
   texto), escolha no máximo 1 que seja pertinente ao trecho, e cite apenas o
   código e título dela — nunca cite ou repita conteúdo do texto integral da
   norma, pois isso não está disponível para você. Se nenhuma norma listada
   for de fato pertinente, não cite nenhuma — não force uma citação só porque
   havia candidatas na lista.
4. Se não tiver certeza sobre um fato, mantenha a redação tão vaga quanto a
   observação original — não preencha lacunas.

Normas candidatas para este laudo, da mais para a menos relevante:
${normsList}

Responda APENAS em JSON válido, sem markdown e sem texto fora do JSON, com os
campos: "generated_text" e "cited_norm_code" (ou null se nenhuma norma se
aplicar). Se o texto gerado contiver aspas duplas, escape-as corretamente
(\\") para manter o JSON válido. Não use quebras de linha literais dentro do
valor de "generated_text" — use espaços no lugar.`;
}

async function generateTechnicalText(rawObservation, itemCategories, engineerId) {
  const candidateNorms = await getCandidateNorms(itemCategories, rawObservation, engineerId);
  const systemPrompt = buildSystemPrompt(candidateNorms);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
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
  const rawText = textBlock.text.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const match = rawText.match(/"generated_text"\s*:\s*"([\s\S]*?)"\s*,\s*"cited_norm_code"/);
    if (match) {
      parsed = {
        generated_text: match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"),
        cited_norm_code: null,
      };
    } else {
      parsed = { generated_text: rawText, cited_norm_code: null };
    }
  }

  return {
    generatedText: parsed.generated_text,
    citedNormCode: parsed.cited_norm_code,
    candidateNormsConsidered: candidateNorms.map((n) => ({
      code: n.code,
      score: n.score,
      matchedKeywords: n.matchedKeywords,
    })),
  };
}

module.exports = { generateTechnicalText, getCandidateNorms };
