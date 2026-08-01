#!/usr/bin/env python3

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


TEST_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = TEST_DIR.parent
SCRIPT = PLUGIN_ROOT / "scripts" / "workflow_graph.py"
SCHEMA_VERSION = "workflow-graph/v1"
TIMESTAMP = "2026-07-30T12:00:00Z"
NEXT_TIMESTAMP = "2026-07-30T12:01:00Z"


def condition(identifier: str) -> dict:
    return {
        "id": identifier,
        "description": f"{identifier}を満たす",
    }


def version_ref(identifier: str, version: str = "1.0.0") -> dict:
    return {"id": identifier, "version": version}


def project_profile() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "project-profile",
        "id": "baseline-profile",
        "version": "1.0.0",
        "generated_at": TIMESTAMP,
        "resource_refs": [
            {
                "type": "project-rule",
                "id": "baseline-rules",
                "version": "1.0.0",
            },
            {
                "type": "capability",
                "id": "text-processing",
                "version": "1.0.0",
            },
        ],
        "provenance_refs": [version_ref("initialization-input")],
    }


def field(identifier: str) -> dict:
    return {
        "name": identifier,
        "type": "string",
        "required": True,
    }


def artifact_contract(
    identifier: str,
    producer: str | None,
    consumers: list[str],
    payload_field: str,
) -> dict:
    return {
        "id": identifier,
        "version": "1.0.0",
        "producer": producer,
        "consumers": consumers,
        "representation": "inline",
        "fields": [field(payload_field)],
        "validation_conditions": [condition(f"{identifier}-valid")],
    }


def node(
    identifier: str,
    inputs: list[dict],
    outputs: list[dict],
) -> dict:
    return {
        "id": identifier,
        "responsibility": f"{identifier}の責務",
        "inputs": inputs,
        "outputs": outputs,
        "completion_conditions": [condition(f"{identifier}-done")],
        "required_capabilities": [],
    }


def base_catalog() -> dict:
    template = {
        "id": "minimal-flow",
        "version": "1.0.0",
        "fragments": [
            version_ref("produce-fragment"),
            version_ref("consume-fragment"),
        ],
        "artifact_contracts": [
            artifact_contract("request", None, ["produce"], "query"),
            artifact_contract("analysis", "produce", ["consume"], "summary"),
            artifact_contract("result", "consume", [], "outcome"),
        ],
        "edges": [
            {
                "producer": "produce",
                "consumer": "consume",
                "artifact": version_ref("analysis"),
            }
        ],
        "completion_conditions": [condition("graph-done")],
    }
    produce_fragment = {
        "id": "produce-fragment",
        "version": "1.0.0",
        "nodes": [
            node(
                "produce",
                [version_ref("request")],
                [version_ref("analysis")],
            )
        ],
        "edges": [],
    }
    consume_fragment = {
        "id": "consume-fragment",
        "version": "1.0.0",
        "nodes": [
            node(
                "consume",
                [version_ref("analysis")],
                [version_ref("result")],
            )
        ],
        "edges": [],
    }
    unused_fragment = {
        "id": "produce-fragment",
        "version": "2.0.0",
        "nodes": [node("unused", [], [])],
        "edges": [],
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "catalog",
        "templates": [template],
        "fragments": [
            produce_fragment,
            consume_fragment,
            unused_fragment,
        ],
    }


def base_goal() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "goal-contract",
        "id": "test-goal",
        "objective": "Phase 1 Coreを検証する",
        "scope": ["テスト対象だけを変更する"],
        "completion_conditions": [condition("goal-done")],
        "prohibitions": [],
        "human_gate_boundaries": [],
        "project_rule_refs": [],
        "adapter_refs": [],
    }


def condition_result(identifier: str, passed: bool = True) -> dict:
    return {
        "condition_id": identifier,
        "passed": passed,
        "evidence": [f"{identifier}-evidence"],
    }


