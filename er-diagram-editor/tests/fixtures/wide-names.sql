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

-- A 60-column table, because row-height error only shows up once it accumulates.
--
-- The rest of this file is 3-6 rows per table, and a FLAT 27px per row looks correct at
-- that size while under-measuring this table by 22px — the true rate is ~27.37px once the
-- 1px inter-row rule and sub-pixel rounding are counted. Under-measuring is the direction
-- that overlaps boxes, and it would only have bitten on the wide tables that real schemas
-- actually have. Keep a table this wide in here.
CREATE TABLE fct_wide_sixty_column_fact_2024 (
  wide_surrogate_key_identifier bigint NOT NULL PRIMARY KEY,
  mbr_reported_reference_number_external_0 text,
  clm_expiration_indicator_flag_1 text,
  pol_effective_reference_number_external_2 bigint,
  pol_effective_indicator_flag_3 character varying(255),
  shpmt_adjusted_sequence_number_4 numeric(10,2),
  pol_reported_date_time_utc_5 date,
  acct_effective_date_time_utc_6 integer,
  clm_reported_date_time_utc_7 text,
  invc_adjusted_indicator_flag_8 integer,
  clm_settlement_status_code_description_9 text,
  cust_settlement_date_time_utc_10 text,
  txn_adjusted_indicator_flag_11 timestamp with time zone,
  txn_last_modified_amount_in_local_currency_12 date,
  txn_effective_date_time_utc_13 numeric(10,2),
  acct_adjusted_date_time_utc_14 bigint,
  shpmt_effective_date_time_utc_15 character varying(255),
  clm_expiration_date_time_utc_16 text,
  shpmt_settlement_reference_number_external_17 jsonb,
  acct_reported_sequence_number_18 integer,
  txn_last_modified_date_time_utc_19 bigint,
  invc_effective_reference_number_external_20 timestamp with time zone,
  pol_expiration_sequence_number_21 timestamp with time zone,
  cust_effective_reference_number_external_22 text,
  pol_settlement_indicator_flag_23 integer,
  mbr_reported_amount_in_local_currency_24 numeric(18,4),
  shpmt_settlement_reference_number_external_25 timestamp with time zone,
  shpmt_adjusted_amount_in_local_currency_26 character varying(255),
  txn_reported_status_code_description_27 character varying(255),
  clm_expiration_reference_number_external_28 numeric(10,2),
  acct_effective_amount_in_local_currency_29 integer,
  mbr_last_modified_date_time_utc_30 numeric(10,2),
  invc_last_modified_reference_number_external_31 timestamp with time zone,
  acct_effective_amount_in_local_currency_32 numeric(10,2),
  clm_effective_indicator_flag_33 boolean,
  invc_reported_reference_number_external_34 numeric(18,4),
  mbr_reported_amount_in_local_currency_35 jsonb,
  pol_settlement_amount_in_local_currency_36 bigint,
  clm_reported_amount_in_local_currency_37 integer,
  pol_settlement_sequence_number_38 date,
  clm_settlement_reference_number_external_39 text,
  acct_adjusted_date_time_utc_40 timestamp with time zone,
  acct_effective_indicator_flag_41 bigint,
  clm_settlement_sequence_number_42 jsonb,
  txn_adjusted_indicator_flag_43 text,
  txn_reported_amount_in_local_currency_44 timestamp with time zone,
  pol_expiration_reference_number_external_45 date,
  acct_last_modified_amount_in_local_currency_46 integer,
  cust_effective_status_code_description_47 jsonb,
  mbr_expiration_date_time_utc_48 character varying(255),
  pol_last_modified_status_code_description_49 date,
  pol_effective_status_code_description_50 numeric(18,4),
  mbr_last_modified_sequence_number_51 date,
  pol_reported_date_time_utc_52 character varying(255),
  mbr_last_modified_sequence_number_53 bigint,
  cust_effective_indicator_flag_54 timestamp with time zone,
  mbr_effective_sequence_number_55 bigint,
  invc_expiration_date_time_utc_56 timestamp with time zone,
  mbr_reported_status_code_description_57 character varying(255),
  pol_last_modified_status_code_description_58 timestamp with time zone
);
