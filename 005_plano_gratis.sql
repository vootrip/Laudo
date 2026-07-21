-- ============================================================
-- Migração: suporte a laudos criados a partir de documento
-- importado pelo próprio engenheiro (em vez de preenchido do zero)
-- ============================================================

ALTER TABLE reports
    ADD COLUMN source_type VARCHAR(30) NOT NULL DEFAULT 'formulario',
        -- 'formulario'          -> criado preenchendo o formulário estruturado (fluxo original)
        -- 'documento_importado' -> engenheiro importou um .docx/.pdf já escrito por ele
    ADD COLUMN original_document_url TEXT,
        -- guarda o arquivo original importado, para auditoria (o que o engenheiro trouxe)
    ADD COLUMN completeness_check_json JSONB;
        -- resultado da checagem da IA: quais seções/itens esperados
        -- estavam presentes, ausentes, ou incompletos no documento importado

COMMENT ON COLUMN reports.source_type IS
    'Origem do conteúdo do laudo: preenchido no formulário ou importado como documento pronto pelo engenheiro.';

COMMENT ON COLUMN reports.original_document_url IS
    'Arquivo original enviado pelo engenheiro, preservado para auditoria — nunca sobrescrito pela IA.';

COMMENT ON COLUMN reports.completeness_check_json IS
    'Checklist gerado pela IA comparando o documento importado contra os itens obrigatórios do template (ex: norma citada, dados do CREA, itens vistoriados). Usado para sinalizar lacunas ao engenheiro, nunca para preenchê-las sozinha.';
