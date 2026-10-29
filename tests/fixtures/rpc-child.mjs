import { createInterface } from 'node:readline';
const mode = process.argv[2];
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const request = JSON.parse(line);
  if (mode === 'coverage-env') { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:process.env.NODE_V8_COVERAGE??null})+'\n');continue; }
  if (mode === 'hang') continue;
  if (mode === 'exit') process.exit(1);
  if (mode === 'bad') { process.stdout.write('not-json\n'); continue; }
  if (mode === 'large') { process.stdout.write('a'.repeat(2048)); continue; }
  if (mode === 'error') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'secret-key-from-provider' } }) + '\n');
    continue;
  }
  // Split a UTF-8 character across writes to exercise the stream decoder.
  const output = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '你好' }) + '\n');
  const cut = output.indexOf(Buffer.from('你')) + 1;
  process.stdout.write(output.subarray(0, cut));
  await new Promise(resolve => setTimeout(resolve, 5));
  process.stdout.write(output.subarray(cut));
}
