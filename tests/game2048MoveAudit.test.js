import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://127.0.0.1:59999';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-test-key';
const { supabase } = await import('../src/services/supabaseClient.js');
const { default: router } = await import('../src/routes/game2048.js');
const { initStateForNewRun, calculateMove } = await import('../src/services/game2048Engine.js');
const { GAME2048_ENGINE_VERSION } = await import('../src/services/game2048Engine.js');

function fixture() {
  return { id:'audit-test-run',user_id:'audit-test-user',period_id:'current-week',seed:'123',...initStateForNewRun('123'),moves:1,current_score:0,status:'active',undo_used_count:0,undo_available:false,finished_reason:null,finished_at:null };
}
async function request(path, input, body={}) {
  let run=structuredClone(input);
  const writes=[], oldFrom=supabase.from;
  supabase.from=table=>{
    const filters=[]; let change=null, insertion=null, executed=false, result;
    const execute=()=>{
      if(executed)return result; executed=true;
      if(change){ writes.push({table,row:change}); if(table==='game_runs')run={...run,...change}; }
      if(insertion){ writes.push({table,row:insertion}); }
      let rows;
      if(table==='users') rows=[{id:run.user_id,telegram_id:123450987}];
      else if(table==='game_runs')rows=[run];
      else if(table==='weekly_periods')rows=[{id:run.period_id,status:'active',freeze_at:new Date(Date.now()+86400000).toISOString(),end_at:new Date(Date.now()+86400000).toISOString()}];
      else rows=insertion?[{id:'inserted',...insertion}]:[];
      return result={data:rows.filter(row=>filters.every(f=>f(row))),error:null};
    };
    return {
      select(){return this;},order(){return this;},limit(){return this;},
      eq(k,v){filters.push(row=>row[k]===v);return this;},
      update(row){change=row;return this;},insert(row){insertion=row;return this;},
      async maybeSingle(){const r=execute();return {...r,data:r.data[0]??null};},
      async single(){const r=execute();return {...r,data:r.data[0]??null};},
      then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);},
    };
  };
  const handler=router.stack.find(l=>l.route?.path===path).route.stack[0].handle;
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.body=data;return this;}};
  try{await handler({user:{telegram_id:123450987},body},res);return {res,run,writes};}
  finally{supabase.from=oldFrom;}
}
test('an active move adds its direction and events to the SAME game update',async()=>{
  const before=fixture(), dir=['left','up','right','down'].find(d=>calculateMove(before,d).moved);
  const expected=calculateMove(before,dir);
  const {res,run,writes}=await request('/run/move',before,{dir});
  assert.equal(res.statusCode,200); assert.equal(res.body.moved,true);
  assert.equal(writes.length,1); assert.equal(writes[0].table,'game_runs');
  assert.deepEqual(run.state,expected.state);
  assert.equal(run.audit_action.type,'move'); assert.equal(run.audit_action.dir,dir);
  assert.equal(run.audit_action.engine_version,GAME2048_ENGINE_VERSION);
  assert.deepEqual(run.audit_action.spawn,expected.spawn); assert.deepEqual(run.audit_action.durov_event,expected.durov_event);
});
test('a final move also records metadata without an extra journal request',async()=>{
  const before=fixture();
  before.state={grid:[[2,2,8,16],[32,64,128,256],[512,1024,2,4],[8,16,32,64]],durov:{cooldown:2}};
  assert.equal(calculateMove(before,'left').status,'finished');
  const {res,run,writes}=await request('/run/move',before,{dir:'left'});
  assert.equal(res.body.finished,true); assert.equal(run.audit_action.type,'move');
  assert.equal(writes.filter(w=>w.table==='game_runs').length,1);
  assert.equal(writes.some(w=>w.table==='game_run_events'),false);
});
test('a no-op move does not write or invent an action',async()=>{
  const before=fixture();before.state={grid:[[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],durov:{cooldown:0}};
  const {res,writes}=await request('/run/move',before,{dir:'left'});
  assert.equal(res.body.moved,false);assert.equal(writes.length,0);
});
test('Undo records its price and restoration in the same update',async()=>{
  const before=fixture();Object.assign(before,{undo_available:true,prev_state:{grid:[[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],durov:{cooldown:0}},prev_rng_index:4,prev_moves:0,prev_current_score:0,prev_status:'active',prev_finished_reason:null,prev_finished_at:null});
  const {res,run,writes}=await request('/run/undo',before);
  assert.equal(res.body.undone,true);assert.equal(writes.length,1);
  assert.equal(run.audit_action.type,'undo');assert.equal(run.audit_action.price,0);assert.equal(run.audit_action.payment_id,null);
  assert.deepEqual(run.state,before.prev_state);assert.equal(run.undo_used_count,1);
});
test('manual finish records its reason alongside the finish update',async()=>{
  const {res,run,writes}=await request('/run/finish',fixture(),{reason:'manual'});
  assert.equal(res.body.finished,true);assert.equal(run.status,'finished');
  assert.equal(run.audit_action.type,'finish');assert.equal(run.audit_action.reason,'manual');
  assert.equal(writes.filter(w=>w.table==='game_runs').length,1);
});
