const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { checkPlanLimit } = require("../middleware/checkPlanLimit");
const { assertEditable } = require("../middleware/reportGuards");
const { generateTechnicalText, reviewImportedDocument } = require("../services/aiReportService");
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
  const { project_id, template_id, title, art_number, raw_input_json, process_id } = req.body;

  if (!project_id || !template_id || !title) {
    return res.status(400).json({ error: "project_id, template_id e title são obrigatórios." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO reports (engineer_id, project_id, template_id, title, art_number, raw_input_json, process_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'rascunho')
       RETURNING *`,
      [req.engineerId, project_id, template_id, title, art_number || null, raw_input_json || {}, process_id || null]
    );
    await pool.query(
      `INSERT INTO report_events (report_id, event_type, event_label) VALUES ($1, 'criado', 'Laudo criado')`,
      [result.rows[0].id]
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
    const reportCheck = await assertEditable(req, res, req.params.id);
    if (!reportCheck) return;

    const aiResult = await generateTechnicalText(observation, item_categories || [], req.engineerId);

    const updated = await pool.query(
      `UPDATE reports
       SET generated_content_json = $1,
           technical_opinion_json = $2,
           norm_references = $3,
           probable_cause = $4,
           risk_level = $5,
           recommended_deadline_days = $6,
           art_required = $7,
           status = 'rascunho',
           updated_at = now()
       WHERE id = $8
       RETURNING *`,
      [
        JSON.stringify({ text: aiResult.generatedText }),
        JSON.stringify({ text: aiResult.technicalOpinion }),
        aiResult.citedNormCode ? [aiResult.citedNormCode] : [],
        aiResult.probableCause,
        aiResult.riskLevel,
        aiResult.recommendedDeadlineDays,
        aiResult.artRequired,
        req.params.id,
      ]
    );

    await pool.query(
      `INSERT INTO report_events (report_id, event_type, event_label) VALUES ($1, 'ia_gerado', 'Texto gerado com IA')`,
      [req.params.id]
    );

    res.json({ report: updated.rows[0], ai: aiResult });
  } catch (err) {
    console.error(err);
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    res.status(500).json({ error: "Erro ao gerar texto com IA: " + err.message });
  }
});

// ---------------------------------------------------------------
// POST /reports/:id/use-formatted-text — pula a reescrita da IA e usa
// o texto exatamente como o engenheiro escreveu no editor (com toda a
// formatação: negrito, itálico, fonte, cor, listas, alinhamento). Vai
// direto pra tela de revisão, com o parecer técnico em branco pro
// engenheiro preencher — não há inferência automática nesse caminho.
// ---------------------------------------------------------------
router.post("/:id/use-formatted-text", async (req, res) => {
  const { html } = req.body;

  if (!html || !html.trim()) {
    return res.status(400).json({ error: "Campo 'html' é obrigatório." });
  }

  try {
    const reportCheck = await assertEditable(req, res, req.params.id);
    if (!reportCheck) return;

    const updated = await pool.query(
      `UPDATE reports
       SET generated_content_json = $1,
           technical_opinion_json = COALESCE(technical_opinion_json, '{"text": ""}'::jsonb),
           status = 'rascunho',
           updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ text: html }), req.params.id]
    );

    await pool.query(
      `INSERT INTO report_events (report_id, event_type, event_label) VALUES ($1, 'ia_gerado', 'Texto definido sem IA')`,
      [req.params.id]
    );

    res.json({ report: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao salvar texto formatado: " + err.message });
  }
});

