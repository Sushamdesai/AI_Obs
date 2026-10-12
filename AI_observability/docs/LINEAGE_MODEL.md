# Lineage Model

## Graph model

The platform uses a directed dependency graph. Core node types:

- `source`
- `ingestion`
- `pipeline`
- `job`
- `dataset`
- `quality_check`
- `transformation`
- `feature`
- `data_product`
- `ai_product`
- `report`

## Relationships

- `source -> ingestion`
- `ingestion -> dataset`
- `dataset -> transformation`
- `transformation -> dataset`
- `dataset -> data_product`
- `dataset -> feature`
- `feature -> ai_product`

## Deterministic motor fixture

The `GET /api/v1/dev/lineage` fixture contains these independent source pipelines:

- Claims -> Claims Ingestion -> Claims Schema -> Claims Quality -> Bronze Claims -> Silver Claims
- Policy -> Policy Ingestion -> Policy Quality -> Silver Policy
- Customer CRM -> Customer Ingestion -> Customer Quality -> Silver Customer
- Payments -> Payment Ingestion -> Payment Quality -> Silver Payments
- Bureau -> File Landing -> Bureau Quality -> Risk Features
- Telematics -> Stream Ingestion -> Telematics Quality -> Driving Features

The graph then converges into Claims Analytics, Customer 360, and Feature Store; Feature Store feeds Fraud/Risk Scoring. Nodes and edges use `LineageNode` and `LineageEdge` contracts and have stable IDs for downstream DAG consumers.

## Graph operations

The eventual lineage engine must support:

- `get_upstream(node)`
- `get_downstream(node)`
- `get_paths(source, target)`
- `calculate_blast_radius(node)`

## UI expectation

The lineage DAG is the primary experience. It should be the hero surface for exploring health, dependency risk, and downstream impact.
