const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { checkPlanLimit } = require("../middleware/checkPlanLimit");
const { generateTechnicalText, reviewImportedDocument } = require("../services/aiReportService");
const { generateReportPdf } = require("../services/pdfService");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

router.post("/", checkPlanLimit, async (req, res) => {
  const { project_id, template_id, title, art_number, raw_input_json } = req.body;

  if (!project_id || !template_id || !title) {
    return res.status(400).json({ error: "project_id, template_id e title são obrigatórios." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO reports (engineer_id, project_id, template_id, title, art_number, raw_input_json, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'rascunho')
       RETURNING *`,
      [req.engineerId, project_id, template_id, title, art_number || null, raw_input_json || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar laudo." });
  }
});

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

router.post("/:id/generate", async (req, res) => {
  const { observation, item_categories } = req.body;

  if (!observation) {
    return res.status(400).json({ error: "Campo 'observation' é obrigatório." });
  }

  if (observation.length > 600) {
    return res.status(400).json({
      error: "Observação muito longa para este campo (máximo 600 caracteres). Se você já tem um documento pronto, use a importação de documento (.docx/.pdf) em vez deste campo.",
    });
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
           technical_opinion_json = $2,
           norm_references = $3,
           status = 'rascunho',
           updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [
        JSON.stringify({ text: aiResult.generatedText }),
        JSON.stringify({ text: aiResult.technicalOpinion }),
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

router.patch("/:id/review", async (req, res) => {
  const { edited_text, edited_opinion } = req.body;

  try {
    const result = await pool.query(
      `UPDATE reports
       SET generated_content_json = jsonb_set(COALESCE(generated_content_json, '{}'::jsonb), '{text}', to_jsonb($1::text)),
           technical_opinion_json = jsonb_set(COALESCE(technical_opinion_json, '{}'::jsonb), '{text}', to_jsonb($2::text)),
           status = 'revisado',
           updated_at = now()
       WHERE id = $3 AND engineer_id = $4
       RETURNING *`,
      [edited_text, edited_opinion || "", req.params.id, req.engineerId]
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

    const templateResult = await pool.query(
      "SELECT type FROM report_templates WHERE id = (SELECT template_id FROM reports WHERE id = $1)",
      [req.params.id]
    );
    const templateType = templateResult.rows[0]?.type || "vistoria";
    const review = await reviewImportedDocument(rawText, templateType);

    const updated = await pool.query(
      `UPDATE reports
       SET source_type = 'documento_importado',
           raw_input_json = $1,
           generated_content_json = $2,
           completeness_check_json = $3,
           status = 'rascunho',
           updated_at = now()
       WHERE id = $4 AND engineer_id = $5
       RETURNING *`,
      [
        JSON.stringify({ imported_raw_text: rawText }),
        JSON.stringify({ text: review.corrected_text }),
        JSON.stringify({ missing_items: review.missing_items, incomplete_items: review.incomplete_items }),
        req.params.id,
        req.engineerId,
      ]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    res.json({ report: updated.rows[0], review });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao importar documento: " + err.message });
  }
});

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
      `SELECT p.address, p.building_name, c.name AS client_name
       FROM projects p JOIN clients c ON c.id = p.client_id
       WHERE p.id = $1`,
      [report.project_id]
    );
    const project = projectResult.rows[0] || {};

    const photosResult = await pool.query(
      "SELECT url, caption FROM report_photos WHERE report_id = $1 ORDER BY display_order",
      [report.id]
    );
    const photos = photosResult.rows;

    let norms = [];
    if (report.norm_references && report.norm_references.length > 0) {
      const normsResult = await pool.query(
        "SELECT code, title FROM technical_norms WHERE code = ANY($1)",
        [report.norm_references]
      );
      norms = normsResult.rows;
    }

    const pdfBuffer = await generateReportPdf({
      engineer,
      project: { address: project.address, building_name: project.building_name },
      client: { name: project.client_name },
      report,
      norms,
      photos,
      photoCount: photos.length,
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