// ---------------------------------------------------------------
// PATCH /reports/:id/review — engenheiro edita o texto gerado
// (fica registrado como revisão manual)
// ---------------------------------------------------------------
router.patch("/:id/review", async (req, res) => {
  const { edited_text, edited_opinion, probable_cause, risk_level, recommended_deadline_days, art_required } = req.body;

  if (risk_level && !["baixo", "medio", "alto", "critico"].includes(risk_level)) {
    return res.status(400).json({ error: "risk_level inválido." });
  }

  try {
    const reportCheck = await assertEditable(req, res, req.params.id);
    if (!reportCheck) return;

    const result = await pool.query(
      `UPDATE reports
       SET generated_content_json = jsonb_set(COALESCE(generated_content_json, '{}'::jsonb), '{text}', to_jsonb($1::text)),
           technical_opinion_json = jsonb_set(COALESCE(technical_opinion_json, '{}'::jsonb), '{text}', to_jsonb($2::text)),
           probable_cause = $3,
           risk_level = $4,
           recommended_deadline_days = $5,
           art_required = $6,
           status = 'em_revisao',
           updated_at = now()
       WHERE id = $7 AND engineer_id = $8
       RETURNING *`,
      [
        edited_text,
        edited_opinion || "",
        probable_cause ?? null,
        risk_level ?? null,
        Number.isInteger(recommended_deadline_days) ? recommended_deadline_days : null,
        typeof art_required === "boolean" ? art_required : null,
        req.params.id,
        req.engineerId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    await pool.query(
      `INSERT INTO report_events (report_id, event_type, event_label) VALUES ($1, 'revisao', 'Texto revisado pelo engenheiro')`,
      [req.params.id]
    );

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
    const reportCheck = await assertEditable(req, res, req.params.id);
    if (!reportCheck) return;

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

    // Trava importante: se a extração não encontrou nenhum texto de verdade
    // (arquivo baseado em imagem/scan, tabelas/caixas de texto que o mammoth
    // não lê, ou arquivo corrompido), paramos aqui com um erro claro em vez
    // de seguir adiante e gerar um "texto corrigido" vazio silenciosamente.
    if (!rawText || rawText.trim().length < 20) {
      return res.status(400).json({
        error: "Não foi possível extrair texto legível deste arquivo. Verifique se o documento não é uma imagem escaneada, e se o conteúdo está em parágrafos normais (não só em tabelas ou caixas de texto).",
      });
    }

    // Chama a IA no papel de REVISOR (não gerador): corrige gramática e
    // aponta o que falta, sem reescrever ou resumir o conteúdo original.
    const templateResult = await pool.query(
      "SELECT type FROM report_templates WHERE id = (SELECT template_id FROM reports WHERE id = $1)",
      [req.params.id]
    );
    const templateType = templateResult.rows[0]?.type || "vistoria";
    const review = await reviewImportedDocument(rawText, templateType);

    // Guarda o arquivo original em base64 (mesmo padrão pragmático usado
    // para fotos — ver ressalva sobre limite de armazenamento do Neon
    // em routes/photos.js). Isso preenche a coluna original_document_url
    // que já existia no schema, mas nunca era usada até agora.
    const originalBase64 = req.file.buffer.toString("base64");
    const originalDataUri = `data:${req.file.mimetype};base64,${originalBase64}`;

    // O fluxo de importação não gera uma observação nova para basear um
    // parecer técnico elaborado (isso é papel do fluxo de formulário) —
    // mas preenchemos um parecer mínimo e honesto, em vez de deixar a
    // seção 4 do PDF em branco/genérica demais.
    const minimalOpinion = review.missing_items && review.missing_items.length > 0
      ? `Documento revisado quanto à gramática e terminologia. Itens pendentes de complementação: ${review.missing_items.join(", ")}.`
      : "Documento revisado quanto à gramática e terminologia, sem pendências de completude identificadas.";

    const updated = await pool.query(
      `UPDATE reports
       SET source_type = 'documento_importado',
           raw_input_json = $1,
           generated_content_json = $2,
           technical_opinion_json = $3,
           completeness_check_json = $4,
           original_document_url = $5,
           status = 'rascunho',
           updated_at = now()
       WHERE id = $6 AND engineer_id = $7
       RETURNING *`,
      [
        JSON.stringify({ imported_raw_text: rawText }),
        JSON.stringify({ text: review.corrected_text }),
        JSON.stringify({ text: minimalOpinion }),
        JSON.stringify({ missing_items: review.missing_items, incomplete_items: review.incomplete_items }),
        originalDataUri,
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
      `SELECT name, email, company_name, crea_number, crea_region, logo_url,
              professional_title, office_address, office_phone
       FROM engineers WHERE id = $1`,
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

    // Fotos com a imagem decodificada em buffer (pdfkit precisa de
    // Buffer, não da data URI crua) e o vínculo de seção/subseção,
    // para o PDF numerar e posicionar cada figura corretamente.
    const photosResult = await pool.query(
      "SELECT url, caption, display_order, section_id, subsection_id, latitude, longitude, captured_at FROM report_photos WHERE report_id = $1 ORDER BY display_order",
      [report.id]
    );
    const photos = photosResult.rows.map((p) => {
      let image_buffer = null;
      if (p.url && p.url.startsWith("data:")) {
        const base64 = p.url.split(",")[1];
        image_buffer = Buffer.from(base64, "base64");
      }
      return { ...p, image_buffer };
    });

    // Seções/subseções estruturadas (novo formato). Laudos antigos sem
    // nenhuma linha aqui caem no fallback de texto plano do pdfService.
    const sectionsResult = await pool.query(
      `SELECT id, section_number, section_title, content_text, order_index
       FROM report_sections WHERE report_id = $1 ORDER BY order_index`,
      [report.id]
    );
    const subsectionsResult = await pool.query(
      `SELECT rs.id, rs.section_id, rs.subsection_number, rs.subsection_title,
              rs.content_text, rs.order_index
       FROM report_subsections rs
       JOIN report_sections s ON s.id = rs.section_id
       WHERE s.report_id = $1
       ORDER BY rs.order_index`,
      [report.id]
    );
    const sections = sectionsResult.rows.map((section) => ({
      ...section,
      subsections: subsectionsResult.rows.filter((sub) => sub.section_id === section.id),
    }));

    // Normas vinculadas ao laudo (nova tabela), com fallback para o
    // formato antigo (reports.norm_references) se ainda não migrado.
    let norms = [];
    const normLinksResult = await pool.query(
      `SELECT tn.code, tn.title, tn.scope_summary, rnl.applied_text
       FROM report_norm_links rnl
       JOIN technical_norms tn ON tn.id = rnl.norm_id
       WHERE rnl.report_id = $1
       ORDER BY rnl.order_index`,
      [report.id]
    );
    if (normLinksResult.rows.length > 0) {
      norms = normLinksResult.rows;
    } else if (report.norm_references && report.norm_references.length > 0) {
      const normsResult = await pool.query(
        "SELECT code, title, scope_summary FROM technical_norms WHERE code = ANY($1)",
        [report.norm_references]
      );
      norms = normsResult.rows;
    }

    const costEstimatesResult = await pool.query(
      `SELECT id, item_description, min_cost_cents, max_cost_cents, order_index
       FROM report_cost_estimates WHERE report_id = $1 ORDER BY order_index`,
      [report.id]
    );
    const costTotals = costEstimatesResult.rows.reduce(
      (acc, row) => ({ min: acc.min + row.min_cost_cents, max: acc.max + row.max_cost_cents }),
      { min: 0, max: 0 }
    );

    // Nota: se o engenheiro tiver logo_url cadastrada, o ideal é baixar
    // a imagem aqui (fetch + arrayBuffer) e passar como engineer.logo_buffer
    // antes de gerar o PDF. Deixado como próximo passo — depende de qual
    // storage (S3/R2) for usado para hospedar o arquivo da logo.

    const pdfBuffer = await generateReportPdf({
      engineer,
      project: { address: project.address, building_name: project.building_name },
      client: { name: project.client_name },
      report,
      sections,
      norms,
      photos,
      costEstimates: {
        items: costEstimatesResult.rows,
        total_min_cents: costTotals.min,
        total_max_cents: costTotals.max,
      },
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
