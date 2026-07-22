const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------
// Helper: confirma que o laudo pertence ao engenheiro autenticado.
// Repetido em quase toda rota abaixo porque cada uma mexe em uma
// tabela filha diferente (sections, subsections, norms, costs) e
// todas precisam da mesma checagem de posse via reports.engineer_id.
// ---------------------------------------------------------------
async function assertReportOwnership(reportId, engineerId) {
  const result = await pool.query(
    "SELECT id FROM reports WHERE id = $1 AND engineer_id = $2",
    [reportId, engineerId]
  );
  return result.rows.length > 0;
}

// =================================================================
// SEÇÕES
// =================================================================

// GET /reports/:id/sections — lista seções com subseções aninhadas,
// já na ordem certa para preview/edição no frontend
router.get("/:id/sections", async (req, res) => {
  try {
    if (!(await assertReportOwnership(req.params.id, req.engineerId))) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    const sectionsResult = await pool.query(
      `SELECT id, section_number, section_title, content_text, order_index
       FROM report_sections WHERE report_id = $1 ORDER BY order_index`,
      [req.params.id]
    );

    const subsectionsResult = await pool.query(
      `SELECT rs.id, rs.section_id, rs.subsection_number, rs.subsection_title,
              rs.content_text, rs.order_index
       FROM report_subsections rs
       JOIN report_sections s ON s.id = rs.section_id
       WHERE s.report_id = $1
       ORDER BY rs.order_index`,
      [req.params.id]
    );

    const sections = sectionsResult.rows.map((section) => ({
      ...section,
      subsections: subsectionsResult.rows.filter((sub) => sub.section_id === section.id),
    }));

    res.json(sections);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar seções." });
  }
});

// POST /reports/:id/sections — cria uma seção macro
router.post("/:id/sections", async (req, res) => {
  const { section_number, section_title, content_text, order_index } = req.body;

  if (!section_number || !section_title) {
    return res.status(400).json({ error: "section_number e section_title são obrigatórios." });
  }

  try {
    if (!(await assertReportOwnership(req.params.id, req.engineerId))) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    const result = await pool.query(
      `INSERT INTO report_sections (report_id, section_number, section_title, content_text, order_index)
       VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(MAX(order_index), -1) + 1 FROM report_sections WHERE report_id = $1)))
       RETURNING *`,
      [req.params.id, section_number, section_title, content_text || null, order_index]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Já existe uma seção com esse número neste laudo." });
    }
    console.error(err);
    res.status(500).json({ error: "Erro ao criar seção." });
  }
});

// PATCH /reports/:id/sections/:sectionId
router.patch("/:id/sections/:sectionId", async (req, res) => {
  const { section_title, content_text, order_index } = req.body;

  try {
    const result = await pool.query(
      `UPDATE report_sections
       SET section_title = COALESCE($1, section_title),
           content_text = COALESCE($2, content_text),
           order_index = COALESCE($3, order_index)
       WHERE id = $4 AND report_id = $5
         AND report_id IN (SELECT id FROM reports WHERE engineer_id = $6)
       RETURNING *`,
      [section_title, content_text, order_index, req.params.sectionId, req.params.id, req.engineerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Seção não encontrada." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao editar seção." });
  }
});

// DELETE /reports/:id/sections/:sectionId (subseções somem em cascata)
router.delete("/:id/sections/:sectionId", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM report_sections
       WHERE id = $1 AND report_id = $2
         AND report_id IN (SELECT id FROM reports WHERE engineer_id = $3)
       RETURNING id`,
      [req.params.sectionId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Seção não encontrada." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover seção." });
  }
});

// =================================================================
// SUBSEÇÕES
// =================================================================

// POST /reports/:id/sections/:sectionId/subsections
router.post("/:id/sections/:sectionId/subsections", async (req, res) => {
  const { subsection_number, subsection_title, content_text, order_index } = req.body;

  if (!subsection_number || !subsection_title) {
    return res.status(400).json({ error: "subsection_number e subsection_title são obrigatórios." });
  }

  try {
    // Confirma que a seção pai pertence a um laudo deste engenheiro
    const sectionCheck = await pool.query(
      `SELECT s.id FROM report_sections s
       JOIN reports r ON r.id = s.report_id
       WHERE s.id = $1 AND s.report_id = $2 AND r.engineer_id = $3`,
      [req.params.sectionId, req.params.id, req.engineerId]
    );
    if (sectionCheck.rows.length === 0) {
      return res.status(404).json({ error: "Seção não encontrada." });
    }

    const result = await pool.query(
      `INSERT INTO report_subsections (section_id, subsection_number, subsection_title, content_text, order_index)
       VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(MAX(order_index), -1) + 1 FROM report_subsections WHERE section_id = $1)))
       RETURNING *`,
      [req.params.sectionId, subsection_number, subsection_title, content_text || null, order_index]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Já existe uma subseção com esse número nesta seção." });
    }
    console.error(err);
    res.status(500).json({ error: "Erro ao criar subseção." });
  }
});

// PATCH /reports/:id/subsections/:subsectionId
router.patch("/:id/subsections/:subsectionId", async (req, res) => {
  const { subsection_title, content_text, order_index } = req.body;

  try {
    const result = await pool.query(
      `UPDATE report_subsections rs
       SET subsection_title = COALESCE($1, subsection_title),
           content_text = COALESCE($2, content_text),
           order_index = COALESCE($3, order_index)
       FROM report_sections s
       WHERE rs.id = $4 AND rs.section_id = s.id
         AND s.report_id = $5
         AND s.report_id IN (SELECT id FROM reports WHERE engineer_id = $6)
       RETURNING rs.*`,
      [subsection_title, content_text, order_index, req.params.subsectionId, req.params.id, req.engineerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Subseção não encontrada." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao editar subseção." });
  }
});

// DELETE /reports/:id/subsections/:subsectionId
router.delete("/:id/subsections/:subsectionId", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM report_subsections rs
       USING report_sections s
       WHERE rs.id = $1 AND rs.section_id = s.id
         AND s.report_id = $2
         AND s.report_id IN (SELECT id FROM reports WHERE engineer_id = $3)
       RETURNING rs.id`,
      [req.params.subsectionId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Subseção não encontrada." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover subseção." });
  }
});

