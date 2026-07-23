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

Um laudo técnico formal tem duas seções conceitualmente distintas, e sua
tarefa é produzir as duas separadamente:

- "diagnostic_text": a descrição técnica do que foi observado (o
  "diagnóstico"), reformulando a observação do engenheiro em linguagem
  técnica formal.
- "technical_opinion": o "parecer técnico conclusivo" — uma conclusão
  objetiva e uma recomendação de próximo passo, baseada ESTRITAMENTE no que
  foi observado. Se a observação for insuficiente para uma conclusão segura,
  o parecer deve dizer isso explicitamente (ex: "recomenda-se avaliação
  complementar para conclusão definitiva"), em vez de forçar uma conclusão.

Regras obrigatórias e inegociáveis para as duas seções:

1. Use APENAS os fatos mencionados pelo engenheiro. Nunca adicione gravidade,
   causa, risco ou conclusão que ele não tenha escrito.
2. NUNCA invente medidas, ângulos, percentuais, prazos, datas, materiais de
   reparo, métodos de execução ou recomendações técnicas específicas que não
   tenham sido explicitamente informados pelo engenheiro. Se ele não disse o
   tamanho da fissura, você não estima um tamanho. Se ele não recomendou um
   reparo, você não recomenda um método de reparo específico — no máximo
   recomenda avaliação complementar por profissional habilitado.
3. O nível de detalhe e o TAMANHO do texto gerado devem ser proporcionais ao
   nível de detalhe da observação original — nas duas direções. Uma
   observação curta e vaga deve gerar textos igualmente curtos e vagos.
   Mas se o engenheiro escreveu um texto longo e detalhado (por exemplo,
   colou o laudo inteiro já redigido, com várias seções e parágrafos), a
   saída deve preservar e organizar TODO esse conteúdo em linguagem técnica
   — não resuma, não encurte, não descarte informação. Nesse caso sua
   tarefa se aproxima mais de revisão/formalização do que de geração do
   zero: mantenha a extensão e a riqueza de detalhes do que foi escrito.
4. Dentre as normas abaixo (já pré-selecionadas e ordenadas por relevância ao
   texto), escolha no máximo 1 que seja pertinente, e cite apenas o código e
   título dela — nunca cite ou repita conteúdo do texto integral da norma.
   Se nenhuma for de fato pertinente, não cite nenhuma.
5. Se não tiver certeza sobre um fato, mantenha a redação tão vaga quanto a
   observação original — não preencha lacunas.

Normas candidatas para este laudo, da mais para a menos relevante:
${normsList}

Responda APENAS em JSON válido, sem markdown e sem texto fora do JSON, com os
campos:
- "diagnostic_text": a descrição técnica do diagnóstico
- "technical_opinion": o parecer conclusivo
- "cited_norm_code": código da norma citada, ou null
- "insufficient_detail": true se a observação original for vaga demais para
  compor uma descrição técnica útil, false caso contrário
- "probable_cause": causa técnica mais provável da manifestação observada,
  em uma frase curta (ex: "Recalque diferencial de fundação"), APENAS se a
  observação der base suficiente para apontar uma causa provável — senão
  null. Não invente uma causa específica que a observação não sustente.
- "risk_level": classificação de risco — exatamente um destes valores:
  "baixo", "medio", "alto", "critico" — ou null se não houver informação
  suficiente para classificar com segurança. Julgue apenas pelo que foi
  descrito (extensão, progressão, elemento afetado), nunca por suposição.
- "recommended_deadline_days": número de dias recomendado para reavaliação
  ou intervenção, como inteiro, APENAS se a gravidade descrita justificar
  um prazo (ex: risco estrutural ativo). Para observações de baixa
  gravidade ou sem urgência aparente, use null — não invente um prazo
  arbitrário só para preencher o campo.
- "art_required": true se a natureza do que foi descrito (ex: dano
  estrutural, risco à segurança) tipicamente exige ART para a intervenção
  recomendada, false se claramente não exige, null se não for possível
  julgar com o que foi informado.

Se o texto gerado contiver aspas duplas, escape-as corretamente (\\") para
manter o JSON válido. Não use quebras de linha literais dentro dos valores —
use espaços no lugar.`;
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
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Observação do engenheiro: "${rawObservation}"` }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na API da IA: ${response.status} - ${errText}`);
  }

  const data = await response.json();

  // Texto de entrada longo (ex: laudo inteiro colado) pode gerar uma saída
  // grande o bastante para estourar o teto de tokens, cortando o JSON pela
  // metade — melhor avisar o engenheiro do que devolver um resultado quebrado.
  if (data.stop_reason === "max_tokens") {
    throw Object.assign(
      new Error("O texto é longo demais para a IA processar de uma vez. Tente gerar em partes menores, ou use 'Organizar em seções automaticamente' após colar o texto sem reformulação."),
      { statusCode: 413 }
    );
  }

  const textBlock = data.content.find((c) => c.type === "text");
  const rawText = textBlock.text.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const diagMatch = rawText.match(/"diagnostic_text"\s*:\s*"([\s\S]*?)"\s*,\s*"technical_opinion"/);
    const opinionMatch = rawText.match(/"technical_opinion"\s*:\s*"([\s\S]*?)"\s*,\s*"cited_norm_code"/);
    if (!diagMatch) {
      throw new Error(
        "A IA retornou uma resposta em formato inesperado. Tente novamente — se persistir, reduza o tamanho da observação."
      );
    }
    parsed = {
      diagnostic_text: diagMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"),
      technical_opinion: opinionMatch ? opinionMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : "",
      cited_norm_code: null,
      insufficient_detail: false,
      probable_cause: (rawText.match(/"probable_cause"\s*:\s*"([^"]*)"/) || [])[1] || null,
      risk_level: (rawText.match(/"risk_level"\s*:\s*"([^"]*)"/) || [])[1] || null,
      recommended_deadline_days: parseInt((rawText.match(/"recommended_deadline_days"\s*:\s*(\d+)/) || [])[1], 10) || null,
      art_required: /"art_required"\s*:\s*true/.test(rawText) ? true : /"art_required"\s*:\s*false/.test(rawText) ? false : null,
    };
  }

  return {
    generatedText: parsed.diagnostic_text,
    technicalOpinion: parsed.technical_opinion,
    citedNormCode: parsed.cited_norm_code,
    insufficientDetail: parsed.insufficient_detail === true,
    probableCause: parsed.probable_cause || null,
    riskLevel: ["baixo", "medio", "alto", "critico"].includes(parsed.risk_level) ? parsed.risk_level : null,
    recommendedDeadlineDays: Number.isInteger(parsed.recommended_deadline_days) ? parsed.recommended_deadline_days : null,
    artRequired: typeof parsed.art_required === "boolean" ? parsed.art_required : null,
    candidateNormsConsidered: candidateNorms.map((n) => ({
      code: n.code,
      score: n.score,
      matchedKeywords: n.matchedKeywords,
    })),
  };
}

const REQUIRED_ITEMS_BY_TEMPLATE = {
  vistoria: [
    "identificação do imóvel (endereço)",
    "identificação do responsável técnico (nome e CREA)",
    "finalidade da vistoria",
    "descrição dos itens vistoriados",
    "data da vistoria",
    "conclusão ou parecer do engenheiro",
  ],
};

async function reviewImportedDocument(rawText, templateType) {
  const requiredItems = REQUIRED_ITEMS_BY_TEMPLATE[templateType] || REQUIRED_ITEMS_BY_TEMPLATE.vistoria;

  const systemPrompt = `Você é um revisor técnico de laudos de engenharia civil.

O engenheiro já escreveu o documento abaixo. Sua tarefa é REVISAR, não reescrever
nem resumir. Regras obrigatórias:

1. Corrija apenas gramática, ortografia e adequação de terminologia técnica.
   Nunca altere o sentido, a gravidade, as conclusões ou os dados numéricos
   do que foi escrito. Preserve o texto original o máximo possível.
2. Nunca invente ou complete informação ausente. Se um dado obrigatório não
   estiver no documento, ele deve aparecer na lista de pendências — não deve
   ser preenchido por você.
3. Compare o documento contra esta lista de itens esperados para este tipo
   de laudo:
${requiredItems.map((i) => `   - ${i}`).join("\n")}

Responda APENAS em JSON válido, sem markdown, com os campos:
- "corrected_text": o texto com apenas as correções de gramática/terminologia (mantendo todo o conteúdo original)
- "missing_items": array com os itens acima que não foram encontrados no documento
- "incomplete_items": array com itens que aparecem mas de forma incompleta

Escape aspas duplas dentro dos textos com \\" e não use quebras de linha literais.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: rawText.slice(0, 12000) }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na API da IA: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  const rawJson = textBlock.text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(rawJson);
  } catch (err) {
    return {
      corrected_text: rawText,
      missing_items: [],
      incomplete_items: [],
      review_failed: true,
    };
  }
}

