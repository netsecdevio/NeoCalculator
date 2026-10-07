#!/usr/bin/env python3
"""Sample native C++/AST allocations; this is not the complete Giac/C heap peak."""
from pathlib import Path
from fractions import Fraction
import re
exec(Path(__file__).with_name('test-calculation-quantities.py').read_text(encoding='utf8').split('\nsummation=')[0])
long='123456789123456789';canonical=str(Fraction(long)+Fraction(27315,100));fahrenheit=str(Fraction(long)*Fraction(9,5)+32)
body=amount(long,'Degree Celsius',23)+keys('ENTER')+check(canonical,canonical)
body+=target('Degree Fahrenheit',60)+check(fahrenheit,canonical)
body+=keys('FORMAT STO 1 AC 7 ENTER UP UP')+check(canonical,canonical)
samples={}
for scope in ('analysis','convert','compose','ans','memory','selector','publish','format','history'):
 env.update(NUMOS_TOOLBOX_SCOPE=scope,NUMOS_TOOLBOX_FAIL_AT='0',NUMOS_TOOLBOX_FAIL_CALL='2' if scope=='history' else '1')
 run(scope,body)
 log=(a.out/(scope+'.log')).read_text(encoding='utf8');entries=[dict(re.findall(r'(\w+)=([\w-]+)',line)) for line in log.splitlines() if line.startswith('TOOLBOX_ALLOC')]
 assert len(entries)==1 and entries[0]['failures']=='0' and records[scope]['passed'];samples[scope]=entries[0]
(a.out/'allocations.json').write_text(json.dumps(dict(scope='native new/new[] plus AST; excludes C malloc and LVGL',samples=samples),indent=2))
