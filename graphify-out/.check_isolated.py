import json
from collections import Counter
from pathlib import Path

data = json.loads(Path('graphify-out/graph.json').read_text(encoding='utf-8'))
degree = Counter()
for e in data['links']:
    degree[e['source']] += 1
    degree[e['target']] += 1

nodes_by_id = {n['id']: n for n in data['nodes']}
isolated = [n for n in data['nodes'] if degree[n['id']] <= 1]

print(f'Total isolated/weak nodes (degree<=1): {len(isolated)}')
print()
by_type = Counter(n.get('file_type') for n in isolated)
for t, c in by_type.most_common():
    print(f'  {t}: {c}')
print()
by_source = Counter(n.get('source_file') for n in isolated)
print('Top source files:')
for s, c in by_source.most_common(15):
    print(f'  {c:3d}  {s}')
print()
print('Sample labels (first 40):')
for n in isolated[:40]:
    print(f'  [{n.get("file_type")}] {n.get("label")}  <- {n.get("source_file")}')
