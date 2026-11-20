import {renderMathText} from './math-text.js';
let nextId=0;

// Excerpts come from the authenticated server's reviewed retrieval index.
// Never fetch a model-supplied URL or embed the whole source document.
export function appendSourceCallout(section,source,preview) {
  let url;try{url=new URL(source.url);}catch{return;}
  if(url.protocol!=='https:'||url.username||url.password)return;
  const wrapper=document.createElement('span');wrapper.className='source-reference';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='annotation-source';
  trigger.textContent='Lesson note: '+source.title;trigger.setAttribute('aria-expanded','false');
  const bubble=document.createElement('aside');bubble.className='source-callout';bubble.hidden=true;
  bubble.id='source-callout-'+(++nextId);bubble.setAttribute('role','dialog');
  trigger.setAttribute('aria-controls',bubble.id);
  const heading=document.createElement('h4');heading.id=bubble.id+'-title';heading.tabIndex=-1;heading.textContent=source.title;
  bubble.setAttribute('aria-labelledby',heading.id);
  const locator=document.createElement('p');locator.className='source-locator';locator.textContent=source.locator;
  const passage=document.createElement('blockquote');
  const excerpt=source.excerpt??preview?.excerpt;
  if(typeof excerpt==='string'&&excerpt.trim()&&excerpt.length<=12000)renderMathText(passage,excerpt);
  else passage.textContent='This saved explanation does not have a passage preview yet. You can keep working here.';
  const close=document.createElement('button');close.type='button';close.textContent='Close note';
  function hide(returnFocus=true){bubble.hidden=true;trigger.setAttribute('aria-expanded','false');if(returnFocus)trigger.focus();}
  close.onclick=()=>hide();
  bubble.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();}});
  trigger.onclick=()=>{
    if(!bubble.hidden){hide();return;}
    bubble.hidden=false;trigger.setAttribute('aria-expanded','true');heading.focus();
  };
  bubble.append(heading,locator,passage);
  if(!source.excerpt&&preview?.provenance==='current-reference'){
    const note=document.createElement('p');note.className='source-locator';note.textContent='Current lesson passage. This older explanation did not save a copy of its reference.';bubble.append(note);
  }
  bubble.append(close);wrapper.append(trigger,bubble);section.append(wrapper);
}
