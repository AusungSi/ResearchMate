"""add research task tables

Revision ID: 0004_research_core
Revises: 0003_reminder_source
Create Date: 2026-03-03 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_research_core"
down_revision = "0003_reminder_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "research_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("topic", sa.Text(), nullable=False),
        sa.Column("constraints_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "research_directions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("research_tasks.id"), nullable=False),
        sa.Column("direction_index", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("queries_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("exclude_terms_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("papers_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("task_id", "direction_index", name="uq_research_direction_task_idx"),
    )

    op.create_table(
        "research_papers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("research_tasks.id"), nullable=False),
        sa.Column("direction_id", sa.Integer(), sa.ForeignKey("research_directions.id"), nullable=False),
        sa.Column("paper_id", sa.String(length=128), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("title_norm", sa.String(length=512), nullable=False),
        sa.Column("authors_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("venue", sa.String(length=255), nullable=True),
        sa.Column("doi", sa.String(length=255), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("abstract", sa.Text(), nullable=True),
        sa.Column("method_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("relevance_score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("task_id", "doi", name="uq_research_paper_task_doi"),
        sa.UniqueConstraint("task_id", "title_norm", name="uq_research_paper_task_title_norm"),
    )

    op.create_table(
        "research_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("research_tasks.id"), nullable=False),
        sa.Column("job_type", sa.String(length=6), nullable=False),
        sa.Column("status", sa.String(length=7), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "research_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("active_task_id", sa.String(length=64), nullable=True),
        sa.Column("active_direction_index", sa.Integer(), nullable=True),
        sa.Column("page", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("page_size", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", name="uq_research_sessions_user"),
    )


def downgrade() -> None:
    op.drop_table("research_sessions")
    op.drop_table("research_jobs")
    op.drop_table("research_papers")
    op.drop_table("research_directions")
    op.drop_table("research_tasks")
