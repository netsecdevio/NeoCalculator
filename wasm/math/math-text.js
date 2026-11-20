import katex from './vendor/katex.mjs';

// Display changes never change the canonical text used by saved annotations.
// A formula is one selection unit; prose keeps exact UTF-16 offsets.
const positions = new WeakMap();
function segments(source, offset=0, formula=false) {
  const parts=[];
  const expression=/\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|(?<![\\$])\$([^$\n]+)\$(?!\$)/g;
  let cursor=0;
  function plain(start,end) {
    if(end<=start)return;
    const text=source.slice(start,end);
    // The API's math field is TeX without delimiters. Legacy answers sometimes
    // contain a standalone TeX line too; ordinary prose stays ordinary text.
    if(formula)parts.push({text,start:start+offset,end:end+offset,math:true});
    else {
      let at=start;
      for(const line of text.split(/(?<=\n)/)) {
        const math=/^\s*\\(?:text|frac|tfrac|dfrac|sqrt|boxed|begin|ln|log|left)\b/.test(line)
          || (/\\[a-zA-Z]+/.test(line)&&!/[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/.test(line.replace(/\\text\{[^}]*\}/g,'')));
        parts.push({text:line,start:at+offset,end:at+offset+line.length,math});at+=line.length;
      }
    }
  }
  for(const match of source.matchAll(expression)) {
    plain(cursor,match.index);
    parts.push({text:match[1]??match[2]??match[3]??match[4],start:offset+match.index,end:offset+match.index+match[0].length,math:true});
    cursor=match.index+match[0].length;
  }
  plain(cursor,source.length);return parts;
}

export function renderMathText(host,source,{mathStart=null,ranges=[]}={}) {
  host.replaceChildren();
  const parts=mathStart===null?segments(source):[
    ...segments(source.slice(0,mathStart)),...segments(source.slice(mathStart),mathStart,true),
  ];
  for(const part of parts) {
    if(part.math&&part.text.length<=8000) {
      const node=document.createElement('span');node.className='rendered-math';
      try {
        katex.render(part.text,node,{output:'mathml',throwOnError:true,trust:false,strict:'error',maxExpand:500,maxSize:10,macros:{}});
        positions.set(node,{start:part.start,end:part.end,atomic:true});
        if(ranges.some(a=>a.start<part.end&&a.end>part.start))node.classList.add('math-highlight');
        host.append(node);continue;
      } catch { /* Malformed notation remains safe, readable text, never HTML. */ }
    }
    const boundaries=[...new Set([part.start,part.end,...ranges.flatMap(a=>[a.start,a.end]).filter(p=>p>part.start&&p<part.end)])].sort((a,b)=>a-b);
    boundaries.slice(0,-1).forEach((start,i)=>{
      const end=boundaries[i+1],text=document.createTextNode(source.slice(start,end));
      positions.set(text,{start,end});
      if(ranges.some(a=>start>=a.start&&end<=a.end)){
        const mark=document.createElement('mark');mark.append(text);host.append(mark);
      }else host.append(text);
    });
  }
}

function edge(node,end) {
  const record=positions.get(node);if(record)return end?record.end:record.start;
  const children=[...node.childNodes];if(end)children.reverse();
  for(const child of children){const found=edge(child,end);if(found!==null)return found;}
  return null;
}
function boundary(host,node,offset,end) {
  for(let parent=node;parent&&parent!==host;parent=parent.parentNode){
    const record=positions.get(parent);if(record?.atomic)return end?record.end:record.start;
  }
  if(node.nodeType===Node.TEXT_NODE){const record=positions.get(node);return record?record.start+offset:null;}
  if(offset<node.childNodes.length)return edge(node.childNodes[offset],false);
  return edge(node,true);
}
export function selectedCanonicalText(host,range,source) {
  if(!host.contains(range.startContainer)||!host.contains(range.endContainer))return null;
  const start=boundary(host,range.startContainer,range.startOffset,false),end=boundary(host,range.endContainer,range.endOffset,true);
  return start!==null&&end!==null&&end>start?{kind:'text',start,end,quote:source.slice(start,end)}:null;
}
