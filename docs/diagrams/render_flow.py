"""Render the inspected architecture, using only pinned local vector assets.

Python standard library; no network or installation. SVG is self-contained.
PNG can be rendered separately with an existing SVG renderer.
"""
from pathlib import Path
import hashlib
import html
import json
import re
import xml.etree.ElementTree as ET

BASE = Path(__file__).resolve().parent
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
graph = json.loads((BASE / 'flow.json').read_text(encoding='utf-8'))
assets = json.loads((BASE / graph['asset_manifest']).read_text(encoding='utf-8'))
allowed = {'svg', 'g', 'path', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'title', 'desc', 'use'}
def vector(key, width=72):
    asset = assets[key]
    path = (BASE / asset['path']).resolve()
    assert path.is_relative_to(BASE)
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == asset['sha256'], key
    assert not re.search(br'<!DOCTYPE|<!ENTITY', raw, re.I)
    root = ET.fromstring(raw)
    assert root.tag == f'{{{NS}}}svg'
    for el in root.iter():
        assert el.tag.split('}')[-1] in allowed, el.tag
        for name, value in el.attrib.items():
            name = name.split('}')[-1]
            assert not name.lower().startswith('on') and name != 'base'
            if name in {'href', 'src'}:
                assert value.startswith('#')
            assert '@import' not in value.lower()
            for url in re.findall(r'url\s*\(([^)]*)\)', value, re.I):
                assert url.strip().strip('\"\'').startswith('#')
    # Prefix internal IDs so gradients/clips from different marks stay distinct.
    ids = {el.get('id'): f'{key}-{el.get("id")}' for el in root.iter() if el.get('id')}
    for el in root.iter():
        for name, value in list(el.attrib.items()):
            if name == 'id':
                el.set(name, ids[value])
            else:
                for original, replacement in ids.items():
                    value = value.replace(f'url(#{original})', f'url(#{replacement})')
                    if name.split('}')[-1] == 'href' and value == f'#{original}':
                        value = f'#{replacement}'
                el.set(name, value)
    box = [float(x) for x in re.split('[ ,]+', root.get('viewBox', '').strip())]
    assert len(box) == 4 and box[2] > 0 and box[3] > 0
    scale = width / max(box[2:])
    root.set('width', str(box[2] * scale))
    root.set('height', str(box[3] * scale))
    root.set('x', str((100 - box[2] * scale) / 2))
    root.set('y', str((100 - box[3] * scale) / 2))
    return ET.tostring(root, encoding='unicode')

escape = html.escape
svg = [f'<svg xmlns="{NS}" width="1180" height="500" viewBox="0 0 1180 500" role="img" aria-labelledby="title description"><title id="title">{escape(graph["title"])}</title><desc id="description">{escape(graph["description"])}</desc>',
       '<defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="#343c4c"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#aeb8cb"/></marker></defs>',
       '<rect width="1180" height="500" rx="20" fill="#171c28"/><rect width="1180" height="500" rx="20" fill="url(#dots)"/>']
for edge in graph['edges']:
    dash = ' stroke-dasharray="6 7"' if edge.get('optional') else ''
    svg.append(f'<path d="{edge["path"]}" fill="none" stroke="#aeb8cb" stroke-width="2.2"{dash} marker-end="url(#arrow)"/>')
for node in graph['nodes']:
    key = node['asset']
    svg.append(f'<g transform="translate({node["x"]} {node["y"]})" aria-label="{escape(assets[key]["name"])}"><rect width="100" height="100" rx="18" fill="#fff" stroke="#b1bacb" stroke-width="1.2"/>')
    if key == 'pglite':
        svg.append('<rect x="12" y="12" width="76" height="76" rx="12" fill="#202531"/>')
    svg.append(vector(key, 96 if key == 'pglite' else 72))
    svg.append(f'<text x="50" y="131" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="20" font-weight="500" fill="#e0e6f0">{escape(assets[key]["name"])}</text></g>')
svg.append('</svg>')
(BASE / 'technology-flow.svg').write_text(''.join(svg), encoding='utf-8')
print('Self-contained SVG rendered: six cards, eight inspected relationships; dotted optional API branch.')
