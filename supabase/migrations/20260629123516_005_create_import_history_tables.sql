-- Create import_history table
CREATE TABLE IF NOT EXISTS import_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_content TEXT, -- Store the CSV content as text
  total_products INTEGER DEFAULT 0,
  new_products INTEGER DEFAULT 0,
  updated_products INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  imported_by TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'completed', -- completed, undone
  undone_at TIMESTAMPTZ,
  column_mapping JSONB -- Store the column mapping used
);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS import_history_created_at_idx ON import_history (created_at DESC);

-- Create index on status
CREATE INDEX IF NOT EXISTS import_history_status_idx ON import_history (status);

-- Create import_products_audit table to track which products were imported/updated
CREATE TABLE IF NOT EXISTS import_products_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES import_history(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  sku TEXT NOT NULL,
  action TEXT NOT NULL, -- 'insert' or 'update'
  old_data JSONB, -- Store old data for undo
  new_data JSONB, -- Store new data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on import_id
CREATE INDEX IF NOT EXISTS import_products_audit_import_id_idx ON import_products_audit (import_id);
CREATE INDEX IF NOT EXISTS import_products_audit_product_id_idx ON import_products_audit (product_id);

-- Enable RLS
ALTER TABLE import_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_products_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "select_import_history" ON import_history FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_import_history" ON import_history FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_import_history" ON import_history FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "select_import_products_audit" ON import_products_audit FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_import_products_audit" ON import_products_audit FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "delete_import_products_audit" ON import_products_audit FOR DELETE
  TO authenticated USING (true);

-- Add comments
COMMENT ON TABLE import_history IS 'History of product imports with file storage';
COMMENT ON TABLE import_products_audit IS 'Audit trail of products created/updated during imports';