import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { articleHash, disclosure, validateArticle } from '../src/wechat/article.mjs';
import { main as wechat, mediaHash } from './wechat.mjs';
import { projectRoot } from './project-env.mjs';
import { approvesCurrentDraft, classifyEditorialIntent, editorialCue } from './qq-editor-intent.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const help = '直接跟我说想写什么就行，比如「给公众号写篇整理书桌的小文章」。看完可以说「开头短一点」或「这版放进草稿箱吧」。';
export function parseEditorialCommand(message) {
  const text = message.trim();
  const create = text.match(/^(?:公众号写稿|(?:请)?(?:帮我)?写一篇公众号(?:文章|推文))(?:[：:，,\s]+)([\s\S]+)$/u);
  if (create) return { action: 'create', brief: create[1].trim() };
  const natural = text.match(/^(?:请)?(?:帮我)?写一篇关于(.+?)的公众号(?:推文|文章)[。！]?$/u);
  if (natural) return { action: 'create', brief: natural[1].trim() };
  const revise = text.match(/^公众号改稿\s+([0-9a-f]{12})\s+([\s\S]+)$/i);
  if (revise) return { action: 'revise', code: revise[1].toLowerCase(), brief: revise[2].trim() };
  const use = text.match(/^(查看稿件|确认入草稿箱)\s+([0-9a-f]{12})$/i);
  if (use) return { action: use[1] === '查看稿件' ? 'view' : 'upload', code: use[2].toLowerCase() };
  if (/^(公众号(?:帮助|改稿)|查看稿件|确认入草稿箱)$/.test(text)) return { action: 'help' };
  return null;
}