// ---------------------------------------------------------------
// Organiza um texto livre (gerado pela IA ou colado pelo engenheiro)
// em seções/subseções numeradas, no padrão do laudo de referência
// (1) Identificação, 2) Objetivo... 7.1, 7.2...). Não reescreve o
// conteúdo — só identifica a estrutura e distribui o texto existente
// nela. Se o texto já tiver cabeçalhos numerados, a IA deve respeitar
// os mesmos números/títulos; se não tiver estrutura nenhuma, ela
// organiza em seções genéricas razoáveis sem inventar conteúdo novo.
// ---------------------------------------------------------------
async function structureReportSections(rawText) {
  const systemPrompt = `Você organiza a ESTRUTURA de laudos de engenharia civil — nunca reescreve o conteúdo.

Tarefa: divida o texto abaixo em seções numeradas (e subseções quando fizer
sentido, ex: "7.1", "7.2"), no padrão comum de laudo técnico brasileiro
(Identificação, Objetivo, Localização, Metodologia, Descrição técnica,
Causas/Diagnóstico, Medidas corretivas, Considerações finais — adapte os
títulos ao conteúdo real, não force esse padrão exato se não couber).

Regras obrigatórias:
1. NUNCA reescreva, resuma, expanda ou corrija o conteúdo do texto. Copie
   os trechos originais literalmente para dentro de cada seção/subseção.
   Sua única tarefa é decidir ONDE cada trecho existente se encaixa.
2. Se o texto já tiver cabeçalhos numerados (ex: "7.1 Rebaixamento..."),
   respeite exatamente esses números e títulos — não renumere.
3. Se o texto não tiver estrutura nenhuma (só parágrafos soltos), crie
   seções genéricas razoáveis (ex: "1) Descrição Técnica") mas ainda assim
   sem alterar o texto em si.
4. Todo o texto original deve aparecer em alguma seção — não descarte nada.
5. Uma seção só deve ter subseções se o texto original já sugerir essa
   subdivisão claramente (não crie subseções artificiais).

Responda APENAS em JSON válido, sem markdown, no formato:
{
  "sections": [
    {
      "section_number": "1",
      "section_title": "Identificação",
      "content_text": "texto da seção, ou null se só tiver subseções",
      "subsections": [
        {"subsection_number": "1.1", "subsection_title": "...", "content_text": "..."}
      ]
    }
  ]
}

Se uma seção não tiver subseções, "subsections" deve ser um array vazio []
e "content_text" deve conter o texto dela. Escape aspas duplas com \\" e não
use quebras de linha literais dentro dos valores — use \\n.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: rawText }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na API da IA: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");

  // A resposta pode ter sido cortada se o texto de entrada for muito
  // longo e o resultado (com toda a formatação JSON) passar do teto de
  // tokens — nesse caso é mais seguro avisar o chamador do que devolver
  // um JSON quebrado pela metade.
  if (data.stop_reason === "max_tokens") {
    throw Object.assign(
      new Error("O texto é longo demais para organizar em seções automaticamente de uma vez. Tente dividir em partes menores, ou organize manualmente."),
      { statusCode: 413 }
    );
  }

  const rawJson = textBlock.text.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error("A IA retornou uma estrutura em formato inesperado. Tente novamente.");
  }

  if (!parsed.sections || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error("Não foi possível identificar seções nesse texto.");
  }

  return parsed.sections;
}

const PHOTO_ANALYSIS_TAGS = [
  "fissura", "trinca", "infiltracao", "umidade", "eflorescencia", "corrosao",
  "armadura_exposta", "mofo", "destacamento", "desplacamento", "erosao",
  "recalque", "carbonatacao", "vazamento", "outro",
];

/**
 * Análise de foto sob demanda (nunca automática — só quando o
 * engenheiro clica em "Analisar"). Devolve tags de patologia visível
 * e uma sugestão de legenda técnica, restritas ao que é observável
 * na imagem — a IA não deve inferir causa, gravidade ou dimensão que
 * não seja visualmente aparente.
 */
async function analyzePhotoWithAI(base64Data, mediaType) {
  const systemPrompt = `Você é um assistente técnico de engenharia analisando uma foto de vistoria.

Sua tarefa: identificar quais manifestações patológicas são VISUALMENTE
observáveis na imagem, e sugerir uma legenda técnica curta e objetiva.

Regras obrigatórias:
1. Baseie-se ESTRITAMENTE no que é visível na imagem. Não infira causa,
   gravidade, medidas ou histórico que a foto sozinha não comprove.
2. Se a imagem não mostrar nenhuma patologia clara (ex: foto de fachada
   sem dano aparente, foto de contexto/localização), retorne tags vazias
   e uma legenda neutra descrevendo o que a foto mostra.
3. A legenda sugerida deve ser curta (uma frase), no mesmo estilo do
   laudo real de referência (ex: "Fissura diagonal na alvenaria próxima
   à esquadria", "Vista geral da fachada do imóvel").
4. Use apenas tags desta lista fixa: ${PHOTO_ANALYSIS_TAGS.join(", ")}.

Responda APENAS em JSON válido, sem markdown, com os campos:
- "tags": array de tags da lista fixa (pode ser vazio)
- "suggested_caption": legenda sugerida, como string`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: "Analise esta foto de vistoria técnica." },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na API da IA: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  const rawJson = (textBlock?.text || "").replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error("A IA retornou uma resposta em formato inesperado. Tente novamente.");
  }

  const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t) => PHOTO_ANALYSIS_TAGS.includes(t)) : [];

  return {
    tags,
    suggestedCaption: typeof parsed.suggested_caption === "string" ? parsed.suggested_caption : null,
  };
}

module.exports = { generateTechnicalText, getCandidateNorms, reviewImportedDocument, structureReportSections, analyzePhotoWithAI };
