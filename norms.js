const express = require("express");
const Stripe = require("stripe");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ---------------------------------------------------------------
// POST /billing/checkout — cria uma sessão de checkout do Stripe
// para o plano escolhido. Requer login (o engenheiro já tem conta,
// geralmente no plano 'gratis', e está fazendo upgrade).
// ---------------------------------------------------------------
router.post("/checkout", express.json(), requireAuth, async (req, res) => {
  const { plan_code } = req.body; // 'start' | 'pro' | 'escritorio'

  try {
    const planResult = await pool.query(
      "SELECT * FROM plan_limits WHERE plan_code = $1",
      [plan_code]
    );
    const plan = planResult.rows[0];

    if (!plan || !plan.stripe_price_id) {
      return res.status(400).json({
        error: "Plano inválido ou ainda não configurado no Stripe (stripe_price_id ausente).",
      });
    }

    const engineerResult = await pool.query(
      "SELECT email, stripe_customer_id FROM engineers WHERE id = $1",
      [req.engineerId]
    );
    const engineer = engineerResult.rows[0];

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: engineer.stripe_customer_id || undefined,
      customer_email: engineer.stripe_customer_id ? undefined : engineer.email,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${process.env.APP_URL}/planos/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/planos`,
      metadata: {
        engineer_id: req.engineerId,
        plan_code: plan_code,
      },
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar sessão de checkout." });
  }
});

// ---------------------------------------------------------------
// POST /billing/webhook — o Stripe chama isso quando o pagamento é
// confirmado. É AQUI que o plano do engenheiro é efetivamente
// liberado — nunca no frontend, para evitar que alguém finja ter
// pago só chamando a rota de sucesso manualmente.
//
// IMPORTANTE: esta rota precisa receber o corpo bruto (raw body),
// não o JSON já parseado, para a verificação de assinatura do Stripe
// funcionar. No server.js, ela deve ser registrada ANTES do
// app.use(express.json()) global, ou usar express.raw() só nela.
// ---------------------------------------------------------------
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Assinatura do webhook inválida:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { engineer_id, plan_code } = session.metadata;

    await pool.query(
      `UPDATE engineers
       SET plan = $1,
           plan_started_at = now(),
           subscription_status = 'active',
           stripe_customer_id = $2
       WHERE id = $3`,
      [plan_code, session.customer, engineer_id]
    );

    console.log(`Plano do engenheiro ${engineer_id} atualizado para ${plan_code}`);
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;

    await pool.query(
      `UPDATE engineers
       SET plan = 'gratis', subscription_status = 'canceled'
       WHERE stripe_customer_id = $1`,
      [subscription.customer]
    );
  }

  res.json({ received: true });
});

module.exports = router;
