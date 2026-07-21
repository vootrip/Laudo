/**
 * Geração do PDF final do laudo — o documento que o engenheiro
 * efetivamente entrega ao cliente dele.
 * -------------------------------------------------------------------
 * Usa pdfkit (biblioteca pura em JS, não depende de navegador headless,
 * o que a torna mais leve e confiável para rodar em qualquer hospedagem,
 * incluindo planos gratuitos com pouca RAM).
 *
 * Estrutura do documento:
 *   1. Cabeçalho com logomarca do escritório (se cadastrada) + dados
 *      do responsável técnico (nome, CREA)
 *   2. Identificação do laudo (cliente, endereço, finalidade, data)
 *   3. Corpo do texto técnico (o conteúdo revisado/aprovado pelo engenheiro)
 *   4. Norma(s) técnica(s) referenciada(s)
 *   5. Área de assinatura
 *   6. Rodapé com nota de rastreabilidade (reforça a confiança no processo
 *      de revisão auditável que já existe no produto)
 */

const PDFDocument = require("pdfkit");

function generateReportPdf({ engineer, project, client, report, norms }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ---------------------------------------------------------
    // 1. Cabeçalho
    // ---------------------------------------------------------
    const headerTop = doc.y;

    if (engineer.logo_url && engineer.logo_buffer) {
      // Nota: para logomarca aparecer, o backend precisa baixar o
      // arquivo de logo_url e passar os bytes como engineer.logo_buffer
      // antes de chamar esta função (ex: via fetch + arrayBuffer).
      doc.image(engineer.logo_buffer, 56, headerTop, { width: 90 });
      doc.x = 160;
    }

    doc
      .fontSize(14)
      .fillColor("#2C2C2A")
      .text(engineer.company_name || engineer.name, { align: "left" })
      .fontSize(9)
      .fillColor("#6B6A64")
      .text(`${engineer.name} — CREA ${engineer.crea_number}/${engineer.crea_region}`)
      .moveDown(1.5);

    doc
      .moveTo(56, doc.y)
      .lineTo(539, doc.y)
      .strokeColor("#E0DED6")
      .lineWidth(0.5)
      .stroke()
      .moveDown(1);

    // ---------------------------------------------------------
    // 2. Título e identificação
    // ---------------------------------------------------------
    doc
      .fontSize(16)
      .fillColor("#2C2C2A")
      .text(report.title || "Laudo de vistoria", { align: "left" })
      .moveDown(0.8);

    doc.fontSize(10).fillColor("#44433F");
    const infoRows = [
      ["Cliente", client?.name || "-"],
      ["Endereço", project?.address || "-"],
      ["Data da vistoria", new Date(report.created_at).toLocaleDateString("pt-BR")],
    ];
    infoRows.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(value);
    });
    doc.moveDown(1.2);

    // ---------------------------------------------------------
    // 3. Corpo do texto técnico
    // ---------------------------------------------------------
    doc
      .fontSize(11)
      .fillColor("#2C2C2A")
      .font("Helvetica-Bold")
      .text("Descrição técnica")
      .moveDown(0.4)
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#2C2C2A")
      .text(report.generated_content_json?.text || "", { align: "justify", lineGap: 3 })
      .moveDown(1);

    // ---------------------------------------------------------
    // 4. Normas referenciadas
    // ---------------------------------------------------------
    if (norms && norms.length > 0) {
      doc
        .fontSize(9)
        .fillColor("#6B6A64")
        .font("Helvetica-Bold")
        .text("Normas técnicas de referência: ", { continued: true })
        .font("Helvetica")
        .text(norms.map((n) => `${n.code} — ${n.title}`).join("; "))
        .moveDown(1.5);
    }

    // ---------------------------------------------------------
    // 5. Área de assinatura
    // ---------------------------------------------------------
    doc.moveDown(2);
    const sigY = doc.y;
    doc
      .moveTo(56, sigY)
      .lineTo(280, sigY)
      .strokeColor("#2C2C2A")
      .lineWidth(0.5)
      .stroke();
    doc
      .fontSize(9)
      .fillColor("#44433F")
      .text(`${engineer.name} — CREA ${engineer.crea_number}/${engineer.crea_region}`, 56, sigY + 6);

    // ---------------------------------------------------------
    // 6. Rodapé de rastreabilidade (em todas as páginas)
    // ---------------------------------------------------------
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(7.5)
        .fillColor("#999790")
        .text(
          `Documento gerado com histórico de revisão rastreável — laudo #${report.id}. Página ${i + 1} de ${range.count}.`,
          56,
          780,
          { width: 483, align: "center" }
        );
    }

    doc.end();
  });
}

module.exports = { generateReportPdf };
