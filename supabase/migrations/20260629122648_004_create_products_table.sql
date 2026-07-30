-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  ean TEXT,
  location TEXT,
  price DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on SKU
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique_idx ON products (sku);

-- Create indexes for search performance
CREATE INDEX IF NOT EXISTS products_ean_idx ON products (ean);
CREATE INDEX IF NOT EXISTS products_location_idx ON products (location);
CREATE INDEX IF NOT EXISTS products_name_idx ON products (name);

-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "select_products" ON products FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_products" ON products FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_products" ON products FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_products" ON products FOR DELETE
  TO authenticated USING (true);

-- Add comment
COMMENT ON TABLE products IS 'Products imported from spreadsheets for inventory management';