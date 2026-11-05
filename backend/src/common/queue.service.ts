import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from './database.service';
type Handler=(payload:any)=>Promise<void>;
@Injectable()
export class QueueService implements OnModuleInit,OnModuleDestroy {
  private handlers=new Map<string,Handler>();private timer?:NodeJS.Timeout;private running=false;
  private failureHandlers=new Map<string,(payload:any,error?:unknown)=>Promise<void>>();
  private readonly logger=new Logger(QueueService.name);
  constructor(private readonly database:DatabaseService){}
  setHandler(kind:string,handler:Handler,onFailed?:(payload:any,error?:unknown)=>Promise<void>){this.handlers.set(kind,handler);if(onFailed)this.failureHandlers.set(kind,onFailed);}
  async enqueue(kind:string,payload:Record<string,unknown>,availableAt=new Date()):Promise<void>{
    await this.database.db('node_jobs').insert({kind,payload:JSON.stringify(payload),available_at:availableAt,status:'pending',attempts:0,created_at:new Date()});
  }
  onModuleInit(){if(process.env.NODE_WORKER_ENABLED!=='false')this.timer=setInterval(()=>void this.tick(),1000);}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async tick():Promise<void>{
    if(this.running||!this.handlers.size)return;this.running=true;
    try {
      const interrupted=await this.database.db('node_jobs').where('status','processing').andWhere('locked_at','<',new Date(Date.now()-300000)).select('*');
      for(const row of interrupted){
        const retryWebhook=row.kind==='process-webhook'&&Number(row.attempts)<5;
        const claimed=await this.database.db('node_jobs').where({id:row.id,status:'processing',lock_owner:row.lock_owner}).update({status:retryWebhook?'pending':'failed',available_at:new Date(),lock_owner:null,last_error:retryWebhook?'worker_interrupted_retrying':'worker_interrupted_review_required'});
        if(claimed&&!retryWebhook)await this.failureHandlers.get(row.kind)?.(typeof row.payload==='string'?JSON.parse(row.payload):row.payload,new Error('worker_interrupted'));
      }
      const job=await this.database.db.transaction(async trx=>{
        // Deliver prepared messages and apply opt-outs before expanding another bulk recipient.
        const row=await trx('node_jobs').where('status','pending').andWhere('available_at','<=',new Date()).whereIn('kind',[...this.handlers.keys()]).orderByRaw("CASE WHEN kind = 'process-webhook' THEN 0 WHEN kind = 'send-whatsapp' THEN 1 WHEN kind = 'campaign-recipient' THEN 3 ELSE 2 END").orderBy('id').forUpdate().skipLocked().first();
        if(!row)return null;const owner=randomUUID();await trx('node_jobs').where('id',row.id).update({status:'processing',locked_at:new Date(),lock_owner:owner,attempts:Number(row.attempts)+1});return {...row,lock_owner:owner};
      });
      if(!job)return;
      try{await this.handlers.get(job.kind)!(typeof job.payload==='string'?JSON.parse(job.payload):job.payload);await this.database.db('node_jobs').where({id:job.id,lock_owner:job.lock_owner}).update({status:'complete',completed_at:new Date()});}
      catch(error){const terminal=Number(job.attempts)>=4;await this.database.db('node_jobs').where({id:job.id,lock_owner:job.lock_owner}).update({status:terminal?'failed':'pending',available_at:new Date(Date.now()+30000),last_error:'job_failed',lock_owner:null});if(terminal)await this.failureHandlers.get(job.kind)?.(typeof job.payload==='string'?JSON.parse(job.payload):job.payload,error);}
      await this.database.db('node_sessions').where('expires_at','<',new Date()).delete();
    }catch{this.logger.warn('Queue unavailable; run the additive database migration and verify database connectivity.');}
    finally{this.running=false;}
  }
}
