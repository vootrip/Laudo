/**
 * Geração do PDF final do laudo — o documento que o engenheiro
 * efetivamente entrega ao cliente dele.
 * -------------------------------------------------------------------
 * Usa pdfkit (biblioteca pura em JS, não depende de navegador headless).
 *
 * Estrutura do documento, no padrão do laudo real de referência
 * (laudo assinado por engenheiro perito, usado como gabarito):
 *   1. Cabeçalho com logomarca (se cadastrada) + dados do responsável
 *      técnico (nome, título, CREA)
 *   2. Título do laudo + identificação (cliente, endereço, data)
 *   3. Corpo em seções numeradas (1, 2, 3...), com subseções (7.1,
 *      7.2...) quando existirem — mesmo padrão do documento real
 *   4. Figuras (fotos) autonumeradas ("Figura 01", "Figura 02"...)
 *      com legenda, inseridas próximas à seção/subseção a que
 *      pertencem (ou ao final, se soltas)
 *   5. Normas técnicas referenciadas, com texto de aplicação
 *   6. Parágrafo de nexo causal e responsabilidade técnica
 *   7. Estimativa de custo em faixas (mín-máx), com total somado
 *   8. Área de assinatura
 *   9. Rodapé em TODAS as páginas: nome do perito, título
 *      profissional, endereço, telefone e e-mail — mesmo padrão
 *      do laudo real, não só na capa
 */

const PDFDocument = require("pdfkit");

