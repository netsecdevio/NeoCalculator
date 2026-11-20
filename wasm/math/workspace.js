import {mountAnnotations} from './annotations.js';
import {drawGraph} from './graph-view.js';
import {loadModels,requestExplanation,loadClasses,saveFeedback,loadOutputs,loadOutput} from './learning-steps.js';
const input = document.querySelector('#expression');
const status = document.querySelector('#status');
const answer = document.querySelector('#answer');
const canvas = document.querySelector('#graph');
// Clear session deliberately has no data-action: it stays enabled during loads and failures.
const buttons = [...document.querySelectorAll('[data-action]')];
let math, createMath, mathLoad, generation = 0, running = false;
const explanation = document.querySelector('#explanation');
let explanationVersion = 0;
function clearExplanation() { ++explanationVersion; explanation.hidden=true; explanation.replaceChildren(); }
input.addEventListener('input', () => { clearExplanation(); answer.textContent=''; canvas.hidden=true; document.querySelector('#graph-description').textContent=''; status.textContent='New problem. Calculate or ask for steps.'; });
async function explain() {
  if(running) return;
  const text=input.value.trim();
  if(!text){status.textContent='Enter a problem or describe what is confusing.';return;}
  clearExplanation();
  const version=explanationVersion,token=generation;
  busy(true);status.textContent='Finding relevant sources and asking your teaching model…';
  try {
    const result=await requestExplanation(text,document.querySelector('#learning-context').value,document.querySelector('#teaching-model').value,document.querySelector('#learning-class').value);
    if(token!==generation || version!==explanationVersion) return;
    if(!Array.isArray(result.steps)||!Array.isArray(result.sources))throw Error('The teaching response could not be read. Please try again.');
    mountFeedback(result);
    status.textContent='Source-guided explanation · '+result.model+'. Check the reasoning as you work.';
  }catch(error){if(token===generation&&version===explanationVersion)status.textContent=error.message;}
  finally{if(token===generation)busy(false);}
}
async function refreshTeachingModels(){
  const select=document.querySelector('#teaching-model');
  try{
    const catalog=await loadModels();
    if(!Array.isArray(catalog.models))throw Error('Model catalog unavailable');
    select.replaceChildren();
    for(const model of catalog.models){const option=document.createElement('option');option.value=model.id;option.textContent=model.label;select.append(option);}
    select.value=catalog.default_model;
    document.querySelector('#model-status').textContent=catalog.models.length+' configured models listed; provider availability may vary.';
  }catch(error){document.querySelector('#model-status').textContent=error.message;}
}
function nodeText(node) {
  if (node.value !== undefined) return node.value;
  if (node.displayText) return node.displayText;
  const children = (node.children || []).map(nodeText);
  const operators = {sum:' + ', product:' * ', rational:' / ', power:' ^ ', equation:' = '};
  if (operators[node.kind]) return '(' + children.join(operators[node.kind]) + ')';
  if (node.kind === 'negative') return '-(' + children[0] + ')';
  if (node.kind === 'inverse') return '1/(' + children[0] + ')';
  if (node.kind === 'root') return '(' + children[0] + ')^(1/' + children[1] + ')';
  if (node.kind === 'sqrt') return 'sqrt(' + children[0] + ')';
  if (node.kind === 'pi' || node.kind === 'e') return node.kind;
  if (node.kind === 'function') return node.name + '(' + children.join(', ') + ')';
  throw Error('This answer needs a display format this calculator does not support yet.');
}
function solveText(result) {
  if (result.setKind === 'no_solution') return 'No solution found in the supported domain.';
  if (result.setKind === 'all_values') return 'All values of x satisfy this equation in its domain.';
  if (result.coverage !== 'finite' || result.restrictions?.length || result.families?.length)
    return 'This equation has conditional or repeating solutions. A complete answer is not supported by this view yet.';
  if (result.setKind !== 'solutions') return 'This equation is not supported yet.';
  return result.groups.map(group => group.values.map(v => v.variable + ' = ' + nodeText(v.value)).join(', ')).join(' or ');
}
function busy(value) { running=value; buttons.forEach(button => { button.disabled = value || (!math && button.dataset.action!=='explain'); }); }
function reset() { mathLoad=resetMath(); return mathLoad; }
async function resetMath() {
  const token = ++generation; clearExplanation();
  busy(true); input.value = ''; answer.textContent = ''; canvas.hidden = true;
  document.querySelector('#graph-description').textContent = '';
  status.textContent = 'Starting a fresh session…';
  const previous = math; math = null;
  if (previous) await previous.shutdown().catch(() => {});
  try {
    const session = await createMath({manifestUrl: new URL('./numos-math-assets.json', import.meta.url)});
    if (token !== generation) { await session.shutdown(); return; }
    math = session; status.textContent = 'Ready. Start with something simple.'; busy(false);
  } catch(error) { if(token === generation) {status.textContent = 'Calculator unavailable; you can still ask for teaching help.';busy(false);} }
}
async function run(action) {
  if(action==='explain') { await explain(); return; }
  clearExplanation();
  if (!math || buttons[0].disabled) return;
  const text = input.value.trim(); if (!text) { status.textContent = 'Enter an expression first.'; return; }
  if (new TextEncoder().encode(text).length > 2000) { status.textContent = 'Please shorten the expression to 2,000 bytes or fewer.'; return; }
  const token = generation, version = explanationVersion, session = math; busy(true); status.textContent = 'Working…'; answer.textContent = ''; canvas.hidden = true;
  document.querySelector('#graph-description').textContent = '';
  try {
    if (action === 'graph') {
      const expression = text.replace(/^y\s*=\s*/i, '');
      const handle = await session.compile1D(expression, 'x');
      try {
        const values = await handle.evaluateMany(Array.from({length:721},(_,i)=>-10+i/36));
        if (token !== generation || version !== explanationVersion) return;
        drawGraph(canvas,values);canvas.hidden=false;
        document.querySelector('#graph-description').textContent='y = '+expression+'; viewing x and y from −10 to 10. Large jumps are left disconnected.';
      } finally { await handle.dispose().catch(()=>{}); }
    } else {
      const result = action === 'solve' ? await session.solve(text,'x') : await session[action](text);
      if (token !== generation || version !== explanationVersion) return;
      answer.textContent = action === 'solve' ? solveText(result.result) : result.displayText;
    }
    if (token === generation && version === explanationVersion) status.textContent = 'Done. Check the result against your working.';
  } catch(error) { if(token === generation && version === explanationVersion) status.textContent = error.code === 'TIME_LIMIT' || error.code === 'SHUTDOWN' ? 'That calculation stopped. Choose Clear session to start again.' : error.message; }
  finally { if(token === generation) busy(false); }
}
document.querySelector('#calculator').addEventListener('submit', event=>{event.preventDefault();void run('evaluate');});
buttons.filter(b=>b.type!=='submit').forEach(button=>button.addEventListener('click',()=>void run(button.dataset.action)));
document.querySelector('#clear').addEventListener('click',()=>{if(createMath) void reset(); else mathLoad=load();});
async function load() {
busy(true);
try {
  const manifestUrl = new URL('./numos-math-assets.json', import.meta.url);
  const response = await fetch(manifestUrl); if(!response.ok) throw Error('calculator files unavailable');
  const manifest = await response.json();
  const module = await import(new URL(manifest.assets.client.url, manifestUrl));
  createMath = module.createNumosMath; await reset();
} catch(error) { status.textContent='Could not load calculator: '+error.message+'. Choose Clear session to retry, or ask for teaching help.';busy(false); }
}
mathLoad=load();

