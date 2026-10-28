import { setTimeout } from 'node:timers/promises';
import { PetClient, PetPresenter } from '../src/channels/pet.ts';
const pet = new PetPresenter(new PetClient('http://127.0.0.1:3847'), () => {
  console.error('桌宠联动不可用。请先运行 npm run pet。');
  process.exitCode = 1;
});
try {
  await pet.thinking();
  await setTimeout(1500);
  await pet.reply('本地对话桥接已经准备好啦。这是显示测试，没有调用模型。');
  await setTimeout(10_000);
} finally { await pet.close(); }
