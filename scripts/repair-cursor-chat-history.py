#!/usr/bin/env python3
"""
Repair Cursor chat history after the Agents Window migration.

Fixes:
1. Orphaned workspace ID 1781456970291 (no folder path) -> DRVN 2
2. composer.composerHeaders workspaceIdentifier for affected sessions
3. Hidden editor agent sidebar flags reset after update
4. Agent transcript folders copied to the DRVN 2 project slug
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

ORPHAN_WS_ID = "1781456970291"
DRVN2_WS_ID = "355eeeb9e8ad022c8c840ac15975060e"
DRVN_WS_ID = "b0c29ddfd087d7c70296d77b21771db3"
DRVN2_PATH = "/Users/neilbarrow/Desktop/Cursor Projects/DRVN 2"

DRVN2_WORKSPACE = {
    "id": DRVN2_WS_ID,
    "uri": {
        "$mid": 1,
        "fsPath": DRVN2_PATH,
        "external": "file:///Users/neilbarrow/Desktop/Cursor%20Projects/DRVN%202",
        "path": DRVN2_PATH,
        "scheme": "file",
    },
}

ORPHAN_COMPOSER_IDS = {
    "289a6933-a39e-4716-9176-f598a10e03b4",
    "5a4e513a-3957-4c81-af81-fca264508f45",
    "8424d174-c480-4600-a3d8-976decc68969",
    "89c2648b-8eda-40f0-a955-0ee315117b80",
    "c45a5b74-7484-4a0d-8c11-a10e133ebd02",
    "f55d967a-c981-47aa-9856-cd1a37736904",
}

CURSOR_USER = Path.home() / "Library/Application Support/Cursor/User"
GLOBAL_DB = CURSOR_USER / "globalStorage/state.vscdb"
ORPHAN_WS_DIR = CURSOR_USER / f"workspaceStorage/{ORPHAN_WS_ID}"
DRVN2_WS_DIR = CURSOR_USER / f"workspaceStorage/{DRVN2_WS_ID}"
DRVN_WS_DIR = CURSOR_USER / f"workspaceStorage/{DRVN_WS_ID}"
TRANSCRIPTS_SRC = Path.home() / f".cursor/projects/{ORPHAN_WS_ID}/agent-transcripts"
TRANSCRIPTS_DST = Path.home() / ".cursor/projects/Users-neilbarrow-Desktop-Cursor-Projects-DRVN-2/agent-transcripts"


def backup(path: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    dest = backup_dir / path.name
    shutil.copy2(path, dest)
    return dest


def checkpoint(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()


def upsert(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        (key, value),
    )


def repair_global_db(backup_dir: Path) -> dict:
    backup(GLOBAL_DB, backup_dir)
    checkpoint(GLOBAL_DB)

    conn = sqlite3.connect(GLOBAL_DB)
    changes: dict = {"projects_updated": 0, "composers_updated": 0}

    row = conn.execute(
        "SELECT value FROM ItemTable WHERE key='glass.localAgentProjects.v1'"
    ).fetchone()
    if row:
        projects = json.loads(row[0])
        for project in projects:
            ws = project.get("workspace", {})
            if ws.get("id") == ORPHAN_WS_ID and "uri" not in ws:
                project["workspace"] = dict(DRVN2_WORKSPACE)
                changes["projects_updated"] += 1
        upsert(conn, "glass.localAgentProjects.v1", json.dumps(projects))

    row = conn.execute(
        "SELECT value FROM ItemTable WHERE key='composer.composerHeaders'"
    ).fetchone()
    if row:
        data = json.loads(row[0])
        composers = data.get("allComposers", [])
        for composer in composers:
            composer_id = composer.get("composerId")
            wi = composer.get("workspaceIdentifier", {})
            if composer_id in ORPHAN_COMPOSER_IDS or wi.get("id") == ORPHAN_WS_ID:
                composer["workspaceIdentifier"] = dict(DRVN2_WORKSPACE)
                changes["composers_updated"] += 1
        data["allComposers"] = composers
        upsert(conn, "composer.composerHeaders", json.dumps(data))

    conn.commit()
    conn.close()
    checkpoint(GLOBAL_DB)
    return changes


def repair_workspace_db(ws_dir: Path, backup_dir: Path, show_sidebar: bool) -> None:
    db_path = ws_dir / "state.vscdb"
    if not db_path.exists():
        return

    backup(db_path, backup_dir / ws_dir.name)
    checkpoint(db_path)
    conn = sqlite3.connect(db_path)

    if show_sidebar:
        upsert(conn, "workbench.unifiedSidebar.hidden", "false")
        upsert(conn, "workbench.sideBar.hidden", "false")
        upsert(conn, "cursor/agentLayout.sidebarVisible", "true")
        upsert(
            conn,
            "workbench.agentLayoutControl.visibilityState",
            json.dumps({"auxBarVisible": True, "unifiedSidebarVisible": True}),
        )

    row = conn.execute(
        "SELECT value FROM ItemTable WHERE key='composer.composerData'"
    ).fetchone()
    if row and ws_dir.name == DRVN2_WS_ID:
        data = json.loads(row[0])
        ids = set(data.get("selectedComposerIds", []))
        ids.update(ORPHAN_COMPOSER_IDS)
        ids.add("ebdbff28-048f-40c0-9443-22a61f03d1ce")
        data["selectedComposerIds"] = sorted(ids)
        data["lastFocusedComposerIds"] = data.get("lastFocusedComposerIds", [])
        upsert(conn, "composer.composerData", json.dumps(data))

    ide_filter = {
        "sortBy": "updated",
        "statusValues": [],
        "recency": "any_time",
        "showArchived": True,
    }
    upsert(conn, "ideSidebar.filterSettings", json.dumps(ide_filter))
    upsert(conn, "agentSidebar.section.archived.collapsed", "false")

    conn.commit()
    conn.close()
    checkpoint(db_path)


def create_orphan_workspace_json() -> None:
    workspace_json = ORPHAN_WS_DIR / "workspace.json"
    ORPHAN_WS_DIR.mkdir(parents=True, exist_ok=True)
    workspace_json.write_text(
        json.dumps({"folder": f"file://{DRVN2_PATH.replace(' ', '%20')}"}, indent=2)
        + "\n"
    )


def copy_transcripts() -> int:
    if not TRANSCRIPTS_SRC.is_dir():
        return 0
    TRANSCRIPTS_DST.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src in TRANSCRIPTS_SRC.iterdir():
        if not src.is_dir():
            continue
        dst = TRANSCRIPTS_DST / src.name
        if dst.exists():
            continue
        shutil.copytree(src, dst)
        copied += 1
    return copied


def main() -> None:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = Path.home() / f".cursor/chat-history-repair-backup-{stamp}"

    print(f"Backup directory: {backup_dir}")
    global_changes = repair_global_db(backup_dir)
    print(f"Global DB: updated {global_changes['projects_updated']} projects, "
          f"{global_changes['composers_updated']} composer headers")

    repair_workspace_db(DRVN2_WS_DIR, backup_dir, show_sidebar=True)
    repair_workspace_db(DRVN_WS_DIR, backup_dir, show_sidebar=True)
    print("Workspace DBs: sidebar visibility restored, filters updated")

    create_orphan_workspace_json()
    print("Created workspace.json for orphaned workspace ID")

    copied = copy_transcripts()
    print(f"Copied {copied} transcript folders to DRVN 2 project slug")

    print("\nDone. Quit and reopen Cursor (or Developer: Reload Window) for changes to apply.")


if __name__ == "__main__":
    main()