def inline_artifact(
    identifier: str,
    contract_id: str,
    producer: str | None,
    payload_name: str,
    payload_value: str,
    condition_id: str,
    *,
    passed: bool = True,
    run_id: str | None = "source-run",
    created_at: str = TIMESTAMP,
    artifact_ids: list[str] | None = None,
) -> dict:
    return {
        "id": identifier,
        "contract": version_ref(contract_id),
        "producer": producer,
        "created_at": created_at,
        "provenance": {
            "run_id": run_id,
            "artifact_ids": artifact_ids if artifact_ids is not None else [],
            "summary": "テスト用Artifact",
        },
        "payload": {payload_name: payload_value},
        "validation": {
            "passed": passed,
            "condition_results": [
                condition_result(condition_id, passed=passed)
            ],
        },
    }


def artifact_set(artifact: dict) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "artifact-set",
        "artifacts": [artifact],
    }


def event(name: str, occurred_at: str, **values: object) -> dict:
    result = {
        "schema_version": SCHEMA_VERSION,
        "kind": "transition-event",
        "event": name,
        "occurred_at": occurred_at,
    }
    result.update(values)
    return result


def block_report() -> dict:
    return {
        "id": "block-one",
        "fingerprint": "capability-gap:write",
        "category": "capability-gap",
        "attempted_operation": "成果物を書き込む",
        "evidence": ["capability-check"],
        "goal_impact": "Nodeを開始できない",
        "safe_workaround": "利用可能な入力だけを保持する",
        "permanent_option": "Project Rule側でCapabilityを見直す",
        "unblock_condition": "必要なCapabilityが利用可能になる",
    }


def resolution_report(*, block_id: str = "block-one", passed: bool = True) -> dict:
    return {
        "id": "resolution-one",
        "block_id": block_id,
        "adopted_action": "限定Capabilityで再実行する",
        "residual_risks": ["同じCapabilityが再び利用不能になる可能性"],
        "resume_node_id": "produce",
        "revalidation_results": [
            {
                "id": "workaround-available",
                "passed": passed,
                "evidence": ["capability-read-back"],
            }
        ],
    }


def failure_report() -> dict:
    return {
        "code": "command-failed",
        "summary": "決定論的処理が失敗した",
        "evidence": ["exit-code:1"],
    }


class WorkflowGraphCliTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(
            prefix="workflow-graph-test."
        )
        self.root = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_json(self, name: str, value: object) -> Path:
        path = self.root / name
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return path

    def read_json(self, path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    def run_cli(
        self,
        *arguments: object,
        expected_status: int = 0,
    ) -> subprocess.CompletedProcess:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *(str(item) for item in arguments)],
            cwd=PLUGIN_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            expected_status,
            result.returncode,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        return result

    def resolve(self, catalog: dict | None = None, name: str = "resolved.json") -> Path:
        catalog_path = self.write_json(
            f"{name}.catalog.json",
            catalog if catalog is not None else base_catalog(),
        )
        resolved_path = self.root / name
        self.run_cli(
            "resolve",
            "--catalog",
            catalog_path,
            "--template-id",
            "minimal-flow",
            "--template-version",
            "1.0.0",
            "--output",
            resolved_path,
        )
        return resolved_path

    def materialize(
        self,
        *,
        initial_artifact: dict | None,
        name: str = "state.json",
        run_id: str = "run-one",
        parent_run_id: str | None = None,
        remediation_depth: int = 0,
    ) -> Path:
        resolved_path = self.resolve(name=f"{name}.resolved.json")
        goal_path = self.write_json(f"{name}.goal.json", base_goal())
        state_path = self.root / name
        arguments: list[object] = [
            "materialize",
            "--goal",
            goal_path,
            "--resolved",
            resolved_path,
            "--run-id",
            run_id,
            "--created-at",
            TIMESTAMP,
            "--state",
            state_path,
        ]
        if initial_artifact is not None:
            artifacts_path = self.write_json(
                f"{name}.artifacts.json",
                artifact_set(initial_artifact),
            )
            arguments.extend(["--artifacts", artifacts_path])
        if parent_run_id is not None:
            arguments.extend(["--parent-run-id", parent_run_id])
        if remediation_depth:
            arguments.extend(["--remediation-depth", remediation_depth])
        self.run_cli(*arguments)
        return state_path

    def transition(
        self,
        state_path: Path,
        transition_event: dict,
        *,
        name: str,
        expected_status: int = 0,
    ) -> subprocess.CompletedProcess:
        event_path = self.write_json(f"{name}.event.json", transition_event)
        return self.run_cli(
            "transition",
            "--state",
            state_path,
            "--event",
            event_path,
            expected_status=expected_status,
        )

    def test_project_profile_validates_minimal_generic_contract(self) -> None:
        profile_path = self.write_json("profile.json", project_profile())
        result = self.run_cli("validate", profile_path)
        self.assertEqual("valid=project-profile\n", result.stdout)

    def test_project_profile_rejects_invalid_references(self) -> None:
        unknown_field = project_profile()
        unknown_field["extra"] = True

        duplicate_resource = project_profile()
        duplicate_resource["resource_refs"].append(
            copy.deepcopy(duplicate_resource["resource_refs"][0])
        )

        invalid_type = project_profile()
        invalid_type["resource_refs"][0]["type"] = "unknown-resource"

        missing_project_rule = project_profile()
        missing_project_rule["resource_refs"] = [
            ref for ref in missing_project_rule["resource_refs"]
            if ref["type"] != "project-rule"
        ]

        invalid_provenance = project_profile()
        invalid_provenance["provenance_refs"] = []

        cases = {
            "unknown-field": (unknown_field, "未知field"),
            "duplicate-resource": (duplicate_resource, "重複参照"),
            "invalid-type": (invalid_type, "未対応"),
            "missing-project-rule": (missing_project_rule, "Project Rule"),
            "invalid-provenance": (invalid_provenance, "1件以上"),
        }
        for name, (document, expected_error) in cases.items():
            with self.subTest(name=name):
                path = self.write_json(f"{name}.json", document)
                result = self.run_cli("validate", path, expected_status=3)
                self.assertIn(expected_error, result.stderr)

    def test_exact_resolution_is_deterministic_and_pins_versions(self) -> None:
        first_path = self.resolve(name="first.json")
        reordered = base_catalog()
        reordered["fragments"].reverse()
        second_path = self.resolve(reordered, name="second.json")

        self.assertEqual(
            first_path.read_bytes(),
            second_path.read_bytes(),
        )
        resolved = self.read_json(first_path)
        self.assertEqual(
            [
                {"id": "produce-fragment", "version": "1.0.0"},
                {"id": "consume-fragment", "version": "1.0.0"},
            ],
            resolved["fragments"],
        )
        self.assertRegex(
            resolved["definition_digest"],
            r"^sha256:[0-9a-f]{64}$",
        )

        catalog = base_catalog()
        catalog["templates"][0]["fragments"][0]["version"] = "9.0.0"
        catalog_path = self.write_json("missing.json", catalog)
        result = self.run_cli(
            "resolve",
            "--catalog",
            catalog_path,
            "--template-id",
            "minimal-flow",
            "--template-version",
            "1.0.0",
            expected_status=3,
        )
        self.assertIn("exact version", result.stderr)

    def test_invalid_definition_and_cycle_are_rejected(self) -> None:
        catalog = base_catalog()
        catalog["unexpected"] = True
        catalog_path = self.write_json("unknown.json", catalog)
        result = self.run_cli(
            "validate",
            catalog_path,
            expected_status=3,
        )
        self.assertIn("未知field", result.stderr)

        cyclic = base_catalog()
        produce = cyclic["fragments"][0]["nodes"][0]
        produce["inputs"].append(version_ref("result"))
        result_contract = cyclic["templates"][0]["artifact_contracts"][2]
        result_contract["consumers"].append("produce")
        cyclic["templates"][0]["edges"].append(
            {
                "producer": "consume",
                "consumer": "produce",
                "artifact": version_ref("result"),
            }
        )
        cyclic_path = self.write_json("cyclic.json", cyclic)
        result = self.run_cli(
            "resolve",
            "--catalog",
            cyclic_path,
            "--template-id",
            "minimal-flow",
            "--template-version",
            "1.0.0",
            expected_status=3,
        )
        self.assertIn("cycle", result.stderr)

    def test_readiness_requires_a_validated_input_artifact(self) -> None:
        no_input_state = self.read_json(
            self.materialize(initial_artifact=None, name="no-input.json")
        )
        self.assertEqual(
            {"produce": "pending", "consume": "pending"},
            {
                item["node_id"]: item["status"]
                for item in no_input_state["nodes"]
            },
        )
        self.assertEqual("pending", no_input_state["run"]["status"])

        unvalidated = inline_artifact(
            "request-one",
            "request",
            None,
            "query",
            "調査する",
            "request-valid",
            passed=False,
        )
        unvalidated_state = self.read_json(
            self.materialize(
                initial_artifact=unvalidated,
                name="unvalidated.json",
            )
        )
        self.assertEqual("pending", unvalidated_state["nodes"][0]["status"])

        validated = copy.deepcopy(unvalidated)
        validated["validation"]["passed"] = True
        validated["validation"]["condition_results"][0]["passed"] = True
        validated_state = self.read_json(
            self.materialize(
                initial_artifact=validated,
                name="validated.json",
            )
        )
        statuses = {
            item["node_id"]: item["status"]
            for item in validated_state["nodes"]
        }
        self.assertEqual("ready", statuses["produce"])
        self.assertEqual("pending", statuses["consume"])
        self.assertEqual("ready", validated_state["run"]["status"])

    def test_materialize_refuses_to_overwrite_existing_state(self) -> None:
        request = inline_artifact(
            "request-one",
            "request",
            None,
            "query",
            "調査する",
            "request-valid",
        )
        state_path = self.materialize(
            initial_artifact=request,
            name="existing-state.json",
        )
        original = state_path.read_bytes()
        resolved_path = self.resolve(name="overwrite-resolved.json")
        goal_path = self.write_json("overwrite-goal.json", base_goal())

        result = self.run_cli(
            "materialize",
            "--goal",
            goal_path,
            "--resolved",
            resolved_path,
            "--run-id",
            "run-two",
            "--created-at",
            NEXT_TIMESTAMP,
            "--state",
            state_path,
            expected_status=3,
        )

        self.assertIn("既存Run state", result.stderr)
        self.assertEqual(original, state_path.read_bytes())

    def test_output_validation_gates_success_and_unlocks_consumer(self) -> None:
        request = inline_artifact(
            "request-one",
            "request",
            None,
            "query",
            "調査する",
            "request-valid",
        )
        state_path = self.materialize(
            initial_artifact=request,
            name="lifecycle.json",
        )
        self.transition(
            state_path,
            event("start-node", NEXT_TIMESTAMP, node_id="produce"),
            name="start-produce",
        )

        invalid_output = inline_artifact(
            "analysis-one",
            "analysis",
            "produce",
            "summary",
            "結果",
            "analysis-valid",
            passed=False,
            run_id="run-one",
            created_at=NEXT_TIMESTAMP,
            artifact_ids=["request-one"],
        )
        invalid_event = event(
            "succeed-node",
            NEXT_TIMESTAMP,
            node_id="produce",
            artifacts=[invalid_output],
            completion_results=[condition_result("produce-done")],
        )
        before = state_path.read_bytes()
        result = self.transition(
            state_path,
            invalid_event,
            name="invalid-success",
            expected_status=3,
        )
        self.assertIn("検証済みArtifact", result.stderr)
        self.assertEqual(before, state_path.read_bytes())

        valid_output = copy.deepcopy(invalid_output)
        valid_output["validation"]["passed"] = True
        valid_output["validation"]["condition_results"][0]["passed"] = True
        self.transition(
            state_path,
            event(
                "succeed-node",
                NEXT_TIMESTAMP,
                node_id="produce",
                artifacts=[valid_output],
                completion_results=[condition_result("produce-done")],
            ),
            name="valid-success",
        )
        state = self.read_json(state_path)
        statuses = {
            item["node_id"]: item["status"] for item in state["nodes"]
        }
        self.assertEqual("succeeded", statuses["produce"])
        self.assertEqual("ready", statuses["consume"])

    def test_output_provenance_is_checked_on_transition_and_load(self) -> None:
        request = inline_artifact(
            "request-one",
            "request",
            None,
            "query",
            "調査する",
            "request-valid",
        )
        state_path = self.materialize(
            initial_artifact=request,
            name="provenance.json",
        )
        self.transition(
            state_path,
            event("start-node", NEXT_TIMESTAMP, node_id="produce"),
            name="provenance-start",
        )
        output = inline_artifact(
            "analysis-one",
            "analysis",
            "produce",
            "summary",
            "結果",
            "analysis-valid",
            run_id="run-one",
            created_at=NEXT_TIMESTAMP,
            artifact_ids=["missing-artifact"],
        )
        missing_id_event = event(
            "succeed-node",
            NEXT_TIMESTAMP,
            node_id="produce",
            artifacts=[output],
            completion_results=[condition_result("produce-done")],
        )
        before = state_path.read_bytes()
        result = self.transition(
            state_path,
            missing_id_event,
            name="provenance-missing-id",
            expected_status=3,
        )
        self.assertIn("存在しないArtifact ID", result.stderr)
        self.assertEqual(before, state_path.read_bytes())

        output["provenance"]["artifact_ids"] = []
        result = self.transition(
            state_path,
            missing_id_event,
            name="provenance-missing-input",
            expected_status=3,
        )
        self.assertIn("Node入力Artifactが必要", result.stderr)
        self.assertEqual(before, state_path.read_bytes())

        output["provenance"]["artifact_ids"] = ["request-one"]
        self.transition(
            state_path,
            missing_id_event,
            name="provenance-valid",
        )
        state = self.read_json(state_path)
        state["artifacts"][1]["provenance"]["artifact_ids"] = []
        tampered_path = self.write_json("provenance-tampered.json", state)
        result = self.run_cli(
            "validate",
            tampered_path,
            expected_status=3,
        )
        self.assertIn("Node入力Artifactが必要", result.stderr)

    def test_blocked_failed_and_round_trip_remain_distinct(self) -> None:
        request = inline_artifact(
            "request-one",
            "request",
            None,
            "query",
            "調査する",
            "request-valid",
        )
        blocked_path = self.materialize(
            initial_artifact=request,
            name="blocked.json",
        )
        self.transition(
            blocked_path,
            event(
                "block-node",
                NEXT_TIMESTAMP,
                node_id="produce",
                block=block_report(),
            ),
            name="block",
        )
        blocked = self.read_json(blocked_path)
        blocked_node = next(
            item for item in blocked["nodes"] if item["node_id"] == "produce"
        )
        self.assertEqual("blocked", blocked_node["status"])
        self.assertEqual("capability-gap", blocked_node["detail"]["category"])

        failed_path = self.materialize(
            initial_artifact=request,
            name="failed.json",
        )
        self.transition(
            failed_path,
            event("start-node", NEXT_TIMESTAMP, node_id="produce"),
            name="start-failed",
        )
        self.transition(
            failed_path,
            event(
                "fail-node",
                NEXT_TIMESTAMP,
                node_id="produce",
                failure=failure_report(),
            ),
            name="fail",
        )
        failed = self.read_json(failed_path)
        failed_node = next(
            item for item in failed["nodes"] if item["node_id"] == "produce"
        )
        self.assertEqual("failed", failed_node["status"])
        self.assertNotIn("category", failed_node["detail"])

        show = self.run_cli("show", "--state", blocked_path)
        self.assertEqual(blocked_path.read_text(encoding="utf-8"), show.stdout)
        self.run_cli("validate", blocked_path)
        temporary_files = list(
            blocked_path.parent.glob(".workflow-graph-*.tmp")
        )
        self.assertEqual([], temporary_files)

    def test_block_resolution_resumes_node_and_preserves_history(self) -> None:
        request = inline_artifact(
            "request-one",
            "request",
            None,
            "query",
            "調査する",
            "request-valid",
        )
        state_path = self.materialize(
            initial_artifact=request,
            name="resolution.json",
        )
        self.transition(
            state_path,
            event("start-node", NEXT_TIMESTAMP, node_id="produce"),
            name="resolution-start",
        )
        self.transition(
            state_path,
            event(
                "block-node",
                NEXT_TIMESTAMP,
                node_id="produce",
                block=block_report(),
            ),
            name="resolution-block",
        )

        before = state_path.read_bytes()
        for name, report, expected_error in [
            (
                "wrong-block",
                resolution_report(block_id="other-block"),
                "現在のBlock",
            ),
            (
                "failed-revalidation",
                resolution_report(passed=False),
                "passed=true",
            ),
        ]:
            with self.subTest(name=name):
                result = self.transition(
                    state_path,
                    event(
                        "resolve-node",
                        NEXT_TIMESTAMP,
                        node_id="produce",
                        resolution=report,
                    ),
                    name=name,
                    expected_status=3,
                )
                self.assertIn(expected_error, result.stderr)
                self.assertEqual(before, state_path.read_bytes())

        self.transition(
            state_path,
            event(
                "resolve-node",
                NEXT_TIMESTAMP,
                node_id="produce",
                resolution=resolution_report(),
            ),
            name="resolution-valid",
        )
        resolved = self.read_json(state_path)
        node = next(
            item for item in resolved["nodes"] if item["node_id"] == "produce"
        )
        self.assertEqual("ready", node["status"])
        self.assertEqual(1, node["attempt"])
        self.assertIsNone(node["detail"])
        self.assertEqual(
            "block-one",
            node["resolution_history"][0]["block"]["id"],
        )
        self.assertEqual(
            "resolution-one",
            node["resolution_history"][0]["resolution"]["id"],
        )

        self.transition(
            state_path,
            event("start-node", NEXT_TIMESTAMP, node_id="produce"),
            name="resolution-restart",
        )
        restarted = self.read_json(state_path)
        restarted_node = next(
            item for item in restarted["nodes"] if item["node_id"] == "produce"
        )
        self.assertEqual(2, restarted_node["attempt"])

        duplicate = self.transition(
            state_path,
            event(
                "block-node",
                NEXT_TIMESTAMP,
                node_id="produce",
                block=block_report(),
            ),
            name="resolution-duplicate-block",
            expected_status=3,
        )
        self.assertIn("再利用不可", duplicate.stderr)

        output = inline_artifact(
            "analysis-one",
            "analysis",
            "produce",
            "summary",
            "結果",
            "analysis-valid",
            run_id="run-one",
            created_at=NEXT_TIMESTAMP,
            artifact_ids=["request-one"],
        )
        self.transition(
            state_path,
            event(
                "succeed-node",
                NEXT_TIMESTAMP,
                node_id="produce",
                artifacts=[output],
                completion_results=[condition_result("produce-done")],
            ),
            name="resolution-success",
        )
        self.run_cli("validate", state_path)

    def test_related_run_records_parent_and_remediation_depth(self) -> None:
        main_path = self.materialize(
            initial_artifact=None,
            name="related-main.json",
        )
        main = self.read_json(main_path)
        self.assertIsNone(main["parent_run_id"])
        self.assertEqual(0, main["remediation_depth"])
        self.assertEqual([], main["related_runs"])

        related_event = event(
            "register-related-run",
            NEXT_TIMESTAMP,
            related_run_id="remediation-one",
        )
        self.transition(
            main_path,
            related_event,
            name="register-related",
        )
        registered = self.read_json(main_path)
        self.assertEqual(
            ["remediation-one"],
            registered["related_runs"],
        )

        for name, transition_event, expected_error in [
            ("duplicate-related", related_event, "重複"),
            (
                "self-related",
                event(
                    "register-related-run",
                    NEXT_TIMESTAMP,
                    related_run_id="run-one",
                ),
                "自身",
            ),
        ]:
            with self.subTest(name=name):
                result = self.transition(
                    main_path,
                    transition_event,
                    name=name,
                    expected_status=3,
                )
                self.assertIn(expected_error, result.stderr)

        child_path = self.materialize(
            initial_artifact=None,
            name="related-child.json",
            run_id="remediation-one",
            parent_run_id="run-one",
            remediation_depth=1,
        )
        child = self.read_json(child_path)
        self.assertEqual("run-one", child["parent_run_id"])
        self.assertEqual(1, child["remediation_depth"])

        legacy = copy.deepcopy(child)
        del legacy["parent_run_id"]
        del legacy["remediation_depth"]
        del legacy["related_runs"]
        for node in legacy["nodes"]:
            del node["resolution_history"]
        legacy_path = self.write_json("legacy-state.json", legacy)
        self.run_cli("validate", legacy_path)

    def test_materialized_state_freezes_graph_and_rejects_payload_extras(self) -> None:
        request = inline_artifact(
            "request-one",
            "request",
            None,
            "query",
            "調査する",
            "request-valid",
        )
        state_path = self.materialize(
            initial_artifact=request,
            name="frozen.json",
        )
        state = self.read_json(state_path)
        original_digest = state["graph"]["definition_digest"]

        catalog = base_catalog()
        catalog["templates"][0]["version"] = "1.1.0"
        self.write_json("changed-catalog.json", catalog)
        reloaded = self.read_json(state_path)
        self.assertEqual(original_digest, reloaded["graph"]["definition_digest"])
        self.assertEqual("1.0.0", reloaded["graph"]["template"]["version"])

        request_with_secret = copy.deepcopy(request)
        request_with_secret["payload"]["token"] = "not-stored"
        result = self.run_cli(
            "materialize",
            "--goal",
            self.write_json("secret-goal.json", base_goal()),
            "--resolved",
            self.resolve(name="secret-resolved.json"),
            "--run-id",
            "run-secret",
            "--created-at",
            TIMESTAMP,
            "--artifacts",
            self.write_json(
                "secret-artifacts.json",
                artifact_set(request_with_secret),
            ),
            "--state",
            self.root / "secret-state.json",
            expected_status=3,
        )
        self.assertIn("Contract未定義field", result.stderr)

    def test_full_success_requires_node_and_goal_validation(self) -> None:
        request = inline_artifact(
            "request-one",
            "request",
            None,
            "query",
            "調査する",
            "request-valid",
        )
        state_path = self.materialize(
            initial_artifact=request,
            name="complete.json",
        )
        self.transition(
            state_path,
            event("start-node", NEXT_TIMESTAMP, node_id="produce"),
            name="complete-start-produce",
        )
        analysis = inline_artifact(
            "analysis-one",
            "analysis",
            "produce",
            "summary",
            "分析結果",
            "analysis-valid",
            run_id="run-one",
            created_at=NEXT_TIMESTAMP,
            artifact_ids=["request-one"],
        )
        self.transition(
            state_path,
            event(
                "succeed-node",
                NEXT_TIMESTAMP,
                node_id="produce",
                artifacts=[analysis],
                completion_results=[condition_result("produce-done")],
            ),
            name="complete-produce",
        )
        self.transition(
            state_path,
            event("start-node", NEXT_TIMESTAMP, node_id="consume"),
            name="complete-start-consume",
        )
        result_artifact = inline_artifact(
            "result-one",
            "result",
            "consume",
            "outcome",
            "完了",
            "result-valid",
            run_id="run-one",
            created_at=NEXT_TIMESTAMP,
            artifact_ids=["analysis-one"],
        )
        self.transition(
            state_path,
            event(
                "succeed-node",
                NEXT_TIMESTAMP,
                node_id="consume",
                artifacts=[result_artifact],
                completion_results=[condition_result("consume-done")],
            ),
            name="complete-consume",
        )
        self.transition(
            state_path,
            event(
                "succeed-run",
                NEXT_TIMESTAMP,
                goal_completion_results=[condition_result("goal-done")],
                graph_completion_results=[condition_result("graph-done")],
            ),
            name="complete-run",
        )
        state = self.read_json(state_path)
        self.assertEqual("succeeded", state["run"]["status"])

        canonical = state_path.read_bytes()
        self.assertTrue(canonical.endswith(b"\n"))
        self.assertEqual(
            (
                json.dumps(
                    state,
                    ensure_ascii=False,
                    sort_keys=True,
                    indent=2,
                )
                + "\n"
            ).encode("utf-8"),
            canonical,
        )


if __name__ == "__main__":
    unittest.main()
