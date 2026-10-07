#!/usr/bin/env python3
"""100 fixed-pool cycles of affine quantities with a full Calculation history."""
from pathlib import Path
import re
exec(Path(__file__).with_name('test-calculation-quantities.py').read_text(encoding='utf8').split('\nsummation=')[0].replace('timeout=180','timeout=600'))
body=''
for i in range(104):
 body+=keys('AC 2 ADD 3 ENTER')*60
 body+=keys('AC')+amount('20','Degree Celsius',23)+keys('ENTER')+check('5863/20','5863/20')+'assert_calc_input quantity role point\n'
 body+=target('Degree Fahrenheit',60)+check('68','5863/20')+output()+all_units()+'assert_calc_input toolbox dump\n'+keys('BACK')+'assert_calc_input unit_menu closed\nassert_calc_input toolbox closed\n'
 body+=keys('AC ans SUB')+amount('32','Degree Fahrenheit',60)+keys('ENTER')+check('20','20')+'assert_calc_input quantity role difference\n'
 body+=output()+keys('DOWN ENTER')+check('20','20')+keys('STO 1 AC ALPHA 1 ENTER UP')+check('20','20')+'assert_calc_input quantity role difference\n'
 body+=keys('AC')+amount('20','Degree Celsius',23)+keys('ADD')+amount('10','Kelvin',5)+keys('ENTER')+'assert_calc_status quantity_error\nassert_calc_input quantity error affine_operation\n'
 body+=keys('AC ans ENTER')+check('20','20')+'assert_calc_input quantity role difference\n'+keys('AC 2 ADD 2 ENTER')+check('4')
 body+=keys('HOME')+'wait 20\nassert_app Menu\ncalculus_probe\nopen_app Calculation\nwait 20\n'
run('temperature-cycles',body)
log=(a.out/'temperature-cycles.log').read_text(encoding='utf8')
homes=[dict(re.findall(r'(\w+)=(\d+)',line)) for line in log.splitlines() if line.startswith('CALCULUS_PROBE|app=Menu|')]
modal=[dict(re.findall(r'(\w+)=(\d+)',line)) for line in log.splitlines() if line.startswith('[TOOLBOX-MEM]')]
assert len(homes)==104 and len(modal)==104
for h in homes[4:]:
 for field in ('objects','timers','pool_total','pool_free','handles'):assert h[field]==homes[4][field],(field,h,homes[4])
assert 0<int(homes[4]['pool_total'])<=65536
(a.out/'resources.json').write_text(json.dumps(dict(warmups=4,cycles=100,historyCapacity=50,evaluationsToFillBeforeEach=60,homes=homes,modal=modal,minimumSampledFree=min(int(m['free']) for m in modal),minimumSampledLargestBlock=min(int(m['largest']) for m in modal)),indent=2))
assert all(r['passed'] for r in records.values())
print('PASS 100 temperature cycles, full history, fixed 64KiB pool')
