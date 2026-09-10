-- Column names long enough to wrap inside a node box.
--
-- NOT a real dump: it is the minimal reproduction of what a real one does. Enterprise
-- schemas are full of names like these — prefix, qualifier, unit, year — and the sample
-- schema and `referenceSchema()` in tests/perf both use `field_0`..`field_7`, which fit on
-- one line at any width. That is why nothing caught the mismatch below.
--
-- `.erd-attr__name` in canvas.css sets `overflow-wrap: anywhere` and `.erd-node` caps at
-- `max-width: 300px`, so a name this long wraps to two or three lines and the row grows
-- past the flat 26px that `measure.ts` assumes. ELK is then told the box is shorter than it
-- is, and lays boxes on top of each other. Measured on a 41-table version of this shape:
-- every box taller than predicted, the worst by 586px (86%), and 26 overlapping pairs.
--
-- Used by tests/e2e/measurement.spec.ts.

CREATE TABLE dim_cust_master_hist_2019 (
  cust_master_surrogate_key_identifier bigint NOT NULL PRIMARY KEY,
  cust_effective_date_time_utc timestamp with time zone,
  cust_reconciliation_amount_in_local_currency numeric(18,4),
  acct_authorisation_source_system_record_locator character varying(255),
  pol_last_modified_created_by_user_identifier character varying(255),
  clm_settlement_status_code_description text
);

CREATE TABLE fct_clm_settlement_txn_2021 (
  clm_surrogate_key bigint NOT NULL PRIMARY KEY,
  cust_master_surrogate_key_identifier bigint NOT NULL REFERENCES dim_cust_master_hist_2019(cust_master_surrogate_key_identifier),
  clm_disbursement_reference_number_external character varying(255),
  clm_adjusted_amount_in_local_currency numeric(18,4),
  clm_reported_date_time_utc timestamp with time zone,
  clm_reconciliation_indicator_flag boolean
);

CREATE TABLE fct_invc_adjusted_txn_2022 (
  invc_surrogate_key bigint NOT NULL PRIMARY KEY,
  cust_master_surrogate_key_identifier bigint NOT NULL REFERENCES dim_cust_master_hist_2019(cust_master_surrogate_key_identifier),
  invc_expiration_source_system_record_locator character varying(4000),
  invc_original_sequence_number integer,
  invc_authorisation_status_code_description text
);
