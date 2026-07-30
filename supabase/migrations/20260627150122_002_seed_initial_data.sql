/*
# Seed Initial Data for InventoryBlindAZ

1. Data seeding
- Insert initial brands data
- Insert initial top 10 vendas
- Insert initial custom KPIs

2. Notes
- Uses INSERT ... ON CONFLICT DO NOTHING to avoid duplicates
- Data matches the initial state from App.tsx
*/

-- Insert initial brands data
INSERT INTO inventory_brands (brand, total_sku, done_sku, divergences, order_index) VALUES
('Nillkin', 195, 195, 70, 1),
('Ringke', 193, 193, 137, 2),
('GoCase Capas', 137, 137, 66, 3),
('Az Capas', 279, 86, 0, 4),
('X-Level', 18, 18, 6, 5),
('Dexnor', 53, 53, 11, 6),
('DUX', 421, 0, 0, 7),
('ESR', 167, 167, 10, 8),
('Lancheiras e Necessaries GC', 40, 40, 13, 9),
('Térmicos GC', 97, 97, 68, 10),
('Linha Joy GC', 6, 6, 5, 11),
('Linha Puffer GC', 4, 4, 4, 12),
('Linha de Bases GC', 46, 46, 32, 13),
('Linha de Mochilas GC', 23, 23, 13, 14),
('Linha Tote Daily GC', 7, 7, 5, 15),
('Linha Tote Bloom GC', 4, 4, 0, 16),
('Linha Tote Mini GC', 7, 7, 4, 17),
('Linha Tote POP GC', 4, 4, 2, 18),
('Linha Tote Moon GC', 2, 2, 2, 19),
('Linha Tote Shopper GC', 4, 4, 0, 20),
('Linha Tote Care GC', 4, 4, 4, 21),
('Linha Mala de Viagem GC', 11, 11, 2, 22),
('Linha de Outlet e PET', 402, 217, 0, 23)
ON CONFLICT DO NOTHING;

-- Insert initial top 10 vendas
INSERT INTO top_vendas (produto, sku, vendas, order_index) VALUES
('Bolsa Tote Mini Gocase - Preto', 'TBGCM55-1', '1.764', 1),
('Bolsa Tote Daily Clear Gocase', 'TBGCM31-1', '3.587', 2),
('Bolsa Tote Puffer Gocase - P', 'TBGCM56-1', '579', 3),
('Bolsa Tote Daily Clear Gocase', 'TBGCM31-6', '258', 4),
('Bolsa De Viagem Mala De Mão', 'BVGCM44-1', '366', 5),
('Bolsa Tote Pop Gocase Com', 'TBGCM103-1', '1.196', 6),
('Bolsa Tote Daily Clear Gocase', 'TBGCM31-33', '771', 7),
('Bolsa Tote Puffer Gocase - M', 'TBGCM56-6', '291', 8),
('Bolsa Tote Mini Gocase - Off', 'TBGCM55-33', '180', 9),
('Bolsa Tote Puffer Gocase - V', 'TBGCM56-39', '254', 10)
ON CONFLICT DO NOTHING;

-- Insert initial custom KPIs
INSERT INTO custom_kpis (titulo, valor, unidade, variacao, tipo_variacao, cor_icone, order_index) VALUES
('Produtividade Média', '48.3', 'SKUs/dia', '+12.5% vs mês anterior', 'up', 'blue', 1),
('Taxa de Erro', '3.2', '%', '-0.8% vs mês anterior', 'down', 'red', 2),
('Tempo Médio/SKU', '2.4', 'min', '-0.3 min vs mês anterior', 'down', 'amber', 3),
('Equipe Ativa', '8', 'operadores', 'Turno: 08h - 17h', 'neutral', 'emerald', 4)
ON CONFLICT DO NOTHING;