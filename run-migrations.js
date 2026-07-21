-- ============================================================
-- Migração: campos que faltavam para a estrutura formal completa
-- de um laudo técnico (identificação do objeto, ART, parecer
-- conclusivo separado do diagnóstico)
-- ============================================================

-- "Objeto da perícia" — o nome/identificação do imóvel ou edificação,
-- distinto do endereço (ex: "Edifício Residencial Aurora")
ALTER TABLE projects ADD COLUMN building_name VARCHAR(255);

-- Número da ART (Anotação de Responsabilidade Técnica) — obrigatório
-- em laudos formais, é específico de cada laudo (não do engenheiro
-- em geral, já que cada serviço tem sua própria ART emitida no CREA)
ALTER TABLE reports ADD COLUMN art_number VARCHAR(50);

-- O parecer técnico conclusivo é uma seção formalmente distinta da
-- descrição/diagnóstico — por isso não reaproveitamos o mesmo campo
-- generated_content_json.text, criamos um campo próprio
ALTER TABLE reports ADD COLUMN technical_opinion_json JSONB;

COMMENT ON COLUMN projects.building_name IS
    'Nome/identificação do imóvel ou edificação (ex: "Edifício Residencial Aurora"), distinto do endereço.';
COMMENT ON COLUMN reports.art_number IS
    'Número da Anotação de Responsabilidade Técnica (ART) emitida no CREA para este laudo específico.';
COMMENT ON COLUMN reports.technical_opinion_json IS
    'Parecer técnico conclusivo — seção formal separada da descrição/diagnóstico, com a conclusão e recomendações do engenheiro.';
