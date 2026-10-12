-- Safe, idempotent, additive setup for the InsuraObserve AI POC.
-- Review and execute explicitly in a Databricks SQL warehouse; the application
-- never runs setup or destructive DDL automatically.
CREATE CATALOG IF NOT EXISTS insurance_observability;
USE CATALOG insurance_observability;

CREATE SCHEMA IF NOT EXISTS bronze;
CREATE SCHEMA IF NOT EXISTS silver;
CREATE SCHEMA IF NOT EXISTS gold;

CREATE TABLE IF NOT EXISTS bronze.claims (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    ingested_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS bronze.policies (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    ingested_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS bronze.customers (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    ingested_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS bronze.payments (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    ingested_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS bronze.bureau (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    ingested_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS bronze.telematics (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    ingested_at TIMESTAMP
) USING DELTA;

CREATE TABLE IF NOT EXISTS silver.claims (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    processed_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS silver.policies (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    processed_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS silver.customers (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    processed_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS silver.payments (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    processed_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS silver.bureau (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    processed_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS silver.telematics (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    processed_at TIMESTAMP
) USING DELTA;

CREATE TABLE IF NOT EXISTS gold.claims_analytics (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    produced_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS gold.customer_360 (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    produced_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS gold.fraud_features (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    produced_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS gold.risk_scoring (
    record_id STRING,
    batch_id STRING,
    line_of_business STRING,
    payload_json STRING,
    produced_at TIMESTAMP
) USING DELTA;
