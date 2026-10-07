#pragma once
// Owned, bounded quantity values; no Giac, Toolbox, LVGL or context in the model.
#include "MathAST.h"
#include "units/UnitRegistry.h"
#include <array>
#include <memory>
#include <string>

namespace numos::quantity {
constexpr unsigned kDimensions=17; // seven SI, plane/solid angle, information, seven counts
constexpr unsigned kComponents=17;
constexpr int kExponentLimit=64;
struct Dimension {
    std::array<int8_t,kDimensions> powers{};
    bool operator==(const Dimension& b)const{return powers==b.powers;}
    bool operator!=(const Dimension& b)const{return !(*this==b);}
    bool scalar()const {for(auto p:powers)if(p)return false;return true;}
};
enum class Error:uint8_t {None,Incomplete,DimensionMismatch,DivisionByZero,AffinePending,
    ContextPending,UncertaintyPending,ApproximatePending,SymbolicPending,ComplexPending,
    FunctionUnsupported,ExponentLimit,ExpressionLimit,InvalidIdentity,Allocation,ScalarDomain,ReferencePending,
    AffineOperation};
const char* errorName(Error);
const char* errorMessage(Error,bool spanish);
struct Value {
    std::string coefficient; // exact scalar in the coherent reference, owned
    Dimension dimension;
    // WHY: an immutable mathematical role; display conversions cannot change it.
    enum class Role:uint8_t { Linear, TemperaturePoint, TemperatureDifference };
    Role role=Role::Linear;
    units::UnitId meaning{}; // provenance only; zero means unspecified magnitude
};
using Owned=std::shared_ptr<const Value>;
struct Descriptor {
    std::array<units::Term,kComponents> terms{};
    uint8_t count=0;
    uint32_t numerator=1,denominator=1;
};
struct Display {
    std::string exact,approximate;
    vpam::NodePtr exactCoefficient,approximateCoefficient;
};
using Resolve=bool(*)(const void*,char,Value&);
struct Analysis {Value value;Error error=Error::None;unsigned calls=0;};
Error admissible(units::Atom);
Dimension dimension(units::Atom);
Analysis evaluate(const vpam::MathNode*,const void* owner,Resolve);
bool contains(const vpam::MathNode*,const void* owner,Resolve);
bool descriptor(uint16_t item,uint8_t prefix,Descriptor&);
bool descriptorDimension(const Descriptor&,Dimension&);
bool compatible(const Value&,const Descriptor&);
Descriptor coherent(const Value&);
Error convert(const Value&,const Descriptor&,Display&);
vpam::NodePtr compose(vpam::NodePtr coefficient,const Descriptor&);
bool symbol(const Descriptor&,char*,size_t);
}
