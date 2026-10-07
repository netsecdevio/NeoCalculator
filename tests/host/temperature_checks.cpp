// Exact external oracles: BIPM SI, NIST temperature equations and UCUM 2.2.
// Expected numbers below deliberately do not read scale/offset from registry.
#include "math/CalculationEngine.h"
#include "math/ToolboxCatalog.h"
#include "math/ToolboxStore.h"
#include "math/VariableManager.h"
#include "math/CursorController.h"
#include "ui/UnitQuickChoices.h"
#include "hal/FileSystem.h"
#include "lvgl.h"
#include <cstdio>
#include <cstdlib>
#include <numeric>
#include <filesystem>
using namespace numos;
using namespace vpam;
using Role=quantity::Value::Role;
using TR=units::TemperatureRole;
unsigned checks=0;
void check(bool ok,const char* message){++checks;if(!ok){std::fprintf(stderr,"FAIL %s\n",message);std::exit(1);}}
struct Rational {
    int64_t n,d;
    Rational(int64_t a,int64_t b=1):n(a),d(b){const auto g=std::gcd(n,d);n/=g;d/=g;if(d<0){n=-n;d=-d;}}
    std::string text()const{return std::to_string(n)+(d==1?"":"/"+std::to_string(d));}
};
Rational operator+(Rational a,Rational b){return {a.n*b.d+b.n*a.d,a.d*b.d};}
Rational operator-(Rational a,Rational b){return {a.n*b.d-b.n*a.d,a.d*b.d};}
Rational operator*(Rational a,Rational b){return {a.n*b.n,a.d*b.d};}
Rational operator/(Rational a,Rational b){return {a.n*b.d,a.d*b.n};}
NodePtr scalar(Rational r){auto n=makeNumber(std::to_string(std::abs(r.n)));if(r.n<0){auto signedRow=makeRow();auto* row=static_cast<NodeRow*>(signedRow.get());row->appendChild(makeOperator(OpKind::Sub));row->appendChild(std::move(n));n=std::move(signedRow);}return r.d==1?std::move(n):makeFraction(std::move(n),makeNumber(std::to_string(r.d)));}
NodePtr amount(Rational v,unsigned id,TR role=TR::Absolute){auto row=makeRow();auto* r=static_cast<NodeRow*>(row.get());r->appendChild(scalar(v));r->appendChild(makeOperator(OpKind::UnitAttach));r->appendChild(makeUnit({units::UnitId(id),units::PrefixId(0),role}));return row;}
NodePtr point(Rational v,unsigned id=23){return amount(v,id);}
NodePtr delta(Rational v,unsigned id=5){return amount(v,id,TR::Difference);}
NodePtr binary(NodePtr a,OpKind op,NodePtr b){auto row=makeRow();auto* r=static_cast<NodeRow*>(row.get());r->appendChild(makeParen(std::move(a)));r->appendChild(makeOperator(op));r->appendChild(makeParen(std::move(b)));return row;}
auto& engine=CalculationEngine::instance();
CalculationEvaluation expect(NodePtr n,Rational value,Role role){auto result=engine.evaluate(n.get());if(!result.ok() || result.exactText!=value.text())std::fprintf(stderr,"expected=%s got=%s reason=%s\n",value.text().c_str(),result.exactText.c_str(),result.diagnostic.c_str());check(result.ok() && result.quantity && result.quantity->coefficient==value.text() && result.quantity->role==role,"exact canonical and owned role");return result;}
void error(NodePtr n,quantity::Error e=quantity::Error::AffineOperation){auto result=engine.evaluate(n.get());if(result.quantityError!=e)std::fprintf(stderr,"expected error=%s got=%s\n",quantity::errorName(e),result.diagnostic.c_str());check(result.status==MathEngineStatus::QuantityError && result.quantityError==e,"semantic error, never syntax error");check(!engine.commitResultAns(result,nullptr),"error cannot overwrite Ans");auto next=engine.evaluate(binary(makeNumber("2"),OpKind::Add,makeNumber("2")).get());check(next.ok() && next.exactText=="4","2+2 immediately after error without restart");}
quantity::Descriptor output(unsigned unit,TR role){quantity::Descriptor d;d.count=1;d.terms[0]={{units::UnitId(unit),units::PrefixId(0),role},1};return d;}
void view(const quantity::Value& value,unsigned unit,Rational expected){const auto saved=value.coefficient;const auto role=value.role;auto d=output(unit,role==Role::TemperaturePoint?TR::Absolute:TR::Difference);quantity::Display v;check(quantity::convert(value,d,v)==quantity::Error::None && v.exact==expected.text(),"independent exact display oracle");check(value.coefficient==saved && value.role==role,"display preserves canonical and role");auto recovered=engine.evaluate(quantity::compose(std::move(v.exactCoefficient),d).get());check(recovered.ok() && recovered.quantity && recovered.quantity->coefficient==saved && recovered.quantity->role==role,"display AST reevaluation preserves mathematics");}
int main(){
 lv_init();check(GiacEngine::instance().begin(),"Giac begins");
 auto decimal=makeRow();auto* dr=static_cast<NodeRow*>(decimal.get());dr->appendChild(makeNumber("293.15"));dr->appendChild(makeUnit({units::UnitId(5)}));expect(std::move(decimal),Rational(29315,100),Role::TemperaturePoint);
 for(auto v:{0,100,-40,20,-400}){auto p=expect(point(v),Rational(v)+Rational(27315,100),Role::TemperaturePoint);view(*p.quantity,5,Rational(v)+Rational(27315,100));view(*p.quantity,60,Rational(v)*Rational(9,5)+Rational(32));view(*p.quantity,23,v);}
 for(auto v:{32,212,-40,68,-500}){auto p=expect(point(v,60),(Rational(v)-Rational(32))*Rational(5,9)+Rational(27315,100),Role::TemperaturePoint);view(*p.quantity,23,(Rational(v)-Rational(32))*Rational(5,9));}
 auto re=expect(point(80,1181),Rational(37315,100),Role::TemperaturePoint);view(*re.quantity,23,100);
 auto rankine=expect(point(9,1180),5,Role::TemperaturePoint);view(*rankine.quantity,1180,9);
 auto d=expect(binary(point(20),OpKind::Sub,point(10)),10,Role::TemperatureDifference);view(*d.quantity,5,10);view(*d.quantity,23,10);view(*d.quantity,60,18);
 auto df=expect(binary(point(68,60),OpKind::Sub,point(32,60)),20,Role::TemperatureDifference);view(*df.quantity,23,20);
 expect(delta(18,60),10,Role::TemperatureDifference);expect(delta(8,1181),10,Role::TemperatureDifference);
 auto sum=expect(binary(point(20),OpKind::Add,delta(10,23)),Rational(30315,100),Role::TemperaturePoint);view(*sum.quantity,23,30);
 auto sub=expect(binary(point(20),OpKind::Sub,delta(18,60)),Rational(28315,100),Role::TemperaturePoint);view(*sub.quantity,23,10);
 auto rev=expect(binary(delta(10),OpKind::Add,point(32,60)),Rational(28315,100),Role::TemperaturePoint);view(*rev.quantity,60,50);
 expect(binary(delta(18,60),OpKind::Add,delta(8,1181)),20,Role::TemperatureDifference);
 expect(binary(delta(18,60),OpKind::Sub,delta(20)), -10,Role::TemperatureDifference);
 expect(binary(makeNumber("2"),OpKind::Mul,delta(5)),10,Role::TemperatureDifference);
 expect(makeFraction(delta(10),makeNumber("2")),5,Role::TemperatureDifference);
 auto compound=expect(binary(delta(10),OpKind::Mul,makeUnit({units::UnitId(3)})),10,Role::Linear);check(compound.quantity->dimension.powers[4]==1 && compound.quantity->dimension.powers[2]==1,"difference times time");
 auto ratio=engine.evaluate(makeFraction(delta(18,60),delta(10)).get());check(ratio.ok() && !ratio.quantity && ratio.exactText=="1","temperature cancels exactly");
 expect(makeParen(delta(-18,60),DelimKind::Bar),10,Role::TemperatureDifference);
 auto ln=engine.evaluate(makeFunction(FuncKind::Ln,makeFraction(delta(18,60),delta(10))).get());check(ln.ok() && !ln.quantity && ln.exactText=="0","transcendental after cancellation");
 for(unsigned unit:{5u,23u,60u,1180u,1181u}) {
  error(binary(point(20,unit),OpKind::Add,point(10,unit)));
  error(binary(delta(10),OpKind::Sub,point(20,unit)));
  error(binary(point(20,unit),OpKind::Mul,makeNumber("2")));
  error(binary(makeNumber("0"),OpKind::Mul,point(20,unit)));
  error(makeFraction(point(20,unit),makeNumber("1")));
  error(makePower(point(20,unit),makeNumber("0")));
  error(makePower(point(20,unit),makeNumber("2")));
  error(makeRoot(point(20,unit)));
  error(makeParen(point(20,unit),DelimKind::Bar));
  error(makeFunction(FuncKind::Ln,point(20,unit)));
  error(makeFunction(FuncKind::Sin,point(20,unit)));
 }
 error(binary(point(20),OpKind::Add,point(10,5)));
 error(makeFunction(FuncKind::Ln,delta(10)),quantity::Error::DimensionMismatch);
 auto negative=makeRow();auto* nr=static_cast<NodeRow*>(negative.get());nr->appendChild(makeOperator(OpKind::Sub));nr->appendChild(makeNumber("40"));nr->appendChild(makeUnit({units::UnitId(60)}));expect(std::move(negative),Rational(23315,100),Role::TemperaturePoint);
 // Generated bounded affine-space laws, with an independent rational oracle.
 for(int a=-60;a<=60;a+=12)for(int b=-20;b<=20;b+=10) {
  expect(binary(binary(point(a),OpKind::Add,delta(b,60)),OpKind::Sub,point(a)),Rational(b)*Rational(5,9),Role::TemperatureDifference);
  expect(binary(binary(point(a),OpKind::Sub,point(b,60)),OpKind::Add,point(b,60)),Rational(a)+Rational(27315,100),Role::TemperaturePoint);
  auto p=expect(point(a),Rational(a)+Rational(27315,100),Role::TemperaturePoint);
  view(*p.quantity,60,Rational(a)*Rational(9,5)+Rational(32));view(*p.quantity,5,Rational(a)+Rational(27315,100));view(*p.quantity,23,a);
  auto interval=expect(delta(b,60),Rational(b)*Rational(5,9),Role::TemperatureDifference);view(*interval.quantity,23,Rational(b)*Rational(5,9));view(*interval.quantity,60,b);
 }
 auto original=point(20);auto cloned=cloneNode(original.get());auto p=expect(std::move(cloned),Rational(29315,100),Role::TemperaturePoint);
 auto greek=engine.evaluate(binary(makeSymbol("Δ"),OpKind::Mul,makeUnit({units::UnitId(23)})).get());check(!greek.ok() && greek.quantityError==quantity::Error::SymbolicPending,"free Delta is not a difference marker");
 auto edited=makeRow();CursorController cursor;cursor.init(static_cast<NodeRow*>(edited.get()));cursor.insertDigit('2');
 auto prepared=toolbox::prepare(*toolbox::find({32768|62,0}));check(cursor.insertPrepared(std::move(prepared.node),nullptr),"insert typed difference");
 auto copy=cloneNode(edited.get());expect(std::move(copy),2,Role::TemperatureDifference);cursor.backspace();check(scanUnits(edited.get())==UnitScan::None,"delete difference as one atom");
 check(engine.commitResultAns(p,nullptr),"commit point Ans");view(*p.quantity,60,68);view(*p.quantity,5,Rational(29315,100));
 expect(binary(makeVariable(VAR_ANS),OpKind::Sub,point(32,60)),20,Role::TemperatureDifference);
 error(binary(makeVariable(VAR_ANS),OpKind::Add,point(10)));
 expect(makeVariable(VAR_ANS),Rational(29315,100),Role::TemperaturePoint);
 error(binary(makeVariable(VAR_ANS),OpKind::Mul,makeNumber("2")));
 std::filesystem::create_directories("out/calc-units-02/session-fs");LittleFSClass::setRoot("out/calc-units-02/session-fs");check(LittleFS.begin(false),"isolated FS");
 for(char name='A';name<='F';++name){check(engine.storeAns(name),"point STO");expect(makeVariable(name),Rational(29315,100),Role::TemperaturePoint);}
 check(engine.commitResultAns(d,nullptr),"commit difference");expect(makeVariable(VAR_PREANS),Rational(29315,100),Role::TemperaturePoint);
 for(char name='A';name<='F';++name){check(engine.storeAns(name),"difference STO");expect(makeVariable(name),10,Role::TemperatureDifference);}
 // Typed identities, migration, codecs, favorite records, and output filtering.
 for(unsigned id:{5u,23u,60u,1180u,1181u})for(auto role:{TR::Absolute,TR::Difference}) {
  units::Atom atom{units::UnitId(id),units::PrefixId(0),role},restored{};uint8_t data[5];
  check(units::encode(atom,data) && units::decode(data,5,restored) && restored==atom,"v2 preserves role");
  const auto saved=restored;data[1]=0xf2;check(!units::decode(data,5,restored) && restored==saved,"unknown role transactional rejection");
  data[1]=1;check(units::decode(data,5,restored) && restored.role==TR::Absolute,"legacy scale means point");
 }
 for(unsigned id:{61u,62u,63u}){uint8_t data[]={0x55,1,uint8_t(id),0,0};units::Atom a;check(units::decode(data,5,a) && a.role==TR::Difference && unsigned(a.unit)==(id==61?5:id==62?23:60),"legacy interval migration");}
 check(!makeUnit({units::UnitId(1),units::PrefixId(0),TR::Difference}),"metre cannot acquire temperature role");
 quantity::Display bad;check(quantity::convert(*p.quantity,output(23,TR::Difference),bad)==quantity::Error::DimensionMismatch,"display cannot turn point into difference");
 check(quantity::convert(*d.quantity,output(23,TR::Absolute),bad)==quantity::Error::DimensionMismatch,"display cannot turn difference into point");
 for(auto pair:{std::pair<unsigned,Role>{23,Role::TemperaturePoint},{62,Role::TemperatureDifference},{1311,Role::TemperatureDifference},{1312,Role::TemperatureDifference}}){const auto* e=toolbox::find({uint16_t(32768|pair.first),0});check(e,"stable catalogue item");auto prepared=toolbox::prepare(*e);auto evaluated=engine.evaluate(prepared.node.get());check(evaluated.ok() && evaluated.quantity->role==pair.second,"favorite restores its own role");}
 auto& favorites=toolbox::Store::instance();favorites.load();toolbox::Identity pi{32768|23,0},di{32768|62,0};if(!favorites.contains(pi))favorites.toggle(pi);if(!favorites.contains(di))favorites.toggle(di);check(favorites.contains(pi) && favorites.contains(di),"favorites distinguish point and difference");check(favorites.save(),"persist favorite identities");
 for(const char* q:{"delta c","diferencia temperatura","temperature difference"})check(toolbox::searchRank(*toolbox::find(di),q)<4,"difference search aliases");
 for(const auto* v:{p.quantity.get(),d.quantity.get()}){auto current=quantity::coherent(*v);ui::UnitQuickChoices quick;quick.prepare(*v,current);check(quick.count>=2,"common temperature choices");for(unsigned i=0;i<quick.count;++i){quantity::Descriptor target;check(quantity::descriptor(quick.ids[i].id&0x3fff,uint8_t(quick.ids[i].variant),target) && quantity::compatible(*v,target),"quick choice role filter");}}
 std::printf("PASS temperature: %u exact, role, algebra, migration, session, favorite and quick-choice assertions\n",checks);
}
