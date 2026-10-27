#!/bin/bash

for i in examples/*flow
do
  echo "$i"
  b=$(basename "$i" .flow)
  ./dataflow.ts "$i" -o examples/${b}-dfd.png -d 
  ./dataflow.ts "$i" -o examples/${b}-seq.png
  ./dataflow.ts "$i" -o examples/${b}-report.md --report
done
