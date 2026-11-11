// Deterministic teaching templates. Unsupported expressions are never guessed.
const abs = n => n < 0n ? -n : n;
function gcd(a,b) { a=abs(a); b=abs(b); while(b) [a,b]=[b,a%b]; return a; }
function rational(n,d=1n) {
  if (!d) throw Error('A denominator cannot be zero.');
  if (d<0n) {n=-n;d=-d;}
  const g=gcd(n,d); return {n:n/g,d:d/g};
}
const parse = value => { const [n,d='1']=value.split('/'); return rational(BigInt(n),BigInt(d)); };
const subtract = (a,b) => rational(a.n*b.d-b.n*a.d,a.d*b.d);
const divide = (a,b) => rational(a.n*b.d,a.d*b.n);
const show = value => value.d===1n ? String(value.n) : `${value.n}/${value.d}`;
const check = (expression,expected) => ({expression,expected});
export function buildExplanation(input) {
  if (typeof input !== 'string' || input.length>2000 || /\d\s+\d/.test(input)) return null;
  const text=input.replace(/\s+/g,'');
  // ax+b=c, with bounded integer/fraction coefficients. No arbitrary parsing/eval.
  const linear=text.match(/^([+-]?(?:\d{1,6}(?:\/\d{1,6})?)?)\*?x([+-]\d{1,6}(?:\/\d{1,6})?)?=(-?\d{1,6}(?:\/\d{1,6})?)$/);
  if (linear && !/^[+-]?\*x/.test(text)) {
    const a=parse(linear[1]===''||linear[1]==='+'?'1':linear[1]==='-'?'-1':linear[1]);
    const b=parse(linear[2]||'0'),c=parse(linear[3]);
    if (!a.n) return null;
    const remaining=subtract(c,b),solution=divide(remaining,a);
    const A=show(a),B=show(b),C=show(c),R=show(remaining),X=show(solution);
    const change=b.n<0n ? `Add ${show(rational(-b.n,b.d))} to both sides.` : b.n>0n ? `Subtract ${B} from both sides.` : 'The x term is already on its own.';
    return {title:'Solve a linear equation',steps:[
      {instruction:'Keep both sides equal as you isolate x.',math:text},
      {instruction:change,math:`(${A}) × x = ${R}`},
      {instruction:`Divide both sides by ${A}.`,math:`x = ${X}`},
      {instruction:'Put that value back into the original equation to check it.',math:`(${A}) × (${X}) + (${B}) = ${C}`},
    ],checks:[check(`(${C})-(${B})`,R),check(`(${R})/(${A})`,X),check(`(${A})*(${X})+(${B})`,C)]};
  }
  const fraction=text.match(/^([+-]?\d{1,6})\/(\d{1,6})([+-])(\d{1,6})\/(\d{1,6})$/);
  if (fraction) {
    const a=parse(`${fraction[1]}/${fraction[2]}`),b=parse(`${fraction[4]}/${fraction[5]}`);
    const denominator=a.d/gcd(a.d,b.d)*b.d;
    const left=a.n*(denominator/a.d),right=b.n*(denominator/b.d);
    const numerator=fraction[3]==='+'?left+right:left-right;
    const result=show(rational(numerator,denominator));
    return {title:'Combine fractions',steps:[
      {instruction:'Use a common denominator.',math:`Common denominator: ${denominator}`},
      {instruction:'Multiply each numerator and denominator by the same amount.',math:`${show(a)} = ${left}/${denominator}; ${show(b)} = ${right}/${denominator}`},
      {instruction:'Combine the numerators. Keep the denominator.',math:`(${left} ${fraction[3]} ${right})/${denominator} = ${numerator}/${denominator}`},
      {instruction:'Reduce by any common factor.',math:result},
    ],checks:[check(show(a),`${left}/${denominator}`),check(show(b),`${right}/${denominator}`),check(text,result)]};
  }
  const log=text.match(/^log10\((\d{1,12}(?:\.\d{1,12})?)\)$/);
  if (log) {
    const [whole,decimal='']=log[1].split('.');
    const value=rational(BigInt(whole+decimal),10n**BigInt(decimal.length));
    let exponent;
    for(let n=-12;n<=12;n++) {
      const power=n>=0?rational(10n**BigInt(n)):rational(1n,10n**BigInt(-n));
      if(power.n===value.n && power.d===value.d) {exponent=n;break;}
    }
    if(exponent===undefined) return null;
    return {title:'Understand a base-10 logarithm',steps:[
      {instruction:'A logarithm asks for an exponent.',math:`log10(${log[1]}) means: 10 to what power equals ${log[1]}?`},
      {instruction:'Write the number as a power of 10.',math:`10^(${exponent}) = ${log[1]}`},
      {instruction:'That exponent is the answer.',math:`log10(${log[1]}) = ${exponent}`},
    ],checks:[check(`10^(${exponent})`,show(value)),check(`log10(${show(value)})`,String(exponent))]};
  }
  return null;
}
