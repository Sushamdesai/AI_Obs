"""Create application metadata tables."""

from alembic import op
import sqlalchemy as sa

revision = "0001_initial_metadata"
down_revision = None
branch_labels = None
depends_on = None

_TABLES = (
    "sources",
    "datasets",
    "pipelines",
    "pipeline_runs",
    "dataset_health",
    "data_metrics",
    "quality_results",
    "schema_versions",
    "lineage_nodes",
    "lineage_edges",
    "observability_events",
    "incidents",
    "incident_timeline",
    "agent_findings",
    "rca_results",
    "sla_statuses",
    "remediation_plans",
    "verification_results",
)


def upgrade() -> None:
    for table_name in _TABLES:
        op.create_table(
            table_name,
            sa.Column("record_id", sa.String(length=256), primary_key=True),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    for table_name in reversed(_TABLES):
        op.drop_table(table_name)
