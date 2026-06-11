-- Append-only-Schutz (§8.4): blockt UPDATE und DELETE auf den unveränderlichen Tabellen.
-- INSERT bleibt erlaubt. Forward-only (migrate deploy, niemals db push).

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Append-only-Tabelle %: % nicht erlaubt', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update      BEFORE UPDATE ON "audit_trail"            FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_audit_no_delete      BEFORE DELETE ON "audit_trail"            FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_fcversion_no_update  BEFORE UPDATE ON "forecast_version"       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_fcversion_no_delete  BEFORE DELETE ON "forecast_version"       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_budgetevt_no_update  BEFORE UPDATE ON "budget_aenderung_event" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_budgetevt_no_delete  BEFORE DELETE ON "budget_aenderung_event" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
