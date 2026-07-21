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
seguindo estas
