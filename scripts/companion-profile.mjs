import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {once} from 'node:events';
import {projectRoot} from './project-env.mjs';
import {companionSettings,createCompanion} from './companion-runtime.mjs';
import {OneBotClient} from '../src/channels/onebot-client.ts';
process.loadEnvFile(join(projectRoot,'.env'));
const settings=companionSettings();
if(!settings)throw new Error('Companion is not configured');
const draftPath=join(projectRoot,'data/companion/profile-draft.json');
if(process.argv.includes('--generate')){
  const companion=createCompanion({settings,model:process.env.DEEPSEEK_MODEL||'deepseek-flash'});
  try{
    const bio=await companion.generate({id:JSON.stringify(['qq-onebot',settings.accountId,'private',settings.ownerId]),proactive:false},'初始设定已经确定了。现在请你自己给 QQ 写一句个人简介，写你自己愿意放在资料页上的话。',{bio:true});
    writeFileSync(draftPath,JSON.stringify({bio,generatedAt:new Date().toISOString(),model:process.env.DEEPSEEK_MODEL||'deepseek-flash'},null,2));
    console.log(JSON.stringify({generated:true,bio}));
  }finally{companion.close();}
}
if(process.argv.includes('--apply')){
  const draft=JSON.parse(readFileSync(draftPath,'utf8'));
  if(typeof draft.bio!=='string'||!draft.bio.trim()||draft.bio.length>120)throw new Error('Invalid bio draft');
  const config=JSON.parse(readFileSync(join(projectRoot,'config/local.json'),'utf8')).qq;
  if(config.accountId!==settings.accountId)throw new Error('Account mismatch');
  const client=new OneBotClient({url:config.url,token:process.env[config.tokenEnv],accountId:config.accountId});
  try{
    const ready=once(client,'ready');client.start();
    await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('QQ login required')),15000).unref())]);
    const before=await client.request('get_stranger_info',{user_id:config.accountId,no_cache:true});
    const backup=join(projectRoot,'data/companion/profile-before-bio.json');
    if(!existsSync(backup))writeFileSync(backup,JSON.stringify(before),{flag:'wx'});
    await client.request('set_qq_profile',{nickname:before.nickname,personal_note:draft.bio});
    const after=await client.request('get_stranger_info',{user_id:config.accountId,no_cache:true});
    const note=after.long_nick??after.personal_note??after.longNick;
    const verified=note===draft.bio;
    writeFileSync(join(projectRoot,'data/companion/profile-result.json'),JSON.stringify({appliedAt:new Date().toISOString(),bio:draft.bio,nickname:after.nickname,verified}));
    console.log(JSON.stringify({applied:true,verified,bio:draft.bio,nickname:after.nickname}));
    if(!verified)process.exitCode=1;
  }finally{client.stop();}
}
