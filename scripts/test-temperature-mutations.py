#!/usr/bin/env python3
"""Mandatory affine mutations, killed by independent host or real UI oracles."""
import argparse,json,os,subprocess,ctypes
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--host',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--native',type=Path,required=True);p.add_argument('--database',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];a.out.mkdir(parents=True,exist_ok=True)
env=dict(os.environ,PATH='C:/mingw64/bin;C:/SDL2/x86_64-w64-mingw32/bin;'+os.environ['PATH'],PYTHONIOENCODING='utf-8')
commands=json.loads((a.host/'commands.json').read_text());base=commands[0]['command'];rsp=(a.host/'temperature_checks.rsp').read_text()
offset='if(out.role==Role::TemperaturePoint && d->offset.numerator)out.coefficient+="+"+exact(d->offset);'
mutations=[
 ('offset-on-difference','Quantity',[(offset,'if(d->offset.numerator)out.coefficient+="+"+exact(d->offset);')]),
 ('omit-point-offset','Quantity',[(offset,'')]),
 ('fahrenheit-inverse-factor','Quantity',[('const auto factor=exact(d->scale,units::prefix(a.prefix)->exponent);','const auto factor=unsigned(a.unit)==60?std::string("(9/5)"):exact(d->scale,units::prefix(a.prefix)->exponent);')]),
 ('add-two-points','Quantity',[('kAddRole[3][3]={{0,3,3},{3,3,1},{3,1,2}}','kAddRole[3][3]={{0,3,3},{3,1,1},{3,1,2}}')]),
 ('display-point-as-difference','Quantity',[('auto result=makeUnit(term.atom);','if(term.atom.role==TemperatureRole::Absolute)term.atom.role=TemperatureRole::Difference;auto result=makeUnit(term.atom);')]),
 ('lose-role-in-ans','CalculationEngine',[('out=*slot.quantity;return true;','out=*slot.quantity;out.role=quantity::Value::Role::TemperatureDifference;return true;')]),
 ('double-offset','Quantity',[(offset,offset+offset)]),
 ('infer-difference-from-neighbor','Quantity',[('if(a.dimension!=b.dimension)return fail(Error::DimensionMismatch);','if(a.dimension!=b.dimension)return fail(Error::DimensionMismatch);if(a.role==Role::TemperaturePoint && b.role==Role::TemperaturePoint && op==OpKind::Add)b.role=Role::TemperatureDifference;')]),
 ('favorite-point-becomes-difference','ToolboxCatalog',[('auto term=item->terms[0];','auto term=item->terms[0];if(item->id==23)term.atom.role=units::TemperatureRole::Difference;')]),
 ('negative-fahrenheit-coordinate','Quantity',[('out.dimension=dimension(a);out.meaning=a.unit;','if(unsigned(a.unit)==60)out.coefficient="abs("+out.coefficient+")";out.dimension=dimension(a);out.meaning=a.unit;')]),
 ('reaumur-factor','Quantity',[('const auto factor=exact(d->scale,units::prefix(a.prefix)->exponent);','const auto factor=unsigned(a.unit)==1181?std::string("(4/5)"):exact(d->scale,units::prefix(a.prefix)->exponent);')]),
 ('display-from-previous-display','CalculationApp',[('if(numos::quantity::convert(*_quantity,descriptor,*view)!=numos::quantity::Error::None)return false;','auto previous=*_quantity;previous.coefficient=_quantityView->exact;if(numos::quantity::convert(previous,descriptor,*view)!=numos::quantity::Error::None)return false;')]),
]
records=[]
for name,unit,replacements in mutations:
 directory=a.out/name;directory.mkdir(exist_ok=True);folder='apps' if unit=='CalculationApp' else 'math';source=(root/'src'/folder/(unit+'.cpp')).read_text(encoding='utf8')
 if unit=='ToolboxCatalog':source=source.replace('#include "units/UnitToolboxProvider.inc"',(root/'src/math/units/UnitToolboxProvider.inc').read_text(encoding='utf8'))
 for before,after in replacements:assert before in source,(name,before);source=source.replace(before,after)
 cpp=directory/(unit+'.cpp');obj=directory/(unit+'.o');cpp.write_text(source,encoding='utf8')
 command=base.copy();command[command.index('-c')+1]=str(cpp.resolve());command[command.index('-o')+1]=str(obj.resolve());command+=['-Isrc/math','-Isrc/math/units','-Isrc/apps']
 def run(label,cmd,timeout=180):
  r=subprocess.run(cmd,cwd=root,env=env,capture_output=True,timeout=timeout);(directory/(label+'.log')).write_bytes(r.stdout+r.stderr);return r
 if unit=='CalculationApp':
  record=next(x for x in json.loads(a.database.read_text()) if x['file'].endswith('CalculationApp.cpp'))
  parse=ctypes.windll.shell32.CommandLineToArgvW;parse.argtypes=[ctypes.c_wchar_p,ctypes.POINTER(ctypes.c_int)];parse.restype=ctypes.POINTER(ctypes.c_wchar_p);n=ctypes.c_int();argv=parse(record['command'],ctypes.byref(n));command=[argv[i] for i in range(n.value)];ctypes.windll.kernel32.LocalFree(argv)
  command[command.index('-o')+1]=str(obj.resolve());command[-1]=str(cpp.resolve());command+=['-Isrc/apps']
 assert run('compile',command).returncode==0,name
 if unit!='CalculationApp':
  old=next(line for line in rsp.splitlines() if line.endswith('/'+unit+'.o"'));link=rsp.replace(old,'"'+obj.resolve().as_posix()+'"');extra=[]
 else:
  objects=[obj.resolve() if f.name=='CalculationApp.o' else f.resolve() for f in (a.native/'src').rglob('*.o')];libs=[*a.native.rglob('liblvgl.a'),*a.native.rglob('libgiac.a'),*a.native.rglob('libtommath.a')];link='\n'.join('"'+f.as_posix()+'"' for f in [*objects,*libs]);extra=['-LC:/SDL2/x86_64-w64-mingw32/lib','-lmingw32','-lSDL2main','-lSDL2']
 response=directory/'link.rsp';response.write_text(link);binary=directory/'mutant.exe'
 assert run('link',['g++','@'+str(response.resolve()),*extra,'-Wl,--gc-sections','-o',str(binary.resolve())]).returncode==0,name
 cmd=[str(binary.resolve())] if unit!='CalculationApp' else ['python','scripts/test-temperature-product.py','--bin',str(binary.resolve()),'--out',str(directory/'ui'),'--only','ans-history']
 r=run('run',cmd);killed=r.returncode==1 and b'FAIL' in r.stdout+r.stderr
 records.append(dict(name=name,rejected=killed,exit=r.returncode));print(name,'REJECTED' if killed else 'SURVIVED',flush=True);(a.out/'results.json').write_text(json.dumps(records,indent=2))
assert len(records)==12 and all(r['rejected'] for r in records)
