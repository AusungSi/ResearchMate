"""add research local canvas and auto run tables

Revision ID: 0009_research_local_canvas_auto
Revises: 0008_research_seed_save_summary
Create Date: 2026-04-16 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0009_research_local_canvas_auto"
down_revision = "0008_research_seed_save_summary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("research_tasks") as batch:
        batch.add_column(sa.Column("mode", sa.String(length=32), nullable=False, server_default="gpt_step"))
        batch.add_column(sa.Column("llm_backend", sa.String(length=32), nullable=False, server_default="gpt"))
        batch.add_column(sa.Column("llm_model", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("auto_status", sa.String(length=32), nullable=False, server_default="idle"))
        batch.add_column(sa.Column("last_checkpoint_id", sa.String(length=128), nullable=True))

    with op.batch_alter_table("research_jobs") as batch:
        batch.alter_column("job_type", type_=sa.String(length=32), existing_type=sa.String(length=16))

    op.create_table(
        "research_canvas_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("research_tasks.id"), nullable=False),
        sa.Column("state_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("task_id", name="uq_research_canvas_state_task"),
    )

    op.create_table(
        "research_run_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("research_tasks.id"), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("run_id", "seq", name="uq_research_run_event_run_seq"),
    )

    op.create_table(
        "research_node_chats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("research_tasks.id"), nullable=False),
        sa.Column("node_id", sa.String(length=128), nullable=False),
        sa.Column("thread_id", sa.String(length=64), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="template"),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("context_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("research_node_chats")
    op.drop_table("research_run_events")
    op.drop_table("research_canvas_state")
    with op.batch_alter_table("research_tasks") as batch:
        batch.drop_column("last_checkpoint_id")
        batch.drop_column("auto_status")
        batch.drop_column("llm_model")
        batch.drop_column("llm_backend")
        batch.drop_column("mode")
