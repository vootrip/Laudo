-- ============================================================
-- Migração: título profissional do perito, para completar o
-- rodapé de todas as páginas do PDF no mesmo padrão do laudo
-- real — segunda linha, em negrito, logo abaixo do nome
-- (ex: "PERITO JUDICIAL - MSc. ENG. CIVIL e ENG. SEGURANÇA DO
-- TRABALHO"). office_address e office_phone já existem desde a
-- migração 006; esse é o único campo que faltava pro rodapé
-- ficar completo.
-- ============================================================

ALTER TABLE engineers
    ADD COLUMN IF NOT EXISTS professional_title VARCHAR(255);

COMMENT ON COLUMN engineers.professional_title IS
    'Título/qualificação profissional exibido em negrito no rodapé de todas as páginas do PDF, abaixo do nome (ex: "Perito Judicial - MSc. Eng. Civil e Eng. Segurança do Trabalho").';
