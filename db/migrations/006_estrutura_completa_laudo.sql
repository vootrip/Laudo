-- ============================================================
-- Migração: estrutura completa de laudo no padrão do documento
-- real de referência (laudo assinado por engenheiro perito).
--
-- Adiciona: seções numeradas, subseções (7.1, 7.2...), vínculo
-- de normas técnicas por laudo com texto de aplicação editável,
-- estimativa de custo em faixas, parágrafo de responsabilidade/
-- nexo causal, vínculo de foto à seção/subseção específica, e
-- dados de contato do escritório para o rodapé de todas as
-- páginas do PDF.
-- ============================================================

-- ------------------------------------------------------------
-- Seções macro do laudo (ex: "7) Identificação das Causas...")
-- Um laudo pode ter seções de texto livre (sem subseção, ex:
-- "2) Objetivo") ou seções que só servem de contêiner para
-- subseções (ex: "7) Identificação das Causas...", cujo texto
-- de fato mora em 7.1, 7.2, 7.3...).
-- ------------------------------------------------------------
CREATE TABLE report_sections (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    section_number  VARCHAR(10) NOT NULL,   -- "1", "2", ... "10"
    section_title   VARCHAR(255) NOT NULL,
    content_text    TEXT,                    -- usado quando a seção não tem subseções
    order_index     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(report_id, section_number)
);

CREATE INDEX idx_report_sections_report ON report_sections(report_id);

CREATE TRIGGER trg_report_sections_updated_at
    BEFORE UPDATE ON report_sections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Subseções (7.1, 7.2, 7.3... / 8.1, 8.2...)
-- ------------------------------------------------------------
CREATE TABLE report_subsections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id          UUID NOT NULL REFERENCES report_sections(id) ON DELETE CASCADE,
    subsection_number   VARCHAR(10) NOT NULL,  -- "7.1", "7.2"...
    subsection_title    VARCHAR(255) NOT NULL,
    content_text        TEXT,
    order_index         INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(section_id, subsection_number)
);

CREATE INDEX idx_report_subsections_section ON report_subsections(section_id);

CREATE TRIGGER trg_report_subsections_updated_at
    BEFORE UPDATE ON report_subsections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Vínculo de normas técnicas por laudo, com texto de aplicação
-- próprio (o engenheiro pode ajustar o texto padrão da norma
-- para o caso específico). Convive com a coluna antiga
-- reports.norm_references (TEXT[] de códigos) — essa tabela é
-- a fonte de verdade nova; a coluna antiga fica congelada para
-- não quebrar laudos já existentes, e pode ser migrada depois.
-- ------------------------------------------------------------
CREATE TABLE report_norm_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    norm_id         UUID NOT NULL REFERENCES technical_norms(id),
    applied_text    TEXT,       -- se nulo, o PDF usa technical_norms.scope_summary como fallback
    order_index     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(report_id, norm_id)
);

CREATE INDEX idx_report_norm_links_report ON report_norm_links(report_id);

-- ------------------------------------------------------------
-- Estimativa de custo em faixas (mín/máx), por item
-- ------------------------------------------------------------
CREATE TABLE report_cost_estimates (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id           UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    item_description     VARCHAR(255) NOT NULL,
    min_cost_cents        INTEGER NOT NULL,
    max_cost_cents         INTEGER NOT NULL,
    order_index          INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (max_cost_cents >= min_cost_cents)
);

CREATE INDEX idx_report_cost_estimates_report ON report_cost_estimates(report_id);

-- ------------------------------------------------------------
-- Vínculo de foto a uma seção/subseção específica, para
-- rastreabilidade de evidência (qual foto sustenta qual
-- afirmação do laudo). Ambos nulos = foto solta, comportamento
-- atual preservado.
-- ------------------------------------------------------------
ALTER TABLE report_photos
    ADD COLUMN section_id     UUID REFERENCES report_sections(id) ON DELETE SET NULL,
    ADD COLUMN subsection_id  UUID REFERENCES report_subsections(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Campo dedicado de responsabilidade / nexo causal técnico
-- (seção 9 "Considerações Finais" do laudo real tem um
-- parágrafo específico atribuindo responsabilidade — não deve
-- ser texto solto misturado no restante da conclusão)
-- ------------------------------------------------------------
ALTER TABLE reports
    ADD COLUMN causal_link_text        TEXT,
    ADD COLUMN responsible_party_text  TEXT;

COMMENT ON COLUMN reports.causal_link_text IS
    'Parágrafo técnico de nexo causal entre a intervenção identificada e o dano constatado.';
COMMENT ON COLUMN reports.responsible_party_text IS
    'Atribuição de responsabilidade técnica pelos danos (ex: ente público, construtora executora).';

-- ------------------------------------------------------------
-- Dados de contato do escritório, para o rodapé aparecer em
-- todas as páginas do PDF no mesmo padrão do laudo real
-- (endereço + telefone + e-mail do responsável técnico).
-- ------------------------------------------------------------
ALTER TABLE engineers
    ADD COLUMN office_address  TEXT,
    ADD COLUMN office_phone    VARCHAR(30);

-- ------------------------------------------------------------
-- Biblioteca de seções técnicas reutilizáveis por tipo de laudo
-- (ex: a seção "Muro Alvenaria" do laudo real, que é conteúdo
-- técnico-educativo repetido em todo laudo do tipo "muro").
-- engineer_id nulo = template global do sistema.
-- ------------------------------------------------------------
CREATE TABLE section_templates (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engineer_id             UUID REFERENCES engineers(id) ON DELETE CASCADE,
    report_type             VARCHAR(50) NOT NULL,   -- casa com report_templates.type
    section_title            VARCHAR(255) NOT NULL,
    default_content_text      TEXT NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_section_templates_type ON section_templates(report_type);
CREATE INDEX idx_section_templates_engineer ON section_templates(engineer_id);