void refreshTeachingModels();

for(const id of ["learning-context","teaching-model"]) document.getElementById(id).addEventListener("input",clearExplanation);

const classSelect=document.createElement('select');classSelect.id='learning-class';
const classLabel=document.createElement('label');classLabel.htmlFor='learning-class';classLabel.textContent='Your class';
document.querySelector('label[for="expression"]').before(classLabel,classSelect);
loadClasses().then(data=>{for(const id of data.classes){const option=document.createElement('option');option.value=id;option.textContent=data.classLabels?.[id]||id;classSelect.append(option);}if(!data.classes.length)status.textContent='No class is linked to this account yet.';}).catch(error=>{status.textContent=error.message;});
const dirtyPanels=new Set();
// Open editors are independent of the refreshable saved-work index. One editor
// owns each output's draft/version for the lifetime of this page.
const openedEditors=new Map(),pendingReopens=new Set();
const workEditors=document.createElement('div');workEditors.id='opened-work';
explanation.after(workEditors);
function focusEditor(editor){editor.scrollIntoView({block:'nearest'});(editor.querySelector('textarea:not(:disabled),select:not(:disabled),button:not(:disabled)')||editor).focus({preventScroll:true});}
window.addEventListener('beforeunload',event=>{if(dirtyPanels.size){event.preventDefault();event.returnValue='';}});
function mountFeedback(result,saved=null,container=null){
  if(!result.outputId||!result.revision)return;
  if(openedEditors.has(result.outputId)){focusEditor(openedEditors.get(result.outputId));return;}
  if(!container){
    container=document.createElement('section');container.dataset.outputId=result.outputId;
    const title=document.createElement('h2');title.textContent=result.title;container.append(title);
  }
  container.tabIndex=-1;
  const editorTitle=container.querySelector('h2');
  if(editorTitle){editorTitle.id='saved-output-title-'+result.outputId;container.setAttribute('aria-labelledby',editorTitle.id);}
  const panel=document.createElement('section');panel.className='feedback';
  const heading=document.createElement('h2');heading.textContent='Your notes and work';
  const description=document.createElement('p');description.textContent='Class: '+result.classId+'. Notes stay attached to this explanation.';
  panel.append(heading,description);
  const fields=[];
  function field(labelText,maxLength){const label=document.createElement('label'),field=document.createElement('textarea');field.maxLength=maxLength;label.textContent=labelText;label.append(field);panel.append(label);fields.push(field);return field;}
  let version=saved?.version||0,editing=0;
  const changed=()=>{dirtyPanels.add(panel);editing++;};
  const annotations=mountAnnotations(panel,result,saved?.feedback,{
    onChange:changed,
    async renderGraph(target,expression){
      if(!math&&mathLoad){
        let timer;
        try{await Promise.race([mathLoad,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The calculator is taking longer to start. Try Draw graph again.')),10000);})]);}
        finally{clearTimeout(timer);}
      }
      const session=math;
      if(!session)throw Error('The calculator is still starting. Try Draw graph again.');
      const handle=await session.compile1D(expression,'x');
      try{const values=await handle.evaluateMany(Array.from({length:721},(_,i)=>-10+i/36));drawGraph(target,values);}
      finally{await handle.dispose().catch(()=>{});}
    },
  });
  const work=field('Show your work or describe your approach',12000);
  const comment=field('What should we explain differently?',12000);
  const rating=document.createElement('select');rating.setAttribute('aria-label','How was this explanation?');
  for(const [value,label] of [['','Choose feedback'],['helpful','Helpful'],['confusing','Confusing'],['incorrect','I think something is incorrect']]){const option=document.createElement('option');option.value=value;option.textContent=label;rating.append(option);}
  panel.append(rating);fields.push(rating);
  if(saved?.feedback){
    work.value=saved.feedback.work||'';comment.value=saved.feedback.comment||'';rating.value=saved.feedback.rating||'';
  }
  panel.addEventListener('input',changed);
  const message=document.createElement('p');message.setAttribute('role','status');
  const draft=document.createElement('button'),submit=document.createElement('button');draft.type=submit.type='button';draft.textContent='Save draft';submit.textContent='Submit for review';
  async function send(submitted){
    if(annotations.pending()){message.textContent='Add or cancel your open comment. Draw any changed graph expression, or use Remove graph, before saving.';return;}
    annotations.setDisabled(true);
    draft.disabled=submit.disabled=true;fields.forEach(f=>f.disabled=true);const snapshot=editing;
    try{
      const response=await saveFeedback(result.outputId,{revision:result.revision,version,submit:submitted,feedback:{...annotations.value(),work:work.value,comment:comment.value,rating:rating.value}});
      version=response.version;if(editing===snapshot)dirtyPanels.delete(panel);
      message.textContent=response.submitted?'Submitted for review.':'Draft saved.';
      if(response.submitted){fields.forEach(f=>f.disabled=true);return;}
    }catch(error){message.textContent='Not saved. Your notes are still here. '+error.message;}
    annotations.setDisabled(false);
    draft.disabled=submit.disabled=false;fields.forEach(f=>f.disabled=false);
  }
  draft.onclick=()=>send(false);submit.onclick=()=>send(true);panel.append(draft,submit,message);
  // Keep prior work visible even when another explanation is requested.
  if(saved?.submitted){annotations.setDisabled(true);fields.forEach(f=>f.disabled=true);draft.disabled=submit.disabled=true;message.textContent='Submitted for review.';}
  container.append(panel);workEditors.append(container);openedEditors.set(result.outputId,container);
}

const reopen=document.createElement('button');reopen.type='button';reopen.textContent='Open saved work';
const savedList=document.createElement('div');savedList.id='saved-work-index';savedList.setAttribute('aria-live','polite');
classSelect.after(reopen,savedList);
let savedListVersion=0;
reopen.onclick=async()=>{
  const request=++savedListVersion;reopen.disabled=true;savedList.setAttribute('aria-busy','true');
  try{
    const {outputs}=await loadOutputs();
    if(request!==savedListVersion)return;
    const index=document.createDocumentFragment();
    if(!outputs.length)index.append(document.createTextNode('No saved explanations yet.'));
    for(const item of outputs){
      const button=document.createElement('button');button.type='button';button.textContent=item.title+' — '+item.classId;
      button.onclick=async()=>{
        if(openedEditors.has(item.outputId)){focusEditor(openedEditors.get(item.outputId));return;}
        if(pendingReopens.has(item.outputId))return;
        pendingReopens.add(item.outputId);button.disabled=true;
        try{
          const saved=await loadOutput(item.outputId);
          // A generated explanation or another view may have opened this output
          // while its saved snapshot was loading. Never replace its current draft.
          if(openedEditors.has(item.outputId)){focusEditor(openedEditors.get(item.outputId));return;}
          const panel=document.createElement('section');panel.dataset.outputId=item.outputId;
          const h=document.createElement('h2');h.textContent=saved.output.title;
          panel.append(h);
          mountFeedback({...saved.output,...item},saved,panel);
        }catch(error){status.textContent=error.message;}
        finally{pendingReopens.delete(item.outputId);button.disabled=false;}
      };
      index.append(button);
    }
    savedList.replaceChildren(index);
  }catch(error){if(request===savedListVersion)savedList.textContent=error.message;}
  finally{if(request===savedListVersion){reopen.disabled=false;savedList.removeAttribute('aria-busy');}}
};