export function createQqEditor({settings, root=projectRoot, run=wechat, classify=classifyEditorialIntent, delivered,
  config=()=>read(join(root,'config/local.json')).wechatMp, appid=()=>process.env.WECHAT_MP_APP_ID}) {
  const owner = JSON.stringify(['qq-onebot',settings.accountId,'private',settings.ownerId]);
  const base = join(root,'data/wechat');
  const reviews = join(base,'qq-reviews');
  const cover = join(root,'assets/wechat/qq-cover.png');
  const directory = id => join(base,'articles',id);
  function contextFile() {
    return join(reviews, 'conversation-' + hash(JSON.stringify([owner,appid()])) + '.json');
  }
  function context() {
    const file = contextFile();
    let state;
    try { state=read(file); } catch { return {recent:[]}; }
    if (!Array.isArray(state?.recent)) return {recent:[]};
    if (Date.now() - state.updated < 86400000) return state;
    return {recent:state.recent};
  }
  function save(state) {
    mkdirSync(reviews,{recursive:true});
    const file = contextFile();
    writeFileSync(file + '.tmp',JSON.stringify({...state,updated:Date.now()}));
    renameSync(file + '.tmp',file);
  }
  function show(review,state,eventId) {
    const entry = {code:review.code,title:review.article.title};
    save({current:review.code,eventId,recent:[entry,...state.recent.filter(item=>item.code!==entry.code)].slice(0,8)});
    return preview(review);
  }
  function choose(state) {
    if (!state.recent.length) {
      save({recent:[],asking:true});
      return '手头还没有审阅稿，你想让我写什么？';
    }
    save({recent:state.recent,choosing:true});
    return '你指哪一版呀？回我序号就能重新看全文。\n' +
      state.recent.map((item,i)=>(i+1)+'．《'+item.title+'》 '+item.code).join('\n');
  }

  function snapshot(id) {
    const dir = directory(id);
    const article = validateArticle(read(join(dir,'article.json')));
    const stamp = hash(JSON.stringify([owner,appid(),id,articleHash(article),mediaHash(dir,article)]));
    return {article, stamp, code:stamp.slice(0,12)};
  }
  function loadReview(code) {
    const file = join(reviews,code+'.json');
    if (!existsSync(file)) return null;
    const record = read(file);
    if (record.owner !== owner || !/^qq-[a-f0-9]{24}$/.test(record.id)) return null;
    const current = snapshot(record.id);
    if (current.stamp !== record.stamp || current.code !== code) return null;
    return {...current,id:record.id};
  }
  function preview({article,code,id}) {
    const sections = [article.title,'微信作者栏：'+(article.wechatAuthor??article.author),'摘要：'+article.digest,disclosure,
      ...article.paragraphs,...article.sources.map(s=>s.title+' '+s.url)];
    const body = sections.join('\n\n');
    const chunks = body.match(/[\s\S]{1,1600}/gu)??[];
    return {bubbles:[...chunks.map(text=>({text})),{stickerId:'wechat-editor-cover-'+id},{text:'稿号 '+code+'。上图是封面。想改哪里直接告诉我，满意了就说「这版放进草稿箱吧」。'}]};
  }
  return {
    imageFile(key){
      const match=/^wechat-editor-cover-(qq-[0-9a-f]{24})$/.exec(key);
      return match ? pathToFileURL(join(directory(match[1]),'cover.png')).href : null;
    },
    handles(message){
      if (message.conversationId!==owner || message.source==='proactive') return false;
      const state=context();
      return Boolean(parseEditorialCommand(message.text) || editorialCue.test(message.text) || state.current || state.asking || state.choosing);
    },
    async handle(conversation,text) {
      if (conversation.proactive || conversation.id!==owner) return null;
      let command=parseEditorialCommand(text);
      if (command?.action==='help') return help;
      try {
        const state=context();
        if (!command) {
          if (!state.current && !state.asking && !state.choosing && !editorialCue.test(text)) return null;
          const selection=state.choosing && /^\s*([1-8])\s*$/.exec(text);
          const followup = state.confirm && state.confirm===state.current &&
            /^(?:对|嗯嗯?|好(?:的|啊)?|可以|确认|是的|存吧|放吧|没问题)[。！!～~\s]*$/u.test(text.trim());
          if (state.confirm) save({...state,confirm:null});
          if (followup && (!delivered || (delivered(state.eventId) && delivered(state.questionId)))) {
            command={action:'upload',code:state.confirm};
          } else if (selection) {
            const entry=state.recent[Number(selection[1])-1];
            if (!entry) return choose(state);
            command={action:'view',code:entry.code};
          } else {
            const intent=await classify(text,{current:state.current??null,recent:state.recent,awaitingTopic:Boolean(state.asking),choosing:Boolean(state.choosing)});
            if (intent.action==='chat') {
              if (state.asking || state.choosing) save({recent:state.recent,current:state.current,eventId:state.eventId});
              return null;
            }
            if (intent.action==='publish') return '我可以先把审过的文章存进草稿箱，发表需要你在微信后台操作。';
            if (intent.action==='askTopic') {
              save({recent:state.recent,asking:true,initialBrief:text.slice(0,6000)});
              return '好呀，想写点什么？告诉我主题，或者丢几条可以公开的素材给我。';
            }
            if (intent.action==='create') command={action:'create',brief:state.asking && state.initialBrief ? state.initialBrief+'\n'+text : text};
            else {
              const code=intent.code==='current' || !intent.code ? state.current : intent.code;
              if (intent.action==='choose' || !state.recent.some(item=>item.code===code)) return choose(state);
              command={action:intent.action,code,brief:text};
              if (command.action==='upload') {
                if (code!==state.current || (delivered && !delivered(state.eventId))) command={action:'view',code};
                else if (!approvesCurrentDraft(text)) {
                  save({...state,confirm:code,questionId:conversation.eventId});
                  return '是要现在把《'+state.recent.find(item=>item.code===code).title+'》这一版存进公众号草稿箱吗？';
                }
              }
            }
          }
        }
        if (!config()?.enabled || !appid()) return '公众号接入未配置，请先检查本机配置。';
        const previous=command.code?loadReview(command.code):null;
        if (command.code && !previous) return '稿号无效，或审核后的内容、封面、目标账号已变化。请重新发起写稿。';
        if (command.action==='view') return show(previous,state,conversation.eventId);
        if (command.action==='upload') {
          await run(['probe']);
          await run(['approve',previous.id,articleHash(previous.article)]);
          const receipt=await run(['upload',previous.id]);
          if (!receipt.media_id) return '微信没有返回草稿回执，请在后台核对。';
          return '《'+previous.article.title+'》已存入「'+config().accountName+'」草稿箱，稿号 '+previous.code+'。可在微信后台预览和发表。';
        }
        if (!conversation.eventId || !command.brief || command.brief.length>6000) return '请将选题、公开资料或修改意见控制在 6000 字以内。';
        const id='qq-'+hash(JSON.stringify([owner,conversation.eventId])).slice(0,24);
        const dir=directory(id);
        mkdirSync(dir,{recursive:true});
        if (!existsSync(join(dir,'article.json'))) {
          const briefFile=join(dir,'brief.json');
          const brief={topic:command.brief,sources:previous?.article.sources??[]};
          if (previous) brief.previousArticle=previous.article;
          writeFileSync(briefFile,JSON.stringify(brief));
          await run(['generate',id,briefFile]);
        }
        if (!existsSync(join(dir,'cover.png'))) copyFileSync(cover,join(dir,'cover.png'));
        const current=snapshot(id);
        mkdirSync(reviews,{recursive:true});
        const ref=join(reviews,current.code+'.json');
        if (!existsSync(ref)) writeFileSync(ref,JSON.stringify({id,owner,stamp:current.stamp}),{flag:'wx'});
        if (!loadReview(current.code)) throw Error('invalid review');
        return show({...current,id},state,conversation.eventId);
      } catch (error) {
        if (error.code===40164) return '微信要求更新出口 IP 白名单。'+(error.requiredWhitelistIp??'请在本机运行公众号连接检查。');
        if (!command) return '我一时没听准你是不是在说公众号稿件，可以再说一遍吗？';
        if (command.action==='upload') return '本次未取得草稿成功回执，请先核对微信草稿箱和本机上传记录。'+(Number.isInteger(error.code)?' 微信错误码 '+error.code:'');
        return '本次未能准备审阅稿。请检查 DSH 和公众号配置，再发送选题或稿号。';
      }
    }
  };
}
