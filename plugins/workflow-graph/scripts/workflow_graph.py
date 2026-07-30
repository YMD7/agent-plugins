#!/usr/bin/env python3

"""Workflow Graph Phase 1の決定論的Core。"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "workflow-graph/v1"
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
FIELD_TYPES = {"string", "integer", "number", "boolean", "string-list"}
PROFILE_RESOURCE_TYPES = {
    "project-rule",
    "template",
    "fragment",
    "skill",
    "script",
    "adapter",
    "capability",
}
NODE_STATUSES = {
    "pending",
    "ready",
    "running",
    "blocked",
    "succeeded",
    "failed",
}
RUN_STATUSES = NODE_STATUSES
BLOCK_CATEGORIES = {
    "project-defect",
    "harness-defect",
    "capability-gap",
    "valid-policy-denial",
    "external-dependency",
    "upstream-limitation",
}


class ValidationError(Exception):
    """入力がWorkflow Graph契約を満たさない場合のエラー。"""


def fail(path: str, message: str) -> None:
    raise ValidationError(f"{path}: {message}")


def expect_object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(path, "objectが必要")
    return value


def expect_list(value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        fail(path, "arrayが必要")
    return value


def expect_string(value: Any, path: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        fail(path, "stringが必要")
    if not allow_empty and not value:
        fail(path, "空文字は使用不可")
    return value


def expect_bool(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        fail(path, "booleanが必要")
    return value


def expect_int(value: Any, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        fail(path, "integerが必要")
    return value


def expect_keys(
    value: dict[str, Any],
    required: set[str],
    optional: set[str],
    path: str,
) -> None:
    missing = sorted(required - value.keys())
    unknown = sorted(value.keys() - required - optional)
    if missing:
        fail(path, f"必須fieldが不足: {','.join(missing)}")
    if unknown:
        fail(path, f"未知field: {','.join(unknown)}")


def expect_id(value: Any, path: str) -> str:
    identifier = expect_string(value, path)
    if len(identifier) > 64 or not ID_PATTERN.fullmatch(identifier):
        fail(path, "64文字以下のlower-kebab IDが必要")
    return identifier


def expect_semver(value: Any, path: str) -> str:
    version = expect_string(value, path)
    if not SEMVER_PATTERN.fullmatch(version):
        fail(path, "完全なSemVerが必要")
    return version


def expect_timestamp(value: Any, path: str) -> str:
    timestamp = expect_string(value, path)
    try:
        datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        fail(path, "UTCのYYYY-MM-DDTHH:MM:SSZ形式が必要")
    return timestamp


def expect_string_list(
    value: Any,
    path: str,
    *,
    allow_empty_items: bool = False,
) -> list[str]:
    items = expect_list(value, path)
    result = [
        expect_string(item, f"{path}[{index}]", allow_empty=allow_empty_items)
        for index, item in enumerate(items)
    ]
    if len(result) != len(set(result)):
        fail(path, "重複値は使用不可")
    return result


def expect_id_list(value: Any, path: str) -> list[str]:
    items = expect_list(value, path)
    result = [expect_id(item, f"{path}[{index}]") for index, item in enumerate(items)]
    if len(result) != len(set(result)):
        fail(path, "重複IDは使用不可")
    return result


def validate_header(value: dict[str, Any], kind: str, path: str) -> None:
    if value.get("schema_version") != SCHEMA_VERSION:
        fail(f"{path}.schema_version", f"{SCHEMA_VERSION}が必要")
    if value.get("kind") != kind:
        fail(f"{path}.kind", f"{kind}が必要")


def validate_version_ref(value: Any, path: str) -> tuple[str, str]:
    ref = expect_object(value, path)
    expect_keys(ref, {"id", "version"}, set(), path)
    return expect_id(ref["id"], f"{path}.id"), expect_semver(
        ref["version"], f"{path}.version"
    )


def version_ref(identifier: str, version: str) -> dict[str, str]:
    return {"id": identifier, "version": version}


def validate_ref_list(value: Any, path: str) -> list[tuple[str, str]]:
    refs = expect_list(value, path)
    result = [
        validate_version_ref(ref, f"{path}[{index}]")
        for index, ref in enumerate(refs)
    ]
    if len(result) != len(set(result)):
        fail(path, "重複参照は使用不可")
    return result


def validate_profile_resource_ref(
    value: Any,
    path: str,
) -> tuple[str, str, str]:
    ref = expect_object(value, path)
    expect_keys(ref, {"type", "id", "version"}, set(), path)
    resource_type = expect_string(ref["type"], f"{path}.type")
    if resource_type not in PROFILE_RESOURCE_TYPES:
        fail(f"{path}.type", "未対応のProject Profile resource type")
    return (
        resource_type,
        expect_id(ref["id"], f"{path}.id"),
        expect_semver(ref["version"], f"{path}.version"),
    )


def validate_project_profile(value: Any, path: str = "$") -> None:
    profile = expect_object(value, path)
    expect_keys(
        profile,
        {
            "schema_version",
            "kind",
            "id",
            "version",
            "generated_at",
            "resource_refs",
            "provenance_refs",
        },
        set(),
        path,
    )
    validate_header(profile, "project-profile", path)
    expect_id(profile["id"], f"{path}.id")
    expect_semver(profile["version"], f"{path}.version")
    expect_timestamp(profile["generated_at"], f"{path}.generated_at")

    refs = expect_list(profile["resource_refs"], f"{path}.resource_refs")
    resource_refs = [
        validate_profile_resource_ref(ref, f"{path}.resource_refs[{index}]")
        for index, ref in enumerate(refs)
    ]
    if len(resource_refs) != len(set(resource_refs)):
        fail(f"{path}.resource_refs", "重複参照は使用不可")
    if not any(ref[0] == "project-rule" for ref in resource_refs):
        fail(f"{path}.resource_refs", "Project Rule参照が1件以上必要")

    provenance_refs = validate_ref_list(
        profile["provenance_refs"],
        f"{path}.provenance_refs",
    )
    if not provenance_refs:
        fail(f"{path}.provenance_refs", "1件以上の出典参照が必要")


def validate_condition(value: Any, path: str) -> str:
    condition = expect_object(value, path)
    expect_keys(condition, {"id", "description"}, set(), path)
    condition_id = expect_id(condition["id"], f"{path}.id")
    expect_string(condition["description"], f"{path}.description")
    return condition_id


def validate_conditions(
    value: Any,
    path: str,
    *,
    require_nonempty: bool = True,
) -> list[str]:
    conditions = expect_list(value, path)
    result = [
        validate_condition(condition, f"{path}[{index}]")
        for index, condition in enumerate(conditions)
    ]
    if require_nonempty and not result:
        fail(path, "1件以上の完了または検証条件が必要")
    if len(result) != len(set(result)):
        fail(path, "重複condition IDは使用不可")
    return result


def validate_results(
    value: Any,
    conditions: list[dict[str, Any]],
    path: str,
    *,
    require_passed: bool,
) -> None:
    results = expect_list(value, path)
    expected_ids = [validate_condition(item, f"{path}.conditions[{index}]")
                    for index, item in enumerate(conditions)]
    actual_ids: list[str] = []
    passed_values: list[bool] = []
    for index, item in enumerate(results):
        result_path = f"{path}[{index}]"
        result = expect_object(item, result_path)
        expect_keys(result, {"condition_id", "passed", "evidence"}, set(), result_path)
        actual_ids.append(expect_id(result["condition_id"], f"{result_path}.condition_id"))
        passed_values.append(expect_bool(result["passed"], f"{result_path}.passed"))
        expect_string_list(
            result["evidence"],
            f"{result_path}.evidence",
            allow_empty_items=False,
        )
    if len(actual_ids) != len(set(actual_ids)):
        fail(path, "重複condition resultは使用不可")
    if sorted(actual_ids) != sorted(expected_ids):
        fail(path, "condition resultが定義と一致しない")
    if require_passed and not all(passed_values):
        fail(path, "全conditionのpassed=trueが必要")


def validate_goal_contract(value: Any, path: str = "$") -> dict[str, Any]:
    goal = expect_object(value, path)
    expect_keys(
        goal,
        {
            "schema_version",
            "kind",
            "id",
            "objective",
            "scope",
            "completion_conditions",
            "prohibitions",
            "human_gate_boundaries",
            "project_rule_refs",
            "adapter_refs",
        },
        set(),
        path,
    )
    validate_header(goal, "goal-contract", path)
    expect_id(goal["id"], f"{path}.id")
    expect_string(goal["objective"], f"{path}.objective")
    if not expect_string_list(goal["scope"], f"{path}.scope"):
        fail(f"{path}.scope", "1件以上必要")
    validate_conditions(goal["completion_conditions"], f"{path}.completion_conditions")
    expect_string_list(goal["prohibitions"], f"{path}.prohibitions")
    expect_string_list(
        goal["human_gate_boundaries"],
        f"{path}.human_gate_boundaries",
    )
    validate_ref_list(goal["project_rule_refs"], f"{path}.project_rule_refs")
    validate_ref_list(goal["adapter_refs"], f"{path}.adapter_refs")
    return goal


def validate_field(value: Any, path: str) -> str:
    field = expect_object(value, path)
    expect_keys(field, {"name", "type", "required"}, set(), path)
    name = expect_id(field["name"], f"{path}.name")
    field_type = expect_string(field["type"], f"{path}.type")
    if field_type not in FIELD_TYPES:
        fail(f"{path}.type", "未対応のfield type")
    expect_bool(field["required"], f"{path}.required")
    return name


def validate_artifact_contract(value: Any, path: str) -> tuple[str, str]:
    contract = expect_object(value, path)
    expect_keys(
        contract,
        {
            "id",
            "version",
            "producer",
            "consumers",
            "representation",
            "fields",
            "validation_conditions",
        },
        set(),
        path,
    )
    identifier = expect_id(contract["id"], f"{path}.id")
    version = expect_semver(contract["version"], f"{path}.version")
    if contract["producer"] is not None:
        expect_id(contract["producer"], f"{path}.producer")
    expect_id_list(contract["consumers"], f"{path}.consumers")
    representation = expect_string(contract["representation"], f"{path}.representation")
    if representation not in {"inline", "reference"}:
        fail(f"{path}.representation", "inlineまたはreferenceが必要")
    fields = expect_list(contract["fields"], f"{path}.fields")
    field_names = [
        validate_field(field, f"{path}.fields[{index}]")
        for index, field in enumerate(fields)
    ]
    if len(field_names) != len(set(field_names)):
        fail(f"{path}.fields", "重複field名は使用不可")
    if representation == "reference" and fields:
        fail(f"{path}.fields", "reference契約ではfieldsを空にする")
    validate_conditions(
        contract["validation_conditions"],
        f"{path}.validation_conditions",
    )
    return identifier, version


def validate_edge(value: Any, path: str) -> tuple[str, str, tuple[str, str]]:
    edge = expect_object(value, path)
    expect_keys(edge, {"producer", "consumer", "artifact"}, set(), path)
    producer = expect_id(edge["producer"], f"{path}.producer")
    consumer = expect_id(edge["consumer"], f"{path}.consumer")
    artifact = validate_version_ref(edge["artifact"], f"{path}.artifact")
    if producer == consumer:
        fail(path, "自己Edgeは使用不可")
    return producer, consumer, artifact


def validate_node(value: Any, path: str) -> str:
    node = expect_object(value, path)
    expect_keys(
        node,
        {
            "id",
            "responsibility",
            "inputs",
            "outputs",
            "completion_conditions",
            "required_capabilities",
        },
        set(),
        path,
    )
    identifier = expect_id(node["id"], f"{path}.id")
    expect_string(node["responsibility"], f"{path}.responsibility")
    validate_ref_list(node["inputs"], f"{path}.inputs")
    validate_ref_list(node["outputs"], f"{path}.outputs")
    validate_conditions(node["completion_conditions"], f"{path}.completion_conditions")
    expect_string_list(
        node["required_capabilities"],
        f"{path}.required_capabilities",
    )
    return identifier


def validate_fragment(value: Any, path: str) -> tuple[str, str]:
    fragment = expect_object(value, path)
    expect_keys(fragment, {"id", "version", "nodes", "edges"}, set(), path)
    identifier = expect_id(fragment["id"], f"{path}.id")
    version = expect_semver(fragment["version"], f"{path}.version")
    nodes = expect_list(fragment["nodes"], f"{path}.nodes")
    node_ids = [
        validate_node(node, f"{path}.nodes[{index}]")
        for index, node in enumerate(nodes)
    ]
    if not node_ids:
        fail(f"{path}.nodes", "1件以上のNodeが必要")
    if len(node_ids) != len(set(node_ids)):
        fail(f"{path}.nodes", "重複Node IDは使用不可")
    edges = expect_list(fragment["edges"], f"{path}.edges")
    edge_keys = [
        validate_edge(edge, f"{path}.edges[{index}]")
        for index, edge in enumerate(edges)
    ]
    if len(edge_keys) != len(set(edge_keys)):
        fail(f"{path}.edges", "重複Edgeは使用不可")
    return identifier, version


def validate_template(value: Any, path: str) -> tuple[str, str]:
    template = expect_object(value, path)
    expect_keys(
        template,
        {
            "id",
            "version",
            "fragments",
            "artifact_contracts",
            "edges",
            "completion_conditions",
        },
        set(),
        path,
    )
    identifier = expect_id(template["id"], f"{path}.id")
    version = expect_semver(template["version"], f"{path}.version")
    if not validate_ref_list(template["fragments"], f"{path}.fragments"):
        fail(f"{path}.fragments", "1件以上のFragment参照が必要")
    contracts = expect_list(template["artifact_contracts"], f"{path}.artifact_contracts")
    contract_refs = [
        validate_artifact_contract(contract, f"{path}.artifact_contracts[{index}]")
        for index, contract in enumerate(contracts)
    ]
    if len(contract_refs) != len(set(contract_refs)):
        fail(f"{path}.artifact_contracts", "重複Artifact Contractは使用不可")
    edges = expect_list(template["edges"], f"{path}.edges")
    edge_keys = [
        validate_edge(edge, f"{path}.edges[{index}]")
        for index, edge in enumerate(edges)
    ]
    if len(edge_keys) != len(set(edge_keys)):
        fail(f"{path}.edges", "重複Edgeは使用不可")
    validate_conditions(
        template["completion_conditions"],
        f"{path}.completion_conditions",
    )
    return identifier, version


def validate_catalog(value: Any, path: str = "$") -> dict[str, Any]:
    catalog = expect_object(value, path)
    expect_keys(
        catalog,
        {"schema_version", "kind", "templates", "fragments"},
        set(),
        path,
    )
    validate_header(catalog, "catalog", path)
    templates = expect_list(catalog["templates"], f"{path}.templates")
    template_refs = [
        validate_template(template, f"{path}.templates[{index}]")
        for index, template in enumerate(templates)
    ]
    if not template_refs:
        fail(f"{path}.templates", "1件以上のTemplateが必要")
    if len(template_refs) != len(set(template_refs)):
        fail(f"{path}.templates", "同じIDとversionのTemplateが重複")
    fragments = expect_list(catalog["fragments"], f"{path}.fragments")
    fragment_refs = [
        validate_fragment(fragment, f"{path}.fragments[{index}]")
        for index, fragment in enumerate(fragments)
    ]
    if len(fragment_refs) != len(set(fragment_refs)):
        fail(f"{path}.fragments", "同じIDとversionのFragmentが重複")
    return catalog


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def canonical_text(value: Any) -> str:
    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
        + "\n"
    )


def digest_value(value: Any) -> str:
    return f"sha256:{hashlib.sha256(canonical_bytes(value)).hexdigest()}"


def digest_resolved(value: dict[str, Any]) -> str:
    body = {key: item for key, item in value.items() if key != "definition_digest"}
    return digest_value(body)


def ensure_acyclic(nodes: list[str], edges: list[tuple[str, str, Any]], path: str) -> None:
    incoming = {node_id: 0 for node_id in nodes}
    outgoing = {node_id: [] for node_id in nodes}
    for producer, consumer, _artifact in edges:
        incoming[consumer] += 1
        outgoing[producer].append(consumer)
    ready = sorted(node_id for node_id, count in incoming.items() if count == 0)
    visited = 0
    while ready:
        current = ready.pop(0)
        visited += 1
        for consumer in sorted(outgoing[current]):
            incoming[consumer] -= 1
            if incoming[consumer] == 0:
                ready.append(consumer)
                ready.sort()
    if visited != len(nodes):
        fail(path, "Phase 1ではcycleを使用不可")


def validate_resolved_graph(
    value: Any,
    path: str = "$",
    *,
    check_digest: bool = True,
) -> dict[str, Any]:
    graph = expect_object(value, path)
    expect_keys(
        graph,
        {
            "schema_version",
            "kind",
            "template",
            "fragments",
            "nodes",
            "edges",
            "artifact_contracts",
            "completion_conditions",
            "definition_digest",
        },
        set(),
        path,
    )
    validate_header(graph, "resolved-graph", path)
    validate_version_ref(graph["template"], f"{path}.template")
    validate_ref_list(graph["fragments"], f"{path}.fragments")
    nodes = expect_list(graph["nodes"], f"{path}.nodes")
    node_ids = [
        validate_node(node, f"{path}.nodes[{index}]")
        for index, node in enumerate(nodes)
    ]
    if not node_ids:
        fail(f"{path}.nodes", "1件以上のNodeが必要")
    if len(node_ids) != len(set(node_ids)):
        fail(f"{path}.nodes", "重複Node IDは使用不可")
    contracts = expect_list(graph["artifact_contracts"], f"{path}.artifact_contracts")
    contract_refs = [
        validate_artifact_contract(contract, f"{path}.artifact_contracts[{index}]")
        for index, contract in enumerate(contracts)
    ]
    if len(contract_refs) != len(set(contract_refs)):
        fail(f"{path}.artifact_contracts", "重複Artifact Contractは使用不可")
    edges = expect_list(graph["edges"], f"{path}.edges")
    edge_keys = [
        validate_edge(edge, f"{path}.edges[{index}]")
        for index, edge in enumerate(edges)
    ]
    if len(edge_keys) != len(set(edge_keys)):
        fail(f"{path}.edges", "重複Edgeは使用不可")
    validate_conditions(
        graph["completion_conditions"],
        f"{path}.completion_conditions",
    )

    node_map = {node["id"]: node for node in nodes}
    contract_map = {
        (contract["id"], contract["version"]): contract
        for contract in contracts
    }
    edge_set = set(edge_keys)

    for node_index, node in enumerate(nodes):
        node_path = f"{path}.nodes[{node_index}]"
        for key in ("inputs", "outputs"):
            for ref_index, ref in enumerate(node[key]):
                ref_key = validate_version_ref(ref, f"{node_path}.{key}[{ref_index}]")
                if ref_key not in contract_map:
                    fail(f"{node_path}.{key}[{ref_index}]", "未解決Artifact Contract参照")

    for contract_index, contract in enumerate(contracts):
        contract_path = f"{path}.artifact_contracts[{contract_index}]"
        ref_key = (contract["id"], contract["version"])
        producer = contract["producer"]
        consumers = contract["consumers"]
        if producer is None:
            if any(edge[2] == ref_key for edge in edge_set):
                fail(contract_path, "Goal入力ArtifactにはEdgeを定義しない")
        else:
            if producer not in node_map:
                fail(f"{contract_path}.producer", "未解決Node参照")
            producer_outputs = {
                validate_version_ref(ref, f"{contract_path}.producer.outputs")
                for ref in node_map[producer]["outputs"]
            }
            if ref_key not in producer_outputs:
                fail(contract_path, "producer NodeのoutputsにContract参照がない")
        for consumer in consumers:
            if consumer not in node_map:
                fail(f"{contract_path}.consumers", "未解決Node参照")
            consumer_inputs = {
                validate_version_ref(ref, f"{contract_path}.consumer.inputs")
                for ref in node_map[consumer]["inputs"]
            }
            if ref_key not in consumer_inputs:
                fail(contract_path, "consumer NodeのinputsにContract参照がない")
            if producer is not None and (producer, consumer, ref_key) not in edge_set:
                fail(contract_path, "producerとconsumerを結ぶEdgeがない")

    for edge_index, (producer, consumer, artifact_ref) in enumerate(edge_keys):
        edge_path = f"{path}.edges[{edge_index}]"
        if producer not in node_map or consumer not in node_map:
            fail(edge_path, "未解決Node参照")
        contract = contract_map.get(artifact_ref)
        if contract is None:
            fail(f"{edge_path}.artifact", "未解決Artifact Contract参照")
        if contract["producer"] != producer or consumer not in contract["consumers"]:
            fail(edge_path, "Artifact Contractのproducer/consumerと不一致")

    ensure_acyclic(node_ids, edge_keys, f"{path}.edges")
    digest = expect_string(graph["definition_digest"], f"{path}.definition_digest")
    if not DIGEST_PATTERN.fullmatch(digest):
        fail(f"{path}.definition_digest", "sha256 digestが必要")
    if check_digest and digest != digest_resolved(graph):
        fail(f"{path}.definition_digest", "定義snapshotのdigestと不一致")
    return graph


def resolve_catalog(
    catalog: dict[str, Any],
    template_id: str,
    template_version: str,
) -> dict[str, Any]:
    validate_catalog(catalog)
    target = (template_id, template_version)
    matches = [
        template
        for template in catalog["templates"]
        if (template["id"], template["version"]) == target
    ]
    if len(matches) != 1:
        fail("$.templates", "Templateのexact version matchが1件ではない")
    template = matches[0]
    fragment_map = {
        (fragment["id"], fragment["version"]): fragment
        for fragment in catalog["fragments"]
    }
    selected: list[dict[str, Any]] = []
    for index, ref in enumerate(template["fragments"]):
        ref_key = validate_version_ref(ref, f"$.template.fragments[{index}]")
        fragment = fragment_map.get(ref_key)
        if fragment is None:
            fail(f"$.template.fragments[{index}]", "exact versionのFragmentがない")
        selected.append(fragment)

    nodes = [
        copy.deepcopy(node)
        for fragment in selected
        for node in fragment["nodes"]
    ]
    edges = [
        copy.deepcopy(edge)
        for fragment in selected
        for edge in fragment["edges"]
    ]
    edges.extend(copy.deepcopy(template["edges"]))
    graph: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": "resolved-graph",
        "template": version_ref(template["id"], template["version"]),
        "fragments": [
            version_ref(fragment["id"], fragment["version"])
            for fragment in selected
        ],
        "nodes": sorted(nodes, key=lambda item: item["id"]),
        "edges": sorted(
            edges,
            key=lambda item: (
                item["producer"],
                item["consumer"],
                item["artifact"]["id"],
                item["artifact"]["version"],
            ),
        ),
        "artifact_contracts": sorted(
            copy.deepcopy(template["artifact_contracts"]),
            key=lambda item: (item["id"], item["version"]),
        ),
        "completion_conditions": sorted(
            copy.deepcopy(template["completion_conditions"]),
            key=lambda item: item["id"],
        ),
        "definition_digest": "",
    }
    graph["definition_digest"] = digest_resolved(graph)
    validate_resolved_graph(graph)
    return graph


def validate_external_reference(value: Any, path: str) -> None:
    reference = expect_object(value, path)
    expect_keys(reference, {"path", "digest", "summary"}, set(), path)
    relative_path = expect_string(reference["path"], f"{path}.path")
    components = relative_path.split("/")
    if (
        relative_path.startswith("/")
        or "\\" in relative_path
        or any(
            not component
            or component in {".", ".."}
            or not re.fullmatch(r"[A-Za-z0-9._-]+", component)
            for component in components
        )
    ):
        fail(f"{path}.path", "正規化済みrepository-relative pathが必要")
    digest = expect_string(reference["digest"], f"{path}.digest")
    if not DIGEST_PATTERN.fullmatch(digest):
        fail(f"{path}.digest", "sha256 digestが必要")
    expect_string(reference["summary"], f"{path}.summary")


def validate_payload(value: Any, contract: dict[str, Any], path: str) -> None:
    payload = expect_object(value, path)
    fields = {field["name"]: field for field in contract["fields"]}
    unknown = sorted(payload.keys() - fields.keys())
    missing = sorted(
        name
        for name, field in fields.items()
        if field["required"] and name not in payload
    )
    if unknown:
        fail(path, f"Contract未定義field: {','.join(unknown)}")
    if missing:
        fail(path, f"必須payload fieldが不足: {','.join(missing)}")
    for name, item in payload.items():
        field_type = fields[name]["type"]
        valid = (
            (field_type == "string" and isinstance(item, str))
            or (
                field_type == "integer"
                and isinstance(item, int)
                and not isinstance(item, bool)
            )
            or (
                field_type == "number"
                and isinstance(item, (int, float))
                and not isinstance(item, bool)
                and math.isfinite(item)
            )
            or (field_type == "boolean" and isinstance(item, bool))
            or (
                field_type == "string-list"
                and isinstance(item, list)
                and all(isinstance(entry, str) for entry in item)
            )
        )
        if not valid:
            fail(f"{path}.{name}", f"{field_type}が必要")


def validate_artifact(
    value: Any,
    contract_map: dict[tuple[str, str], dict[str, Any]],
    path: str,
) -> dict[str, Any]:
    artifact = expect_object(value, path)
    expect_keys(
        artifact,
        {
            "id",
            "contract",
            "producer",
            "created_at",
            "provenance",
            "validation",
        },
        {"payload", "external_reference"},
        path,
    )
    expect_id(artifact["id"], f"{path}.id")
    contract_ref = validate_version_ref(artifact["contract"], f"{path}.contract")
    contract = contract_map.get(contract_ref)
    if contract is None:
        fail(f"{path}.contract", "Materialized Run GraphにないContract参照")
    if artifact["producer"] is not None:
        expect_id(artifact["producer"], f"{path}.producer")
    if artifact["producer"] != contract["producer"]:
        fail(f"{path}.producer", "Artifact Contractのproducerと不一致")
    expect_timestamp(artifact["created_at"], f"{path}.created_at")

    provenance = expect_object(artifact["provenance"], f"{path}.provenance")
    expect_keys(
        provenance,
        {"run_id", "artifact_ids", "summary"},
        set(),
        f"{path}.provenance",
    )
    if provenance["run_id"] is not None:
        expect_id(provenance["run_id"], f"{path}.provenance.run_id")
    expect_id_list(provenance["artifact_ids"], f"{path}.provenance.artifact_ids")
    expect_string(
        provenance["summary"],
        f"{path}.provenance.summary",
        allow_empty=True,
    )

    has_payload = "payload" in artifact
    has_reference = "external_reference" in artifact
    if has_payload == has_reference:
        fail(path, "payloadまたはexternal_referenceの一方だけが必要")
    if contract["representation"] == "inline":
        if not has_payload:
            fail(path, "inline Contractにはpayloadが必要")
        validate_payload(artifact["payload"], contract, f"{path}.payload")
    else:
        if not has_reference:
            fail(path, "reference Contractにはexternal_referenceが必要")
        validate_external_reference(
            artifact["external_reference"],
            f"{path}.external_reference",
        )

    validation = expect_object(artifact["validation"], f"{path}.validation")
    expect_keys(
        validation,
        {"passed", "condition_results"},
        set(),
        f"{path}.validation",
    )
    passed = expect_bool(validation["passed"], f"{path}.validation.passed")
    validate_results(
        validation["condition_results"],
        contract["validation_conditions"],
        f"{path}.validation.condition_results",
        require_passed=passed,
    )
    result_passed = all(
        result["passed"] for result in validation["condition_results"]
    )
    if passed != result_passed:
        fail(f"{path}.validation.passed", "condition_resultsの集約結果と不一致")
    return artifact


def contract_map_for(graph: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (contract["id"], contract["version"]): contract
        for contract in graph["artifact_contracts"]
    }


def validate_artifact_set(
    value: Any,
    contract_map: dict[tuple[str, str], dict[str, Any]],
    path: str = "$",
) -> list[dict[str, Any]]:
    artifact_set = expect_object(value, path)
    expect_keys(
        artifact_set,
        {"schema_version", "kind", "artifacts"},
        set(),
        path,
    )
    validate_header(artifact_set, "artifact-set", path)
    artifacts = expect_list(artifact_set["artifacts"], f"{path}.artifacts")
    result = [
        validate_artifact(
            artifact,
            contract_map,
            f"{path}.artifacts[{index}]",
        )
        for index, artifact in enumerate(artifacts)
    ]
    artifact_ids = [artifact["id"] for artifact in result]
    if len(artifact_ids) != len(set(artifact_ids)):
        fail(f"{path}.artifacts", "重複Artifact IDは使用不可")
    return result


def inputs_ready(node: dict[str, Any], artifacts: list[dict[str, Any]]) -> bool:
    validated_refs = {
        (artifact["contract"]["id"], artifact["contract"]["version"])
        for artifact in artifacts
        if artifact["validation"]["passed"]
    }
    return all(
        (ref["id"], ref["version"]) in validated_refs
        for ref in node["inputs"]
    )


def validate_output_provenance(
    node: dict[str, Any],
    artifact: dict[str, Any],
    artifacts: list[dict[str, Any]],
    path: str,
) -> None:
    provenance_ids = artifact["provenance"]["artifact_ids"]
    artifact_map = {item["id"]: item for item in artifacts}
    selected = []
    for artifact_id in provenance_ids:
        source = artifact_map.get(artifact_id)
        if source is None:
            fail(f"{path}.provenance.artifact_ids", "存在しないArtifact ID")
        if not source["validation"]["passed"]:
            fail(f"{path}.provenance.artifact_ids", "未検証Artifactは参照不可")
        selected.append(source)
    if node["inputs"] and not provenance_ids:
        fail(f"{path}.provenance.artifact_ids", "Node入力Artifactが必要")
    selected_refs = {
        (item["contract"]["id"], item["contract"]["version"])
        for item in selected
    }
    required_refs = {
        validate_version_ref(ref, f"{path}.node.inputs")
        for ref in node["inputs"]
    }
    if not required_refs.issubset(selected_refs):
        fail(f"{path}.provenance.artifact_ids", "Node input Contractが不足")


def validate_failure(value: Any, path: str) -> None:
    failure = expect_object(value, path)
    expect_keys(failure, {"code", "summary", "evidence"}, set(), path)
    expect_id(failure["code"], f"{path}.code")
    expect_string(failure["summary"], f"{path}.summary")
    expect_string_list(failure["evidence"], f"{path}.evidence")


def validate_block(value: Any, path: str) -> None:
    block = expect_object(value, path)
    expect_keys(
        block,
        {
            "id",
            "fingerprint",
            "category",
            "attempted_operation",
            "evidence",
            "goal_impact",
            "safe_workaround",
            "permanent_option",
            "unblock_condition",
        },
        set(),
        path,
    )
    expect_id(block["id"], f"{path}.id")
    expect_string(block["fingerprint"], f"{path}.fingerprint")
    category = expect_string(block["category"], f"{path}.category")
    if category not in BLOCK_CATEGORIES:
        fail(f"{path}.category", "未対応のBlock分類")
    expect_string(block["attempted_operation"], f"{path}.attempted_operation")
    expect_string_list(block["evidence"], f"{path}.evidence")
    expect_string(block["goal_impact"], f"{path}.goal_impact")
    expect_string(block["safe_workaround"], f"{path}.safe_workaround")
    expect_string(block["permanent_option"], f"{path}.permanent_option")
    expect_string(block["unblock_condition"], f"{path}.unblock_condition")


def validate_status_detail(status: str, value: Any, path: str) -> None:
    validators = {
        "failed": validate_failure,
        "blocked": validate_block,
    }
    validator = validators.get(status)
    if validator is None:
        if value is not None:
            fail(path, f"{status}ではdetailを使用不可")
    else:
        validator(value, path)


def validate_node_state(
    value: Any,
    node: dict[str, Any],
    artifacts: list[dict[str, Any]],
    contract_map: dict[tuple[str, str], dict[str, Any]],
    path: str,
) -> None:
    state = expect_object(value, path)
    expect_keys(
        state,
        {"node_id", "status", "attempt", "detail", "completion_results"},
        set(),
        path,
    )
    if state["node_id"] != node["id"]:
        fail(f"{path}.node_id", "Node定義と不一致")
    status = expect_string(state["status"], f"{path}.status")
    if status not in NODE_STATUSES:
        fail(f"{path}.status", "未対応のNode status")
    attempt = expect_int(state["attempt"], f"{path}.attempt")
    if attempt < 0 or attempt > 1:
        fail(f"{path}.attempt", "Phase 1では0または1だけを使用可能")
    if status in {"pending", "ready"} and attempt != 0:
        fail(f"{path}.attempt", f"{status}では0が必要")
    if status in {"running", "succeeded", "failed"} and attempt != 1:
        fail(f"{path}.attempt", f"{status}では1が必要")
    validate_status_detail(status, state["detail"], f"{path}.detail")
    if status == "succeeded":
        validate_results(
            state["completion_results"],
            node["completion_conditions"],
            f"{path}.completion_results",
            require_passed=True,
        )
        output_refs = {
            validate_version_ref(ref, f"{path}.outputs")
            for ref in node["outputs"]
        }
        produced_refs = {
            (artifact["contract"]["id"], artifact["contract"]["version"])
            for artifact in artifacts
            if artifact["producer"] == node["id"]
            and artifact["validation"]["passed"]
        }
        if not output_refs.issubset(produced_refs):
            fail(path, "検証済み出力Artifactが不足")
    elif state["completion_results"]:
        fail(f"{path}.completion_results", "succeeded以外では空arrayが必要")
    if status in {"pending", "ready"}:
        expected = "ready" if inputs_ready(node, artifacts) else "pending"
        if status != expected:
            fail(f"{path}.status", "入力Artifactから計算したreadinessと不一致")


def validate_run_state(value: Any, path: str = "$") -> dict[str, Any]:
    state = expect_object(value, path)
    expect_keys(
        state,
        {
            "schema_version",
            "kind",
            "run_id",
            "created_at",
            "updated_at",
            "goal_contract",
            "graph",
            "run",
            "nodes",
            "artifacts",
        },
        set(),
        path,
    )
    validate_header(state, "run-state", path)
    expect_id(state["run_id"], f"{path}.run_id")
    created_at = expect_timestamp(state["created_at"], f"{path}.created_at")
    updated_at = expect_timestamp(state["updated_at"], f"{path}.updated_at")
    if updated_at < created_at:
        fail(f"{path}.updated_at", "created_atより前にはできない")
    goal = validate_goal_contract(state["goal_contract"], f"{path}.goal_contract")
    graph = validate_resolved_graph(state["graph"], f"{path}.graph")
    contract_map = contract_map_for(graph)

    artifacts = expect_list(state["artifacts"], f"{path}.artifacts")
    validated_artifacts = [
        validate_artifact(
            artifact,
            contract_map,
            f"{path}.artifacts[{index}]",
        )
        for index, artifact in enumerate(artifacts)
    ]
    artifact_ids = [artifact["id"] for artifact in validated_artifacts]
    if len(artifact_ids) != len(set(artifact_ids)):
        fail(f"{path}.artifacts", "重複Artifact IDは使用不可")

    node_map = {node["id"]: node for node in graph["nodes"]}
    node_states = expect_list(state["nodes"], f"{path}.nodes")
    state_ids = [
        expect_id(node_state.get("node_id"), f"{path}.nodes[{index}].node_id")
        if isinstance(node_state, dict)
        else fail(f"{path}.nodes[{index}]", "objectが必要")
        for index, node_state in enumerate(node_states)
    ]
    if len(state_ids) != len(set(state_ids)):
        fail(f"{path}.nodes", "重複Node stateは使用不可")
    if set(state_ids) != set(node_map):
        fail(f"{path}.nodes", "Materialized Nodeとstateが一致しない")
    state_map = {node_state["node_id"]: node_state for node_state in node_states}
    for node_id, node in node_map.items():
        validate_node_state(
            state_map[node_id],
            node,
            validated_artifacts,
            contract_map,
            f"{path}.nodes[{state_ids.index(node_id)}]",
        )

    for index, artifact in enumerate(validated_artifacts):
        producer = artifact["producer"]
        if producer is not None:
            producer_state = state_map.get(producer)
            if producer_state is None or producer_state["status"] != "succeeded":
                fail(
                    f"{path}.artifacts[{index}].producer",
                    "producer Nodeがsucceededではない",
                )
            validate_output_provenance(
                node_map[producer],
                artifact,
                validated_artifacts,
                f"{path}.artifacts[{index}]",
            )

    run = expect_object(state["run"], f"{path}.run")
    expect_keys(
        run,
        {
            "status",
            "detail",
            "goal_completion_results",
            "graph_completion_results",
        },
        set(),
        f"{path}.run",
    )
    run_status = expect_string(run["status"], f"{path}.run.status")
    if run_status not in RUN_STATUSES:
        fail(f"{path}.run.status", "未対応のRun status")
    validate_status_detail(run_status, run["detail"], f"{path}.run.detail")
    if run_status == "succeeded":
        validate_results(
            run["goal_completion_results"],
            goal["completion_conditions"],
            f"{path}.run.goal_completion_results",
            require_passed=True,
        )
        validate_results(
            run["graph_completion_results"],
            graph["completion_conditions"],
            f"{path}.run.graph_completion_results",
            require_passed=True,
        )
        if any(
            node_state["status"] != "succeeded"
            for node_state in node_states
        ):
            fail(f"{path}.run.status", "未完了Nodeがあるためsucceededにできない")
    elif run["goal_completion_results"] or run["graph_completion_results"]:
        fail(f"{path}.run", "succeeded以外ではcompletion resultsを空にする")
    if run_status == "ready" and not any(
        node_state["status"] == "ready" for node_state in node_states
    ):
        fail(f"{path}.run.status", "ready Nodeがない")
    if run_status == "pending" and any(
        node_state["status"] in {"ready", "running"}
        for node_state in node_states
    ):
        fail(f"{path}.run.status", "readyまたはrunning Nodeが存在する")
    return state


def materialize_run(
    goal: dict[str, Any],
    graph: dict[str, Any],
    run_id: str,
    created_at: str,
    initial_artifact_set: dict[str, Any] | None,
) -> dict[str, Any]:
    validate_goal_contract(goal)
    validate_resolved_graph(graph)
    expect_id(run_id, "$.run_id")
    expect_timestamp(created_at, "$.created_at")
    contract_map = contract_map_for(graph)
    artifacts: list[dict[str, Any]] = []
    if initial_artifact_set is not None:
        artifacts = copy.deepcopy(
            validate_artifact_set(initial_artifact_set, contract_map)
        )
        for index, artifact in enumerate(artifacts):
            if artifact["producer"] is not None:
                fail(
                    f"$.artifacts[{index}].producer",
                    "初期Artifactのproducerはnullが必要",
                )

    node_states = []
    for node in graph["nodes"]:
        status = "ready" if inputs_ready(node, artifacts) else "pending"
        node_states.append(
            {
                "node_id": node["id"],
                "status": status,
                "attempt": 0,
                "detail": None,
                "completion_results": [],
            }
        )
    run_status = (
        "ready"
        if any(node_state["status"] == "ready" for node_state in node_states)
        else "pending"
    )
    state = {
        "schema_version": SCHEMA_VERSION,
        "kind": "run-state",
        "run_id": run_id,
        "created_at": created_at,
        "updated_at": created_at,
        "goal_contract": copy.deepcopy(goal),
        "graph": copy.deepcopy(graph),
        "run": {
            "status": run_status,
            "detail": None,
            "goal_completion_results": [],
            "graph_completion_results": [],
        },
        "nodes": node_states,
        "artifacts": artifacts,
    }
    validate_run_state(state)
    return state


def validate_transition_event(value: Any, path: str = "$") -> dict[str, Any]:
    event = expect_object(value, path)
    base = {"schema_version", "kind", "event", "occurred_at"}
    event_name = expect_string(event.get("event"), f"{path}.event")
    fields: dict[str, set[str]] = {
        "start-node": {"node_id"},
        "succeed-node": {"node_id", "artifacts", "completion_results"},
        "fail-node": {"node_id", "failure"},
        "block-node": {"node_id", "block"},
        "succeed-run": {"goal_completion_results", "graph_completion_results"},
        "fail-run": {"failure"},
        "block-run": {"block"},
    }
    extra = fields.get(event_name)
    if extra is None:
        fail(f"{path}.event", "未対応のtransition event")
    expect_keys(event, base | extra, set(), path)
    validate_header(event, "transition-event", path)
    expect_timestamp(event["occurred_at"], f"{path}.occurred_at")
    if "node_id" in event:
        expect_id(event["node_id"], f"{path}.node_id")
    if "artifacts" in event:
        expect_list(event["artifacts"], f"{path}.artifacts")
    if "completion_results" in event:
        expect_list(event["completion_results"], f"{path}.completion_results")
    if "goal_completion_results" in event:
        expect_list(
            event["goal_completion_results"],
            f"{path}.goal_completion_results",
        )
    if "graph_completion_results" in event:
        expect_list(
            event["graph_completion_results"],
            f"{path}.graph_completion_results",
        )
    if "failure" in event:
        validate_failure(event["failure"], f"{path}.failure")
    if "block" in event:
        validate_block(event["block"], f"{path}.block")
    return event


def recompute_readiness(state: dict[str, Any]) -> None:
    node_map = {node["id"]: node for node in state["graph"]["nodes"]}
    for node_state in state["nodes"]:
        if node_state["status"] in {"pending", "ready"}:
            node = node_map[node_state["node_id"]]
            node_state["status"] = (
                "ready" if inputs_ready(node, state["artifacts"]) else "pending"
            )


def find_node_state(
    state: dict[str, Any],
    node_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    node = next(
        (item for item in state["graph"]["nodes"] if item["id"] == node_id),
        None,
    )
    node_state = next(
        (item for item in state["nodes"] if item["node_id"] == node_id),
        None,
    )
    if node is None or node_state is None:
        fail("$.event.node_id", "Materialized Run GraphにないNode")
    return node, node_state


def require_status(
    actual: str,
    allowed: set[str],
    path: str,
) -> None:
    if actual not in allowed:
        fail(path, f"{actual}からは遷移不可")


def apply_node_event(
    state: dict[str, Any],
    event: dict[str, Any],
) -> None:
    node, node_state = find_node_state(state, event["node_id"])
    name = event["event"]
    if state["run"]["status"] in {"pending", "ready"}:
        state["run"]["status"] = "running"
        state["run"]["detail"] = None
    if name == "start-node":
        require_status(node_state["status"], {"ready"}, "$.node.status")
        node_state["status"] = "running"
        node_state["attempt"] = 1
    elif name == "succeed-node":
        require_status(node_state["status"], {"running"}, "$.node.status")
        contract_map = contract_map_for(state["graph"])
        new_artifacts = [
            validate_artifact(
                artifact,
                contract_map,
                f"$.event.artifacts[{index}]",
            )
            for index, artifact in enumerate(event["artifacts"])
        ]
        existing_ids = {artifact["id"] for artifact in state["artifacts"]}
        new_ids = [artifact["id"] for artifact in new_artifacts]
        if len(new_ids) != len(set(new_ids)) or existing_ids.intersection(new_ids):
            fail("$.event.artifacts", "重複Artifact IDは使用不可")
        output_refs = {
            validate_version_ref(ref, "$.node.outputs")
            for ref in node["outputs"]
        }
        produced_refs = {
            (artifact["contract"]["id"], artifact["contract"]["version"])
            for artifact in new_artifacts
        }
        if produced_refs != output_refs or len(new_artifacts) != len(output_refs):
            fail("$.event.artifacts", "Node outputsとArtifact集合が一致しない")
        for index, artifact in enumerate(new_artifacts):
            if artifact["producer"] != node["id"]:
                fail("$.event.artifacts", "Artifact producerがNodeと不一致")
            if artifact["provenance"]["run_id"] != state["run_id"]:
                fail("$.event.artifacts", "出力Artifactのrun_idがRunと不一致")
            if not artifact["validation"]["passed"]:
                fail("$.event.artifacts", "検証済みArtifactだけを出力可能")
            validate_output_provenance(
                node,
                artifact,
                state["artifacts"],
                f"$.event.artifacts[{index}]",
            )
        validate_results(
            event["completion_results"],
            node["completion_conditions"],
            "$.event.completion_results",
            require_passed=True,
        )
        state["artifacts"].extend(copy.deepcopy(new_artifacts))
        node_state["status"] = "succeeded"
        node_state["detail"] = None
        node_state["completion_results"] = copy.deepcopy(
            event["completion_results"]
        )
        recompute_readiness(state)
    elif name == "fail-node":
        require_status(node_state["status"], {"running"}, "$.node.status")
        node_state["status"] = "failed"
        node_state["detail"] = copy.deepcopy(event["failure"])
    elif name == "block-node":
        require_status(node_state["status"], {"ready", "running"}, "$.node.status")
        node_state["status"] = "blocked"
        node_state["detail"] = copy.deepcopy(event["block"])


def apply_run_event(
    state: dict[str, Any],
    event: dict[str, Any],
) -> None:
    name = event["event"]
    current = state["run"]["status"]
    if name == "succeed-run":
        require_status(
            current,
            {"pending", "ready", "running"},
            "$.run.status",
        )
        if any(
            node_state["status"] != "succeeded"
            for node_state in state["nodes"]
        ):
            fail("$.run.status", "未完了Nodeがある")
        validate_results(
            event["goal_completion_results"],
            state["goal_contract"]["completion_conditions"],
            "$.event.goal_completion_results",
            require_passed=True,
        )
        validate_results(
            event["graph_completion_results"],
            state["graph"]["completion_conditions"],
            "$.event.graph_completion_results",
            require_passed=True,
        )
        state["run"]["status"] = "succeeded"
        state["run"]["detail"] = None
        state["run"]["goal_completion_results"] = copy.deepcopy(
            event["goal_completion_results"]
        )
        state["run"]["graph_completion_results"] = copy.deepcopy(
            event["graph_completion_results"]
        )
    elif name == "fail-run":
        require_status(current, {"pending", "ready", "running"}, "$.run.status")
        state["run"]["status"] = "failed"
        state["run"]["detail"] = copy.deepcopy(event["failure"])
    elif name == "block-run":
        require_status(current, {"pending", "ready", "running"}, "$.run.status")
        state["run"]["status"] = "blocked"
        state["run"]["detail"] = copy.deepcopy(event["block"])


def transition_state(
    state: dict[str, Any],
    event: dict[str, Any],
) -> dict[str, Any]:
    validate_run_state(state)
    validate_transition_event(event)
    if event["occurred_at"] < state["updated_at"]:
        fail("$.event.occurred_at", "Run stateのupdated_atより前にはできない")
    result = copy.deepcopy(state)
    node_events = {
        "start-node",
        "succeed-node",
        "fail-node",
        "block-node",
    }
    if event["event"] in node_events:
        if result["run"]["status"] not in {"pending", "ready", "running"}:
            fail("$.run.status", "停止中または終端RunではNodeを遷移できない")
        apply_node_event(result, event)
    else:
        apply_run_event(result, event)
    result["updated_at"] = event["occurred_at"]
    validate_run_state(result)
    return result


def load_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as error:
        raise ValidationError(
            f"{path}: JSONが不正（line={error.lineno}, column={error.colno}）"
        ) from error


def write_json(value: Any, path: str | None) -> None:
    text = canonical_text(value)
    if path is None:
        sys.stdout.write(text)
        return
    target = Path(path)
    parent = target.parent
    if not parent.is_dir():
        fail(path, "保存先directoryが存在しない")
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=parent,
            prefix=".workflow-graph-",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = handle.name
            os.chmod(temporary_path, 0o600)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, target)
    finally:
        if temporary_path is not None and os.path.exists(temporary_path):
            os.unlink(temporary_path)


def validate_document(value: Any) -> str:
    document = expect_object(value, "$")
    kind = expect_string(document.get("kind"), "$.kind")
    if kind == "goal-contract":
        validate_goal_contract(document)
    elif kind == "project-profile":
        validate_project_profile(document)
    elif kind == "catalog":
        validate_catalog(document)
    elif kind == "resolved-graph":
        validate_resolved_graph(document)
    elif kind == "run-state":
        validate_run_state(document)
    elif kind == "transition-event":
        validate_transition_event(document)
    else:
        fail("$.kind", "未対応のdocument kind")
    return kind


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Workflow Graph Phase 1 Core",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("path")

    resolve_parser = subparsers.add_parser("resolve")
    resolve_parser.add_argument("--catalog", required=True)
    resolve_parser.add_argument("--template-id", required=True)
    resolve_parser.add_argument("--template-version", required=True)
    resolve_parser.add_argument("--output")

    materialize_parser = subparsers.add_parser("materialize")
    materialize_parser.add_argument("--goal", required=True)
    materialize_parser.add_argument("--resolved", required=True)
    materialize_parser.add_argument("--run-id", required=True)
    materialize_parser.add_argument("--created-at", required=True)
    materialize_parser.add_argument("--artifacts")
    materialize_parser.add_argument("--state", required=True)

    transition_parser = subparsers.add_parser("transition")
    transition_parser.add_argument("--state", required=True)
    transition_parser.add_argument("--event", required=True)

    show_parser = subparsers.add_parser("show")
    show_parser.add_argument("--state", required=True)
    return parser


def run_command(args: argparse.Namespace) -> None:
    if args.command == "validate":
        kind = validate_document(load_json(args.path))
        print(f"valid={kind}")
    elif args.command == "resolve":
        expect_id(args.template_id, "$.template_id")
        expect_semver(args.template_version, "$.template_version")
        graph = resolve_catalog(
            load_json(args.catalog),
            args.template_id,
            args.template_version,
        )
        write_json(graph, args.output)
    elif args.command == "materialize":
        artifact_set = load_json(args.artifacts) if args.artifacts else None
        state = materialize_run(
            load_json(args.goal),
            load_json(args.resolved),
            args.run_id,
            args.created_at,
            artifact_set,
        )
        if Path(args.state).exists():
            fail(args.state, "既存Run stateはmaterializeで上書き不可")
        write_json(state, args.state)
    elif args.command == "transition":
        state = transition_state(
            load_json(args.state),
            load_json(args.event),
        )
        write_json(state, args.state)
    elif args.command == "show":
        state = load_json(args.state)
        validate_run_state(state)
        write_json(state, None)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        run_command(args)
    except ValidationError as error:
        print("error=validation_error", file=sys.stderr)
        print(f"detail={error}", file=sys.stderr)
        return 3
    except OSError as error:
        print("error=io_error", file=sys.stderr)
        print(f"detail={error}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
