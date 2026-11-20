import {mountAnnotations} from './annotations.js';
import {drawGraph} from './graph-view.js';
import {loadModels,requestExplanation,loadClasses,saveFeedback,loadOutputs,loadOutput} from './learning-steps.js';
const input = document.querySelector('#expression');
// Launch context is learner-provided text, not an identity or enrollment grant.
const launch = new URLSearchParams(window.location.hash.slice(1));
const launchText = (key,limit) => (launch.get(key)||'').slice(0,limit);
const lessonTitle=launchText('lessonTitle',160);
const learningContext=document.querySelector('#learning-context');
learningContext.value=launchText('context',3000);
input.value=launchText('problem',6000);
const lessonHeading=document.querySelector('#lesson-context');
lessonHeading.textContent=lessonTitle ? 'From your lesson: '+lessonTitle : 'Bring the question you are working on.';

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
    const result=await requestExplanation(text,learningContext.value,document.querySelector('#teaching-model').value,document.querySelector('#learning-class').value);
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
function reset(clearInput=true) { mathLoad=resetMath(clearInput); return mathLoad; }
async function resetMath(clearInput) {
  const token = ++generation; clearExplanation();
  busy(true); if(clearInput) input.value = ''; answer.textContent = ''; canvas.hidden = true;
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
  createMath = module.createNumosMath; await reset(false);
} catch(error) { status.textContent='Could not load calculator: '+error.message+'. Choose Clear session to retry, or ask for teaching help.';busy(false); }
}
mathLoad=load();

void refreshTeachingModels();

for(const id of ["learning-context","teaching-model"]) document.getElementById(id).addEventListener("input",clearExplanation);

const classSelect=document.createElement('select');classSelect.id='learning-class';
const classLabel=document.createElement('label');classLabel.htmlFor='learning-class';classLabel.textContent='Your class';
document.querySelector('.problem-context').before(classLabel,classSelect);
const classNames=new Map();
const className=id=>classNames.get(id)||'Your class';
function updateClassContext(){
  document.querySelector('#class-context').textContent=classSelect.value ? 'Working in '+className(classSelect.value) : 'Choose a linked class to save explanations.';
  document.querySelectorAll('[data-class-label]').forEach(element=>{element.textContent=className(element.dataset.classLabel);});
}
classSelect.addEventListener('change',()=>{clearExplanation();updateClassContext();});
const classContext=document.querySelector('#class-context');
classContext.setAttribute('role','status');
const retryClasses=document.createElement('button');retryClasses.type='button';retryClasses.textContent='Retry classes';retryClasses.hidden=true;
classContext.after(retryClasses);
let loadingClasses=false;
async function refreshClasses(){
  if(loadingClasses)return;
  loadingClasses=true;retryClasses.disabled=true;classSelect.disabled=true;
  classContext.textContent='Loading your linked classes…';
  try{
    const data=await loadClasses();
    if(!Array.isArray(data.classes)||data.classes.some(id=>typeof id!=='string'))throw Error('The class list could not be read. Please retry.');
    const previous=classSelect.value;
    classNames.clear();classSelect.replaceChildren();
    for(const id of data.classes){
      const name=typeof data.classLabels?.[id]==='string' ? data.classLabels[id] : 'Class '+(classNames.size+1);
      classNames.set(id,name);
      const option=document.createElement('option');option.value=id;option.textContent=name;classSelect.append(option);
    }
    const preferred=previous||launch.get('classId');
    if(classNames.has(preferred))classSelect.value=preferred;
    updateClassContext();
    retryClasses.hidden=true;
    if(!data.classes.length)classContext.textContent='No class is linked to this account yet. Ask your parent or teacher to link one.';
  }catch{
    classContext.textContent='Could not load your classes. Check your Silas connection or sign in/pair this device, then retry.';
    retryClasses.hidden=false;
  }finally{loadingClasses=false;retryClasses.disabled=false;classSelect.disabled=!classSelect.options.length;}
}
retryClasses.onclick=()=>void refreshClasses();
void refreshClasses();

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
  const description=document.createElement('p');const label=document.createElement('span');label.dataset.classLabel=result.classId;label.textContent=className(result.classId);
  description.append(label,document.createTextNode(' · Notes stay attached to this explanation.'));
  panel.append(heading,description);
  const fields=[];
  function field(labelText,maxLength){const label=document.createElement('label'),field=document.createElement('textarea');field.maxLength=maxLength;label.textContent=labelText;label.append(field);panel.append(label);fields.push(field);return field;}
  let version=saved?.version||0,editing=0;
  const changed=()=>{dirtyPanels.add(panel);editing++;workStates.set(result.outputId,'Unsaved changes');updateHistoryState(result.outputId);};
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
      workStates.set(result.outputId,response.submitted?'Submitted for review':'Draft saved');updateHistoryState(result.outputId);
      if(response.submitted){fields.forEach(f=>f.disabled=true);return;}
    }catch(error){message.textContent='Not saved. Your notes are still here. '+error.message;}
    annotations.setDisabled(false);
    draft.disabled=submit.disabled=false;fields.forEach(f=>f.disabled=false);
  }
  draft.onclick=()=>send(false);submit.onclick=()=>send(true);panel.append(draft,submit,message);
  // Keep prior work visible even when another explanation is requested.
  if(saved?.submitted){annotations.setDisabled(true);fields.forEach(f=>f.disabled=true);draft.disabled=submit.disabled=true;message.textContent='Submitted for review.';}
  container.append(panel);workEditors.append(container);openedEditors.set(result.outputId,container);
  workStates.set(result.outputId,saved?.submitted?'Submitted for review':saved?.version?'Draft saved':'Saved explanation');updateHistoryState(result.outputId);
}

