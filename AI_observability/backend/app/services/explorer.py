from __future__ import annotations

from shared.contracts import Dataset, DatasetHealth, PipelineRun, QualityResult, SchemaVersion

from backend.app.api.v1.schemas import DatasetDetail, DatasetPreview
from backend.app.persistence.repository import MetadataRepository
from backend.app.services.lineage import LineageService


_SENSITIVE_PREVIEW_KEYS = ("name", "email", "phone", "address", "token", "secret", "ssn")


class DatasetExplorerService:
    def __init__(self, repository: MetadataRepository, data_provider, lineage: LineageService) -> None:
        self.repository = repository
        self.data_provider = data_provider
        self.lineage = lineage

    def list_datasets(self) -> list[Dataset]:
        return [Dataset.model_validate(payload) for payload in self.repository.list("dataset")]

    def get_dataset(self, dataset_id: str) -> DatasetDetail:
        payload = self.repository.get("dataset", dataset_id)
        if payload is None:
            raise KeyError(f"Unknown dataset: {dataset_id}")
        dataset = Dataset.model_validate(payload)
        all_health = self.repository.list("dataset_health")
        health_payload = next((item for item in all_health if item.get("dataset_id") == dataset_id), None)
        quality_payloads = [
            item for item in self.repository.list("quality_result") if item.get("dataset_id") == dataset_id
        ]
        quality_payloads.sort(key=lambda item: item.get("evaluated_at", ""), reverse=True)
        schema_payloads = [
            item for item in self.repository.list("schema_version") if item.get("dataset_id") == dataset_id
        ]
        run_payloads = [
            item
            for item in self.repository.list("pipeline_run")
            if item.get("pipeline_id")
            == (f"{dataset.source_id}-ingestion" if dataset.source_id else "gold-curation")
        ]
        run_payloads.sort(key=lambda item: item.get("started_at", ""), reverse=True)
        dataset_node = dataset.dataset_id
        graph = self.lineage.get_lineage_graph()
        anchor = dataset_node if dataset_node in {node.node_id for node in graph.nodes} else None
        if anchor is None:
            matching_nodes = [
                node.node_id
                for node in graph.nodes
                if node.node_type == "dataset" and node.node_id.endswith(dataset.dataset_id.split(".", 1)[-1])
            ]
            anchor = matching_nodes[0] if matching_nodes else None
        upstream = self.lineage.get_upstream(anchor) if anchor else []
        downstream = self.lineage.get_downstream(anchor) if anchor else []
        consumers = [node for node in downstream if node.node_type in {"data_product", "ai_product", "report"}]
        return DatasetDetail(
            dataset=dataset,
            platform=self.data_provider.status.value,
            health=DatasetHealth.model_validate(health_payload) if health_payload else None,
            quality=QualityResult.model_validate(quality_payloads[-1]) if quality_payloads else None,
            schema_versions=[SchemaVersion.model_validate(item) for item in schema_payloads],
            last_run=PipelineRun.model_validate(run_payloads[0]) if run_payloads else None,
            upstream=upstream,
            downstream=downstream,
            consumers=consumers,
            row_count=self.data_provider.count_records(dataset_id, latest_batch_only=True),
        )

    def preview(self, dataset_id: str, *, limit: int) -> DatasetPreview:
        if self.repository.get("dataset", dataset_id) is None:
            raise KeyError(f"Unknown dataset: {dataset_id}")
        rows = self.data_provider.get_records(dataset_id, limit=limit, latest_batch_only=True)
        safe_rows = [
            {
                key: value
                for key, value in row.items()
                if not any(fragment in key.lower() for fragment in _SENSITIVE_PREVIEW_KEYS)
            }
            for row in rows
        ]
        return DatasetPreview(
            dataset_id=dataset_id,
            row_count=self.data_provider.count_records(dataset_id, latest_batch_only=True),
            returned_count=len(safe_rows),
            records=safe_rows,
            truncated=len(safe_rows) < self.data_provider.count_records(dataset_id, latest_batch_only=True),
        )
