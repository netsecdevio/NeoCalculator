#!/usr/bin/env python3
"""Validate the single unit source; reproducibly emit immutable C++ and inventory."""
import argparse
import json
import re
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/math/units/registry.json'

def quoted(value):
    return json.dumps(value, ensure_ascii=False)

def help_text(value):
    # UI prose uses the compact Latin font; mathematical notation stays in the
    # typed STIX preview. Do not render unsupported superscripts as tofu.
    value=re.sub('[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+',lambda m:'^'+m[0].translate(str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺','0123456789-+')),value)
    return value.replace('≈','approx.').replace('π','pi').replace('μ','micro').replace('Ω','ohm').replace('×','*').replace('µ','micro').replace('°','deg')

def exact(value):
    assert len(value) == 4
    n, d, e, p = value
    assert all(type(x) is int for x in value)
    assert -(2**63) < n < 2**63 and 0 < d < 2**64
    assert -120 <= e <= 120 and -3 <= p <= 3
    return '{%dLL,%dULL,%d,%d}' % (n, d, e, p)

def validate(data):
    assert data['schema'] == 1
    prefixes = data['prefixes']
    assert [p['id'] for p in prefixes] == list(range(25))
    assert len({p['symbol'] for p in prefixes}) == 25
    assert prefixes[0]['exponent'] == 0 and not prefixes[0]['official']
    units = {u['id']: u for u in data['units']}
    cats = {c['id']: c for c in data['categories']}
    assert len(units) == len(data['units']) and len(cats) == len(data['categories'])
    assert len({u['key'] for u in units.values()}) == len(units)
    for c in cats.values():
        assert c['en'] and c['es'] and 0 < c['id'] < 16384
        path = set()
        while c['parent']:
            assert c['id'] not in path
            path.add(c['id']); c = cats[c['parent']]
    for u in units.values():
        assert 0 < u['id'] < 32768
        assert all(u[k] for k in ('en','es','symbol','quantity','reference','location','exactness'))
        assert u['reference'] == 'coherent SI basis (m, kg, s, A, K, mol, cd)' or (u.get('domain') == 'information' and u['reference'] in ('bit','bit count')) or (u.get('domain') == 'count' and u['reference'] in ('specified count','specified count per second'))
        assert len(u['symbol'].encode()) < 24 and len(u['prefixed_symbol'].encode()) < 24
        assert all(isinstance(alias,str) and alias and '|' not in alias for alias in u['aliases'])
        assert u['source'] in data['sources']
        for pid, override in u.get('prefix_name_overrides', {}).items():
            assert int(pid) in u['offered_prefixes'] and override['source'] in data['sources']
            assert override.get('en') or override.get('es')
        assert len(u['dimension']) == 7 and all(type(x) is int and -8 <= x <= 8 for x in u['dimension'])
        exact(u['scale']); exact(u['offset'])
        assert u['exactness'] in ('exact','measured','historical','conventional_approximate')
        assert u['scale'][0] > 0 or (u['conversion']=='formula' and u.get('formula'))
        if u['exactness'] != 'exact': assert u.get('uncertainty_decimal') or u.get('uncertainty_note')
        assert u['conversion'] == ('affine' if u['offset'][0] else 'multiplicative') or (u['conversion']=='formula' and u.get('formula'))
        assert u['temperature_role'] in ('none','absolute','difference')
        if u['temperature_role'] == 'difference': assert u['offset'][0] == 0
        if 'legacy_temperature_unit' in u:
            assert u['temperature_role']=='difference' and units[u['legacy_temperature_unit']]['temperature_role']=='absolute'
        assert u['standard_prefixes'] in ('decimal','not_standardized','astronomical_as')
        assert u['offered_prefixes'] and len(set(u['offered_prefixes'])) == len(u['offered_prefixes'])
        assert all(0 <= p < 25 for p in u['offered_prefixes'])
        if u['standard_prefixes'] != 'decimal': assert u['offered_prefixes'] == [0]
    # All definitions point directly to the coherent SI basis; no recursive
    # definition graph can acquire a hidden cycle. Alias collisions must be
    # explicit in the source instead of silently selecting the first record.
    aliases = {}
    for u in units.values():
        for alias in u['aliases']:
            aliases.setdefault(alias.casefold(),set()).add(u['id'])
    collisions={k:sorted(v) for k,v in aliases.items() if len(v)>1}
    assert collisions == data.get('ambiguous_aliases',{})
    assert len({i['id'] for i in data['items']}) == len(data['items'])
    for i in data['items']:
        assert 0 < i['id'] < 16384 and i['category'] in cats and i['en'] and i['es']
        terms = i.get('terms', [[i.get('unit'), i['default_prefix'], i.get('power',1)]])
        assert 1 <= len(terms) <= 4
        assert 0 <= i.get('prefix_component',0) < len(terms)
        coefficient=i.get('coefficient',[1,1,0,0]);exact(coefficient)
        assert 0<coefficient[0]<=10**9 and coefficient[1]<=10**9 and coefficient[2:]==[0,0]
        for uid, pid, power in terms:
            assert uid in units and pid in units[uid]['offered_prefixes'] and power in (-4,-3,-2,-1,1,2,3,4)
            assert units[uid]['conversion'] != 'affine' or len(terms) == 1
    references=data.get('references',[])
    assert len({r['id'] for r in references})==len(references)
    assert len({r['key'] for r in references})==len(references)
    for r in references:
        assert 0<r['id']<16384 and r['category'] in cats
        assert all(r[k] for k in ('key','en','es','symbol','source','location','exactness'))
        assert r['source'] in data['sources'] and len(r['symbol'].encode())<48
        assert r['kind'] in ('physical_constant','scale','contextual')
        assert r['exactness'] in ('exact','measured','derived','contextual')
        assert r.get('dimension') is None or (len(r['dimension'])==7 and all(type(x) is int and -8<=x<=8 for x in r['dimension']))
        assert all(0<=p<25 for p in r.get('prefixes',[0]))
        if r.get('scale') is not None: exact(r['scale'])
        if r['exactness']=='contextual':assert r.get('scale') is None
    return units, cats

def cpp_enum(value):
    return ''.join(word.title() for word in value.split('_'))

def american(text):
    return text.replace('metre','meter').replace('Metre','Meter').replace('litre','liter').replace('Litre','Liter').replace('Tonne','Metric ton').replace('tonne','metric ton')

def prefixed_name(name, prefix, spanish=False, metre=False, power=1):
    if not prefix['id']:return name
    if metre:
        suffix=(' cuadrado' if power==2 else ' cúbico' if power==3 else ' a la cuarta' if power==4 else '') if spanish else (' squared' if power==2 else ' cubed' if power==3 else ' to the fourth' if power==4 else '')
        stem=prefix['es'][:-1]+{'a':'á','o':'ó','i':'í'}[prefix['es'][-1]] if spanish else prefix['en']
        return stem+('metro' if spanish else 'metre')+suffix
    stem=prefix['es' if spanish else 'en']
    return stem+name[0].lower()+name[1:]

def outputs(data):
    units,cats=validate(data);q=quoted
    lines=['// Generated by scripts/generate-unit-catalog.py. Do not edit.','inline constexpr Prefix kPrefixes[] = {']
    for p in data['prefixes']:lines.append('{PrefixId(%d),%d,%s,%s,%s},'%(p['id'],p['exponent'],q(p['symbol']),q(p['en']),q(p['es'])))
    lines+=['};','inline constexpr PrefixId kPrefixOrder[] = {'+','.join('PrefixId(%d)'%p['id'] for p in sorted(data['prefixes'],key=lambda p:-p['exponent']))+'};','inline constexpr Definition kDefinitions[] = {']
    for u in sorted(units.values(),key=lambda u:u['id']):
        mask=(1<<25)-1 if u['standard_prefixes']=='decimal' else ((1|(1<<15)|(1<<16)|(1<<18)) if u['standard_prefixes']=='astronomical_as' else 1)
        offered=sum(1<<p for p in u['offered_prefixes'])
        fields=['UnitId(%d)'%u['id'],*[q(u[k]) for k in ['key','symbol','prefixed_symbol','en','es']],q('|'.join(u['aliases'])),q(u['quantity']),'{'+','.join(map(str,u['dimension']))+'}',exact(u['scale']),exact(u['offset']),str(mask)+'U',str(offered)+'U','Conversion::'+cpp_enum(u['conversion']),'TemperatureRole::'+cpp_enum(u['temperature_role']),*[q(u[k]) for k in ['source','location','variant']],'Exactness::'+cpp_enum(u['exactness']),q(u.get('domain','si')),q(u.get('uncertainty_decimal',u.get('uncertainty_note',''))),q(u.get('formula',''))]
        lines.append('{'+','.join(fields)+'},')
    lines+=['};','struct TemperatureAlias { UnitId legacy, unit; };','inline constexpr TemperatureAlias kTemperatureAliases[] = {']
    for u in sorted(units.values(),key=lambda u:u['id']):
        if 'legacy_temperature_unit' in u:lines.append('{UnitId(%d),UnitId(%d)},'%(u['id'],u['legacy_temperature_unit']))
    lines+=['};','inline constexpr Category kCategories[] = {']
    for c in data['categories']:lines.append('{%d,%d,%s,%s},'%(c['id'],c['parent'],q(c['en']),q(c['es'])))
    lines+=['};','inline constexpr Item kItems[] = {']
    entries=['// Unit namespace 0x8000; stable item ID + prefix ID.'];meta=[]
    inventory=['# Generated unit inventory','','Source: `src/math/units/registry.json`. IDs do not depend on order.','', '| ID | Symbol | English / Español | Kind | SI nominal scale and offset | Exactness | Source / location |','|---|---|---|---|---|---|---|']
    for u in sorted(units.values(),key=lambda u:u['id']):inventory.append(f"| {u['id']} | {u['symbol']} | {u['en']} / {u['es']} | {u['quantity']} | {u['scale']} ; offset {u['offset']} | {u['exactness']} | {u['source']}: {u['location']} |")
    for i in sorted(data['items'],key=lambda i:i['id']):
        terms=i.get('terms',[[i.get('unit'),0,i.get('power',1)]])
        component=i.get('prefix_component',0);definition=units[terms[component][0]]
        selector=i.get('prefix_selector','unit' in i) and len(definition['offered_prefixes'])>1
        quantity=i.get('quantity',units[terms[0][0]]['quantity'])
        ts=[]
        for uid,prefix,power in terms:
            d=units[uid];role=i.get('temperature_role',d['temperature_role'])
            if d['temperature_role']!='none' and (len(terms)>1 or power!=1):role='difference'
            uid=d.get('legacy_temperature_unit',uid)
            ts.append('{{UnitId(%d),PrefixId(%d)},%d}'%(uid,prefix,power) if role=='none' else '{{UnitId(%d),PrefixId(%d),TemperatureRole::%s},%d}'%(uid,prefix,cpp_enum(role),power))
        coefficient=i.get('coefficient',[1,1,0,0])
        lines.append('{%d,%d,%s,%s,%s,{%s},%d,PrefixId(%d),%s,%d,%dU,%dU},'%(i['id'],i['category'],q(i['en']),q(i['es']),q(quantity),','.join(ts),len(terms),i['default_prefix'],str(selector).lower(),component,*coefficient[:2]))
        for pid in (definition['offered_prefixes'] if selector else [0]):
            p=data['prefixes'][pid]
            en=prefixed_name(i['en'],p,metre=i.get('unit')==1,power=i.get('power',1))
            es=prefixed_name(i['es'],p,True,metre=i.get('unit')==1,power=i.get('power',1))
            override=definition.get('prefix_name_overrides',{}).get(str(pid),{}) if len(terms)==1 else {}
            en,es=override.get('en',en),override.get('es',es)
            en_us=prefixed_name(i['en_us'],p) if 'en_us' in i else american(en)
            es_419=prefixed_name(i['es_419'],p,True) if 'es_419' in i else es
            aliases=list(definition['aliases']) if not pid and len(terms)==1 else []
            aliases+=i.get('aliases',[]) if not pid else []
            aliases+=definition.get('variant_aliases',{}).get(str(pid),[])
            if i.get('unit')==1:aliases.append((p['en'] if pid else '')+'meter')
            aliases+=([en_us] if en_us!=en else [])+([es_419] if es_419!=es else [])
            symbol_aliases=(definition.get('symbol_aliases',[]) if not pid and len(terms)==1 else [])+(i.get('symbol_aliases',[]) if not pid else [])+definition.get('variant_symbol_aliases',{}).get(str(pid),[])+i.get('variant_symbol_aliases',{}).get(str(pid),[])
            base_help='Typed unit. EXE inserts; RIGHT chooses a prefix.' if selector else 'Typed unit. EXE inserts; FORMAT shows options.'
            base_help_es='Unidad tipada. EXE inserta; DER elige prefijo.' if selector else 'Unidad tipada. EXE inserta; FORMAT abre opciones.'
            help_en=help_text(i.get('help_en',definition.get('help_en',base_help)));help_es=help_text(i.get('help_es',definition.get('help_es',base_help_es)))
            entries.append('{{%d,%d},%d,Recipe::Unit,%dU,Calculation,%s,%s,%s,%s,%s,%d,true,false,nullptr},'%(0x8000|i['id'],pid,i['category'],i['id'],q(en),q(es),q(help_en),q(help_es),q('|'.join(dict.fromkeys(aliases))),(0x8000|i['id']) if selector else 0))
            if en_us!=en or es_419!=es or symbol_aliases:meta.append((0x8000|i['id'],pid,en_us if en_us!=en else '',es_419 if es_419!=es else '','|'.join(symbol_aliases)))
    lines+=['};']
    refs=data.get('references',[]);ref_lines=['// Generated typed reference data.','inline constexpr std::array<Reference,%d> kReferences = {{'%len(refs)];ref_entries=['// Reference namespace 0x4000; never a unit/free variable identity.']
    for r in sorted(refs,key=lambda r:r['id']):
        notation=r.get('notation',{});base=notation.get('base',r['symbol']);sub=notation.get('sub','');den=notation.get('denominator',{})
        if 'numerator' in notation:base=notation['numerator'].get('base','');sub=notation['numerator'].get('sub','')
        prefixes=r.get('prefixes',[0]);scale=r.get('scale')
        fields=['ReferenceId(%d)'%r['id'],str(r['category']),'ReferenceKind::'+cpp_enum(r['kind']),'Exactness::'+cpp_enum(r['exactness']),str(sum(1<<p for p in prefixes))+'U',*[q(r.get(k,'')) for k in ['key','symbol','en','es']],q('|'.join(r.get('aliases',[]))),q('|'.join(r.get('symbol_aliases',[]))),q(r.get('quantity',r['kind'])),'{'+','.join(map(str,r.get('dimension') or [0]*7))+'}',str(r.get('dimension') is not None).lower(),*[q(r.get(k,'') or '') for k in ['nominal_decimal','uncertainty_decimal','formula','source','location']],q(base),q(sub),q(den.get('base','')),q(den.get('sub','')),q(notation.get('sup','')),exact(scale or [0,1,0,0]),str(scale is not None).lower()]
        ref_lines.append('{'+','.join(fields)+'},')
        for pid in prefixes:
            p=data['prefixes'][pid];en=prefixed_name(r['en'],p);es=prefixed_name(r['es'],p,True)
            en_us=prefixed_name(r.get('en_us',american(r['en'])),p)
            es_419=prefixed_name(r.get('es_419',r['es']),p,True)
            aliases=list(r.get('aliases',[]))+([en_us] if en_us!=en else [])+([es_419] if es_419!=es else [])
            ref_entries.append('{{%d,%d},%d,Recipe::QuantityReference,%dU,Calculation,%s,%s,%s,%s,%s,%d,true,false,nullptr},'%(0x4000|r['id'],pid,r['category'],r['id'],q(en),q(es),q(help_text(r.get('help_en',''))),q(help_text(r.get('help_es',''))),q('|'.join(dict.fromkeys(aliases))),(0x4000|r['id']) if len(prefixes)>1 else 0))
            symbols=r.get('symbol_aliases',[]) if not pid else []
            if symbols or en_us!=en or es_419!=es:meta.append((0x4000|r['id'],pid,en_us if en_us!=en else '',es_419 if es_419!=es else '','|'.join(symbols)))
    ref_lines+=['}};']
    metadata=['// Sparse regional names and exact symbol aliases.','struct UnitVariantMetadata {Identity identity;const char *enUS,*es419,*symbols;};','constexpr UnitVariantMetadata unitVariantMetadata[] = {']
    for uid,pid,en,es,symbols in sorted(meta):metadata.append('{{%d,%d},%s,%s,%s},'%(uid,pid,q(en),q(es),q(symbols)))
    metadata+=['};']
    # Navigation adjacency, not a second definition/factor table. Preserve the
    # provider's category -> item -> reference order exactly.
    navigation=['// Generated navigation positions; identities remain stable.',
                'struct UnitGroupIndex {uint16_t id, first, count;};']
    rows=[];groups=[]
    for group in sorted({0, *cats}):
        children=[c['id'] for c in data['categories'] if c['parent']==group]
        children += [0x8000|i['id'] for i in sorted(data['items'],key=lambda i:i['id']) if i['category']==group]
        children += [0x4000|r['id'] for r in sorted(refs,key=lambda r:r['id']) if r['category']==group]
        groups.append((group,len(rows),len(children)));rows+=children
    assert len(rows)<65536
    navigation+=['constexpr uint16_t unitGroupRows[] = {'+','.join(map(str,rows))+'};',
                 'constexpr UnitGroupIndex unitGroups[] = {']
    navigation+=['{%d,%d,%d},'%g for g in groups]+['};']
    inventory+=['',f"Definitions: {len(units)}. Catalogue items: {len(data['items'])}. Insertable offered variants: {len(entries)-1}. Official prefixes: 24 + neutral. Typed references: {len(refs)}.",'','## Sources','']
    if refs:
        reference_inventory=['','## Typed physical references and contextual scales','',
            '| Reference ID | Symbol | English / Español | Kind / exactness | Nominal / uncertainty | Formula or context | Source / location |',
            '|---|---|---|---|---|---|---|']
        for r in sorted(refs,key=lambda r:r['id']):
            cells=[str(r['id']),r['symbol'],r['en']+' / '+r['es'],r['kind']+' / '+r['exactness'],
                str(r.get('nominal_decimal') or 'context required')+' / '+str(r.get('uncertainty_decimal') or 'not a fixed measured value'),
                r.get('formula') or r.get('help_en',''),r['source']+': '+r['location']]
            reference_inventory.append('| '+' | '.join(c.replace('|','\\|').replace('\n',' ') for c in cells)+' |')
        inventory[-2:-2]=reference_inventory
    for key,source in data['sources'].items():inventory.append(f"- {key}: [{source['version']}]({source['url']}). {source.get('location','')}".rstrip())
    inventory+=['','## Deferred','']+[f'- {k}: {v}.' for k,v in data.get('deferred',{}).items()]
    return {ROOT/'src/math/units/UnitRegistryData.inc':'\n'.join(lines)+'\n',ROOT/'src/math/units/UnitToolboxEntries.inc':'\n'.join(entries)+'\n',ROOT/'src/math/units/ReferenceRegistryData.inc':'\n'.join(ref_lines)+'\n',ROOT/'src/math/units/ReferenceToolboxEntries.inc':'\n'.join(ref_entries)+'\n',ROOT/'src/math/units/UnitVariantMetadata.inc':'\n'.join(metadata)+'\n',ROOT/'src/math/units/UnitNavigationIndex.inc':'\n'.join(navigation)+'\n',ROOT/'docs/UNIT_CATALOG_02_INVENTORY.md':'\n'.join(inventory)+'\n'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
    generated=outputs(json.loads(SOURCE.read_text(encoding='utf8')))
    for path,text in generated.items():
        if args.check: assert path.read_text(encoding='utf8')==text, f'Stale generated file: {path}'
        elif not path.exists() or path.read_text(encoding='utf8')!=text:path.write_text(text,encoding='utf8')
    print('Unit registry validated; generated outputs '+('match' if args.check else 'written'))
if __name__=='__main__': main()
