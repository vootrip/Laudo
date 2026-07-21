-- ============================================================
-- Migração: plano grátis (1 laudo) + tabela de configuração de
-- planos, para controlar limites e liberar recursos após pagamento
-- ============================================================

-- Tabela de configuração dos planos — fica fácil ajustar preço/limite
-- sem precisar alterar código, só uma linha no banco.
CREATE TABLE plan_limits (
    plan_code       VARCHAR(30) PRIMARY KEY, -- gratis|start|pro|escritorio
    display_name    VARCHAR(50) NOT NULL,
    laudos_included INTEGER NOT NULL,        -- quantidade incluída no período
    billing_period  VARCHAR(20) NOT NULL,    -- 'unico' (grátis, não recorrente) | 'mensal'
    price_cents     INTEGER NOT NULL DEFAULT 0,
    stripe_price_id VARCHAR(100),            -- preenchido depois de criar o produto no Stripe
    allows_signature BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO plan_limits (plan_code, display_name, laudos_included, billing_period, price_cents, allows_signature) VALUES
    ('gratis',     'Grátis',      1,  'unico',  0,      true),
    ('start',      'Start',      10,  'mensal', 7900,   true),
    ('pro',        'Pro',        20,  'mensal', 14900,  true),
    ('escritorio', 'Escritório', 40,  'mensal', 24900,  true);

-- O plano padrão de um novo cadastro passa a ser 'gratis', não 'trial'
ALTER TABLE engineers ALTER COLUMN plan SET DEFAULT 'gratis';

-- Campo para saber quando a assinatura paga começou (útil para calcular
-- o "período atual" de laudos_included no caso dos planos mensais)
ALTER TABLE engineers ADD COLUMN plan_started_at TIMESTAMPTZ DEFAULT now();
