-- ============================================================
-- Tabela de referência de normas técnicas (catálogo curado)
-- IMPORTANTE: contém apenas número, título e escopo resumido
-- (informação pública de catálogo). NÃO contém texto integral
-- das normas, que é conteúdo comercializado pela ABNT.
-- O engenheiro consulta o texto completo na fonte oficial
-- (Catálogo ABNT ou Target GEDWeb).
-- ============================================================

CREATE TABLE technical_norms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(50) NOT NULL UNIQUE,  -- ex: NBR 16280
    title           VARCHAR(255) NOT NULL,
    scope_summary   TEXT NOT NULL,      -- resumo escrito internamente, não é o texto da norma
    applies_to      VARCHAR(100) NOT NULL, -- vistoria|estrutural|conclusao_obra|geral
    status          VARCHAR(20) NOT NULL DEFAULT 'vigente', -- vigente|cancelada|substituida
    official_source_url TEXT DEFAULT 'https://www.abntcatalogo.com.br',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO technical_norms (code, title, scope_summary, applies_to, status) VALUES

('NBR 16280', 'Reforma em edificações — Sistema de gestão de reformas',
 'Aplica-se a reformas em edificações e é a referência mais comum citada em laudos de vistoria predial, cautelar ou de conformidade estrutural após alterações no imóvel. Cobre responsabilidades de projeto, execução e fiscalização de reformas.',
 'vistoria', 'vigente'),

('NBR 5674', 'Manutenção de edificações — Requisitos para o sistema de gestão de manutenção',
 'Referência para laudos que avaliam o estado de conservação e a manutenção predial ao longo do tempo — frequentemente citada em vistorias de saída ou cautelares que discutem desgaste natural vs. dano.',
 'vistoria', 'vigente'),

('NBR 15575', 'Edificações habitacionais — Desempenho',
 'Norma de desempenho de edificações habitacionais (estrutural, térmico, acústico, estanqueidade). Citada em laudos que avaliam se um imóvel novo ou reformado atende aos requisitos mínimos de desempenho.',
 'conclusao_obra', 'vigente'),

('NBR 13752', 'Perícias de engenharia na construção civil',
 'Norma-base para laudos periciais e cautelares — define terminologia, metodologia e estrutura mínima esperada de um laudo pericial de engenharia civil.',
 'vistoria', 'vigente'),

('NBR 6118', 'Projeto de estruturas de concreto — Procedimento',
 'Referência técnica quando o laudo identifica indícios de comprometimento estrutural em elementos de concreto armado, exigindo avaliação mais aprofundada além da vistoria simples.',
 'estrutural', 'vigente'),

('NBR 9575', 'Impermeabilização — Seleção e projeto',
 'Citada em laudos de vistoria que identificam infiltrações, umidade ou falhas de impermeabilização em lajes, terraços e áreas molhadas.',
 'vistoria', 'vigente');

-- Índice para busca rápida por aplicabilidade
CREATE INDEX idx_technical_norms_applies_to ON technical_norms(applies_to);
