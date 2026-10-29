import type {AvatarChoice} from './companion.ts';
import type {QqStore} from './qq-store.ts';
import {qqImageUrl} from '../channels/qq-images.ts';

export async function applyAvatar(options: {authorized:boolean;eventId:string;choice:AvatarChoice;store:QqStore;
  images?: {url?:string}[]; imageFile:(id:string)=>Promise<string>;
  request:(action:string,params:unknown)=>Promise<unknown>}): Promise<string> {
  const {store,eventId,choice}=options;
  if(!options.authorized)throw new Error('Avatar update requires the owner request');
  const existing=store.avatarAction(eventId);
  if(existing)return existing.state==='confirmed'?'头像修改接口此前已确认成功，本次未重复执行。':'先前头像操作结果尚不能确认，本次没有自动重试。';
  let file:string|undefined;
  try{file='stickerId' in choice?await options.imageFile(choice.stickerId):qqImageUrl(options.images?.[choice.imageIndex]?.url);}
  catch{return '选中的头像图片暂时下载失败，还没有修改头像。';}
  if(!file)return '没有可用的头像图片，还没有修改头像。';
  if(!store.beginAvatar(eventId,choice))return '该头像操作已经处理，本次没有重复执行。';
  try{
    await options.request('set_qq_avatar',{file});
    store.finishAvatar(eventId,'confirmed');
    return 'QQ 头像修改接口确认成功，已提交选定图片。客户端显示可能有缓存延迟；尚未核对客户端显示。';
  }catch{store.finishAvatar(eventId,'uncertain');return 'QQ 头像修改没有获得成功确认，不能说换好了。不要自动重试。';}
}
