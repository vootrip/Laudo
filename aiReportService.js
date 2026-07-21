/**
 * Geração do PDF final do laudo — estrutura formal seguindo o padrão
 * de mercado de um Laudo Técnico de Avaliação e Inspeção Predial:
 *   1. Identificação (contratante, objeto da perícia, endereço, finalidade)
 *   2. Objetivo (parágrafo formal do propósito da vistoria)
 *   3. Vistoria e Diagnóstico (data + descrição técnica)
 *   4. Parecer Técnico Conclusivo (conclusão e recomendação, separado do diagnóstico)
 *   5. Encerramento (nº de páginas, fotos anexas, local/data, ART)
 * Mais: assinatura e rodapé de rastreabilidade em todas as páginas.
 */

const PDFDocument = require("pdfkit");

function generateReportPdf({ engineer, project, client, report, norms, photos = [], photoCount = 0 }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, bufferPages: true });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const vistoriaDate = new Date(report.created_at).toLocaleDateString("pt-BR");
    const emissaoDate = new Date().toLocaleDateString("pt-BR");

    // ---------------------------------------------------------
    // Cabeçalho
    // ---------------------------------------------------------
    if (engineer.logo_url && engineer.logo_buffer) {
      doc.image(engineer.logo_buffer, 56, doc.y, { width: 90 });
      doc.x = 160;
    }

    doc
      .fontSize(14)
      .fillColor("#2C2C2A")
      .text(engineer.company_name || engineer.name, { align: "left" })
      .fontSize(9)
      .fillColor("#6B6A64")
      .text(`${engineer.name} — CREA ${engineer.crea_number}/${engineer.crea_region}`)
      .moveDown(1.2);

    doc
      .moveTo(56, doc.y)
      .lineTo(539, doc.y)
      .strokeColor("#E0DED6")
      .lineWidth(0.5)
      .stroke()
      .moveDown(1);

    doc
      .fontSize(15)
      .fillColor("#2C2C2A")
      .font("Helvetica-Bold")
      .text("LAUDO TÉCNICO DE AVALIAÇÃO E INSPEÇÃO PREDIAL", { align: "left" })
      .moveDown(1);

    // ---------------------------------------------------------
    // 1. IDENTIFICAÇÃO
    // ---------------------------------------------------------
    sectionTitle(doc, "1. Identificação");
    const identRows = [
      ["Contratante", client?.name || "-"],
      ["Objeto da perícia", project?.building_name || "-"],
      ["Endereço", project?.address || "-"],
    ];
    fieldRows(doc, identRows);
    doc.moveDown(0.8);

    // ---------------------------------------------------------
    // 2. OBJETIVO
    // ---------------------------------------------------------
    sectionTitle(doc, "2. Objetivo");
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#2C2C2A")
      .text(
        `O presente laudo tem por objetivo realizar a inspeção visual e técnica no imóvel acima identificado, com o intuito de constatar e registrar as condições observadas, apontando diretrizes quando aplicável.`,
        { align: "justify", lineGap: 3 }
      )
      .moveDown(0.8);

    // ---------------------------------------------------------
    // 3. VISTORIA E DIAGNÓSTICO
    // ---------------------------------------------------------
    sectionTitle(doc, "3. Vistoria e Diagnóstico");
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#2C2C2A")
      .text(`Data da vistoria: ${vistoriaDate}`, { continued: false })
      .moveDown(0.4)
      .text(report.generated_content_json?.text || "", { align: "justify", lineGap: 3 })
      .moveDown(0.8);

    // ---------------------------------------------------------
    // 4. PARECER TÉCNICO
    // ---------------------------------------------------------
    sectionTitle(doc, "4. Parecer Técnico");
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#2C2C2A")
      .text(report.technical_opinion_json?.text || "Sem parecer conclusivo registrado.", {
        align: "justify",
        lineGap: 3,
      })
      .moveDown(0.8);

    if (norms && norms.length > 0) {
      doc
        .fontSize(9)
        .fillColor("#6B6A64")
        .font("Helvetica-Bold")
        .text("Normas técnicas de referência: ", { continued: true })
        .font("Helvetica")
        .text(norms.map((n) => `${n.code} — ${n.title}`).join("; "))
        .moveDown(0.8);
    }

    // ---------------------------------------------------------
    // Registro fotográfico (se houver fotos anexadas)
    // ---------------------------------------------------------
    if (photos && photos.length > 0) {
      sectionTitle(doc, "Registro Fotográfico");
      const imgWidth = 220;
      const imgHeight = 165;
      let col = 0;
      let rowStartY = doc.y;

      photos.forEach((photo, idx) => {
        if (doc.y + imgHeight + 20 > 740) {
          doc.addPage();
          rowStartY = doc.y;
          col = 0;
        }
        const x = 56 + col * (imgWidth + 20);
        try {
          const base64 = photo.url.split(",")[1];
          const buffer = Buffer.from(base64, "base64");
          doc.image(buffer, x, rowStartY, { width: imgWidth, height: imgHeight, fit: [imgWidth, imgHeight] });
          if (photo.caption) {
            doc
              .fontSize(8)
              .fillColor("#6B6A64")
              .text(photo.caption, x, rowStartY + imgHeight + 4, { width: imgWidth });
          }
        } catch (imgErr) {
          // Se uma foto individual estiver corrompida, pula ela em vez
          // de quebrar a geração do PDF inteiro
          doc.fontSize(8).fillColor("#791F1F").text("[imagem indisponível]", x, rowStartY);
        }

        col++;
        if (col >= 2) {
          col = 0;
          rowStartY += imgHeight + 30;
          doc.y = rowStartY;
        }
      });

      doc.y = rowStartY + (col > 0 ? imgHeight + 30 : 0);
      doc.moveDown(1);
    }

    // ---------------------------------------------------------
    // 5. ENCERRAMENTO
    // ---------------------------------------------------------
    sectionTitle(doc, "5. Encerramento");
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor("#2C2C2A")
      .text(
        photoCount > 0
          ? `Este laudo possui ${photoCount} fotografia(s) anexada(s) como registro do estado observado.`
          : `Este laudo não possui fotografias anexadas.`
      )
      .moveDown(0.3)
      .text(`${engineer.crea_region || ""}, ${emissaoDate}.`)
      .moveDown(1.5);

    // ---------------------------------------------------------
    // Assinatura
    // ---------------------------------------------------------
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
      .text(engineer.name, 56, sigY + 6)
      .text(`CREA-${engineer.crea_region}: ${engineer.crea_number}`, 56, sigY + 20);
    if (report.art_number) {
      doc.text(`ART nº: ${report.art_number}`, 56, sigY + 34);
    }

    // ---------------------------------------------------------
    // Rodapé de rastreabilidade (todas as páginas)
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

function sectionTitle(doc, text) {
  doc
    .fontSize(11.5)
    .fillColor("#2C2C2A")
    .font("Helvetica-Bold")
    .text(text)
    .moveDown(0.4);
}

function fieldRows(doc, rows) {
  doc.fontSize(10);
  rows.forEach(([label, value]) => {
    doc.font("Helvetica-Bold").fillColor("#44433F").text(`${label}: `, { continued: true });
    doc.font("Helvetica").fillColor("#2C2C2A").text(value);
  });
}

module.exports = { generateReportPdf };
