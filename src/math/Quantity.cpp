#include "Quantity.h"
#include "CalculationEngine.h"
#include "InputRowSyntax.h"
#include "AngleModeRuntime.h"
#include <algorithm>
#include <cstring>
#include <cstdlib>
#include <cstdio>

namespace numos::quantity {
namespace {
using namespace vpam;
using units::UnitId;
using units::PrefixId;
using Role=Value::Role;
using TemperatureRole=units::TemperatureRole;
constexpr unsigned kNodes=192,kDepth=16,kCalls=64,kText=2000;
bool temperature(const Dimension& d) {
    for(unsigned i=0;i<kDimensions;++i)if(d.powers[i]!=(i==4?1:0))return false;
    return true;
}
Role linearRole(const Dimension& d){return temperature(d)?Role::TemperatureDifference:Role::Linear;}
// Rows/columns: linear, point, difference. 3 is an undefined affine operation.
constexpr uint8_t kAddRole[3][3]={{0,3,3},{3,3,1},{3,1,2}};
constexpr uint8_t kSubtractRole[3][3]={{0,3,3},{3,2,1},{3,3,2}};
bool same(const char* a,const char* b){return a && b && !std::strcmp(a,b);}
const char* meaning(UnitId id){const auto* d=units::definition(id);return d?d->quantity:"";}
std::string group(const std::string& s){return "("+s+")";}
std::string exact(const units::Exact& e,int prefix=0) {
    std::string s=std::to_string(e.numerator);
    if(e.denominator!=1)s+="/"+std::to_string(e.denominator);
    if(e.decimal+prefix)s+="*10^("+std::to_string(e.decimal+prefix)+")";
    if(e.piPower)s+="*pi^("+std::to_string(e.piPower)+")";
    return group(s);
}
bool combine(Dimension& a,const Dimension& b,int sign) {
    auto next=a;
    for(unsigned i=0;i<kDimensions;++i) {
        int n=int(a.powers[i])+sign*int(b.powers[i]);
        if(n < -kExponentLimit || n > kExponentLimit)return false;
        next.powers[i]=int8_t(n);
    }
    a=next;return true;
}
bool power(Dimension& a,int numerator,int denominator) {
    auto next=a;
    if(denominator<=0 || denominator>16 || numerator < -kExponentLimit || numerator>kExponentLimit)return false;
    for(unsigned i=0;i<kDimensions;++i) {
        const int n=int(a.powers[i])*numerator;
        if(n%denominator || n/denominator < -kExponentLimit || n/denominator>kExponentLimit)return false;
        next.powers[i]=int8_t(n/denominator);
    }
    a=next;return true;
}
bool scalarTree(const EngineResultNode& n,unsigned& budget,unsigned depth=0) {
    if(!budget-- || depth>40)return false;
    switch(n.kind) {
        case EngineNodeKind::Integer:case EngineNodeKind::Decimal:case EngineNodeKind::Rational:
        case EngineNodeKind::Pi:case EngineNodeKind::EulerE:case EngineNodeKind::Add:
        case EngineNodeKind::Neg:case EngineNodeKind::Mul:case EngineNodeKind::Inv:
        case EngineNodeKind::Pow:case EngineNodeKind::Sqrt:case EngineNodeKind::Root:
        case EngineNodeKind::Function:break;
        default:return false;
    }
    for(const auto& c:n.children)if(!scalarTree(c,budget,depth+1))return false;
    return true;
}
bool imaginaryTree(const EngineResultNode& n) {
    if(n.kind==EngineNodeKind::ImagUnit || n.kind==EngineNodeKind::Complex)return true;
    for(const auto& c:n.children)if(imaginaryTree(c))return true;
    return false;
}
Error scalar(const std::string& source,StructuredEngineResult& result,bool radians=false) {
    if(source.size()>kText)return Error::ExpressionLimit;
    result=GiacEngine::instance().evaluateStructured(source.c_str(),true,
        radians?GiacEngine::EvaluationAngle::Radians:GiacEngine::EvaluationAngle::Current);
    if(result.base.status==MathEngineStatus::OutOfMemory)return Error::Allocation;
    if(!result.base.ok() || !result.hasTree)return Error::ScalarDomain;
    unsigned budget=400;
    if(!scalarTree(result.tree,budget))return imaginaryTree(result.tree)?Error::ComplexPending:Error::SymbolicPending;
    return Error::None;
}
UnitId propagated(const Value& a,const Value& b,bool divide) {
    if(b.dimension.scalar())return a.meaning;
    if(a.dimension.scalar() && !divide)return b.meaning;
    const char* x=meaning(a.meaning);const char* y=meaning(b.meaning);
    // Local physical relations with known operands, not inference from a vector.
    if(divide && same(x,"voltage") && same(y,"current"))return UnitId(18);
    if(!divide && ((same(x,"current") && same(y,"resistance")) || (same(y,"current") && same(x,"resistance"))))return UnitId(16);
    if(!divide && ((same(x,"power") && same(y,"time")) || (same(y,"power") && same(x,"time"))))return UnitId(13);
    if(!divide && ((same(x,"current") && same(y,"time")) || (same(y,"current") && same(x,"time"))))return UnitId(15);
    if(!divide && ((same(x,"voltage") && same(y,"current")) || (same(y,"voltage") && same(x,"current"))))return UnitId(14);
    return UnitId{};
}
struct Walker {
    const void* owner;Resolve resolve;
    Error error=Error::None;unsigned nodes=0,calls=0;
    bool fail(Error e){if(error==Error::None)error=e;return false;}
    bool checked(Value& value,bool radians=false) {
        if(++calls>kCalls)return fail(Error::ExpressionLimit);
        StructuredEngineResult r;const auto e=scalar(value.coefficient,r,radians);
        if(e!=Error::None)return fail(e);
        value.coefficient=std::move(r.base.exactText);return true;
    }
    bool apply(Value& a,Value b,OpKind op) {
        if(op==OpKind::Add || op==OpKind::Sub) {
            if(a.dimension!=b.dimension)return fail(Error::DimensionMismatch);
            if(unsigned(a.role)>2 || unsigned(b.role)>2)return fail(Error::InvalidIdentity);
            const auto role=(op==OpKind::Add?kAddRole:kSubtractRole)[unsigned(a.role)][unsigned(b.role)];
            if(role==3)return fail(Error::AffineOperation);
            a.role=Role(role);
            if(!same(meaning(a.meaning),meaning(b.meaning)))a.meaning=UnitId{};
        } else {
            if(a.role==Role::TemperaturePoint || b.role==Role::TemperaturePoint)return fail(Error::AffineOperation);
            if(op==OpKind::Div) {
                if(!checked(b))return false;
                if(b.coefficient=="0")return fail(Error::DivisionByZero);
            }
            a.meaning=propagated(a,b,op==OpKind::Div);
            if(!combine(a.dimension,b.dimension,op==OpKind::Div?-1:1))return fail(Error::ExponentLimit);
            a.role=linearRole(a.dimension);
        }
        const char symbol=op==OpKind::Add?'+':op==OpKind::Sub?'-':op==OpKind::Mul?'*':'/';
        a.coefficient=group(a.coefficient)+symbol+group(b.coefficient);
        return a.coefficient.size()<=kText || fail(Error::ExpressionLimit);
    }
    bool exponent(Value& a,Value b,bool root=false) {
        if(a.role==Role::TemperaturePoint || b.role==Role::TemperaturePoint)return fail(Error::AffineOperation);
        if(!b.dimension.scalar())return fail(Error::DimensionMismatch);
        if(!checked(b))return false;
        // The closed scalar was evaluated by Giac. Read its typed rational;
        // never approximate an exponent or parse a user's formula as text.
        StructuredEngineResult r;
        if(++calls>kCalls)return fail(Error::ExpressionLimit);
        const auto e=scalar(b.coefficient,r);if(e!=Error::None)return fail(e);
        ExactVal rational;
        if(!CalculationEngine::resultTreeToExactVal(r.tree,rational) || !rational.isRational() ||
           rational.num < -64 || rational.num>64 || rational.den>16 || rational.den<=0)return fail(Error::ExponentLimit);
        int p=int(rational.num),q=int(rational.den);
        if(root){if(p<=0 || q!=1 || p>16)return fail(Error::ExponentLimit);q=p;p=1;}
        if(!power(a.dimension,p,q))return fail(Error::ExponentLimit);
        a.role=linearRole(a.dimension);
        if(!(p==1 && q==1))a.meaning=UnitId{};
        if(p<0){Value denominator=a;if(!checked(denominator))return false;if(denominator.coefficient=="0")return fail(Error::DivisionByZero);}
        a.coefficient=root?"surd("+a.coefficient+","+std::to_string(q)+")":group(a.coefficient)+"^("+std::to_string(p)+"/"+std::to_string(q)+")";
        return checked(a);
    }
    bool node(const MathNode* n,Value& out,unsigned depth=0) {
        if(!n)return fail(Error::Incomplete);
        if(++nodes>kNodes || depth>kDepth)return fail(Error::ExpressionLimit);
        auto child=[&](const MathNode* c,Value& v){return node(c,v,depth+1);};
        switch(n->type()) {
            case NodeType::Empty:return fail(Error::Incomplete);
            case NodeType::Row: {
                // WHY: syntax visitors consume operator atoms without entering
                // node(). Count them too, and reject oversized rows before the
                // visitor or Giac can process an arbitrarily long sign chain.
                const auto count=n->childCount();
                if(count>int(kNodes-nodes) || (count && depth==kDepth))return fail(Error::ExpressionLimit);
                for(int i=0;i<count;++i)
                    if(n->child(i) && n->child(i)->type()==NodeType::Operator)++nodes;
                struct Sink {
                    Walker& w;unsigned depth;Value sum,term;bool hasSum=false,hasTerm=false,negative=false;
                    OpKind pending=OpKind::Mul,addition=OpKind::Add;
                    bool fail(const char* m){return w.fail(std::strstr(m,"incomplete")?Error::Incomplete:Error::FunctionUnsupported);}
                    bool unary(OpKind op){if(op==OpKind::Sub)negative=!negative;return true;}
                    bool flush(){if(!hasTerm)return true;if(!hasSum){sum=std::move(term);hasSum=true;}else if(!w.apply(sum,std::move(term),addition))return false;hasTerm=false;return true;}
                    bool binary(OpKind op){if(inputrow::precedence(op)==1){if(!flush())return false;addition=op;}else pending=op;return true;}
                    bool operand(const MathNode* n){
                        // WHY: a scalar coordinate followed by an atomic point
                        // unit constructs a point. Multiplying an existing point
                        // (including Ans or a parenthesized point) never does.
                        if(n->type()==NodeType::Unit && hasTerm && pending==OpKind::Mul && !negative && term.dimension.scalar() &&
                           units::normalized(static_cast<const NodeUnit*>(n)->atom()).role==TemperatureRole::Absolute) {
                            if(++w.nodes>kNodes || depth+1>kDepth)return w.fail(Error::ExpressionLimit);
                            return w.attach(static_cast<const NodeUnit*>(n)->atom(),term);
                        }
                        Value v;if(!w.node(n,v,depth+1))return false;
                        if(negative){if(v.role==Role::TemperaturePoint)return w.fail(Error::AffineOperation);v.coefficient="-("+v.coefficient+")";}
                        negative=false;
                        if(!hasTerm){term=std::move(v);hasTerm=true;}else if(!w.apply(term,std::move(v),pending))return false;return true;
                    }
                } sink{*this,depth};
                if(!inputrow::visit(*static_cast<const NodeRow*>(n),sink) || !sink.flush())return false;
                out=std::move(sink.sum);return true;
            }
            case NodeType::Unit: {
                out.coefficient="1";return attach(static_cast<const NodeUnit*>(n)->atom(),out);
            }
            case NodeType::QuantityReference: {
                const auto a=static_cast<const NodeQuantityReference*>(n)->atom();const auto* r=units::reference(a.reference);
                if(!units::valid(a))return fail(Error::InvalidIdentity);
                return fail(r->exactness==units::Exactness::Measured?Error::UncertaintyPending:
                    r->kind==units::ReferenceKind::PhysicalConstant?Error::ReferencePending:Error::ContextPending);
            }
            case NodeType::Fraction: {
                const auto* f=static_cast<const NodeFraction*>(n);Value b;
                return child(f->numerator(),out) && child(f->denominator(),b) && apply(out,std::move(b),OpKind::Div);
            }
            case NodeType::Power: {
                const auto* p=static_cast<const NodePower*>(n);Value b;
                return child(p->base(),out) && child(p->exponent(),b) && exponent(out,std::move(b));
            }
            case NodeType::Root: {
                const auto* r=static_cast<const NodeRoot*>(n);Value degree;degree.coefficient="2";
                return child(r->radicand(),out) && (!r->hasDegree() || child(r->degree(),degree)) && exponent(out,std::move(degree),true);
            }
            case NodeType::Paren: {
                const auto* p=static_cast<const NodeParen*>(n);if(!child(p->content(),out))return false;
                if(p->delimKind()==DelimKind::Bar){if(out.role==Role::TemperaturePoint)return fail(Error::AffineOperation);out.coefficient="abs("+out.coefficient+")";return checked(out);}return true;
            }
            case NodeType::Variable: {
                if(resolve && resolve(owner,static_cast<const NodeVariable*>(n)->name(),out))return true;
                std::string error;
                if(!CalculationEngine::serializeForGiac(n,out.coefficient,error,true))return fail(Error::SymbolicPending);
                return checked(out);
            }
            case NodeType::Number:case NodeType::Constant: {
                if(n->type()==NodeType::Constant && static_cast<const NodeConstant*>(n)->constKind()==ConstKind::Imag)return fail(Error::ComplexPending);
                std::string error;
                return CalculationEngine::serializeForGiac(n,out.coefficient,error,true) || fail(Error::Incomplete);
            }
            case NodeType::Symbol:return fail(Error::SymbolicPending);
            case NodeType::Function:case NodeType::Call:case NodeType::LogBase: {
                const char* function=nullptr;const MathNode* arg=nullptr;
                if(n->type()==NodeType::Function) {
                    const auto* f=static_cast<const NodeFunction*>(n);arg=f->argument();
                    switch(f->funcKind()) {
                        case FuncKind::Sin:function="sin";break;case FuncKind::Cos:function="cos";break;case FuncKind::Tan:function="tan";break;
                        case FuncKind::Ln:function="ln";break;case FuncKind::Log:function="log10";break;
                        default:break;
                    }
                } else if(n->type()==NodeType::Call) {
                    const auto* f=static_cast<const NodeCall*>(n);function=f->name().c_str();if(f->childCount()==1)arg=f->child(0);
                } else {const auto* l=static_cast<const NodeLogBase*>(n);Value base;
                    if(!child(l->argument(),out) || !child(l->base(),base))return false;
                    if(!out.dimension.scalar() || !base.dimension.scalar())return fail(Error::DimensionMismatch);
                    if(!checked(base))return false;if(base.coefficient=="0" || base.coefficient=="1")return fail(Error::ScalarDomain);
                    out.coefficient="logb("+out.coefficient+","+base.coefficient+")";return checked(out);
                }
                // Validate children even for unsupported functions before any
                // algebraic simplification can erase an invalid operand.
                if(!arg || !function)return fail(Error::FunctionUnsupported);
                if(!child(arg,out))return false;
                if(out.role==Role::TemperaturePoint)return fail(Error::AffineOperation);
                const bool trig=same(function,"sin") || same(function,"cos") || same(function,"tan");
                bool radians=false;
                if(same(function,"abs")){out.coefficient="abs("+out.coefficient+")";return checked(out);}
                if(same(function,"sqrt")){Value degree;degree.coefficient="2";return exponent(out,std::move(degree),true);}
                if(trig) {
                    Dimension angle;angle.powers[7]=1;
                    if(out.dimension==angle)radians=true;
                    else if(!out.dimension.scalar())return fail(Error::DimensionMismatch);
                } else if(same(function,"ln") || same(function,"exp") || same(function,"log10")) {
                    if(!out.dimension.scalar())return fail(Error::DimensionMismatch);
                } else return fail(Error::FunctionUnsupported);
                out.dimension={};out.meaning=UnitId{};out.coefficient=std::string(function)+"("+out.coefficient+")";
                return checked(out,radians);
            }
            default:return fail(Error::FunctionUnsupported);
        }
    }
    bool attach(units::Atom a,Value& out) {
        const auto e=admissible(a);if(e!=Error::None)return fail(e);
        a=units::normalized(a);const auto* d=units::definition(a.unit);
        out.dimension=dimension(a);out.meaning=a.unit;
        out.role=a.role==TemperatureRole::Absolute?Role::TemperaturePoint:linearRole(out.dimension);
        const auto factor=exact(d->scale,units::prefix(a.prefix)->exponent);
        out.coefficient=out.coefficient=="1"?factor:group(out.coefficient)+"*"+factor;
        if(out.role==Role::TemperaturePoint && d->offset.numerator)out.coefficient+="+"+exact(d->offset);
        return true;
    }
};
std::string scale(const Descriptor& d) {
    std::string s="("+std::to_string(d.numerator)+"/"+std::to_string(d.denominator)+")";
    for(unsigned i=0;i<d.count;++i) {
        const auto& t=d.terms[i];const auto* def=units::definition(t.atom.unit);
        s+="*"+exact(def->scale,units::prefix(t.atom.prefix)->exponent)+"^("+std::to_string(t.power)+")";
    }
    return s;
}
bool pointDescriptor(const Descriptor& d) {
    return d.count==1 && d.terms[0].power==1 && d.numerator==1 && d.denominator==1 &&
        units::normalized(d.terms[0].atom).role==TemperatureRole::Absolute;
}
NodePtr termNode(units::Term term,bool absolute=false) {
    auto result=makeUnit(term.atom);const int p=absolute?std::abs(int(term.power)):int(term.power);
    if(p==1)return result;
    auto exponent=makeRow();auto* row=static_cast<NodeRow*>(exponent.get());
    if(p<0)row->appendChild(makeOperator(OpKind::Sub));row->appendChild(makeNumber(std::to_string(std::abs(p))));
    return makePower(std::move(result),std::move(exponent));
}
}

Error admissible(units::Atom a) {
    if(!units::valid(a))return Error::InvalidIdentity;
    a=units::normalized(a);
    const auto& d=*units::definition(a.unit);
    if(d.conversion==units::Conversion::Affine && d.temperature==TemperatureRole::None)return Error::AffinePending;
    if(d.conversion!=units::Conversion::Multiplicative && d.conversion!=units::Conversion::Affine)return Error::ContextPending;
    if(d.exactness==units::Exactness::Measured)return Error::UncertaintyPending;
    if(d.exactness!=units::Exactness::Exact)return Error::ApproximatePending;
    if(d.scale.numerator<=0 || !d.scale.denominator || !d.offset.denominator ||
       (d.conversion==units::Conversion::Multiplicative && d.offset.numerator))return Error::InvalidIdentity;
    return Error::None;
}
Dimension dimension(units::Atom a) {
    Dimension result;const auto* d=units::definition(a.unit);if(!d)return result;
    std::copy(std::begin(d->dimension),std::end(d->dimension),result.powers.begin());
    if(same(d->quantity,"angle") || same(d->quantity,"plane_angle"))result.powers[7]=1;
    // WHY: lm = cd·sr and lx = cd·sr/m². Retaining explicit solid angle
    // requires the same domain exponent in the named photometric units.
    if(same(d->quantity,"solid_angle") || same(d->quantity,"luminous_flux") || same(d->quantity,"illuminance"))result.powers[8]=1;
    if(same(d->domain,"information"))result.powers[9]=1;
    if(same(d->domain,"count")) {
        constexpr const char* names[]={"symbol_rate","sample_count","frame_count","event_count","flop_count","instruction_count","io_count"};
        for(unsigned i=0;i<7;++i)if(same(d->quantity,names[i]))result.powers[10+i]=1;
    }
    return result;
}
Analysis evaluate(const MathNode* root,const void* owner,Resolve resolve) {
    Analysis a;Walker w{owner,resolve};
    if(w.node(root,a.value) && w.checked(a.value))a.error=Error::None;else a.error=w.error;
    a.calls=w.calls;return a;
}
bool contains(const MathNode* root,const void* owner,Resolve resolve) {
    const MathNode* pending[400]{};unsigned size=0,visited=0;if(root)pending[size++]=root;
    while(size && visited++<400) {
        const auto* n=pending[--size];if(!n)continue;
        if(n->type()==NodeType::Unit || n->type()==NodeType::QuantityReference)return true;
        if(n->type()==NodeType::Variable && resolve){Value v;if(resolve(owner,static_cast<const NodeVariable*>(n)->name(),v))return true;}
        for(int i=0;i<n->childCount();++i){if(size>=400)return true;pending[size++]=n->child(i);}
    }
    return size!=0;
}
bool descriptor(uint16_t id,uint8_t prefix,Descriptor& out) {
    const auto* item=units::item(id);if(!item || prefix>=25 || (!item->prefixSelector && prefix))return false;
    Descriptor next;next.count=item->termCount;next.numerator=item->coefficientNumerator;next.denominator=item->coefficientDenominator;
    for(unsigned i=0;i<next.count;++i){next.terms[i]=item->terms[i];if(item->prefixSelector && i==item->prefixComponent)next.terms[i].atom.prefix=PrefixId(prefix);}
    Dimension d;if(!descriptorDimension(next,d))return false;out=next;return true;
}
bool descriptorDimension(const Descriptor& descriptor,Dimension& out) {
    if(descriptor.count>kComponents || !descriptor.numerator || !descriptor.denominator)return false;
    Dimension next;
    for(unsigned i=0;i<descriptor.count;++i) {
        const auto& t=descriptor.terms[i];if(admissible(t.atom)!=Error::None || !t.power)return false;
        if(units::normalized(t.atom).role==TemperatureRole::Absolute && !pointDescriptor(descriptor))return false;
        auto d=dimension(t.atom);if(!power(d,t.power,1) || !combine(next,d,1))return false;
    }
    out=next;return true;
}
bool compatible(const Value& value,const Descriptor& descriptor) {
    Dimension d;return descriptorDimension(descriptor,d) && d==value.dimension &&
        value.role==(pointDescriptor(descriptor)?Role::TemperaturePoint:linearRole(d));
}
Descriptor coherent(const Value& value) {
    Descriptor out;
    if(value.dimension.scalar())return out;
    if(temperature(value.dimension)) {
        out.terms[0]={{UnitId(5),PrefixId(0),value.role==Role::TemperaturePoint?TemperatureRole::Absolute:TemperatureRole::Difference},1};
        out.count=1;return out;
    }
    // Preserve a known named magnitude; never identify Hz with Bq or Gy with Sv.
    if(uint16_t(value.meaning))for(const auto& d:units::kDefinitions) {
        units::Atom atom{d.id,PrefixId(uint16_t(d.id)==2?10:0)};
        const bool kg=uint16_t(d.id)==2;
        if(same(d.quantity,meaning(value.meaning)) && dimension(atom)==value.dimension && admissible(atom)==Error::None &&
           d.scale.numerator==1 && d.scale.denominator==1 && d.scale.piPower==0 && d.scale.decimal+(kg?3:0)==0) {
            out.terms[0]={atom,1};out.count=1;return out;
        }
    }
    auto remaining=value.dimension;
    constexpr uint16_t domains[]={8,9,1286,1291,1292,1293,1294,1295,1296,1297};
    for(unsigned i=7;i<kDimensions;++i)if(remaining.powers[i]) {
        const int8_t p=remaining.powers[i];units::Atom atom{UnitId(domains[i-7]),PrefixId(0)};
        out.terms[out.count++]={atom,p};auto d=dimension(atom);power(d,p,1);combine(remaining,d,-1);
    }
    for(unsigned i=0;i<7;++i)if(remaining.powers[i])out.terms[out.count++]={{UnitId(i+1),PrefixId(i==1?10:0),i==4?TemperatureRole::Difference:TemperatureRole::None},remaining.powers[i]};
    return out;
}
Error convert(const Value& value,const Descriptor& descriptor,Display& destination) {
    if(!compatible(value,descriptor))return Error::DimensionMismatch;
    std::string canonical=value.coefficient;
    if(value.role==Role::TemperaturePoint) {
        const auto a=units::normalized(descriptor.terms[0].atom);
        const auto& offset=units::definition(a.unit)->offset;
        if(offset.numerator)canonical=group(canonical)+"-"+exact(offset);
    }
    StructuredEngineResult result;const auto e=scalar(group(canonical)+"/"+group(scale(descriptor)),result);
    if(e!=Error::None)return e;
    Display next;next.exact=result.base.exactText;next.approximate=result.base.approximateText;
    next.exactCoefficient=CalculationEngine::resultTreeToAST(result.tree,ProductNotation::ScalarNatural);
    if(!next.exactCoefficient)return Error::Allocation;
    if(result.hasApproximateTree) {
        unsigned budget=400;
        // A decimal underflow must never masquerade as the exact nonzero value.
        const bool falseZero=next.exact!="0" && (next.approximate=="0" || next.approximate=="0.0");
        if(!falseZero && scalarTree(result.approximateTree,budget))next.approximateCoefficient=CalculationEngine::resultTreeToAST(result.approximateTree);
    }
    if(!next.approximateCoefficient)next.approximate.clear();
    destination=std::move(next);return Error::None;
}
NodePtr compose(NodePtr coefficient,const Descriptor& descriptor) {
    if(!coefficient)return {};
    Dimension valid;if(!descriptorDimension(descriptor,valid))return {};
    if(!descriptor.count)return coefficient;
    auto result=makeRow();auto* row=static_cast<NodeRow*>(result.get());
    bool parentheses=false;
    if(coefficient->type()==NodeType::Row)for(int i=1;i<coefficient->childCount();++i) {
        const auto* n=coefficient->child(i);if(n->type()==NodeType::Operator){const auto op=static_cast<const NodeOperator*>(n)->op();parentheses|=op==OpKind::Add || op==OpKind::Sub;}
    }
    row->appendChild(parentheses?makeParen(std::move(coefficient)):std::move(coefficient));
    const bool tight=descriptor.count==1 && descriptor.terms[0].power==1 && units::angularTight(descriptor.terms[0].atom);
    row->appendChild(makeOperator(tight?OpKind::UnitAttachTight:OpKind::UnitAttach));
    if(descriptor.count==1 && descriptor.numerator==1 && descriptor.denominator==1)row->appendChild(termNode(descriptor.terms[0]));
    else {
        auto numerator=makeRow(),denominator=makeRow();auto* num=static_cast<NodeRow*>(numerator.get());auto* den=static_cast<NodeRow*>(denominator.get());
        if(descriptor.numerator!=1)num->appendChild(makeNumber(std::to_string(descriptor.numerator)));
        if(descriptor.denominator!=1)den->appendChild(makeNumber(std::to_string(descriptor.denominator)));
        for(unsigned i=0;i<descriptor.count;++i){const auto& t=descriptor.terms[i];auto* target=t.power<0?den:num;if(target->childCount())target->appendChild(makeOperator(OpKind::UnitProduct));target->appendChild(termNode(t,true));}
        if(!num->childCount())num->appendChild(makeNumber("1"));
        row->appendChild(den->childCount()?makeFraction(std::move(numerator),std::move(denominator)):std::move(numerator));
    }
    return result;
}
bool symbol(const Descriptor& d,char* out,size_t capacity) {
    if(!capacity)return false;out[0]=0;size_t offset=0;
    for(unsigned i=0;i<d.count;++i) {
        char atom[48]{};if(!units::symbol(d.terms[i].atom,atom,sizeof(atom)))return false;
        const int n=d.terms[i].power==1?std::snprintf(out+offset,capacity-offset,"%s%s",i?" · ":"",atom):
            std::snprintf(out+offset,capacity-offset,"%s%s^%d",i?" · ":"",atom,int(d.terms[i].power));
        if(n<0 || size_t(n)>=capacity-offset)return false;offset+=size_t(n);
    }
    return true;
}
const char* errorName(Error e) {
    static constexpr const char* names[]={"none","incomplete","dimension_mismatch","division_by_zero","affine_pending","context_pending","uncertainty_pending","approximate_pending","symbolic_pending","complex_pending","function_unsupported","exponent_limit","expression_limit","invalid_identity","allocation","scalar_domain","reference_pending","affine_operation"};
    return unsigned(e)<std::size(names)?names[unsigned(e)]:"invalid_identity";
}
const char* errorMessage(Error e,bool spanish) {
    static constexpr const char* messages[][2]={
        {"",""},{"Incomplete expression","Expresión incompleta"},
        {"Incompatible dimensions","Dimensiones incompatibles"},{"Division by zero","División por cero"},
        {"Affine temperatures not supported yet","Temperaturas afines aún no disponibles"},
        {"Contextual quantities not supported yet","Cantidades contextuales aún no disponibles"},
        {"Uncertainty not supported yet","Incertidumbre aún no disponible"},
        {"Approximate unit not supported yet","Unidad aproximada aún no disponible"},
        {"A closed real quantity is required","Se requiere una cantidad real cerrada"},
        {"Complex quantities not supported yet","Cantidades complejas aún no disponibles"},
        {"Function not supported for quantities","Función no disponible para cantidades"},
        {"Unit exponent outside supported range","Exponente de unidad fuera del límite"},
        {"Quantity expression limit","Límite de expresión con unidades"},
        {"Invalid unit identity","Identidad de unidad inválida"},
        {"Not enough memory","Memoria insuficiente"},{"Quantity outside function domain","Cantidad fuera del dominio"},
        {"Physical references not supported yet","Referencias físicas aún no disponibles"},
        {"Operation undefined for temperature points","Operación no definida para puntos de temperatura"}};
    return messages[unsigned(e)<std::size(messages)?unsigned(e):unsigned(Error::InvalidIdentity)][spanish?1:0];
}
}
