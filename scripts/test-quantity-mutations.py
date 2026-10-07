#!/usr/bin/env python3
"""Compile isolated deliberate defects; unchanged independent typed tests must reject them."""
import argparse,json,os,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--host',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];a.out.mkdir(parents=True,exist_ok=True)
env=dict(os.environ,PATH='C:/mingw64/bin;C:/SDL2/x86_64-w64-mingw32/bin;'+os.environ['PATH'])
commands=json.loads((a.host/'commands.json').read_text());base=commands[0]['command'];rsp=(a.host/'quantity_calculation_checks.rsp').read_text()
mutations=[
 ('omit-kilo','Quantity',[('e.decimal+prefix','e.decimal')]),
 ('prefix-power-once','Quantity',[('std::to_string(t.power)','std::to_string(1)')]),
 ('gram-as-kilogram','Quantity',[('const auto factor=exact(d->scale,units::prefix(a.prefix)->exponent);','auto broken=d->scale;if(uint16_t(a.unit)==2)broken.decimal=0;const auto factor=exact(broken,units::prefix(a.prefix)->exponent);')]),
 ('cancel-without-scaling','Quantity',[('a.meaning=propagated(a,b,op==OpKind::Div);','if(op==OpKind::Div && a.dimension==b.dimension)b.coefficient="1";a.meaning=propagated(a,b,op==OpKind::Div);')]),
 ('incompatible-add','Quantity',[('if(a.dimension!=b.dimension)return fail(Error::DimensionMismatch);','')]),
 ('output-label-only','Quantity',[('group(canonical)+"/"+group(scale(descriptor))','group(canonical)')]),
 ('rescale-ans','CalculationEngine',[('out=*slot.quantity;return true;','out=*slot.quantity;out.coefficient="100*("+out.coefficient+")";return true;')]),
 ('unit-as-scalar','Quantity',[('out.dimension=dimension(a);out.meaning=a.unit;','out.dimension={};out.meaning=a.unit;')]),
 ('erase-context','Quantity',[('return fail(r->exactness==units::Exactness::Measured?Error::UncertaintyPending:\n                    r->kind==units::ReferenceKind::PhysicalConstant?Error::ReferencePending:Error::ContextPending);','out.coefficient="0";return true;')]),
 ('affine-as-factor','Quantity',[('out.role=a.role==TemperatureRole::Absolute?Role::TemperaturePoint:linearRole(out.dimension);','out.role=linearRole(out.dimension);')]),
 ('measured-as-exact','Quantity',[('if(d.exactness==units::Exactness::Measured)return Error::UncertaintyPending;',''),('if(d.exactness!=units::Exactness::Exact)return Error::ApproximatePending;','')]),
 ('fuel-without-100','ToolboxCatalog',[]),
]
records=[]
for name,unit,replacements in mutations:
 directory=a.out/name;directory.mkdir(exist_ok=True);text=(root/'src/math'/(unit+'.cpp')).read_text(encoding='utf8')
 if name=='fuel-without-100':
  provider=(root/'src/math/units/UnitToolboxProvider.inc').read_text(encoding='utf8').replace('static_cast<unsigned long>(item->coefficientDenominator)','static_cast<unsigned long>(1)')
  assert 'units/UnitToolboxProvider.inc' in text;text=text.replace('#include "units/UnitToolboxProvider.inc"',provider)
 for before,after in replacements:
  assert before in text,(name,before);text=text.replace(before,after)
 cpp=directory/(unit+'.cpp');obj=directory/(unit+'.o');cpp.write_text(text,encoding='utf8')
 command=base.copy();command[command.index('-c')+1]=str(cpp.resolve());command[command.index('-o')+1]=str(obj.resolve());command+=['-Isrc/math','-Isrc/math/units']
 r=subprocess.run(command,cwd=root,env=env,capture_output=True);(directory/'compile.log').write_bytes(r.stdout+r.stderr);assert r.returncode==0,name
 old=next(line for line in rsp.splitlines() if line.endswith('/'+unit+'.o"'))
 link=rsp.replace(old,'"'+obj.resolve().as_posix()+'"');response=directory/'link.rsp';response.write_text(link)
 binary=directory/'mutant.exe';r=subprocess.run(['g++','@'+str(response.resolve()),'-Wl,--gc-sections','-o',str(binary.resolve())],cwd=root,env=env,capture_output=True);(directory/'link.log').write_bytes(r.stdout+r.stderr);assert r.returncode==0,name
 r=subprocess.run([str(binary.resolve())],cwd=root,env=env,capture_output=True,timeout=120);log=r.stdout+r.stderr;(directory/'run.log').write_bytes(log)
 killed=r.returncode==1 and b'FAIL' in log;records.append(dict(name=name,rejected=killed,exit=r.returncode));print(name,'REJECTED' if killed else 'SURVIVED',flush=True)
 (a.out/'results.json').write_text(json.dumps(records,indent=2))
assert len(records)==12 and all(r['rejected'] for r in records),records
