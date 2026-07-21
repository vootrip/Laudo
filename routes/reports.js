const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { checkPlanLimit } = require("../middleware/checkPlanLimit");
const { generateTechnicalText } = require("../services/aiReportService");
const { generateReportPdf } = require("../services/pdfService");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Todas as rotas abaixo exigem o engenheiro autenticado
router.use(requireAuth);

// ---------------------------------------------------------------
// POST /reports — cria um laudo em rascunho (fluxo do formulário)
// Passa primeiro por checkPlanLimit: se o engenheiro já usou todos
// os laudos disponíveis no plano atual, a criação é bloqueada com
// status 402 e o frontend deve redirecionar para a tela de planos.
// ---------------------------------------------------------------
router.post("/", checkPlanLimit, async (req, res) => {
  const { project_id, template_id, title, raw_input_json } = req.body;

  if (!project_id || !template_id || !title) {
    return res.status(400).json({ error: "project_id, template_id e title são obrigatórios." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO reports (engineer_id, project_id, template_id, title, raw_input_json, status)
       VALUES ($1, $2, $3, $4, $5, 'rascunho')
       RETURNING *`,
      [req.engineerId, project_id, template_id, title, raw_input_json || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar laudo." });
  }
});

// ---------------------------------------------------------------
// GET /reports/:id
// ---------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM reports WHERE id = $1 AND engineer_id = $2",
      [req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar laudo." });
  }
});

// ---------------------------------------------------------------
// POST /reports/:id/generate — chama a IA para gerar o texto técnico
// a partir da observação livre do formulário
// ---------------------------------------------------------------
router.post("/:id/generate", async (req, res) => {
  const { observation, item_categories } = req.body;

  if (!observation) {
    return res.status(400).json({ error: "Campo 'observation' é obrigatório." });
  }

  try {
    const reportCheck = await pool.query(
      "SELECT id FROM reports WHERE id = $1 AND engineer_id = $2",
      [req.params.id, req.engineerId]
    );
    if (reportCheck.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    const aiResult = await generateTechnicalText(observation, item_categories || [], req.engineerId);

    const updated = await pool.query(
      `UPDATE reports
       SET generated_content_json = $1,
           norm_references = $2,
           status = 'rascunho',
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [
        JSON.stringify({ text: aiResult.generatedText }),
        aiResult.citedNormCode ? [aiResult.citedNormCode] : [],
        req.params.id,
      ]
    );

    res.json({ report: updated.rows[0], ai: aiResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar texto com IA: " + err.message });
  }
});

// ---------------------------------------------------------------
// PATCH /reports/:id/review — engenheiro edita o texto gerado
// (fica registrado como revisão manual)
// ---------------------------------------------------------------
router.patch("/:id/review", async (req, res) => {
  const { edited_text } = req.body;

  try {
    const result = await pool.query(
      `UPDATE reports
       SET generated_content_json = jsonb_set(generated_content_json, '{text}', to_jsonb($1::text)),
           status = 'revisado',
           updated_at = now()
       WHERE id = $2 AND engineer_id = $3
       RETURNING *`,
      [edited_text, req.params.id, req.engineerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao revisar laudo." });
  }
});

// ---------------------------------------------------------------
// POST /reports/:id/import — engenheiro importa documento pronto
// (.docx ou .pdf) para revisão/completude pela IA
// ---------------------------------------------------------------
router.post("/:id/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }

  try {
    let rawText;
    if (req.file.mimetype === "application/pdf") {
      const data = await pdfParse(req.file.buffer);
      rawText = data.text;
    } else if (
      req.file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      rawText = result.value;
    } else {
      return res.status(400).json({ error: "Formato não suportado. Envie .docx ou .pdf." });
    }

    // Nota: o upload do arquivo original para um storage (S3/R2) e a
    // chamada de revisão via IA seguem a mesma lógica já desenhada em
    // integracao_import_documento.js — aqui deixamos o texto extraído
    // salvo como entrada bruta para a etapa seguinte de revisão.
    const updated = await pool.query(
      `UPDATE reports
       SET source_type = 'documento_importado',
           raw_input_json = $1,
           status = 'rascunho',
           updated_at = now()
       WHERE id = $2 AND engineer_id = $3
       RETURNING *`,
      [JSON.stringify({ imported_raw_text: rawText }), req.params.id, req.engineerId]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    res.json({ report: updated.rows[0], extractedText: rawText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao importar documento: " + err.message });
  }
});

// ---------------------------------------------------------------
// GET /reports/:id/pdf — gera o PDF final do laudo, com a
// identidade visual do escritório (logo, nome, CREA), e devolve
// o arquivo para download.
// ---------------------------------------------------------------
router.get("/:id/pdf", async (req, res) => {
  try {
    const reportResult = await pool.query(
      "SELECT * FROM reports WHERE id = $1 AND engineer_id = $2",
      [req.params.id, req.engineerId]
    );
    if (reportResult.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    const report = reportResult.rows[0];

    const engineerResult = await pool.query(
      "SELECT name, company_name, crea_number, crea_region, logo_url FROM engineers WHERE id = $1",
      [req.engineerId]
    );
    const engineer = engineerResult.rows[0];

    const projectResult = await pool.query(
      `SELECT p.address, c.name AS client_name
       FROM projects p JOIN clients c ON c.id = p.client_id
       WHERE p.id = $1`,
      [report.project_id]
    );
    const project = projectResult.rows[0] || {};

    let norms = [];
    if (report.norm_references && report.norm_references.length > 0) {
      const normsResult = await pool.query(
        "SELECT code, title FROM technical_norms WHERE code = ANY($1)",
        [report.norm_references]
      );
      norms = normsResult.rows;
    }

    // Nota: se o engenheiro tiver logo_url cadastrada, o ideal é baixar
    // a imagem aqui (fetch + arrayBuffer) e passar como engineer.logo_buffer
    // antes de gerar o PDF. Deixado como próximo passo — depende de qual
    // storage (S3/R2) for usado para hospedar o arquivo da logo.

    const pdfBuffer = await generateReportPdf({
      engineer,
      project: { address: project.address },
      client: { name: project.client_name },
      report,
      norms,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="laudo-${report.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar PDF: " + err.message });
  }
});


router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, status, source_type, created_at FROM reports WHERE engineer_id = $1 ORDER BY created_at DESC",
      [req.engineerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar laudos." });
  }
});

module.exports = router;
