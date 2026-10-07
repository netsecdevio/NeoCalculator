#include "math/ToolboxCatalog.h"
#include "math/ToolboxStore.h"
#include "math/CalculationEngine.h"
#include "math/CursorController.h"
#include "math/VariableManager.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
using namespace vpam;
using namespace numos;
namespace {
unsigned checks=0;
void check(bool ok,const char* text) {++checks;if(!ok){std::printf("FAIL %s\n",text);std::exit(1);}}
units::Atom atom(uint16_t unit,uint8_t prefix=0) {return {units::UnitId(unit),units::PrefixId(prefix)};}
const toolbox::Entry* entry(uint16_t item,uint8_t prefix=0) {return toolbox::find({uint16_t(0x8000|item),prefix});}
void query(const char* text,uint16_t item,uint8_t prefix) {
    check(entry(item,prefix) && toolbox::searchRank(*entry(item,prefix),text)==0,"exact unit query");
}
}
int main() {
    check(GiacEngine::instance().begin(),"Giac initialization");
    auto& engine=CalculationEngine::instance();
    auto wide=makeRow();auto* wideRow=static_cast<NodeRow*>(wide.get());
    for(unsigned i=0;i<150;++i){if(i)wideRow->appendChild(makeOperator(OpKind::Add));wideRow->appendChild(makeNumber("2"));}
    check(scanUnits(wide.get())==UnitScan::None && engine.evaluate(wide.get()).exactText=="300","wide ordinary input retains the established node budget");
    auto prior=engine.evaluate(makeNumber("42").get());engine.noteAnsRotated(prior.exactText,false);
    size_t variants=0;
    for(const auto& d:units::kDefinitions)for(unsigned p=0;p<25;++p) {
        const auto a=atom(uint16_t(d.id),p);auto node=makeUnit(a);
        check(bool(node)==units::valid(a),"typed constructor validates every standard combination");
        if(!node)continue;
        ++variants;check(node->type()==NodeType::Unit,"identity is not a variable");
        auto copied=cloneNode(node.get());check(static_cast<NodeUnit*>(copied.get())->atom()==units::normalized(a),"clone preserves identity and role");
        uint8_t data[5]{};units::Atom restored=atom(1);
        check(units::encode(a,data) && units::decode(data,5,restored) && restored==units::normalized(a),"closed machine atom roundtrip");
        std::string text,error;check(!CalculationEngine::serializeForGiac(node.get(),text,error),"unit never serializes as free identifier");
        const auto evaluated=engine.evaluate(node.get());check(quantity::admissible(a)==quantity::Error::None?evaluated.ok():evaluated.status==MathEngineStatus::UnitsUnavailable,"metadata admits exact multiplicative variants only");
        char symbol[32]{};check(units::symbol(a,symbol,sizeof(symbol)),"bounded canonical symbol");
        auto fm=defaultFontMetrics();node->calculateLayout(fm);check(node->layout().width>0,"unit layout");
    }
    check(!makeUnit(atom(65535)) && !makeUnit(atom(1,25)) && !makeUnit(atom(47,10)),"corrupt and disallowed atoms rejected");
    units::Atom destination=atom(1,15);const auto before=destination;
    const uint8_t corrupt[][5]={{0x55,3,1,0,0},{0x55,1,255,255,0},{0x55,1,1,0,25},{0x55,1,47,0,10}};
    for(const auto& bytes:corrupt)
        check(!units::decode(bytes,5,destination) && destination==before,"unknown schema/ID/variant preserves destination");
    check(engine.evaluate(makeVariable(VAR_ANS).get()).exactText=="42","unit guards preserve Ans");
    query("metro",1,0);query("metre",1,0);query("meter",1,0);
    query("milimetro",1,15);query("milímetro",1,15);query("millimeter",1,15);
    query("ohm",18,0);query("ohmio",18,0);query("Ω",18,0);
    query("microsegundo",3,16);query("µs",3,16);query("μs",3,16);
    check(toolbox::searchRank(*entry(18),"resistencia")<4,"quantity search");
    for(const auto pair:{std::pair<const char*,uint8_t>{"mA",15},{"MA",9}}) {
        query(pair.first,4,pair.second);
        check(toolbox::searchRank(*entry(4,pair.second==15?9:15),pair.first)==99,"case-sensitive current symbols");
    }
    query("MHz",10,9);query("mHz",10,15);query("Pa",12,0);query("pA",4,18);query("s",3,0);query("S",19,0);
    query("kilohm",18,10);query("megohm",18,9);
    for(size_t i=0;i<toolbox::entryCount();++i) {
        const auto& e=*toolbox::entryAt(i);if(e.recipe!=toolbox::Recipe::Unit)continue;
        check(toolbox::available(e,toolbox::Calculation),"Calculation receives units");
        check(!toolbox::available(e,toolbox::Equations|toolbox::Calculus|toolbox::Grapher),"other applications cannot receive units as letters");
    }
    const auto& provider=toolbox::catalogProvider();
    check(provider.initialFrom(nullptr,0x8001,{0x8001,0})==12,"neutral metre centred in complete scale");
    check(provider.initialFrom(nullptr,0x8001,{0x8001,15})==15,"favorite reopens exact prefix");
    check(provider.at(nullptr,0x8001,0).entry->identity.variant==1 && provider.at(nullptr,0x8001,24).entry->identity.variant==24,"prefix extremes available");
    check(provider.at(nullptr,208,0).entry->identity==toolbox::Identity{0x8002,10},"kg entry is kilo gram identity");
    for(uint16_t item:{uint16_t(101),uint16_t(102)}) {
        auto p=toolbox::prepare(*entry(item,14));check(p.node->type()==NodeType::Power,"prefix squared/cubed structurally");
        check(static_cast<NodeUnit*>(p.node->child(0)->child(0))->atom()==atom(1,14),"prefix is inside power base");
    }
    for(uint16_t item=110;item<=120;++item) {
        auto p=toolbox::prepare(*entry(item));check(p.node && scanUnits(p.node.get())==UnitScan::Present,"compound built from typed components");
    }
    {
        auto product=makeRow();auto* target=static_cast<NodeRow*>(product.get());CursorController cursor;cursor.init(target);
        auto ah=toolbox::prepare(*entry(113));check(cursor.insertPrepared(std::move(ah.node),nullptr),"compound insertion");
        check(target->childCount()==3 && target->child(0)->type()==NodeType::Unit && target->child(2)->type()==NodeType::Unit,"unit product components are editable in the receiving row");
        cursor.insertPower();cursor.insertDigit('2');
        check(target->child(2)->type()==NodeType::Power && scanUnits(target->child(2))==UnitScan::Present,"power edits last explicit unit component");
    }
    auto root=makeRow();auto* row=static_cast<NodeRow*>(root.get());CursorController cursor;cursor.init(row);
    cursor.insertDigit('2');auto second=toolbox::prepare(*entry(3));check(cursor.insertPrepared(std::move(second.node),nullptr),"insert after number");
    check(row->childCount()==3 && row->child(0)->type()==NodeType::Number && static_cast<NodeOperator*>(row->child(1))->op()==OpKind::UnitAttach,"number and unit structural product");
    auto metre=toolbox::prepare(*entry(1));check(cursor.insertPrepared(std::move(metre.node),nullptr),"adjacent units");
    check(static_cast<NodeOperator*>(row->child(3))->op()==OpKind::UnitProduct,"m dot s not millisecond");
    cursor.insertPower();cursor.insertDigit('2');check(scanUnits(root.get())==UnitScan::Present,"power edit keeps unit");
    check(engine.evaluate(root.get()).ok(),"edited quantity computes");
    {
        auto nested=makeRow();CursorController c;c.init(static_cast<NodeRow*>(nested.get()));
        c.insertParen();auto p=toolbox::prepare(*entry(18,10));
        check(c.insertPrepared(std::move(p.node),nullptr),"unit insertion inside real parentheses");
        check(scanUnits(nested.get())==UnitScan::Present,"parenthesis retains typed unit");
        c.moveLeft();c.moveRight();c.backspace();
        check(scanUnits(nested.get())==UnitScan::None,"cursor and delete remove the unit as one atom");
    }
    auto zero=makeRow();auto* zr=static_cast<NodeRow*>(zero.get());zr->appendChild(makeNumber("0"));zr->appendChild(makeOperator(OpKind::Mul));zr->appendChild(makeUnit(atom(1)));
    check(engine.evaluate(zr).quantity && engine.evaluate(zr).quantity->dimension.powers[0]==1,"zero product retains length");
    auto ratio=makeFraction(makeUnit(atom(1)),makeUnit(atom(1)));
    check(engine.evaluate(ratio.get()).exactText=="1" && !engine.evaluate(ratio.get()).quantity,"ratio cancels only after scaling");
    check(engine.evaluate(makeVariable('m').get()).ok(),"free m remains a variable");
    VariableManager::instance().setVariable('A',ExactVal::fromInt(7));
    check(engine.evaluate(makeUnit(atom(4)).get()).ok(),"ampere is a unit despite memory A");
    check(engine.evaluate(makeVariable('A').get()).exactText=="7","ampere does not read or overwrite memory A");
    check(engine.evaluate(makeSymbol("Ω").get()).ok(),"free Greek omega remains separate from ohm");
    auto ordinary=makeRow();auto* r=static_cast<NodeRow*>(ordinary.get());r->appendChild(makeNumber("2"));r->appendChild(makeOperator(OpKind::Add));r->appendChild(makeNumber("2"));
    check(engine.evaluate(r).exactText=="4","ordinary computation resumes without restart");
    std::printf("PASS %u checks, %zu standard unit/prefix atoms; NodeUnit=%zu bytes\n",checks,variants,sizeof(NodeUnit));
}
