import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueService } from '../src/common/queue.service';

for(const kind of ['process-webhook','send-whatsapp'])test(`interrupted ${kind} follows its safe recovery policy`,async()=>{
  const updates:any[]=[];let failures=0;
  const row={id:1,kind,attempts:1,lock_owner:'old-owner',payload:JSON.stringify({eventId:7,messageId:8})};
  const query:any={where(){return this},andWhere(){return this},select:async()=>[row],update:async(data:any)=>{updates.push(data);return 1}};
  const db:any=()=>query;db.transaction=async()=>null;
  const queue=new QueueService({db} as any);
  queue.setHandler(kind,async()=>{},async()=>{failures++});
  await queue.tick();
  assert.equal(updates[0].status,kind==='process-webhook'?'pending':'failed');
  assert.equal(failures,kind==='process-webhook'?0:1);
});

test('queue ranks opt-out webhooks and prepared sends before bulk recipient expansion', async () => {
  const order: string[] = [], handled: string[] = [];
  const row={id:10,kind:'send-whatsapp',attempts:0,payload:JSON.stringify({messageId:7})};
  const query:any={
    where(){return this;},andWhere(){return this;},whereIn(){return this;},
    select:async()=>[],delete:async()=>0,update:async()=>1,
    orderByRaw(sql:string){order.push(sql);return this;},orderBy(column:string){order.push(column);return this;},
    forUpdate(){return this;},skipLocked(){return this;},first:async()=>row,
  };
  const db:any=()=>query;db.transaction=async(callback:any)=>callback(db);
  const queue=new QueueService({db} as any);
  for(const kind of ['process-webhook','send-whatsapp','campaign-recipient'])queue.setHandler(kind,async()=>{handled.push(kind);});
  await queue.tick();
  assert.equal(order.length,2);assert.equal(order[1],'id');
  assert.match(order[0],/kind = 'process-webhook' THEN 0/);
  assert.match(order[0],/kind = 'send-whatsapp' THEN 1/);
  assert.match(order[0],/kind = 'campaign-recipient' THEN 3/);
  assert.deepEqual(handled,['send-whatsapp']);
});
