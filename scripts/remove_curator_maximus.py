"""Detach Maximus_AXE's students after deploying the curator list change.

Run from the project root: python3 scripts/remove_curator_maximus.py
"""

import sqlite3
from datetime import datetime
from pathlib import Path


root = Path(__file__).resolve().parent.parent
db_path = root / "database.db"
backup_path = root / f"database.before-remove-maximus-{datetime.now():%Y%m%d-%H%M%S}.db"

with sqlite3.connect(db_path, timeout=30) as db:
    db.row_factory = sqlite3.Row
    with sqlite3.connect(backup_path) as backup:
        db.backup(backup)
    print(f"Резервная копия: {backup_path}")

    try:
        db.execute("BEGIN IMMEDIATE")
        curator = db.execute(
            "SELECT username FROM users WHERE user_id = ?", (5803865978,)
        ).fetchone()
        if not curator or curator["username"].lower() != "maximus_axe":
            raise RuntimeError("Telegram ID не принадлежит Maximus_AXE; изменений нет")

        students = db.execute(
            "SELECT COUNT(*) FROM users WHERE LOWER(curator) = 'maximus_axe'"
        ).fetchone()[0]
        db.execute(
            "UPDATE users SET curator = NULL, percent = NULL "
            "WHERE LOWER(curator) = 'maximus_axe'"
        )
        db.commit()
        print(f"Отвязано учеников: {students}")
    except Exception:
        db.rollback()
        raise
