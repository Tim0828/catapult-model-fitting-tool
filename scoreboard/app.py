"""Catapult Challenge scoreboard: a tiny Flask + SQLite service.

This is the only part of the project that needs a backend. The referee enters
shots on /referee, the projector shows / (auto-refreshing). Points are computed
on the server with the same rule as the students' tool (scoring.py).

Run for development:     python scoreboard/app.py
Run in a lesson (Pi):    see docs/HOSTING.md (gunicorn + systemd)

Environment variables:
    SCOREBOARD_DB   path of the SQLite file (default: scoreboard/scoreboard.db)
    SCOREBOARD_PIN  if set, write requests need header X-Referee-Pin with this value
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from flask import Flask, abort, g, jsonify, request, send_from_directory

from scoring import score_shot

HERE = Path(__file__).resolve().parent

SCHEMA = """
CREATE TABLE IF NOT EXISTS teams (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS shots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    target_cm  REAL NOT NULL,
    actual_cm  REAL NOT NULL,
    points     INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

MAX_NAME = 40
MAX_DISTANCE_CM = 10_000


def create_app(db_path: str | os.PathLike | None = None, pin: str | None = None) -> Flask:
    app = Flask(__name__, static_folder=str(HERE / "static"), static_url_path="/static")
    app.config["DB_PATH"] = str(db_path or os.environ.get("SCOREBOARD_DB") or HERE / "scoreboard.db")
    app.config["PIN"] = pin if pin is not None else os.environ.get("SCOREBOARD_PIN") or None

    def db() -> sqlite3.Connection:
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DB_PATH"])
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    with app.app_context():
        db().executescript(SCHEMA)

    def require_referee():
        expected = app.config["PIN"]
        if expected and request.headers.get("X-Referee-Pin") != expected:
            abort(403, description="wrong or missing referee PIN")

    def json_body() -> dict:
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            abort(400, description="expected a JSON object")
        return body

    def number(body: dict, key: str) -> float:
        value = body.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= MAX_DISTANCE_CM:
            abort(400, description=f"{key} must be a number between 0 and {MAX_DISTANCE_CM}")
        return float(value)

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(409)
    def json_error(err):
        return jsonify(error=err.description), err.code

    # Pages ------------------------------------------------------------

    @app.get("/")
    def board_page():
        return send_from_directory(app.static_folder, "board.html")

    @app.get("/referee")
    def referee_page():
        return send_from_directory(app.static_folder, "referee.html")

    # API --------------------------------------------------------------

    @app.get("/api/scoreboard")
    def scoreboard():
        teams = db().execute(
            """
            SELECT t.id, t.name,
                   COALESCE(SUM(s.points), 0) AS points,
                   COUNT(s.id) AS shots,
                   MIN(ABS(s.actual_cm - s.target_cm)) AS best_miss_cm
            FROM teams t LEFT JOIN shots s ON s.team_id = t.id
            GROUP BY t.id
            ORDER BY points DESC, best_miss_cm IS NULL, best_miss_cm ASC, t.name
            """
        ).fetchall()
        recent = db().execute(
            """
            SELECT s.id, t.name AS team, s.target_cm, s.actual_cm, s.points, s.created_at
            FROM shots s JOIN teams t ON t.id = s.team_id
            ORDER BY s.id DESC LIMIT 15
            """
        ).fetchall()
        return jsonify(teams=[dict(r) for r in teams], recent=[dict(r) for r in recent])

    @app.post("/api/teams")
    def add_team():
        require_referee()
        name = str(json_body().get("name", "")).strip()
        if not 0 < len(name) <= MAX_NAME:
            abort(400, description=f"team name must be 1-{MAX_NAME} characters")
        try:
            with db() as conn:
                cur = conn.execute("INSERT INTO teams (name) VALUES (?)", (name,))
        except sqlite3.IntegrityError:
            abort(409, description="a team with this name already exists")
        return jsonify(id=cur.lastrowid, name=name), 201

    @app.delete("/api/teams/<int:team_id>")
    def delete_team(team_id: int):
        require_referee()
        with db() as conn:
            if conn.execute("DELETE FROM teams WHERE id = ?", (team_id,)).rowcount == 0:
                abort(404, description="no such team")
        return "", 204

    @app.post("/api/shots")
    def add_shot():
        require_referee()
        body = json_body()
        team_id = body.get("team_id")
        target = number(body, "target_cm")
        actual = number(body, "actual_cm")
        if not isinstance(team_id, int) or db().execute("SELECT 1 FROM teams WHERE id = ?", (team_id,)).fetchone() is None:
            abort(400, description="unknown team_id")
        points = score_shot((actual - target) / 100)
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO shots (team_id, target_cm, actual_cm, points) VALUES (?, ?, ?, ?)",
                (team_id, target, actual, points),
            )
        return jsonify(id=cur.lastrowid, points=points), 201

    @app.delete("/api/shots/<int:shot_id>")
    def delete_shot(shot_id: int):
        require_referee()
        with db() as conn:
            if conn.execute("DELETE FROM shots WHERE id = ?", (shot_id,)).rowcount == 0:
                abort(404, description="no such shot")
        return "", 204

    return app


if __name__ == "__main__":
    # Development server only; use gunicorn for a lesson (docs/HOSTING.md).
    create_app().run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
