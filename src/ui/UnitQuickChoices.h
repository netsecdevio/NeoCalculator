#pragma once
#include "math/Quantity.h"
#include "math/ToolboxStore.h"
#include <array>
#include <algorithm>

namespace ui {
// Presentation suggestions only. No factors, inferred magnitude or automatic
// conversion; each row still goes through Calculation's exact confirmation.
struct UnitQuickChoices {
    using Identity=numos::toolbox::Identity;
    std::array<Identity,6> ids{};
    unsigned count=0,favorites=0;
    static bool same(const numos::quantity::Descriptor& a,const numos::quantity::Descriptor& b) {
        if(uint64_t(a.numerator)*b.denominator!=uint64_t(b.numerator)*a.denominator)return false;
        auto includes=[](const auto& x,const auto& y) {
            for(unsigned i=0;i<x.count;++i) {
                int px=0,py=0;
                for(unsigned j=0;j<x.count;++j)if(x.terms[i].atom==x.terms[j].atom)px+=x.terms[j].power;
                for(unsigned j=0;j<y.count;++j)if(x.terms[i].atom==y.terms[j].atom)py+=y.terms[j].power;
                if(px!=py)return false;
            }return true;
        };
        return includes(a,b) && includes(b,a);
    }
    static Identity identity(const numos::quantity::Descriptor& current) {
        using namespace numos;
        for(const auto& item:units::kItems) {
            quantity::Descriptor candidate;candidate.count=item.termCount;
            candidate.numerator=item.coefficientNumerator;candidate.denominator=item.coefficientDenominator;
            std::copy_n(item.terms,item.termCount,candidate.terms.begin());
            unsigned prefix=0;
            if(item.prefixSelector) {
                auto& term=candidate.terms[item.prefixComponent];
                for(unsigned i=0;i<current.count;++i)if(current.terms[i].atom.unit==term.atom.unit && current.terms[i].power==term.power){term.atom.prefix=current.terms[i].atom.prefix;break;}
                prefix=unsigned(term.atom.prefix);
            }
            const Identity id{uint16_t(0x8000|item.id),uint16_t(prefix)};
            if(same(candidate,current) && numos::toolbox::find(id))return id;
        }return {};
    }
    void prepare(const numos::quantity::Value& value,const numos::quantity::Descriptor& current) {
        using namespace numos;count=favorites=0;
        auto add=[&](Identity id) {
            const auto* e=numos::toolbox::find(id);quantity::Descriptor next;
            if(!e || e->recipe!=numos::toolbox::Recipe::Unit || !quantity::descriptor(uint16_t(e->argument),uint8_t(id.variant),next) ||
               !quantity::compatible(value,next) || same(current,next))return;
            for(unsigned i=0;i<count;++i) {
                quantity::Descriptor old;
                if(quantity::descriptor(ids[i].id&0x3fff,uint8_t(ids[i].variant),old) && same(old,next))return;
            }
            if(count<ids.size())ids[count++]=id;
        };
        auto& store=numos::toolbox::Store::instance();store.load();
        for(unsigned i=0;i<store.favoriteCount() && count<3;++i)add(store.favorite(i));
        favorites=count;
        const auto selected=identity(current);
        auto offer=[&](unsigned item,unsigned prefix=0){add({uint16_t(0x8000|item),uint16_t(prefix)});};
        // Explicit existing families, selected by representation identity, not
        // dimensional exponents. In particular Hz/Bq and J/N·m stay separate.
        switch(selected.id&0x3fff) {
        case 1:offer(1,14);offer(1,15);offer(1,10);break;
        case 2:offer(2);offer(2,15);offer(2,10);break;
        case 3:case 47:case 48:case 49:offer(47);offer(48);offer(3);break;
        case 110:case 111:case 1107:case 120:offer(111);offer(110);break;
        case 13:case 114:offer(114,10);offer(13);offer(13,10);break;
        case 101:offer(101,14);offer(101);offer(45);break;
        case 102:case 46:offer(46);offer(46,15);offer(102);break;
        case 18:offer(18,10);offer(18);offer(18,9);break;
        case 17:offer(17,16);offer(17,17);offer(17);break;
        case 4:offer(4,15);offer(4);offer(4,16);break;
        case 16:offer(16,15);offer(16);offer(16,10);break;
        case 10:offer(10,10);offer(10);offer(10,9);break;
        case 26:offer(26,10);offer(26);offer(26,9);break;
        case 8:case 57:case 58:case 59:offer(57);offer(8);offer(58);break;
        case 5:case 23:case 60:case 1180:case 1181:offer(5);offer(23);offer(60);break;
        case 61:case 62:case 63:case 1311:case 1312:offer(61);offer(62);offer(63);break;
        default:break;
        }
    }
};
}
