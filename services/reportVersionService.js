const pool = require("../db/pool");

/**
 * Monta o snapshot completo do laudo (campos do laudo + seções +
 * subseções + normas vinculadas + estimativa de custo) no formato
 * exato que vai congelado em report_versions.snapshot_json.
 *
 * Reaproveitado tanto pelo endpoint de assinatura quanto pelo
 * GET /reports/:id/full (mesma forma de montar os dados).
 */
async function buildReportSnapshot(reportId) {
  const reportResult = await pool.query("SELECT * FROM reports WHERE id = $1", [reportId]);
  if (reportResult.rows.length === 0) return null;
  const report = reportResult.rows[0];

  const [sectionsResult, subsectionsResult, normsResult, costsResult, photosResult] = await Promise.all([
    pool.query(
      `SELECT id, section_number, section_title, content_text, order_index
       FROM report_sections WHERE report_id = $1 ORDER BY order_index`,
      [reportId]
    ),
    pool.query(
      `SELECT rs.id, rs.section_id, rs.subsection_number, rs.subsection_title,
              rs.content_text, rs.order_index
       FROM report_subsections rs
       JOIN report_sections s ON s.id = rs.section_id
       WHERE s.report_id = $1
       ORDER BY rs.order_index`,
      [reportId]
    ),
    pool.query(
      `SELECT tn.code, tn.title, rnl.applied_text, rnl.order_index
       FROM report_norm_links rnl
       JOIN technical_norms tn ON tn.id = rnl.norm_id
       WHERE rnl.report_id = $1
       ORDER BY rnl.order_index`,
      [reportId]
    ),
    pool.query(
      `SELECT item_description, min_cost_cents, max_cost_cents, order_index
       FROM report_cost_estimates WHERE report_id = $1 ORDER BY order_index`,
      [reportId]
    ),
    pool.query(
      `SELECT id, caption, display_order, section_id, subsection_id
       FROM report_photos WHERE report_id = $1 ORDER BY display_order`,
      [reportId]
    ),
  ]);

  const sections = sectionsResult.rows.map((section) => ({
    ...section,
    subsections: subsectionsResult.rows.filter((sub) => sub.section_id === section.id),
  }));

  return {
    report: {
      title: report.title,
      art_number: report.art_number,
      generated_content_json: report.generated_content_json,
      technical_opinion_json: report.technical_opinion_json,
      causal_link_text: report.causal_link_text,
      responsible_party_text: report.responsible_party_text,
      norm_references: report.norm_references,
    },
    sections,
    norms: normsResult.rows,
    cost_estimates: costsResult.rows,
    photos: photosResult.rows,
    snapshotted_at: new Date().toISOString(),
  };
}

/**
 * Cria uma nova versão (snapshot imutável) do laudo e a marca como
 * vigente. Usado tanto na primeira assinatura (version_number = 1)
 * quanto em toda reassinatura após uma retificação/complementação
 * (version_number = anterior + 1). A partir da versão 2, change_summary
 * é obrigatório — é o que explica juridicamente o que mudou.
 */
async function createNewVersion(reportId, { changeSummary, signedPdfUrl } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lastVersionResult = await client.query(
      "SELECT COALESCE(MAX(version_number), 0) AS last FROM report_versions WHERE report_id = $1",
      [reportId]
    );
    const nextVersionNumber = lastVersionResult.rows[0].last + 1;

    if (nextVersionNumber > 1 && !changeSummary) {
      throw Object.assign(new Error("change_summary é obrigatório a partir da segunda versão do laudo."), {
        statusCode: 400,
      });
    }

    const snapshot = await buildReportSnapshot(reportId);
    if (!snapshot) {
      throw Object.assign(new Error("Laudo não encontrado."), { statusCode: 404 });
    }

    const versionResult = await client.query(
      `INSERT INTO report_versions (report_id, version_number, snapshot_json, change_summary, signed_pdf_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [reportId, nextVersionNumber, JSON.stringify(snapshot), changeSummary || null, signedPdfUrl || null]
    );
    const version = versionResult.rows[0];

    await client.query(
      `UPDATE reports
       SET current_version_id = $1,
           status = 'assinado',
           signed_at = now(),
           updated_at = now()
       WHERE id = $2`,
      [version.id, reportId]
    );

    await client.query("COMMIT");
    return version;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { buildReportSnapshot, createNewVersion };