const workStates=new Map();
function updateHistoryState(id){
  for(const card of document.querySelectorAll('.saved-work-card'))if(card.dataset.savedId===id){
    card.querySelector('.saved-work-status').textContent=workStates.get(id)||'Saved explanation';
  }
}
const reopen=document.createElement('button');reopen.type='button';reopen.textContent='Open saved work';reopen.setAttribute('aria-expanded','false');reopen.setAttribute('aria-controls','saved-work-history');
const history=document.createElement('section');history.id='saved-work-history';history.hidden=true;history.setAttribute('aria-label','Saved work');
const historyHeader=document.createElement('div');historyHeader.className='saved-work-header';
const historyTitle=document.createElement('h2');historyTitle.textContent='Saved work';
const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh saved work';
const close=document.createElement('button');close.type='button';close.textContent='Hide saved work';
const savedList=document.createElement('div');savedList.id='saved-work-index';savedList.setAttribute('aria-live','polite');
historyHeader.append(historyTitle,refresh,close);history.append(historyHeader,savedList);
classSelect.after(reopen,history);
let savedListVersion=0;
close.onclick=()=>{++savedListVersion;history.hidden=true;reopen.hidden=false;reopen.setAttribute('aria-expanded','false');refresh.disabled=false;savedList.removeAttribute('aria-busy');reopen.focus();};
async function refreshSavedWork(){
  const request=++savedListVersion;refresh.disabled=true;savedList.setAttribute('aria-busy','true');
  try{
    const {outputs}=await loadOutputs();
    if(request!==savedListVersion)return;
    const index=document.createDocumentFragment();
    if(!outputs.length)index.append(document.createTextNode('No saved explanations yet. Ask for steps to start.'));
    for(const item of outputs){
      const card=document.createElement('article');card.className='saved-work-card';card.dataset.savedId=item.outputId;
      const button=document.createElement('button');button.type='button';button.textContent=item.title||'Saved explanation';
      const meta=document.createElement('p');meta.className='saved-work-meta';
      const label=document.createElement('span');label.dataset.classLabel=item.classId;label.textContent=className(item.classId);meta.append(label);
      const date=new Date(item.created);
      if(item.created&&!Number.isNaN(date.getTime())){const time=document.createElement('time');time.dateTime=date.toISOString();time.textContent=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(date);meta.append(document.createTextNode(' · '),time);}
      const state=document.createElement('span');state.className='saved-work-status';state.textContent=workStates.get(item.outputId)||(item.submitted===true?'Submitted for review':Number.isInteger(item.version)&&item.version>0?'Draft saved':'Saved explanation');
      button.onclick=async()=>{
        if(openedEditors.has(item.outputId)){focusEditor(openedEditors.get(item.outputId));return;}
        if(pendingReopens.has(item.outputId))return;
        pendingReopens.add(item.outputId);button.disabled=true;
        try{
          const saved=await loadOutput(item.outputId);
          // A generated explanation may have opened this output during the read.
          // Keep one canonical draft, never replace it with a stale snapshot.
          if(openedEditors.has(item.outputId)){focusEditor(openedEditors.get(item.outputId));return;}
          const panel=document.createElement('section');panel.dataset.outputId=item.outputId;
          const h=document.createElement('h2');h.textContent=saved.output.title;panel.append(h);
          mountFeedback({...saved.output,...item},saved,panel);focusEditor(panel);
        }catch(error){status.textContent=error.message;}
        finally{pendingReopens.delete(item.outputId);button.disabled=false;}
      };
      card.append(button,meta,state);index.append(card);
    }
    savedList.replaceChildren(index);
  }catch(error){if(request===savedListVersion)savedList.textContent=error.message;}
  finally{if(request===savedListVersion){refresh.disabled=false;savedList.removeAttribute('aria-busy');}}
}
refresh.onclick=refreshSavedWork;
reopen.onclick=()=>{reopen.hidden=true;reopen.setAttribute('aria-expanded','true');history.hidden=false;close.focus();void refreshSavedWork();};
