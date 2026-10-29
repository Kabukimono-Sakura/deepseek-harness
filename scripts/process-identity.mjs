import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
const exec=promisify(execFile);
export function matchesIdentity(info,executable,script){
  const normalize=value=>String(value??'').replaceAll('\\','/').toLowerCase();
  return Boolean(info&&normalize(info.ExecutablePath)===normalize(resolve(executable))&&(!script||normalize(info.CommandLine).includes(normalize(script))));
}
export async function isExpectedProcess(pid,executable,script){
  if(!Number.isSafeInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);}catch{return false;}
  if(process.platform!=='win32')return null;
  const source=`Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
  try{
    const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,timeout:5000,encoding:'utf8'});
    return matchesIdentity(stdout.trim()?JSON.parse(stdout):null,executable,script);
  }catch{return null;} // Unknown identity is never treated as a stale PID.
}
