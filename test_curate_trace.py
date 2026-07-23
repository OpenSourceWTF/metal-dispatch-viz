import bisect
import hashlib
import json
import subprocess
import sys
import tempfile
import tracemalloc
import unittest
from pathlib import Path
from unittest import mock

import scripts.curate_trace as curate_module
from scripts.curate_trace import TraceValidationError, curate_trace, verify_curated


def public_rows(command_buffers=3, *, summary=None, anchor=True):
    rows = []
    for index in range(command_buffers):
        seq = 100 + index
        start = 10 + index * 30
        rows.extend(
            [
                {
                    "record": "op",
                    "seq": seq,
                    "command_buffer_index": index,
                    "kernel": f"kernel-{index}",
                    "raw_note": f"op-{index}",
                },
                {
                    "record": "cb",
                    "command_buffer_index": index,
                    "op_count": 1,
                    "first_op_seq": seq,
                    "last_op_seq": seq,
                    "encode_start_ns": start,
                    "encode_end_ns": start + 10,
                    "gpu_start_ns": start + 5,
                    "gpu_end_ns": start + 20,
                    "raw_note": f"cb-{index}",
                },
            ]
        )
    if anchor:
        rows.append(
            {
                "record": "wait",
                "bucket": "cb_wait_until_completed",
                "at_ns": 10 + (command_buffers - 1) * 30 + 21,
                "wait_ns": 4,
                "raw_note": "anchor",
            }
        )
    rows.append(
        summary
        if summary is not None
        else {"record": "summary", "complete": True, "dropped_rows": 0}
    )
    return rows


class CurateTraceTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.source = self.root / "raw.jsonl"
        self.destination = self.root / "out.jsonl"

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_rows(self, rows, path=None):
        path = path or self.source
        path.write_text(
            "".join(
                json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n"
                for row in rows
            ),
            encoding="utf-8",
        )
        return path

    def read_rows(self, path=None):
        path = path or self.destination
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def test_selects_whole_command_buffers_and_referenced_ops(self):
        self.write_rows(public_rows())

        result = curate_trace(
            self.source, self.destination, max_command_buffers=2
        )
        output = self.read_rows()

        self.assertEqual(result["command_buffers"], 2)
        self.assertEqual(result["ops"], 2)
        self.assertEqual(
            result["source_sha256"],
            hashlib.sha256(self.source.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            {
                row["command_buffer_index"]
                for row in output
                if row.get("record") == "cb"
            },
            {1, 2},
        )
        self.assertEqual(
            {
                row["command_buffer_index"]
                for row in output
                if row.get("record") == "op"
            },
            {1, 2},
        )
        self.assertEqual(sum(row.get("record") == "summary" for row in output), 1)
        self.assertTrue(output[-1]["complete"])
        self.assertTrue(output[-1]["curated_window"])
        self.assertEqual(output[-1]["source_metadata"]["summary"]["record"], "summary")

    def test_repeat_output_is_byte_identical(self):
        self.write_rows(public_rows())
        first = self.root / "first.jsonl"
        second = self.root / "second.jsonl"

        curate_trace(self.source, first, max_command_buffers=2)
        curate_trace(self.source, second, max_command_buffers=2)

        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertTrue(first.read_bytes().endswith(b"\n"))

    def test_chooses_latest_eligible_anchor_and_has_deterministic_fallback(self):
        rows = public_rows(anchor=False)
        rows.insert(
            2,
            {
                "record": "wait",
                "bucket": "cb_wait_until_completed",
                "at_ns": 31,
                "wait_ns": 1,
                "label": "too-early",
            },
        )
        rows.insert(
            -1,
            {
                "record": "wait",
                "bucket": "cb_wait_until_completed",
                "at_ns": 91,
                "wait_ns": 1,
                "label": "eligible",
            },
        )
        self.write_rows(rows)

        result = curate_trace(self.source, self.destination, max_command_buffers=2)

        self.assertEqual(result["selection_mode"], "anchor")
        waits = [
            row
            for row in self.read_rows()
            if row.get("record") == "wait"
        ]
        self.assertEqual([row["label"] for row in waits], ["eligible"])

        fallback_source = self.root / "fallback.jsonl"
        fallback_output = self.root / "fallback-out.jsonl"
        self.write_rows(public_rows(anchor=False), fallback_source)
        fallback = curate_trace(
            fallback_source, fallback_output, max_command_buffers=2
        )
        fallback_rows = self.read_rows(fallback_output)
        self.assertEqual(fallback["selection_mode"], "final-command-buffers")
        self.assertEqual(
            [
                row["command_buffer_index"]
                for row in fallback_rows
                if row.get("record") == "cb"
            ],
            [1, 2],
        )

    def test_uses_public_and_documented_legacy_aliases_without_renaming(self):
        rows = [
            {
                "seq": 7,
                "cb_index": 4,
                "kind": "compute",
                "kernel_name": "legacy-kernel",
            },
            {
                "cb_index": 4,
                "op_count": 1,
                "first_op_seq": 7,
                "last_op_seq": 7,
                "encode_start_ns": 100,
                "encode_end_ns": 110,
            },
            {
                "kind": "wait",
                "cause": "cb_wait_until_completed",
                "ts_ns": 111,
                "ns": 3,
            },
            {"record": "summary", "complete": True, "dropped_rows": 0},
        ]
        self.write_rows(rows)

        curate_trace(self.source, self.destination, max_command_buffers=1)
        output = self.read_rows()

        op = next(row for row in output if row.get("seq") == 7)
        cb = next(row for row in output if row.get("op_count") == 1)
        wait = next(row for row in output if row.get("kind") == "wait")
        self.assertEqual(op["cb_index"], 4)
        self.assertNotIn("command_buffer_index", op)
        self.assertEqual(cb["cb_index"], 4)
        self.assertNotIn("record", cb)
        self.assertEqual(wait["cause"], "cb_wait_until_completed")
        self.assertNotIn("bucket", wait)

    def test_rebases_timestamps_but_not_durations_or_indices(self):
        rows = public_rows(command_buffers=1, anchor=False)
        rows.insert(
            -1,
            {
                "record": "wait",
                "bucket": "cb_wait_until_completed",
                "at_ns": 31,
                "timestamp_ns": 31,
                "duration_ns": 9,
                "wait_ns": 9,
                "cb_index": 0,
            },
        )
        self.write_rows(rows)

        curate_trace(self.source, self.destination, max_command_buffers=1)
        output = self.read_rows()
        cb = next(row for row in output if row.get("record") == "cb")
        wait = next(row for row in output if row.get("record") == "wait")

        self.assertEqual(cb["encode_start_ns"], 0)
        self.assertEqual(cb["encode_end_ns"], 10)
        self.assertEqual(cb["gpu_start_ns"], 5)
        self.assertEqual(cb["gpu_end_ns"], 20)
        self.assertEqual(cb["command_buffer_index"], 0)
        self.assertEqual(wait["at_ns"], 21)
        self.assertEqual(wait["timestamp_ns"], 21)
        self.assertEqual(wait["duration_ns"], 9)
        self.assertEqual(wait["wait_ns"], 9)
        self.assertEqual(wait["cb_index"], 0)

    def test_wait_duration_aliases_match_renderer_and_bucket_totals(self):
        rows = public_rows(command_buffers=1)
        rows.insert(
            -2,
            {
                "record": "wait",
                "bucket": "cb_wait_until_completed",
                "at_ns": 15,
                "waitNs": 3,
            },
        )
        anchor = rows[-2]
        anchor["duration_ns"] = 4
        anchor["ns"] = 4
        anchor["dur_ns"] = 4
        anchor["waitNs"] = 4
        self.write_rows(rows)

        result = curate_trace(
            self.source, self.destination, max_command_buffers=1
        )

        self.assertEqual(
            result["buckets"],
            {
                "cb_wait_until_completed": {
                    "count": 2,
                    "total_ns": 7,
                }
            },
        )
        self.assertTrue(verify_curated(self.destination)["valid"])

    def test_rejects_conflicting_wait_duration_aliases(self):
        rows = public_rows(command_buffers=1)
        rows[-2]["ns"] = 9
        self.write_rows(rows)

        with self.assertRaisesRegex(
            TraceValidationError, "conflicting wait duration aliases"
        ):
            curate_trace(
                self.source, self.destination, max_command_buffers=1
            )

    def test_rejects_conflicting_wait_timestamp_aliases_in_source(self):
        rows = public_rows(command_buffers=1, anchor=False)
        rows.insert(
            -1,
            {
                "record": "wait",
                "bucket": "cb_wait_until_completed",
                "at_ns": 15,
                "timestamp_ns": 999,
                "wait_ns": 1,
            },
        )
        self.write_rows(rows)

        with self.assertRaisesRegex(
            TraceValidationError, "conflicting wait timestamp aliases"
        ):
            curate_trace(self.source, self.destination, max_command_buffers=1)

    def test_includes_timestamped_waits_and_documented_owner_fallback(self):
        rows = public_rows(command_buffers=1, anchor=False)
        rows[-1:-1] = [
            {
                "record": "wait",
                "bucket": "inside",
                "at_ns": 15,
                "wait_ns": 1,
            },
            {
                "record": "wait",
                "bucket": "owner-fallback",
                "command_buffer_index": 0,
                "wait_ns": 2,
            },
        ]
        self.write_rows(rows)

        curate_trace(
            self.source,
            self.destination,
            max_command_buffers=1,
            anchor_bucket="absent",
        )

        self.assertEqual(
            {
                row["bucket"]
                for row in self.read_rows()
                if row.get("record") == "wait"
            },
            {"inside", "owner-fallback"},
        )

    def test_reports_malformed_json_line_and_writes_nothing(self):
        self.source.write_text(
            '{"record":"summary","complete":true,"dropped_rows":0}\n'
            '{"record":\n',
            encoding="utf-8",
        )

        with self.assertRaisesRegex(TraceValidationError, r"line 2"):
            curate_trace(self.source, self.destination, max_command_buffers=1)

        self.assertFalse(self.destination.exists())

    def test_rejects_nonfinite_and_unusable_timestamps(self):
        cases = {
            "nonfinite": public_rows(),
            "inverted": public_rows(),
            "missing-pair": public_rows(),
        }
        cases["nonfinite"][1]["gpu_end_ns"] = float("nan")
        cases["inverted"][1]["encode_end_ns"] = 9
        del cases["missing-pair"][1]["encode_end_ns"]

        for name, rows in cases.items():
            with self.subTest(name=name):
                source = self.root / f"{name}.jsonl"
                output = self.root / f"{name}-out.jsonl"
                self.write_rows(rows, source)
                with self.assertRaises(TraceValidationError):
                    curate_trace(source, output, max_command_buffers=1)

    def test_rejects_duplicate_command_buffers(self):
        rows = public_rows(command_buffers=1)
        rows.insert(-1, dict(rows[1]))
        self.write_rows(rows)

        with self.assertRaisesRegex(TraceValidationError, "duplicate"):
            curate_trace(self.source, self.destination, max_command_buffers=1)

    def test_rejects_dropped_incomplete_missing_multiple_or_nonfinal_summary(self):
        cases = {
            "dropped": public_rows(
                summary={"record": "summary", "complete": True, "dropped_rows": 1}
            ),
            "incomplete": public_rows(
                summary={"record": "summary", "complete": False, "dropped_rows": 0}
            ),
            "missing": public_rows()[:-1],
            "multiple": public_rows()
            + [{"record": "summary", "complete": True, "dropped_rows": 0}],
            "nonfinal": public_rows()
            + [
                {
                    "record": "wait",
                    "bucket": "late",
                    "at_ns": 999,
                    "wait_ns": 1,
                }
            ],
        }

        for name, rows in cases.items():
            with self.subTest(name=name):
                source = self.root / f"{name}.jsonl"
                output = self.root / f"{name}-out.jsonl"
                self.write_rows(rows, source)
                with self.assertRaises(TraceValidationError):
                    curate_trace(source, output, max_command_buffers=1)

    def test_rejects_missing_or_inconsistent_op_ranges_references_and_counts(self):
        cases = {
            "missing-range": public_rows(command_buffers=1),
            "missing-owner": public_rows(command_buffers=1),
            "count": public_rows(command_buffers=1),
            "range": public_rows(command_buffers=1),
        }
        del cases["missing-range"][1]["last_op_seq"]
        cases["missing-owner"][0]["command_buffer_index"] = 99
        cases["count"][1]["op_count"] = 2
        cases["range"][1]["last_op_seq"] = 101

        for name, rows in cases.items():
            with self.subTest(name=name):
                source = self.root / f"{name}.jsonl"
                output = self.root / f"{name}-out.jsonl"
                self.write_rows(rows, source)
                with self.assertRaises(TraceValidationError):
                    curate_trace(source, output, max_command_buffers=1)

    def test_legacy_summary_requires_gate_and_remains_unverifiable(self):
        rows = public_rows(
            command_buffers=1,
            summary={"record": "summary", "ops_total": 1, "cbs_total": 1},
        )
        self.write_rows(rows)

        with self.assertRaisesRegex(TraceValidationError, "legacy"):
            curate_trace(self.source, self.destination, max_command_buffers=1)

        result = curate_trace(
            self.source,
            self.destination,
            max_command_buffers=1,
            allow_legacy_summary=True,
        )
        report = verify_curated(self.destination)
        self.assertIsNone(result["source_complete"])
        self.assertFalse(result["valid_evidence"])
        self.assertEqual(result["source_evidence_status"], "legacy-unverifiable")
        self.assertFalse(report["valid_evidence"])

    def test_legacy_source_emits_current_v1_renderer_summary_contract(self):
        rows = public_rows(
            command_buffers=1,
            summary={"record": "summary", "ops_total": 1, "cbs_total": 1},
        )
        self.write_rows(rows)

        result = curate_trace(
            self.source,
            self.destination,
            max_command_buffers=1,
            allow_legacy_summary=True,
        )
        summary = self.read_rows()[-1]

        self.assertEqual(summary["schema_version"], 1)
        self.assertTrue(summary["final"])
        self.assertEqual(summary["summary_seq"], 0)
        self.assertTrue(summary["complete"])
        self.assertEqual(summary["dropped_rows"], 0)
        self.assertEqual(summary["ops_total"], 1)
        self.assertEqual(summary["cbs_total"], 1)
        self.assertEqual(
            summary["buckets"],
            {
                "cb_wait_until_completed": {
                    "count": 1,
                    "total_ns": 4,
                }
            },
        )
        self.assertIsNone(summary["source_complete"])
        self.assertFalse(summary["valid_evidence"])
        self.assertEqual(result, summary)
        self.assertTrue(verify_curated(self.destination)["valid"])

    def test_legacy_gate_never_accepts_partially_missing_gate_fields(self):
        for summary in (
            {"record": "summary", "complete": True},
            {"record": "summary", "dropped_rows": 0},
        ):
            with self.subTest(summary=summary):
                self.write_rows(public_rows(command_buffers=1, summary=summary))
                with self.assertRaises(TraceValidationError):
                    curate_trace(
                        self.source,
                        self.destination,
                        max_command_buffers=1,
                        allow_legacy_summary=True,
                    )

    def test_accepts_cumulative_checkpoint_then_terminal_summary(self):
        rows = public_rows(command_buffers=1)[:-1]
        counts = {
            "ops_total": 1,
            "cbs_total": 1,
            "buckets": {
                "cb_wait_until_completed": {"count": 1, "total_ns": 4}
            },
        }
        rows.extend(
            [
                {
                    "record": "summary",
                    "final": False,
                    "summary_seq": 0,
                    "complete": True,
                    "dropped_rows": 0,
                    **counts,
                },
                {
                    "record": "summary",
                    "final": True,
                    "summary_seq": 1,
                    "complete": True,
                    "dropped_rows": 0,
                    **counts,
                },
            ]
        )
        self.write_rows(rows)

        result = curate_trace(
            self.source, self.destination, max_command_buffers=1
        )
        output = self.read_rows()
        report = verify_curated(self.destination)

        self.assertEqual(sum(row.get("record") == "summary" for row in output), 1)
        self.assertTrue(result["source_metadata"]["summary"]["final"])
        self.assertEqual(
            result["source_metadata"]["summary"]["summary_seq"], 1
        )
        self.assertEqual(result["source_counts"]["summary_records"], 2)
        self.assertTrue(report["valid"])

    def test_rejects_invalid_cumulative_summary_streams(self):
        base = public_rows(command_buffers=1)[:-1]

        def summary(seq, final, **overrides):
            row = {
                "schema_version": 1,
                "record": "summary",
                "final": final,
                "summary_seq": seq,
                "complete": True,
                "dropped_rows": 0,
                "ops_total": 1,
                "cbs_total": 1,
                "buckets": {
                    "cb_wait_until_completed": {"count": 1, "total_ns": 4}
                },
            }
            row.update(overrides)
            return row

        cases = {
            "no-terminal": [
                summary(0, False),
                summary(1, False),
            ],
            "multiple-terminal": [
                summary(0, True),
                summary(1, True),
            ],
            "checkpoint-after-terminal": [
                summary(0, True),
                summary(1, False),
            ],
            "duplicate-seq": [
                summary(0, False),
                summary(0, True),
            ],
            "non-monotonic-seq": [
                summary(2, False),
                summary(1, True),
            ],
            "checkpoint-count-exceeds-terminal": [
                summary(0, False, ops_total=2),
                summary(1, True, ops_total=1),
            ],
            "checkpoint-drops-exceed-terminal": [
                summary(0, False, dropped_rows=1),
                summary(1, True, dropped_rows=0),
            ],
            "schema-mismatch": [
                summary(0, False),
                {
                    "record": "summary",
                    "final": True,
                    "summary_seq": 1,
                    "complete": True,
                    "dropped_rows": 0,
                    "ops_total": 1,
                },
            ],
            "terminal-incomplete": [
                summary(0, False),
                summary(1, True, complete=False),
            ],
            "terminal-dropped": [
                summary(0, False),
                summary(1, True, dropped_rows=1),
            ],
        }

        for name, summaries in cases.items():
            with self.subTest(name=name):
                source = self.root / f"{name}.jsonl"
                destination = self.root / f"{name}-out.jsonl"
                self.write_rows(base + summaries, source)
                with self.assertRaises(TraceValidationError):
                    curate_trace(
                        source, destination, max_command_buffers=1
                    )
                self.assertFalse(destination.exists())

    def test_accepts_monotonic_sparse_bucket_introduction(self):
        rows = public_rows(command_buffers=1)[:-1]
        rows.extend(
            [
                {
                    "schema_version": 1,
                    "record": "summary",
                    "final": False,
                    "summary_seq": 0,
                    "complete": True,
                    "dropped_rows": 0,
                    "ops_total": 1,
                    "cbs_total": 1,
                    "buckets": {
                        "alloc_calls": {"count": 2, "total_ns": 0}
                    },
                },
                {
                    "schema_version": 1,
                    "record": "summary",
                    "final": True,
                    "summary_seq": 1,
                    "complete": True,
                    "dropped_rows": 0,
                    "ops_total": 1,
                    "cbs_total": 1,
                    "buckets": {
                        "alloc_calls": {"count": 3, "total_ns": 1},
                        "alloc_gc": {"count": 1, "total_ns": 9},
                    },
                },
            ]
        )
        self.write_rows(rows)

        result = curate_trace(
            self.source, self.destination, max_command_buffers=1
        )

        self.assertIn(
            "alloc_gc",
            result["source_metadata"]["summary"]["buckets"],
        )
        self.assertTrue(verify_curated(self.destination)["valid"])

    def test_rejects_invalid_sparse_bucket_transitions(self):
        base = public_rows(command_buffers=1)[:-1]

        def summary(seq, final, buckets, **overrides):
            row = {
                "schema_version": 1,
                "record": "summary",
                "final": final,
                "summary_seq": seq,
                "complete": True,
                "dropped_rows": 0,
                "ops_total": 1,
                "cbs_total": 1,
                "buckets": buckets,
            }
            row.update(overrides)
            return row

        bucket_a = {"a": {"count": 2, "total_ns": 10}}
        bucket_ab = {
            "a": {"count": 2, "total_ns": 10},
            "b": {"count": 1, "total_ns": 4},
        }
        cases = {
            "bucket-removal": [
                summary(0, False, bucket_ab),
                summary(1, True, bucket_a),
            ],
            "bucket-shape-change": [
                summary(0, False, bucket_a),
                summary(1, True, {"a": {"count": 2}}),
            ],
            "bucket-type-change": [
                summary(0, False, bucket_a),
                summary(1, True, {"a": {"count": 2, "total_ns": "10"}}),
            ],
            "bucket-count-decrease": [
                summary(0, False, bucket_a),
                summary(1, True, {"a": {"count": 1, "total_ns": 10}}),
            ],
            "bucket-total-decrease": [
                summary(0, False, bucket_a),
                summary(1, True, {"a": {"count": 2, "total_ns": 9}}),
            ],
            "negative-new-bucket": [
                summary(0, False, bucket_a),
                summary(
                    1,
                    True,
                    {
                        **bucket_a,
                        "b": {"count": -1, "total_ns": 0},
                    },
                ),
            ],
            "unsafe-new-bucket": [
                summary(0, False, bucket_a),
                summary(
                    1,
                    True,
                    {
                        **bucket_a,
                        "b": {"count": 1, "total_ns": 2**53},
                    },
                ),
            ],
            "schema-version-change": [
                summary(0, False, bucket_a),
                summary(1, True, bucket_a, schema_version=2),
            ],
        }

        for name, summaries in cases.items():
            with self.subTest(name=name):
                source = self.root / f"{name}.jsonl"
                destination = self.root / f"{name}-out.jsonl"
                self.write_rows(base + summaries, source)
                with self.assertRaises(TraceValidationError):
                    curate_trace(
                        source, destination, max_command_buffers=1
                    )
                self.assertFalse(destination.exists())

    def test_modern_cumulative_summaries_require_safe_ops_and_cb_totals(self):
        base = public_rows(command_buffers=1)[:-1]

        def summary(seq, final, **overrides):
            row = {
                "schema_version": 1,
                "record": "summary",
                "final": final,
                "summary_seq": seq,
                "complete": True,
                "dropped_rows": 0,
                "ops_total": 1,
                "cbs_total": 1,
                "buckets": {
                    "cb_wait_until_completed": {"count": 1, "total_ns": 4}
                },
            }
            row.update(overrides)
            return row

        both_omitted = [summary(0, False), summary(1, True)]
        for row in both_omitted:
            del row["ops_total"]
            del row["cbs_total"]
        ops_omitted = [summary(0, False), summary(1, True)]
        for row in ops_omitted:
            del row["ops_total"]
        cbs_omitted = [summary(0, False), summary(1, True)]
        for row in cbs_omitted:
            del row["cbs_total"]

        cases = {
            "both-omitted": both_omitted,
            "ops-omitted": ops_omitted,
            "cbs-omitted": cbs_omitted,
            "negative-ops": [
                summary(0, False, ops_total=-1),
                summary(1, True, ops_total=1),
            ],
            "boolean-cbs": [
                summary(0, False, cbs_total=True),
                summary(1, True, cbs_total=1),
            ],
            "fractional-ops": [
                summary(0, False, ops_total=0.5),
                summary(1, True, ops_total=1),
            ],
            "unsafe-cbs": [
                summary(0, False, cbs_total=2**53),
                summary(1, True, cbs_total=1),
            ],
        }

        for name, summaries in cases.items():
            with self.subTest(name=name):
                source = self.root / f"modern-totals-{name}.jsonl"
                destination = self.root / f"modern-totals-{name}-out.jsonl"
                self.write_rows(base + summaries, source)
                with self.assertRaises(TraceValidationError):
                    curate_trace(
                        source, destination, max_command_buffers=1
                    )
                self.assertFalse(destination.exists())

    def test_legacy_gate_rejects_ambiguous_multiple_legacy_summaries(self):
        rows = public_rows(command_buffers=1)[:-1]
        rows.extend(
            [
                {"record": "summary", "ops_total": 1, "cbs_total": 1},
                {"record": "summary", "ops_total": 1, "cbs_total": 1},
            ]
        )
        self.write_rows(rows)

        with self.assertRaisesRegex(TraceValidationError, "ambiguous|summary"):
            curate_trace(
                self.source,
                self.destination,
                max_command_buffers=1,
                allow_legacy_summary=True,
            )

    def test_atomic_replace_failure_preserves_destination_and_cleans_temp(self):
        self.write_rows(public_rows(command_buffers=1))
        self.destination.write_bytes(b"existing\n")

        with mock.patch(
            "scripts.curate_trace.os.replace", side_effect=OSError("replace failed")
        ):
            with self.assertRaisesRegex(OSError, "replace failed"):
                curate_trace(self.source, self.destination, max_command_buffers=1)

        self.assertEqual(self.destination.read_bytes(), b"existing\n")
        self.assertEqual(
            list(self.root.glob(f".{self.destination.name}.*.tmp")), []
        )

    def test_second_pass_hash_change_preserves_destination_and_cleans_temp(self):
        self.write_rows(public_rows(command_buffers=1))
        self.destination.write_bytes(b"existing\n")
        original_select = curate_module._select_window

        def select_then_mutate(*args, **kwargs):
            selection = original_select(*args, **kwargs)
            changed = self.source.read_bytes().replace(
                b"kernel-0", b"xernel-0", 1
            )
            self.source.write_bytes(changed)
            return selection

        with mock.patch(
            "scripts.curate_trace._select_window",
            side_effect=select_then_mutate,
        ):
            with self.assertRaisesRegex(TraceValidationError, "source changed"):
                curate_trace(
                    self.source, self.destination, max_command_buffers=1
                )

        self.assertEqual(self.destination.read_bytes(), b"existing\n")
        self.assertEqual(
            list(self.root.glob(f".{self.destination.name}.*.tmp")), []
        )

    def test_verifier_accepts_valid_output_and_rejects_corruption(self):
        self.write_rows(public_rows(command_buffers=2))
        curate_trace(self.source, self.destination, max_command_buffers=2)

        report = verify_curated(self.destination)

        self.assertTrue(report["valid"])
        self.assertEqual(
            report["validation_scope"], "structural-curated-file"
        )
        self.assertFalse(report["raw_provenance_attested"])
        self.assertEqual(report["command_buffers"], 2)
        corrupt = self.read_rows()
        next(row for row in corrupt if row.get("record") == "op")[
            "command_buffer_index"
        ] = 99
        self.write_rows(corrupt, self.destination)
        with self.assertRaises(TraceValidationError):
            verify_curated(self.destination)

    def test_verifier_rejects_legacy_evidence_upgrade(self):
        self.write_rows(
            public_rows(
                command_buffers=1,
                summary={"record": "summary", "ops_total": 1, "cbs_total": 1},
            )
        )
        curate_trace(
            self.source,
            self.destination,
            max_command_buffers=1,
            allow_legacy_summary=True,
        )
        rows = self.read_rows()
        rows[-1]["valid_evidence"] = True
        self.write_rows(rows, self.destination)

        with self.assertRaisesRegex(TraceValidationError, "legacy"):
            verify_curated(self.destination)

    def test_verifier_rejects_conflicting_out_of_bounds_wait_alias(self):
        self.write_rows(public_rows(command_buffers=1))
        curate_trace(self.source, self.destination, max_command_buffers=1)
        rows = self.read_rows()
        wait = next(row for row in rows if row.get("record") == "wait")
        wait["timestamp_ns"] = 999
        self.write_rows(rows, self.destination)

        with self.assertRaisesRegex(
            TraceValidationError, "conflicting wait timestamp aliases"
        ):
            verify_curated(self.destination)

    def test_large_trace_curation_has_bounded_python_heap(self):
        command_buffer_count = 2_000
        ops_per_command_buffer = 100
        with self.source.open("w", encoding="utf-8", newline="\n") as output:
            seq = 0
            for cb_index in range(command_buffer_count):
                for _ in range(ops_per_command_buffer):
                    output.write(
                        json.dumps(
                            {
                                "record": "op",
                                "seq": seq,
                                "command_buffer_index": cb_index,
                                "kind": "compute",
                                "kernel_name": "compact-memory-fixture",
                            },
                            separators=(",", ":"),
                        )
                        + "\n"
                    )
                    seq += 1
                start = cb_index * 10
                output.write(
                    json.dumps(
                        {
                            "record": "cb",
                            "command_buffer_index": cb_index,
                            "op_count": ops_per_command_buffer,
                            "first_op_seq": seq - ops_per_command_buffer,
                            "last_op_seq": seq - 1,
                            "encode_start_ns": start,
                            "encode_end_ns": start + 2,
                        },
                        separators=(",", ":"),
                    )
                    + "\n"
                )
            output.write(
                json.dumps(
                    {
                        "record": "wait",
                        "bucket": "cb_wait_until_completed",
                        "at_ns": command_buffer_count * 10,
                        "wait_ns": 1,
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )
            output.write(
                json.dumps(
                    {
                        "record": "summary",
                        "complete": True,
                        "dropped_rows": 0,
                        "ops_total": seq,
                        "cbs_total": command_buffer_count,
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )

        tracemalloc.start()
        try:
            result = curate_trace(
                self.source, self.destination, max_command_buffers=1
            )
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()

        self.assertEqual(result["ops"], ops_per_command_buffer)
        self.assertLess(
            peak,
            64 * 1024 * 1024,
            f"curator peak Python heap was {peak / (1024 * 1024):.1f} MiB",
        )

    def test_high_cardinality_anchor_search_uses_bisect_not_cb_scans(self):
        command_buffer_count = 2_000
        rows = []
        for cb_index in range(command_buffer_count):
            start = cb_index * 10
            rows.extend(
                [
                    {
                        "record": "cb",
                        "command_buffer_index": cb_index,
                        "op_count": 0,
                        "first_op_seq": 0,
                        "last_op_seq": 0,
                        "encode_start_ns": start,
                        "encode_end_ns": start + 2,
                    },
                    {
                        "record": "wait",
                        "bucket": "cb_wait_until_completed",
                        "at_ns": start + 3,
                        "wait_ns": 1,
                    },
                ]
            )
        rows.append(
            {"record": "summary", "complete": True, "dropped_rows": 0}
        )
        self.write_rows(rows)
        calls = 0

        def counted_bisect(values, target, *args):
            nonlocal calls
            calls += 1
            return bisect.bisect_right(values, target, *args)

        with mock.patch(
            "scripts.curate_trace.bisect_right",
            side_effect=counted_bisect,
            create=True,
        ):
            curate_trace(
                self.source, self.destination, max_command_buffers=64
            )

        self.assertEqual(calls, 1)

    def test_verifier_requires_real_upper_bound_anchor_bucket(self):
        self.write_rows(public_rows(command_buffers=2))
        curate_trace(self.source, self.destination, max_command_buffers=2)
        rows = self.read_rows()
        rows[-1]["anchor_bucket"] = "forged_bucket"
        self.write_rows(rows, self.destination)

        with self.assertRaisesRegex(TraceValidationError, "anchor"):
            verify_curated(self.destination)

    def test_verifier_requires_exact_current_v1_summary_contract(self):
        self.write_rows(public_rows(command_buffers=1))
        curate_trace(self.source, self.destination, max_command_buffers=1)
        valid_rows = self.read_rows()
        corruptions = {
            "missing-schema": lambda summary: summary.pop(
                "schema_version", None
            ),
            "not-final": lambda summary: summary.__setitem__("final", False),
            "wrong-ops": lambda summary: summary.__setitem__("ops_total", 2),
            "wrong-cbs": lambda summary: summary.__setitem__("cbs_total", 2),
            "bad-buckets": lambda summary: summary.__setitem__("buckets", []),
        }

        for name, corrupt in corruptions.items():
            with self.subTest(name=name):
                path = self.root / f"corrupt-v1-{name}.jsonl"
                rows = json.loads(json.dumps(valid_rows))
                corrupt(rows[-1])
                self.write_rows(rows, path)
                with self.assertRaises(TraceValidationError):
                    verify_curated(path)

    def test_integer_fields_enforce_js_safe_integer_domain(self):
        js_safe = 2**53 - 1
        boundary_rows = [
            {
                "record": "op",
                "seq": js_safe,
                "command_buffer_index": js_safe,
            },
            {
                "record": "cb",
                "command_buffer_index": js_safe,
                "op_count": 1,
                "first_op_seq": js_safe,
                "last_op_seq": js_safe,
                "encode_start_ns": js_safe - 20,
                "encode_end_ns": js_safe - 10,
            },
            {
                "record": "wait",
                "bucket": "cb_wait_until_completed",
                "at_ns": js_safe - 9,
                "wait_ns": 1,
            },
            {"record": "summary", "complete": True, "dropped_rows": 0},
        ]
        self.write_rows(boundary_rows)
        curate_trace(self.source, self.destination, max_command_buffers=1)
        self.assertTrue(verify_curated(self.destination)["valid"])

        cases = {
            "huge-index": ("command_buffer_index", js_safe + 1, 0),
            "huge-seq": ("seq", js_safe + 1, 0),
            "huge-count": ("op_count", js_safe + 1, 1),
            "fractional-timestamp": ("encode_start_ns", 1.5, 1),
            "boolean-seq": ("seq", True, 0),
            "enormous-index": ("command_buffer_index", 10**400, 0),
        }
        for name, (field, value, row_index) in cases.items():
            with self.subTest(name=name):
                rows = public_rows(command_buffers=1)
                rows[row_index][field] = value
                source = self.root / f"{name}.jsonl"
                destination = self.root / f"{name}-out.jsonl"
                self.write_rows(rows, source)
                with self.assertRaisesRegex(
                    TraceValidationError, "integer|safe"
                ):
                    curate_trace(
                        source, destination, max_command_buffers=1
                    )

    def test_deep_json_is_line_scoped_and_preserves_destination(self):
        self.destination.write_bytes(b"existing\n")
        deep_value = "[" * 2_000 + "0" + "]" * 2_000
        self.source.write_text(
            '{"record":"op","seq":0,"command_buffer_index":0,"deep":'
            + deep_value
            + "}\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(TraceValidationError, r"line 1.*depth|line 1"):
            curate_trace(self.source, self.destination, max_command_buffers=1)

        self.assertEqual(self.destination.read_bytes(), b"existing\n")
        self.assertEqual(
            list(self.root.glob(f".{self.destination.name}.*.tmp")), []
        )

    def test_rejects_same_path_invalid_limits_and_missing_destination_parent(self):
        self.write_rows(public_rows(command_buffers=1))

        with self.assertRaisesRegex(ValueError, "different"):
            curate_trace(self.source, self.source, max_command_buffers=1)
        for limit in (0, -1, True, 1.5):
            with self.subTest(limit=limit):
                with self.assertRaises(ValueError):
                    curate_trace(
                        self.source, self.destination, max_command_buffers=limit
                    )
        with self.assertRaisesRegex(FileNotFoundError, "parent"):
            curate_trace(
                self.source,
                self.root / "missing" / "output.jsonl",
                max_command_buffers=1,
            )

    def test_cli_curates_and_verifies(self):
        self.write_rows(public_rows(command_buffers=1))
        script = Path(__file__).parent / "scripts" / "curate_trace.py"
        curate = subprocess.run(
            [
                sys.executable,
                str(script),
                str(self.source),
                str(self.destination),
                "--max-command-buffers",
                "1",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(curate.returncode, 0, curate.stderr)
        self.assertIn('"command_buffers":1', curate.stdout)

        verify = subprocess.run(
            [sys.executable, str(script), "--verify", str(self.destination)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(verify.returncode, 0, verify.stderr)
        self.assertIn('"valid":true', verify.stdout)


if __name__ == "__main__":
    unittest.main()
