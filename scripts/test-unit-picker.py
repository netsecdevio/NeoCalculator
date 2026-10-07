#!/usr/bin/env python3
"""Real menu events for contextual output choices; no direct publication calls."""
from pathlib import Path
import re
exec(Path(__file__).with_name('test-calculation-quantities.py').read_text(encoding='utf8').split('\nsummation=')[0])
velocity=amount('6','km',1,10)+keys('FRAC')+amount('300','Second',3)+keys('RIGHT ENTER')
quick=output()+'assert_calc_input unit_menu geometry\n'+keys('DOWN ENTER')
run('quick-speed',velocity+check('20','20','1:0:1,3:0:-1')+output()+'assert_calc_input unit_menu dump\n'+shot('quick-speed')+keys('DOWN')+shot('quick-kmh-selected')+keys('ENTER')+check('72','20','1:10:1,48:0:-1')+shot('speed-kmh')+keys('AC ans FRAC')+amount('2','Second',3)+keys('ENTER')+check('10','10','1:0:1,3:0:-2'))
run('quick-length',amount('2','metre',1)+keys('ENTER')+quick+check('200','2','1:14:1'))
run('quick-energy',amount('100','Watt',14)+keys('MUL')+amount('2','hour',48)+keys('ENTER')+output()+shot('quick-energy')+keys('DOWN ENTER')+check('1/5','720000','14:10:1,48:0:1'))
favorite=keys('TOOLBOX')+search('mm')+selected(1,15)+keys('FORMAT ENTER BACK BACK')
run('quick-favorite',favorite+amount('2','metre',1)+keys('ENTER')+output()+'assert_calc_input unit_menu dump\n'+keys('DOWN')+shot('quick-favorite')+keys('ENTER')+check('2000','2','1:15:1'))
run('all-components-cancel',velocity+output()+all_units()+shot('all-units')+keys('BACK')+check('20','20','1:0:1,3:0:-1')+output()+components()+shot('by-components')+keys('BACK')+'assert_calc_input unit_menu dump\n'+keys('BACK')+check('20','20','1:0:1,3:0:-1'))
run('held-confirm',velocity+output()+keys('DOWN')+'keydown ENTER\n'+'keyrepeat ENTER\n'*8+'keyup ENTER\n'+'assert_calc_input unit_menu closed\n'+check('72','20','1:10:1,48:0:-1')+'assert_calc_input quantity dump\n'+keys('FORMAT FORMAT')+check('72','20','1:10:1,48:0:-1'))
run('empty-search',velocity+output()+all_units()+keys('ALPHA')+shot('empty-search')+'sdl_text zzzzz\nassert_calc_input toolbox query\n'+shot('no-destinations')+keys('DOWN ENTER BACK BACK')+check('20','20','1:0:1,3:0:-1')+keys('AC 2 ADD 2 ENTER')+check('4'))
mapping=(root/'src/input/generated/ProductionKeypadMap.generated.h').read_text(encoding='utf8')
contacts=mapping.split('kProductionKeypadMap = {{',1)[1].split('}};',1)[0]
coordinates=[m.groups() for line in contacts.splitlines() if (m:=re.match(r'\s*\{(\d+), (\d+),',line))]
planes=[line for line in mapping.split('kTextPlaneDefinitions = {{',1)[1].split('}};',1)[0].splitlines() if '{{{' in line]
def physical_text(query):
 result=''
 for letter in query:
  i=next(i for i,line in enumerate(planes) if 'SemanticId::code_'+letter+',' in line)
  result+='calc_physical 3 0\ncalc_physical %s %s\nassert_calc_input toolbox query\n'%coordinates[i]
 return result
for query in ('metro','metre','meter','milimetro','kilometre'):
 prefix=15 if query=='milimetro' else 10 if query=='kilometre' else 0
 body=amount('2','metre',1)+keys('ENTER')+output()+all_units()+physical_text(query)+keys('DOWN')+selected(1,prefix)+keys('BACK BACK')+check('2','2','1:0:1')
 run('contacts-'+query,body)
run('contacts-microsegundo',amount('2','Second',3)+keys('ENTER')+output()+all_units()+physical_text('microsegundo')+keys('DOWN')+selected(3,16)+shot('physical-search')+keys('ENTER')+check('2000000','2','3:16:1'))
unusual=amount('1','metre',1)
for query,item,prefix in [('Second',3,0),('kg',2,10),('Ampere',4,0),('delta k',61,0),('mole',6,0),('candela',7,0)]:
 unusual+=keys('MUL')+amount('1',query,item,prefix)
run('unusual-current',unusual+keys('ENTER')+check('1','1')+output()+'assert_calc_input unit_menu geometry\n'+shot('unusual-current')+keys('BACK')+check('1','1'))
raise SystemExit(0 if records and all(r['passed'] for r in records.values()) else 1)
