const express = require("express");
const multer = require("multer");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // PDF assinado costuma ser maior que o original
});

// ---------------------------------------------------------------
// POST /reports/:id/signatures/manual-upload
//
// Fluxo que FUNCIONA HOJE, sem depender de nenhuma API externa:
// o engenheiro baixa o PDF do laudo (GET /reports/:id/pdf), assina
// fora do sistema usando seu certificado gov.br em
// https://assinador.iti.br (gratuito, ICP-Brasil), e sobe o PDF
// já assinado de volta aqui. Isso cobre o caso de uso real de quem
// já assina digitalmente sem custo adicional.
// ---------------------------------------------------------------
router.post("/:id/signatures/manual-upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }
  if (req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "Envie o PDF assinado (formato .pdf)." });
  }

  try {
    const reportCheck = await pool.query(
      "SELECT id, status FROM reports WHERE id = $1 AND engineer_id = $2",
      [req.params.id, req.engineerId]
    );
    if (reportCheck.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    if (reportCheck.rows[0].status === "rascunho") {
      return res.status(409).json({
        error: "Assine o laudo no sistema primeiro (POST /reports/:id/sign) antes de anexar o PDF assinado externamente.",
      });
    }

    const base64 = req.file.buffer.toString("base64");
    const dataUri = `data:application/pdf;base64,${base64}`;

    const result = await pool.query(
      `INSERT INTO signatures (report_id, provider, signature_status, signed_pdf_url, completed_at)
       VALUES ($1, 'externo_manual', 'assinado', $2, now())
       RETURNING id, provider, signature_status, completed_at`,
      [req.params.id, dataUri]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes("File too large")) {
      return res.status(400).json({ error: "PDF assinado deve ter no máximo 8MB." });
    }
    res.status(500).json({ error: "Erro ao registrar assinatura." });
  }
});

// GET /reports/:id/signatures — histórico de assinaturas do laudo
router.get("/:id/signatures", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.provider, s.signature_status, s.provider_document_id, s.created_at, s.completed_at
       FROM signatures s
       JOIN reports r ON r.id = s.report_id
       WHERE s.report_id = $1 AND r.engineer_id = $2
       ORDER BY s.created_at DESC`,
      [req.params.id, req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar assinaturas." });
  }
});

// GET /reports/:id/signatures/:signatureId/pdf — baixa o PDF já assinado
router.get("/:id/signatures/:signatureId/pdf", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.signed_pdf_url FROM signatures s
       JOIN reports r ON r.id = s.report_id
       WHERE s.id = $1 AND s.report_id = $2 AND r.engineer_id = $3`,
      [req.params.signatureId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0 || !result.rows[0].signed_pdf_url) {
      return res.status(404).json({ error: "PDF assinado não encontrado." });
    }
    const base64 = result.rows[0].signed_pdf_url.split(",")[1];
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="laudo-assinado-${req.params.id}.pdf"`);
    res.send(Buffer.from(base64, "base64"));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao baixar PDF assinado." });
  }
});

module.exports = router;

// =================================================================
// NOTA — Integração real com D4Sign (ainda NÃO implementada aqui)
// =================================================================
// A tabela `signatures` já tem os campos necessários (provider,
// provider_document_id, signature_status) para suportar D4Sign como
// segundo provider, mas a integração de fato depende de:
//   1. Conta D4Sign criada e chave de API (D4SIGN_API_TOKEN,
//      D4SIGN_CRYPT_KEY) — não temos essas credenciais neste ambiente.
//   2. Fluxo assíncrono: criar documento na D4Sign (POST /documents),
//      adicionar signatário, disparar para assinatura, e receber
//      webhook de confirmação (D4Sign não tem callback síncrono).
//      Isso exige um endpoint público de webhook (ex: POST
//      /webhooks/d4sign) similar ao que já existe para o Stripe em
//      routes/billing.js, atualizando `signatures.signature_status`
//      e `signatures.provider_document_id` quando o webhook chegar.
// Quando tiver a conta/credenciais, o próximo passo é criar
// services/d4signService.js com essas duas chamadas (criar documento
// + webhook handler) seguindo o mesmo padrão de routes/billing.js.