// =================================================================
// NORMAS VINCULADAS AO LAUDO (com texto de aplicação editável)
// =================================================================

// GET /reports/:id/norms
router.get("/:id/norms", async (req, res) => {
  try {
    if (!(await assertReportOwnership(req.params.id, req.engineerId))) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    const result = await pool.query(
      `SELECT rnl.id AS link_id, rnl.applied_text, rnl.order_index,
              tn.id AS norm_id, tn.code, tn.title, tn.scope_summary
       FROM report_norm_links rnl
       JOIN technical_norms tn ON tn.id = rnl.norm_id
       WHERE rnl.report_id = $1
       ORDER BY rnl.order_index`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar normas do laudo." });
  }
});

// POST /reports/:id/norms — vincula uma norma já cadastrada em /norms
router.post("/:id/norms", async (req, res) => {
  const { norm_id, applied_text, order_index } = req.body;

  if (!norm_id) {
    return res.status(400).json({ error: "norm_id é obrigatório." });
  }

  try {
    if (!(await assertReportOwnership(req.params.id, req.engineerId))) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }

    // Se applied_text não vier, já pré-preenche com o texto padrão da
    // norma (scope_summary), para o engenheiro só ajustar em vez de
    // escrever do zero — mas ele pode sobrescrever depois via PATCH.
    const result = await pool.query(
      `INSERT INTO report_norm_links (report_id, norm_id, applied_text, order_index)
       VALUES ($1, $2,
               COALESCE($3, (SELECT scope_summary FROM technical_norms WHERE id = $2)),
               COALESCE($4, (SELECT COALESCE(MAX(order_index), -1) + 1 FROM report_norm_links WHERE report_id = $1)))
       RETURNING *`,
      [req.params.id, norm_id, applied_text || null, order_index]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Essa norma já está vinculada a este laudo." });
    }
    console.error(err);
    res.status(500).json({ error: "Erro ao vincular norma." });
  }
});

// PATCH /reports/:id/norms/:linkId — ajusta o texto de aplicação
router.patch("/:id/norms/:linkId", async (req, res) => {
  const { applied_text, order_index } = req.body;
  try {
    const result = await pool.query(
      `UPDATE report_norm_links
       SET applied_text = COALESCE($1, applied_text),
           order_index = COALESCE($2, order_index)
       WHERE id = $3 AND report_id = $4
         AND report_id IN (SELECT id FROM reports WHERE engineer_id = $5)
       RETURNING *`,
      [applied_text, order_index, req.params.linkId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Vínculo de norma não encontrado." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao editar vínculo de norma." });
  }
});