function formatCurrencyBRL(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------
// Renderização de texto rico (produzido pelo editor com barra de
// formatação do frontend: negrito, itálico, sublinhado, fonte,
// tamanho, cor, listas, alinhamento). Laudos antigos ou trechos sem
// nenhuma tag caem direto no comportamento anterior (texto puro),
// sem custo extra.
// ---------------------------------------------------------------
const RICH_FONT_MAP = {
  Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", boldItalic: "Helvetica-BoldOblique" },
  "Times New Roman": { normal: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic", boldItalic: "Times-BoldItalic" },
  "Courier New": { normal: "Courier", bold: "Courier-Bold", italic: "Courier-Oblique", boldItalic: "Courier-BoldOblique" },
};

function rgbStringToHex(str) {
  const m = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
  if (!m) return str; // já deve ser hex (#rrggbb) ou nome de cor válido do pdfkit
  const toHex = (n) => Number(n).toString(16).padStart(2, "0");
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

function parseStyleAttr(attrString) {
  const styleMatch = (attrString || "").match(/style\s*=\s*"([^"]*)"/i);
  const styles = {};
  if (styleMatch) {
    styleMatch[1].split(";").forEach((decl) => {
      const idx = decl.indexOf(":");
      if (idx === -1) return;
      const key = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (key && val) styles[key] = val;
    });
  }
  return styles;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function pickFontName(state) {
  const family = RICH_FONT_MAP[state.fontFamily] || RICH_FONT_MAP.Helvetica;
  if (state.bold && state.italic) return family.boldItalic;
  if (state.bold) return family.bold;
  if (state.italic) return family.italic;
  return family.normal;
}

function renderRichText(doc, rawContent, opts = {}) {
  const content = rawContent || "";
  const baseFontSize = opts.fontSize || 10.5;
  const baseColor = opts.color || "#2C2C2A";
  const baseAlign = opts.align || "justify";
  const lineGap = opts.lineGap != null ? opts.lineGap : 3;
  const baseIndent = opts.indent || 0;

  // Sem nenhuma tag: comportamento antigo, sem overhead de parsing
  if (!content.includes("<")) {
    doc.font("Helvetica").fontSize(baseFontSize).fillColor(baseColor)
      .text(content, { align: baseAlign, lineGap, indent: baseIndent });
    return;
  }

  const tokenRe = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let match;

  let state = { bold: false, italic: false, underline: false, fontFamily: "Helvetica", fontSize: baseFontSize, color: baseColor };
  const stateStack = [];
  const listStack = []; // { type: 'ul'|'ol', counter }
  let currentRuns = [];
  let currentAlign = baseAlign;

  function currentIndent() {
    return baseIndent + listStack.length * 14;
  }

  function flushParagraph() {
    if (currentRuns.length === 0) return;
    currentRuns.forEach((run, i) => {
      const isFirst = i === 0;
      const isLast = i === currentRuns.length - 1;
      const options = { continued: !isLast, underline: run.underline };
      if (isFirst) {
        options.align = currentAlign;
        options.indent = currentIndent();
        options.lineGap = lineGap;
      }
      doc.font(run.font).fontSize(run.fontSize).fillColor(run.color).text(run.text, options);
    });
    doc.moveDown(0.15);
    currentRuns = [];
  }

  while ((match = tokenRe.exec(content)) !== null) {
    // Texto puro entre tags
    if (match[4] !== undefined) {
      const text = decodeHtmlEntities(match[4]).replace(/[ \t]+/g, " ").replace(/\n/g, " ");
      if (text.trim().length === 0 && currentRuns.length === 0) continue;
      currentRuns.push({
        text,
        font: pickFontName(state),
        fontSize: state.fontSize,
        color: state.color,
        underline: state.underline,
      });
      continue;
    }

    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attrs = match[3] || "";

    if (["b", "strong", "i", "em", "u", "span", "font"].includes(tag)) {
      if (!closing) {
        stateStack.push(state);
        let next = state;
        if (tag === "b" || tag === "strong") next = { ...state, bold: true };
        else if (tag === "i" || tag === "em") next = { ...state, italic: true };
        else if (tag === "u") next = { ...state, underline: true };
        else if (tag === "span" || tag === "font") {
          const styles = parseStyleAttr(attrs);
          next = { ...state };
          if (styles.color) next.color = rgbStringToHex(styles.color);
          if (styles["font-size"]) {
            const sizeNum = parseFloat(styles["font-size"]);
            if (!isNaN(sizeNum)) next.fontSize = sizeNum;
          }
          if (styles["font-family"]) {
            const fam = styles["font-family"].replace(/["']/g, "").split(",")[0].trim();
            if (RICH_FONT_MAP[fam]) next.fontFamily = fam;
          }
        }
        state = next;
      } else {
        state = stateStack.pop() || state;
      }
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      if (!closing) {
        flushParagraph();
        listStack.push({ type: tag, counter: 0 });
      } else {
        listStack.pop();
      }
      continue;
    }

    if (tag === "li") {
      if (!closing) {
        flushParagraph();
        const list = listStack[listStack.length - 1];
        const marker = list && list.type === "ol" ? `${(list.counter += 1)}.  ` : "•  ";
        currentRuns.push({ text: marker, font: pickFontName(state), fontSize: state.fontSize, color: state.color, underline: false });
      } else {
        flushParagraph();
      }
      continue;
    }

    if (tag === "p" || tag === "div") {
      if (!closing) {
        flushParagraph();
        const styles = parseStyleAttr(attrs);
        currentAlign = styles["text-align"] || baseAlign;
      } else {
        flushParagraph();
        currentAlign = baseAlign;
      }
      continue;
    }

    if (tag === "br") {
      flushParagraph();
      continue;
    }
    // Outras tags desconhecidas são ignoradas (o texto interno ainda é processado)
  }

  flushParagraph();
}

function drawFooter(doc, engineer, pageWidth) {
  const parts = [
    `${engineer.name}${engineer.crea_number ? " — CREA " + engineer.crea_number + "/" + (engineer.crea_region || "") : ""}`,
  ];
  if (engineer.office_address) parts.push(engineer.office_address);
  const contact = [engineer.office_phone, engineer.email].filter(Boolean).join(" — e-mail: ");
  if (contact) parts.push(contact);

  doc
    .fontSize(7.5)
    .fillColor("#999790")
    .text(parts.join("\n"), 56, 772, { width: pageWidth, align: "center", lineGap: 1 });
}

function formatFigureCaption(label, photo) {
  let text = label;
  if (photo.caption) text += `: ${photo.caption}`;
  if (photo.latitude != null && photo.longitude != null) {
    const coords = `${photo.latitude.toFixed(6)}, ${photo.longitude.toFixed(6)}`;
    text += ` — Coordenada de captura: ${coords}`;
  }
  return text;
}

function generateReportPdf({
  engineer,
  project,
  client,
  report,
  sections = [],
  norms = [],
  photos = [],
  costEstimates = { items: [], total_min_cents: 0, total_max_cents: 0 },
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, bufferPages: true });
    const chunks = [];
    const pageContentWidth = 483;

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ---------------------------------------------------------
    // 1. Cabeçalho
    // ---------------------------------------------------------
    const headerTop = doc.y;

    if (engineer.logo_url && engineer.logo_buffer) {
      doc.image(engineer.logo_buffer, 56, headerTop, { width: 90 });
      doc.x = 160;
    }

    doc
      .fontSize(14)
      .fillColor("#2C2C2A")
      .text(engineer.company_name || engineer.name, { align: "left" })
      .fontSize(9)
      .fillColor("#6B6A64")
      .text(`${engineer.name} — CREA ${engineer.crea_number || "-"}/${engineer.crea_region || "-"}`)
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
    // 3. Corpo em seções / subseções numeradas
    // ---------------------------------------------------------
    let figureCounter = 0;
    const renderFigures = (sectionId, subsectionId) => {
      const matching = photos.filter((p) =>
        subsectionId ? p.subsection_id === subsectionId : sectionId ? (p.section_id === sectionId && !p.subsection_id) : false
      );
      matching.forEach((photo) => {
        figureCounter += 1;
        const label = `Figura ${String(figureCounter).padStart(2, "0")}`;
        if (photo.image_buffer) {
          if (doc.y > 620) doc.addPage();
          try {
            doc.image(photo.image_buffer, { fit: [pageContentWidth, 320], align: "center" });
          } catch (e) {
            // imagem inválida/corrompida — não derruba a geração do PDF inteiro
          }
        }
        doc
          .fontSize(9)
          .fillColor("#6B6A64")
          .text(formatFigureCaption(label, photo), { align: "center" })
          .moveDown(0.8);
      });
    };

    if (sections && sections.length > 0) {
      sections.forEach((section) => {
        if (doc.y > 700) doc.addPage();
        doc
          .fontSize(12.5)
          .fillColor("#2C2C2A")
          .font("Helvetica-Bold")
          .text(`${section.section_number}) ${section.section_title}`)
          .moveDown(0.4);

        if (section.subsections && section.subsections.length > 0) {
          section.subsections.forEach((sub) => {
            if (doc.y > 700) doc.addPage();
            doc
              .fontSize(11)
              .fillColor("#2C2C2A")
              .font("Helvetica-Bold")
              .text(`${sub.subsection_number} ${sub.subsection_title}`)
              .moveDown(0.3);
            renderRichText(doc, sub.content_text || "", { align: "justify", lineGap: 3, fontSize: 10.5, color: "#2C2C2A" });
            doc.moveDown(0.6);

            renderFigures(null, sub.id);
          });
          // Fotos vinculadas à seção diretamente (não a uma subseção
          // específica), mesmo quando a seção tem subseções — sem isso
          // ficariam de fora tanto do loop acima quanto das "soltas".
          renderFigures(section.id, null);
        } else {
          renderRichText(doc, section.content_text || "", { align: "justify", lineGap: 3, fontSize: 10.5, color: "#2C2C2A" });
          doc.moveDown(0.6);

          renderFigures(section.id, null);
        }

        doc.moveDown(0.6);
      });
    } else {
      // Fallback: laudos antigos (formato flat, sem seções estruturadas)
      doc
        .fontSize(11)
        .fillColor("#2C2C2A")
        .font("Helvetica-Bold")
        .text("Descrição técnica")
        .moveDown(0.4);
      renderRichText(doc, report.generated_content_json?.text || "", { align: "justify", lineGap: 3, fontSize: 10.5, color: "#2C2C2A" });
      doc.moveDown(1);
    }

    // Fotos que não estão vinculadas a nenhuma seção/subseção específica
    const looseFigures = photos.filter((p) => !p.section_id && !p.subsection_id);
    if (looseFigures.length > 0) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#2C2C2A").text("Registros fotográficos").moveDown(0.4);
      looseFigures.forEach((photo) => {
        figureCounter += 1;
        const label = `Figura ${String(figureCounter).padStart(2, "0")}`;
        if (photo.image_buffer) {
          if (doc.y > 620) doc.addPage();
          try {
            doc.image(photo.image_buffer, { fit: [pageContentWidth, 320], align: "center" });
          } catch (e) {}
        }
        doc
          .fontSize(9)
          .fillColor("#6B6A64")
          .text(formatFigureCaption(label, photo), { align: "center" })
          .moveDown(0.8);
      });
    }

    // ---------------------------------------------------------
    // 5. Normas referenciadas (com texto de aplicação)
    // ---------------------------------------------------------
    if (norms && norms.length > 0) {
      if (doc.y > 650) doc.addPage();
      doc
        .fontSize(11)
        .fillColor("#2C2C2A")
        .font("Helvetica-Bold")
        .text("Normas técnicas de referência")
        .moveDown(0.4);
      norms.forEach((n) => {
        doc
          .fontSize(9.5)
          .font("Helvetica-Bold")
          .fillColor("#44433F")
          .text(`• ${n.code} — ${n.title}`, { continued: false })
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#6B6A64")
          .text(n.applied_text || n.scope_summary || "", { indent: 12, align: "justify" })
          .moveDown(0.4);
      });
      doc.moveDown(0.6);
    }

    // ---------------------------------------------------------
    // 6. Nexo causal e responsabilidade técnica
    // ---------------------------------------------------------
    if (report.causal_link_text || report.responsible_party_text) {
      if (doc.y > 680) doc.addPage();
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#2C2C2A").text("Considerações Finais").moveDown(0.4);
      if (report.causal_link_text) {
        doc
          .font("Helvetica")
          .fontSize(10.5)
          .fillColor("#2C2C2A")
          .text(report.causal_link_text, { align: "justify", lineGap: 3 })
          .moveDown(0.5);
      }
      if (report.responsible_party_text) {
        doc
          .font("Helvetica-Bold")
          .fontSize(10.5)
          .fillColor("#2C2C2A")
          .text("Responsabilidade técnica: ", { continued: true })
          .font("Helvetica")
          .text(report.responsible_party_text, { align: "justify" })
          .moveDown(0.8);
      }
    }

    // ---------------------------------------------------------
    // 7. Estimativa de custo
    // ---------------------------------------------------------
    if (costEstimates.items && costEstimates.items.length > 0) {
      if (doc.y > 650) doc.addPage();
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#2C2C2A")
        .text(
          `Estimativa preliminar de custos: ${formatCurrencyBRL(costEstimates.total_min_cents)} a ${formatCurrencyBRL(costEstimates.total_max_cents)}`
        )
        .moveDown(0.4);
      costEstimates.items.forEach((item) => {
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor("#44433F")
          .text(
            `• ${item.item_description}: ${formatCurrencyBRL(item.min_cost_cents)} a ${formatCurrencyBRL(item.max_cost_cents)}`
          );
      });
      doc.moveDown(1);
    }

    // ---------------------------------------------------------
    // 8. Área de assinatura
    // ---------------------------------------------------------
    if (doc.y > 700) doc.addPage();
    doc.moveDown(2);
    const sigY = doc.y;
    doc.moveTo(56, sigY).lineTo(280, sigY).strokeColor("#2C2C2A").lineWidth(0.5).stroke();
    doc
      .fontSize(9)
      .fillColor("#44433F")
      .text(`${engineer.name} — CREA ${engineer.crea_number || "-"}/${engineer.crea_region || "-"}`, 56, sigY + 6);

    // ---------------------------------------------------------
    // 9. Rodapé em TODAS as páginas (nome, título, endereço,
    // telefone, e-mail — padrão do laudo real)
    // ---------------------------------------------------------
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, engineer, pageContentWidth);
    }

    doc.end();
  });
}

module.exports = { generateReportPdf };
