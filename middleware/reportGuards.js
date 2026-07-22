const pool = require("../db/pool");

// Status em que o CONTEÚDO do laudo (seções, subseções, normas
// vinculadas, custos, responsabilidade, texto gerado por IA) ainda
// pode ser editado diretamente pelas rotas normais.
const EDITABLE_STATUSES = ["rascunho", "em_revisao"];

/**
 * Busca o laudo (confirmando posse) e barra a operação com 409 se
 * o status não for editável. Usado em toda rota que muda conteúdo
 * do laudo (sections, subsections, norms, costs, responsibility,
 * generate, review, import, photos).
 *
 * Retorna o laudo se estiver editável, ou null (já respondendo o
 * erro) se não estiver — o chamador só precisa checar `if (!report) return;`.
 */
async function assertEditable(req, res, reportId) {
  const result = await pool.query("SELECT * FROM reports WHERE id = $1 AND engineer_id = $2", [
    reportId,
    req.engineerId,
  ]);

  if (result.rows.length === 0) {
    res.status(404).json({ error: "Laudo não encontrado." });
    return null;
  }

  const report = result.rows[0];
  if (!EDITABLE_STATUSES.includes(report.status)) {
    res.status(409).json({
      error: `Laudo com status "${report.status}" não pode ser editado diretamente. ` +
        (report.status === "assinado" || report.status === "entregue"
          ? "Use POST /reports/:id/unlock-for-revision para destravar e corrigir (isso preserva a versão assinada anterior no histórico)."
          : "Verifique o status atual do laudo."),
      status: report.status,
    });
    return null;
  }

  return report;
}

module.exports = { assertEditable, EDITABLE_STATUSES };
