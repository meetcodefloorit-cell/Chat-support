"""merge duplicate admin-operator threads into shared canonical threads

Revision ID: b8f7c2d1e9a4
Revises: a7d9e4c2b1f0
Create Date: 2026-03-27 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8f7c2d1e9a4"
down_revision: Union[str, None] = "a7d9e4c2b1f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _merge_duplicate_conversation_hidden_rows(
    conn: sa.engine.Connection,
    *,
    project_id: int,
    canonical_id: int,
    duplicate_id: int,
) -> None:
    hidden_rows = conn.execute(
        sa.text(
            """
            SELECT id, user_id, hidden_at
            FROM conversation_hidden
            WHERE project_id = :project_id AND conversation_id = :duplicate_id
            """
        ),
        {"project_id": project_id, "duplicate_id": duplicate_id},
    ).mappings().all()

    for row in hidden_rows:
        existing = conn.execute(
            sa.text(
                """
                SELECT id, hidden_at
                FROM conversation_hidden
                WHERE project_id = :project_id
                  AND conversation_id = :canonical_id
                  AND user_id = :user_id
                """
            ),
            {
                "project_id": project_id,
                "canonical_id": canonical_id,
                "user_id": row["user_id"],
            },
        ).mappings().first()

        if existing:
            row_hidden_at = row["hidden_at"]
            existing_hidden_at = existing["hidden_at"]
            if row_hidden_at is not None and (
                existing_hidden_at is None or row_hidden_at > existing_hidden_at
            ):
                conn.execute(
                    sa.text(
                        """
                        UPDATE conversation_hidden
                        SET hidden_at = :hidden_at
                        WHERE id = :existing_id
                        """
                    ),
                    {"hidden_at": row_hidden_at, "existing_id": existing["id"]},
                )
            conn.execute(
                sa.text("DELETE FROM conversation_hidden WHERE id = :row_id"),
                {"row_id": row["id"]},
            )
            continue

        conn.execute(
            sa.text(
                """
                UPDATE conversation_hidden
                SET conversation_id = :canonical_id
                WHERE id = :row_id
                """
            ),
            {"canonical_id": canonical_id, "row_id": row["id"]},
        )


def upgrade() -> None:
    conn = op.get_bind()

    duplicate_groups = conn.execute(
        sa.text(
            """
            SELECT project_id, operator_id, MIN(id) AS canonical_id
            FROM conversations
            WHERE type = 'admin_operator'
            GROUP BY project_id, operator_id
            HAVING COUNT(*) > 1
            """
        )
    ).mappings().all()

    for group in duplicate_groups:
        project_id = int(group["project_id"])
        operator_id = int(group["operator_id"])
        canonical_id = int(group["canonical_id"])

        duplicate_rows = conn.execute(
            sa.text(
                """
                SELECT id
                FROM conversations
                WHERE project_id = :project_id
                  AND type = 'admin_operator'
                  AND operator_id = :operator_id
                  AND id <> :canonical_id
                ORDER BY id ASC
                """
            ),
            {
                "project_id": project_id,
                "operator_id": operator_id,
                "canonical_id": canonical_id,
            },
        ).mappings().all()

        for duplicate_row in duplicate_rows:
            duplicate_id = int(duplicate_row["id"])

            conn.execute(
                sa.text(
                    """
                    UPDATE messages
                    SET conversation_id = :canonical_id
                    WHERE project_id = :project_id
                      AND conversation_id = :duplicate_id
                    """
                ),
                {
                    "canonical_id": canonical_id,
                    "project_id": project_id,
                    "duplicate_id": duplicate_id,
                },
            )

            conn.execute(
                sa.text(
                    """
                    UPDATE notifications
                    SET reference_id = :canonical_id
                    WHERE project_id = :project_id
                      AND reference_id = :duplicate_id
                      AND kind IN ('new_message', 'admin_broadcast')
                    """
                ),
                {
                    "canonical_id": canonical_id,
                    "project_id": project_id,
                    "duplicate_id": duplicate_id,
                },
            )

            _merge_duplicate_conversation_hidden_rows(
                conn,
                project_id=project_id,
                canonical_id=canonical_id,
                duplicate_id=duplicate_id,
            )

            conn.execute(
                sa.text("DELETE FROM conversations WHERE id = :duplicate_id"),
                {"duplicate_id": duplicate_id},
            )

    op.create_index(
        "ix_conversations_admin_operator_unique",
        "conversations",
        ["project_id", "operator_id"],
        unique=True,
        sqlite_where=sa.text("type = 'admin_operator'"),
        postgresql_where=sa.text("type = 'admin_operator'"),
    )


def downgrade() -> None:
    op.drop_index("ix_conversations_admin_operator_unique", table_name="conversations")
