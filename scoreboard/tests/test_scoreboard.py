"""Tests for the scoreboard service and its scoring rule."""

import pytest

from app import create_app
from scoring import score_shot


@pytest.fixture
def client(tmp_path):
    return create_app(db_path=tmp_path / "test.db", pin="").test_client()


@pytest.fixture
def pin_client(tmp_path):
    return create_app(db_path=tmp_path / "test.db", pin="1234").test_client()


def add_team(client, name, **kw):
    return client.post("/api/teams", json={"name": name}, **kw)


@pytest.mark.parametrize(
    "miss_m,points",
    [(0, 10), (0.0499, 10), (0.05, 9), (-0.05, 9), (0.1, 8), (0.15, 7), (0.45, 1), (0.5, 0), (3.0, 0)],
)
def test_score_shot(miss_m, points):
    assert score_shot(miss_m) == points


def test_pages_are_served(client):
    assert b"Catapult Challenge" in client.get("/").data
    assert b"Referee" in client.get("/referee").data


def test_full_round(client):
    a = add_team(client, "Rockets").get_json()["id"]
    b = add_team(client, "Comets").get_json()["id"]
    r = client.post("/api/shots", json={"team_id": a, "target_cm": 80, "actual_cm": 83})
    assert r.status_code == 201 and r.get_json()["points"] == 10
    client.post("/api/shots", json={"team_id": b, "target_cm": 80, "actual_cm": 95})  # 7 points
    client.post("/api/shots", json={"team_id": b, "target_cm": 120, "actual_cm": 118})  # 10 points

    board = client.get("/api/scoreboard").get_json()
    assert [(t["name"], t["points"], t["shots"]) for t in board["teams"]] == [("Comets", 17, 2), ("Rockets", 10, 1)]
    assert board["teams"][0]["best_miss_cm"] == 2
    assert len(board["recent"]) == 3 and board["recent"][0]["team"] == "Comets"


def test_ties_are_broken_by_best_miss(client):
    a = add_team(client, "A").get_json()["id"]
    b = add_team(client, "B").get_json()["id"]
    client.post("/api/shots", json={"team_id": a, "target_cm": 100, "actual_cm": 104})
    client.post("/api/shots", json={"team_id": b, "target_cm": 100, "actual_cm": 101})
    assert [t["name"] for t in client.get("/api/scoreboard").get_json()["teams"]] == ["B", "A"]


def test_undo_shot_and_remove_team(client):
    a = add_team(client, "Rockets").get_json()["id"]
    shot = client.post("/api/shots", json={"team_id": a, "target_cm": 80, "actual_cm": 80}).get_json()["id"]
    assert client.delete(f"/api/shots/{shot}").status_code == 204
    assert client.delete(f"/api/shots/{shot}").status_code == 404
    client.post("/api/shots", json={"team_id": a, "target_cm": 80, "actual_cm": 80})
    assert client.delete(f"/api/teams/{a}").status_code == 204
    board = client.get("/api/scoreboard").get_json()
    assert board == {"teams": [], "recent": []}  # shots cascade with the team


def test_duplicate_team_names_rejected_case_insensitively(client):
    assert add_team(client, "Rockets").status_code == 201
    r = add_team(client, "rockets")
    assert r.status_code == 409 and "exists" in r.get_json()["error"]


@pytest.mark.parametrize(
    "body",
    [
        {"team_id": 1, "target_cm": "80", "actual_cm": 80},
        {"team_id": 1, "target_cm": 80, "actual_cm": -1},
        {"team_id": 1, "target_cm": 80, "actual_cm": True},
        {"team_id": 99, "target_cm": 80, "actual_cm": 80},
        {"target_cm": 80, "actual_cm": 80},
    ],
)
def test_invalid_shots_rejected(client, body):
    add_team(client, "Rockets")
    r = client.post("/api/shots", json=body)
    assert r.status_code == 400 and "error" in r.get_json()


@pytest.mark.parametrize("name", ["", "   ", "x" * 41])
def test_invalid_team_names_rejected(client, name):
    assert add_team(client, name).status_code == 400


def test_non_json_body_rejected(client):
    r = client.post("/api/teams", data="name=x", content_type="application/x-www-form-urlencoded")
    assert r.status_code == 400


def test_pin_protects_writes_but_not_reads(pin_client):
    assert add_team(pin_client, "Rockets").status_code == 403
    assert add_team(pin_client, "Rockets", headers={"X-Referee-Pin": "nope"}).status_code == 403
    assert add_team(pin_client, "Rockets", headers={"X-Referee-Pin": "1234"}).status_code == 201
    assert pin_client.get("/api/scoreboard").status_code == 200


def test_data_survives_restart(tmp_path):
    db = tmp_path / "persist.db"
    add_team(create_app(db_path=db, pin="").test_client(), "Rockets")
    teams = create_app(db_path=db, pin="").test_client().get("/api/scoreboard").get_json()["teams"]
    assert [t["name"] for t in teams] == ["Rockets"]
