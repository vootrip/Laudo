const pool = require("../db/pool");

/**
 * Verifica se o engenheiro ainda tem laudos disponíveis no plano atual
 * antes de permitir a criação de um novo. Roda ANTES da rota de criação
 * de laudo (POST /reports).
 *
 * Regra:
 *  - Plano 'gratis' (billing_period = 'unico'): conta TODOS os laudos já
 *    criados pelo engenheiro, desde sempre (limite vitalício de 1).
 *  - Planos pagos (billing_period = 'mensal'): conta só os laudos criados
 *    desde o início do período de cobrança atual (plan_started_at, contado
 *    em janelas de 30 dias — simplificado; em produção real, isso normalmente
 *    é sincronizado com o ciclo de cobrança do Stripe/Asaas).
 */
async function checkPlanLimit(req, res, next) {
  try {
    const engineerResult = await pool.query(
      "SELECT plan, plan_started_at, subscription_status FROM engineers WHERE id = $1",
      [req.engineerId]
    );
    const engineer = engineerResult.rows[0];

    const planResult = await pool.query(
      "SELECT * FROM plan_limits WHERE plan_code = $1",
      [engineer.plan]
    );
    const plan = planResult.rows[0];

    if (!plan) {
      return res.status(500).json({ error: "Plano do engenheiro não reconhecido." });
    }

    let countQuery;
    let countParams;

    if (plan.billing_period === "unico") {
      countQuery = "SELECT COUNT(*) FROM reports WHERE engineer_id = $1";
      countParams = [req.engineerId];
    } else {
      countQuery = `
        SELECT COUNT(*) FROM reports
        WHERE engineer_id = $1 AND created_at >= $2`;
      countParams = [req.engineerId, engineer.plan_started_at];
    }

    const countResult = await pool.query(countQuery, countParams);
    const usedCount = parseInt(countResult.rows[0].count, 10);

    if (usedCount >= plan.laudos_included) {
      return res.status(402).json({
        error: "Limite de laudos do plano atual atingido.",
        current_plan: plan.plan_code,
        laudos_included: plan.laudos_included,
        laudos_used: usedCount,
        action_required: "upgrade_plan",
      });
    }

    // Deixa disponível para a rota, caso queira usar (ex: exibir "faltam X laudos")
    req.planInfo = { ...plan, laudosUsed: usedCount };
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao verificar limite do plano." });
  }
}

module.exports = { checkPlanLimit };
