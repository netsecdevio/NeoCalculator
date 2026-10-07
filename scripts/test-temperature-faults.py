#!/usr/bin/env python3
"""Persistent allocation faults on affine construction, display and ownership."""
from pathlib import Path
from fractions import Fraction
import re
exec(Path(__file__).with_name('test-calculation-quantities.py').read_text(encoding='utf8').split('\nsummation=')[0])
long='123456789123456789';canonical=str(Fraction(long)+Fraction(27315,100))
q=amount(long,'Degree Celsius',23)+keys('ENTER')
ordinary=keys('AC 2 ADD 2 ENTER')+check('4')
for scope in ('analysis','convert','compose','ans','memory','selector','publish','format','history'):
 for point in ((1,) if scope in ('ans','selector') else (1,2)):
  env.update(NUMOS_TOOLBOX_SCOPE=scope,NUMOS_TOOLBOX_FAIL_AT=str(point),NUMOS_TOOLBOX_FAIL_CALL='2' if scope=='history' else '1')
  if scope in ('analysis','convert','compose'):body=q+'assert_calc_status out_of_memory\nassert_calc_input unit 23 0 1\n'+keys('ENTER')+check(canonical,canonical)
  elif scope=='ans':body=q+'assert_calc_input no_result\n'+keys('ENTER')+check(canonical,canonical)
  elif scope=='memory':body=q+keys('STO 1 AC ALPHA 1 ENTER')+check('0')
  elif scope=='selector':body=q+output()+all_units()+'assert_calc_input toolbox closed\n'+check(canonical,canonical)
  elif scope=='publish':body=q+output()+all_units()+search('Degree Fahrenheit')+selected(60)+keys('ENTER')+'assert_calc_input toolbox open\n'+check(canonical,canonical)+'assert_calc_input quantity role point\n'+keys('BACK BACK')
  elif scope=='format':body=q+keys('FORMAT')+check(canonical,canonical)
  else:body=q+keys('AC 7 ENTER UP UP')+check('7')
  name=scope+'-'+str(point);run(name,body+ordinary)
  log=(a.out/(name+'.log')).read_text(encoding='utf8');samples=[dict(re.findall(r'(\w+)=([\w-]+)',line)) for line in log.splitlines() if line.startswith('TOOLBOX_ALLOC')]
  records[name]['samples']=samples;records[name]['passed'] &= any(int(s['failures'])>0 for s in samples)
(a.out/'results.json').write_text(json.dumps(records,indent=2))
raise SystemExit(0 if all(r['passed'] for r in records.values()) else 1)