// DELETE /reports/:id/norms/:linkId
router.delete("/:id/norms/:linkId", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM report_norm_links
       WHERE id = $1 AND report_id = $2
         AND report_id IN (SELECT id FROM reports WHERE engineer_id = $3)
       RETURNING id`,
      [req.params.linkId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Vínculo de norma não encontrado." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover vínculo de norma." });
  }
});

// =================================================================
// ESTIMATIVA DE CUSTO (faixas mín/máx por item)
// =================================================================

// GET /reports/:id/cost-estimates
router.get("/:id/cost-estimates", async (req, res) => {
  try {
    if (!(await assertReportOwnership(req.params.id, req.engineerId))) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    const result = await pool.query(
      `SELECT * FROM report_cost_estimates WHERE report_id = $1 ORDER BY order_index`,
      [req.params.id]
    );
    const totals = result.rows.reduce(
      (acc, row) => ({
        min: acc.min + row.min_cost_cents,
        max: acc.max + row.max_cost_cents,
      }),
      { min: 0, max: 0 }
    );
    res.json({ items: result.rows, total_min_cents: totals.min, total_max_cents: totals.max });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar estimativa de custo." });
  }
});

// POST /reports/:id/cost-estimates
router.post("/:id/cost-estimates", async (req, res) => {
  const { item_description, min_cost_cents, max_cost_cents, order_index } = req.body;

  if (!item_description || min_cost_cents == null || max_cost_cents == null) {
    return res.status(400).json({
      error: "item_description, min_cost_cents e max_cost_cents são obrigatórios.",
    });
  }
  if (max_cost_cents < min_cost_cents) {
    return res.status(400).json({ error: "max_cost_cents não pode ser menor que min_cost_cents." });
  }

  try {
    if (!(await assertReportOwnership(req.params.id, req.engineerId))) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    const result = await pool.query(
      `INSERT INTO report_cost_estimates (report_id, item_description, min_cost_cents, max_cost_cents, order_index)
       VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(MAX(order_index), -1) + 1 FROM report_cost_estimates WHERE report_id = $1)))
       RETURNING *`,
      [req.params.id, item_description, min_cost_cents, max_cost_cents, order_index]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao adicionar item de custo." });
  }
});

// PATCH /reports/:id/cost-estimates/:estimateId
router.patch("/:id/cost-estimates/:estimateId", async (req, res) => {
  const { item_description, min_cost_cents, max_cost_cents, order_index } = req.body;
  try {
    const result = await pool.query(
      `UPDATE report_cost_estimates
       SET item_description = COALESCE($1, item_description),
           min_cost_cents = COALESCE($2, min_cost_cents),
           max_cost_cents = COALESCE($3, max_cost_cents),
           order_index = COALESCE($4, order_index)
       WHERE id = $5 AND report_id = $6
         AND report_id IN (SELECT id FROM reports WHERE engineer_id = $7)
       RETURNING *`,
      [item_description, min_cost_cents, max_cost_cents, order_index, req.params.estimateId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Item de custo não encontrado." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao editar item de custo." });
  }
});

// DELETE /reports/:id/cost-estimates/:estimateId
router.delete("/:id/cost-estimates/:estimateId", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM report_cost_estimates
       WHERE id = $1 AND report_id = $2
         AND report_id IN (SELECT id FROM reports WHERE engineer_id = $3)
       RETURNING id`,
      [req.params.estimateId, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Item de custo não encontrado." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover item de custo." });
  }
});

// =================================================================
// RESPONSABILIDADE TÉCNICA / NEXO CAUSAL
// =================================================================

// PATCH /reports/:id/responsibility
router.patch("/:id/responsibility", async (req, res) => {
  const { causal_link_text, responsible_party_text } = req.body;
  try {
    const result = await pool.query(
      `UPDATE reports
       SET causal_link_text = COALESCE($1, causal_link_text),
           responsible_party_text = COALESCE($2, responsible_party_text),
           updated_at = now()
       WHERE id = $3 AND engineer_id = $4
       RETURNING id, causal_link_text, responsible_party_text`,
      [causal_link_text, responsible_party_text, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao salvar responsabilidade técnica." });
  }
});

// =================================================================
// AGREGADO — tudo que o preview/PDF precisa, numa chamada só
// =================================================================

// GET /reports/:id/full
router.get("/:id/full", async (req, res) => {
  try {
    const reportResult = await pool.query(
      "SELECT * FROM reports WHERE id = $1 AND engineer_id = $2",
      [req.params.id, req.engineerId]
    );
    if (reportResult.rows.length === 0) {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    const report = reportResult.rows[0];

    const [sectionsResult, subsectionsResult, normsResult, costsResult, photosResult] = await Promise.all([
      pool.query(
        `SELECT id, section_number, section_title, content_text, order_index
         FROM report_sections WHERE report_id = $1 ORDER BY order_index`,
        [req.params.id]
      ),
      pool.query(
        `SELECT rs.id, rs.section_id, rs.subsection_number, rs.subsection_title,
                rs.content_text, rs.order_index
         FROM report_subsections rs
         JOIN report_sections s ON s.id = rs.section_id
         WHERE s.report_id = $1
         ORDER BY rs.order_index`,
        [req.params.id]
      ),
      pool.query(
        `SELECT rnl.id AS link_id, rnl.applied_text, rnl.order_index,
                tn.code, tn.title
         FROM report_norm_links rnl
         JOIN technical_norms tn ON tn.id = rnl.norm_id
         WHERE rnl.report_id = $1
         ORDER BY rnl.order_index`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, item_description, min_cost_cents, max_cost_cents, order_index
         FROM report_cost_estimates WHERE report_id = $1 ORDER BY order_index`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, caption, display_order, section_id, subsection_id
         FROM report_photos WHERE report_id = $1 ORDER BY display_order`,
        [req.params.id]
      ),
    ]);

    const sections = sectionsResult.rows.map((section) => ({
      ...section,
      subsections: subsectionsResult.rows.filter((sub) => sub.section_id === section.id),
    }));

    const costTotals = costsResult.rows.reduce(
      (acc, row) => ({ min: acc.min + row.min_cost_cents, max: acc.max + row.max_cost_cents }),
      { min: 0, max: 0 }
    );

    res.json({
      report,
      sections,
      norms: normsResult.rows,
      cost_estimates: {
        items: costsResult.rows,
        total_min_cents: costTotals.min,
        total_max_cents: costTotals.max,
      },
      photos: photosResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao montar visão completa do laudo." });
  }
});

module.exports = router;
