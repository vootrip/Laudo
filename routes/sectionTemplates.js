const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { assertEditable } = require("../middleware/reportGuards");

const router = express.Router();
router.use(requireAuth);

// GET /section-templates?report_type=muro — lista templates globais +
// próprios do escritório, opcionalmente filtrados por tipo de laudo
router.get("/", async (req, res) => {
  const { report_type } = req.query;
  try {
    const conditions = ["(engineer_id IS NULL OR engineer_id = $1)"];
    const params = [req.engineerId];
    if (report_type) {
      conditions.push(`report_type = $${params.length + 1}`);
      params.push(report_type);
    }
    const result = await pool.query(
      `SELECT * FROM section_templates WHERE ${conditions.join(" AND ")}
       ORDER BY (engineer_id IS NULL) DESC, report_type, section_title`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar templates de seção." });
  }
});

// POST /section-templates — cadastra um template PRÓPRIO do escritório
// (nunca cria template global — engineer_id sempre é o do usuário logado)
router.post("/", async (req, res) => {
  const { report_type, section_title, default_content_text } = req.body;
  if (!report_type || !section_title || !default_content_text) {
    return res.status(400).json({ error: "report_type, section_title e default_content_text são obrigatórios." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO section_templates (engineer_id, report_type, section_title, default_content_text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.engineerId, report_type, section_title, default_content_text]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar template de seção." });
  }
});

// PATCH /section-templates/:id — só edita template PRÓPRIO (mesma
// regra de proteção do catálogo de normas: templates globais não
// são editáveis por engenheiros individuais)
router.patch("/:id", async (req, res) => {
  const { section_title, default_content_text } = req.body;
  try {
    const result = await pool.query(
      `UPDATE section_templates
       SET section_title = COALESCE($1, section_title),
           default_content_text = COALESCE($2, default_content_text)
       WHERE id = $3 AND engineer_id = $4
       RETURNING *`,
      [section_title, default_content_text, req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Template não encontrado, ou é um template padrão do sistema (não editável)." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao editar template de seção." });
  }
});

// DELETE /section-templates/:id
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM section_templates WHERE id = $1 AND engineer_id = $2 RETURNING id`,
      [req.params.id, req.engineerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Template não encontrado, ou é um template padrão do sistema (não removível)." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao remover template de seção." });
  }
});

// POST /section-templates/:id/apply/:reportId — cria uma seção nova
// no laudo já preenchida com o texto padrão do template (o engenheiro
// ajusta o que for específico do caso a partir daí). Evita ter que
// digitar do zero conteúdo técnico-educativo repetitivo (ex: "como
// funciona um muro de divisa"), que se repete em todo laudo do mesmo tipo.
router.post("/:id/apply/:reportId", async (req, res) => {
  const { section_number, order_index } = req.body;
  if (!section_number) {
    return res.status(400).json({ error: "section_number é obrigatório (ex: '5')." });
  }
  try {
    const reportCheck = await assertEditable(req, res, req.params.reportId);
    if (!reportCheck) return;

    const templateResult = await pool.query(
      `SELECT * FROM section_templates WHERE id = $1 AND (engineer_id IS NULL OR engineer_id = $2)`,
      [req.params.id, req.engineerId]
    );
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: "Template de seção não encontrado." });
    }
    const template = templateResult.rows[0];

    const result = await pool.query(
      `INSERT INTO report_sections (report_id, section_number, section_title, content_text, order_index)
       VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(MAX(order_index), -1) + 1 FROM report_sections WHERE report_id = $1)))
       RETURNING *`,
      [req.params.reportId, section_number, template.section_title, template.default_content_text, order_index]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Já existe uma seção com esse número neste laudo." });
    }
    console.error(err);
    res.status(500).json({ error: "Erro ao aplicar template de seção." });
  }
});

module.exports = router;
