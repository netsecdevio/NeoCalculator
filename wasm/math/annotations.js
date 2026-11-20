// Anchors are data, never HTML. Text offsets use JavaScript's UTF-16 indexing.
const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const button=(text,action)=>{const node=element('button',text);node.type='button';node.onclick=action;return node;};
export const stepText=step=>step.explanation+(step.math?'\n'+step.math:'');
const graphExpression=value=>value.trim().replace(/^y\s*=\s*/i,'');

export function mountAnnotations(host,result,saved,{onChange,renderGraph}) {
  let notes=structuredClone(saved?.annotations||[]),graph=saved?.graph?{...saved.graph,expression:graphExpression(saved.graph.expression)}:null;
  let active=false,locked=false,pending=null,editingIndex=null,graphBusy=false,graphGeneration=0;
  const root=element('section',undefined,'annotation-workspace');
  const toolbar=element('div',undefined,'annotation-toolbar');
  const toggle=button('Annotate',()=>{active=!active;refreshMode();});toggle.setAttribute('aria-pressed','false');
  const help=element('p','Choose Annotate, then tap a step or highlight the words you want to comment on.','annotation-hint');
  const message=element('p');message.setAttribute('role','status');
  const body=element('div',undefined,'annotation-layout'),lesson=element('div',undefined,'annotation-lesson');
  const rail=element('aside',undefined,'annotation-comments');rail.setAttribute('aria-label','Comments on this explanation');
  const noteList=element('ol',undefined,'annotation-list');
  const composer=element('div',undefined,'annotation-composer');composer.hidden=true;
  const target=element('p',undefined,'annotation-target');
  const label=element('label','Your comment'),text=element('textarea');text.maxLength=2000;text.rows=3;label.append(text);
  text.placeholder='What helped? What is confusing?';
  const add=button('Add comment',commit),cancel=button('Cancel',cancelComment);
  composer.append(target,label,add,cancel);rail.append(element('h3','Your comments'),noteList,composer,message);
  toolbar.append(toggle);root.append(toolbar,help,body);body.append(lesson,rail);host.append(root);
  const stepNodes=result.steps.map((step,index)=>{
    const section=element('section',undefined,'annotation-step'),heading=element('h3','Step '+(index+1));
    const content=element('p',stepText(step),'annotation-text');content.dataset.step=String(index);
    const mark=button('Comment on step '+(index+1),()=>start({step:index}));mark.className='step-comment';
    section.append(heading,content,mark);
    for(const id of step.citationIds||[]){
      const source=result.sources?.find(s=>s.id===id);if(!source)continue;
      let url;try{url=new URL(source.url);}catch{continue;}if(url.protocol!=='https:')continue;
      const link=element('a',source.title+' · '+source.locator,'annotation-source');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';section.append(link);
    }
    content.addEventListener('pointerup',()=>{
      if(!active||locked)return;
      const selection=window.getSelection();
      if(selection?.rangeCount&&!selection.isCollapsed){
        const range=selection.getRangeAt(0);
        if(!content.contains(range.startContainer)||!content.contains(range.endContainer)){message.textContent='Select words inside a single step.';return;}
        const before=range.cloneRange();before.selectNodeContents(content);before.setEnd(range.startContainer,range.startOffset);
        const startOffset=before.toString().length,endOffset=startOffset+range.toString().length;
        start({step:index,anchor:{kind:'text',start:startOffset,end:endOffset,quote:stepText(step).slice(startOffset,endOffset)}});
      }else start({step:index});
    });
    lesson.append(section);return {section,content,mark};
  });
  if(result.answer)lesson.append(element('p',result.answer,'step-math'));
  if(result.question)lesson.append(element('p',result.question));
  if(result.limitations?.length)lesson.append(element('p',result.limitations.join(' '),'annotation-hint'));

  const graphDetails=element('details',undefined,'annotation-graph-tools');graphDetails.append(element('summary','Add a graph to this explanation'));
  const graphLabel=element('label','Graph expression'),graphInput=element('input');graphInput.maxLength=2000;graphInput.placeholder='For example: 2*x+12';graphInput.value=graph?.expression||'';graphLabel.append(graphInput);
  const plot=button('Draw graph',async()=>{
    if(locked||graphBusy)return;
    if(pending){message.textContent='Add or cancel your current comment first.';return;}
    const expression=graphExpression(graphInput.value);
    if(!expression||new TextEncoder().encode(expression).length>2000){message.textContent='Enter a graph expression up to 2,000 bytes.';return;}
    if(notes.some(n=>n.anchor?.kind==='graph')&&expression!==graph?.expression){message.textContent='Remove the graph comments before changing their graph.';return;}
    await draw({expression},expression!==graph?.expression);
  });
  const graphWrap=element('div',undefined,'annotation-graph');graphWrap.hidden=true;
  const graphCanvas=element('canvas');graphCanvas.width=720;graphCanvas.height=480;graphCanvas.setAttribute('aria-label','Attached graph, x and y from negative ten to ten');
  const pinLayer=element('div',undefined,'graph-pins'),graphCaption=element('p',undefined,'annotation-hint');
  const pointControls=element('div',undefined,'annotation-point-controls');pointControls.hidden=true;
  const xLabel=element('label','Graph x coordinate'),yLabel=element('label','Graph y coordinate');
  const pointX=element('input'),pointY=element('input');
  for(const input of [pointX,pointY]){input.type='number';input.min='-10';input.max='10';input.step='any';input.value='0';}
  xLabel.append(pointX);yLabel.append(pointY);
  const pointButton=button('Comment at graph point',()=>{
    if(locked||!graph)return;
    for(const input of [pointX,pointY])if(!input.value.trim()||!Number.isFinite(Number(input.value))||Math.abs(Number(input.value))>10){message.textContent='Choose x and y coordinates between −10 and 10.';input.focus();return;}
    start({anchor:{kind:'graph',x:(Number(pointX.value)+10)/20,y:(10-Number(pointY.value))/20}});
  });
  const removeGraph=button('Remove graph',()=>{
    if(locked||graphBusy)return;
    if(pending){message.textContent='Add or cancel your current comment first.';return;}
    if(notes.some(n=>n.anchor?.kind==='graph')){message.textContent='Remove the graph comments before removing their graph.';return;}
    graph=null;graphInput.value='';graphWrap.hidden=true;pointControls.hidden=true;removeGraph.hidden=true;graphCaption.textContent='';
    graphCanvas.getContext('2d').clearRect(0,0,720,480);renderPins();onChange();message.textContent='Graph removed.';
  });removeGraph.hidden=true;
  pointControls.append(xLabel,yLabel,pointButton);
  graphWrap.append(graphCanvas,pinLayer);graphDetails.append(graphLabel,plot,removeGraph);lesson.append(graphDetails,graphWrap,graphCaption,pointControls);
  graphCanvas.addEventListener('pointerup',event=>{
    if(!active||locked||!graph)return;
    const rect=graphCanvas.getBoundingClientRect();
    start({anchor:{kind:'graph',x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))}});
  });
  async function draw(next,changed){
    const generation=++graphGeneration;graphBusy=true;plot.disabled=true;message.textContent='Drawing graph…';
    const draftCanvas=document.createElement('canvas');draftCanvas.width=720;draftCanvas.height=480;
    try{
      await renderGraph(draftCanvas,next.expression);
      if(generation!==graphGeneration)return;
      graphCanvas.getContext('2d').drawImage(draftCanvas,0,0);graph={...next};graphWrap.hidden=false;pointControls.hidden=false;removeGraph.hidden=false;
      graphCaption.textContent='y = '+graph.expression+' · x and y: −10 to 10';graphDetails.open=false;message.textContent=locked?'Saved graph restored.':'Graph attached. Turn on Annotate to place a comment.';
      if(changed)onChange();renderPins();
    }catch(error){if(generation===graphGeneration)message.textContent='Graph could not be drawn. '+error.message;}
    finally{if(generation===graphGeneration){graphBusy=false;plot.disabled=locked;}}
  }
  function refreshMode(){toggle.setAttribute('aria-pressed',String(active));toggle.textContent=active?'Done annotating':'Annotate';root.classList.toggle('is-annotating',active);}
  function describeTarget(){target.textContent=pending?.anchor?.kind==='text'?'“'+pending.anchor.quote+'”':pending?.anchor?.kind==='graph'?'Graph point: x ≈ '+((pending.anchor.x*20)-10).toFixed(1)+', y ≈ '+(10-pending.anchor.y*20).toFixed(1):'Step '+(pending.step+1);}
  function start(anchor,index=null){
    if(locked)return;
    if(pending!==null){message.textContent='Add or cancel your current comment before choosing another spot.';text.focus();return;}
    if(notes.length>=40&&index===null){message.textContent='You can add up to 40 comments.';return;}
    active=true;refreshMode();pending=structuredClone(anchor);editingIndex=index;text.value=index===null?'':notes[index].text;
    describeTarget();composer.hidden=false;add.textContent=index===null?'Add comment':'Update comment';message.textContent='';renderPins();text.focus();
  }
  function cancelComment(){pending=null;editingIndex=null;text.value='';composer.hidden=true;renderPins();toggle.focus();}
  function commit(){
    if(locked||!pending)return;
    const value=text.value.trim();if(!value){message.textContent='Write a short comment first.';text.focus();return;}
    const note={...pending,text:value};if(editingIndex===null)notes.push(note);else notes[editingIndex]=note;
    pending=null;editingIndex=null;composer.hidden=true;text.value='';onChange();renderNotes();toggle.focus();
  }
  function renderPins(){
    pinLayer.replaceChildren();
    [...notes,...(pending?.anchor?.kind==='graph'?[pending]:[])].forEach((note,index)=>{
      if(note.anchor?.kind!=='graph')return;
      const pin=button(String(index+1),()=>{if(index<notes.length)noteList.children[index]?.scrollIntoView({block:'nearest'});});pin.className='graph-pin';
      pin.style.left=(note.anchor.x*100)+'%';pin.style.top=(note.anchor.y*100)+'%';pin.setAttribute('aria-label','Graph comment '+(index+1));pinLayer.append(pin);
    });
  }
  function renderNotes(){
    noteList.replaceChildren();
    notes.forEach((note,index)=>{
      const item=element('li'),location=note.anchor?.kind==='graph'?'Graph':('Step '+(note.step+1));
      item.append(element('strong',(index+1)+'. '+location));
      if(note.anchor?.kind==='text')item.append(element('blockquote',note.anchor.quote));
      item.append(element('p',note.text));
      if(!locked){item.append(button('Edit comment '+(index+1),()=>{const {text,...anchor}=note;start(anchor,index);}),button('Remove comment '+(index+1),()=>{
        if(pending){message.textContent='Add or cancel your current comment first.';return;}notes.splice(index,1);onChange();renderNotes();toggle.focus();
      }));}
      noteList.append(item);
    });
    if(!notes.length)noteList.append(element('li','No comments yet. Point to the part you want help with.','annotation-empty'));
    stepNodes.forEach(({content,mark},index)=>{
      const source=stepText(result.steps[index]);content.replaceChildren();
      const ranges=notes.flatMap(note=>note.step===index&&note.anchor?.kind==='text'?[note.anchor]:[]);
      const boundaries=[...new Set([0,source.length,...ranges.flatMap(a=>[a.start,a.end])])].sort((a,b)=>a-b);
      boundaries.slice(0,-1).forEach((start,i)=>{const end=boundaries[i+1],selected=ranges.some(a=>start>=a.start&&end<=a.end);content.append(selected?element('mark',source.slice(start,end)):document.createTextNode(source.slice(start,end)));});
      const count=notes.filter(n=>n.step===index).length;mark.textContent='Comment on step '+(index+1)+(count?' · '+count:'');mark.disabled=locked;
    });renderPins();
  }
  text.addEventListener('input',onChange);
  renderNotes();if(graph)void draw(graph,false);
  return {
    value:()=>({annotationFormat:2,annotations:structuredClone(notes),...(graph?{graph:{...graph}}:{})}),
    pending:()=>pending!==null||graphBusy||graphExpression(graphInput.value)!==(graph?.expression||''),
    setDisabled(value){locked=value;toggle.disabled=value;plot.disabled=value||graphBusy;graphInput.disabled=value;pointX.disabled=pointY.disabled=pointButton.disabled=removeGraph.disabled=value;add.disabled=cancel.disabled=text.disabled=value;renderNotes();if(value){active=false;refreshMode();}},
  };
}
