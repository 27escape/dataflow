#!/bin/bash
set -euo pipefail
shopt -s nullglob

for i in examples/*.flow
do
  echo "$i"
  b=$(basename "$i" .flow)
  ./dataflow.ts "$i" -o "examples/${b}-dfd.png" -d
  ./dataflow.ts "$i" -o "examples/${b}-seq.png"
  # ./dataflow.ts "$i" -o "examples/${b}-dfd.svg" -d
  # ./dataflow.ts "$i" -o "examples/${b}-seq.svg"
  ./dataflow.ts "$i" -o "examples/${b}-report.md" --report

  ./dataflow.ts "$i" -o "examples/${b}-dfd-e.png" -d --explain
  ./dataflow.ts "$i" -o "examples/${b}-seq-e.png" --explain
  # ./dataflow.ts "$i" -o "examples/${b}-dfd-e.svg" -d --explain
  # ./dataflow.ts "$i" -o "examples/${b}-seq-e.svg" --explain
  ./dataflow.ts "$i" -o "examples/${b}-report-e.md" --report --explain
done
