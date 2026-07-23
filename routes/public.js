/**
 * Rota pública de demonstração — permite que qualquer visitante da
 * landing page teste a reformulação técnica da IA, sem precisar
 * criar conta. Objetivo: reduzir a desconfiança inicial ("eu
 * assinaria algo que uma IA escreveu?") deixando a pessoa ver o
 * resultado com o próprio texto dela, na hora.
 *
 * Duas proteções importantes, por ser uma rota sem login:
 *  1. Rate limit simples por IP (evita que alguém abuse e gere custo
 *     alto de API às suas custas).
 *  2. Limite de tamanho do texto de entrada (evita prompt gigante).
 *
 * Nota sobre o rate limiter: a implementação abaixo usa um Map em
 * memória, o que funciona bem para um único servidor. Se o backend
 * rodar em múltiplas instâncias (mais de um servidor ao mesmo tempo),
 * isso precisaria virar um contador compartilhado (ex: Redis) para
 * ser realmente eficaz — vale revisar isso ao escalar.
 */

const express = require("express");
const pool = require("../db/pool");
const router = express.Router();

const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hora
const requestLog = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

// ---------------------------------------------------------------
// POST /public/demo — reformula um texto de exemplo, sem autenticação
// ---------------------------------------------------------------
router.post("/demo", express.json(), async (req, res) => {
  const { observation } = req.body;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: "Limite de testes gratuitos atingido por agora. Crie uma conta para continuar usando.",
    });
  }

  if (!observation || observation.length < 10) {
    return res.status(400).json({ error: "Descreva a observação com um pouco mais de detalhe." });
  }
  if (observation.length > 500) {
    return res.status(400).json({ error: "Texto muito longo para a demonstração (máximo 500 caracteres)." });
  }

  try {
    const systemPrompt = `Você é um assistente de redação técnica para laudos de engenharia civil.
Reformule a observação abaixo em linguagem técnica formal, seguindo estas regras:
1. Use APENAS os fatos mencionados. Nunca adicione gravidade, causa ou conclusão não mencionada.
2. Reformule o vocabulário coloquial em terminologia técnica de engenharia civil.
3. Esta é uma demonstração pública — não cite normas técnicas específicas aqui.
4. Responda em no máximo 3 frases.

Responda APENAS em JSON, sem markdown, com o campo "generated_text".`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 250,
        system: systemPrompt,
        messages: [{ role: "user", content: `Observação: "${observation}"` }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Erro na API da IA: ${response.status}`);
    }

    const data = await response.json();
    const textBlock = data.content.find((c) => c.type === "text");
    const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, "").trim());

    res.json({ generated_text: parsed.generated_text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar demonstração." });
  }
});

// ---------------------------------------------------------------
// GET /public/plans — planos e preços públicos, para a landing
// page e a tela de upgrade do app puxarem do banco em vez de
// hardcodear preço em dois lugares (que dessincroniza fácil).
// ---------------------------------------------------------------
router.get("/plans", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT plan_code, display_name, laudos_included, billing_period, price_cents, allows_signature
       FROM plan_limits ORDER BY price_cents`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar planos." });
  }
});

module.exports = router;
