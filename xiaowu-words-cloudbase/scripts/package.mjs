import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const entries = [];
async function collect(directory, target) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const source = resolve(directory, item.name), name = target + item.name;
    if (item.isDirectory()) await collect(source, name + '/');
    else if (item.isFile()) entries.push({ name, body: await readFile(source), executable: item.name === 'scf_bootstrap' });
  }
}
for (const name of ['server.mjs','scf_bootstrap']) entries.push({name,body:await readFile(resolve(root,name)),executable:name==='scf_bootstrap'});
await collect(resolve(root,'lib'),'lib/');
await collect(resolve(root,'dist/public'),'public/');
entries.push({name:'package.json',body:Buffer.from(JSON.stringify({name:'xiaowu-words-http',version:'0.1.1',private:true,type:'module',engines:{node:'>=22.21.0'},scripts:{start:'node server.mjs'}},null,2))});
// Stored ZIP built with Node only; no native dependency is needed by the cloud function.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc ^ 0xffffffff) >>> 0;
}
const local=[], central=[];let offset=0;
for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
  const name=Buffer.from(entry.name), body=entry.body, checksum=crc32(body);
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);
  head.writeUInt16LE(0x21,12);head.writeUInt32LE(checksum,14);head.writeUInt32LE(body.length,18);head.writeUInt32LE(body.length,22);head.writeUInt16LE(name.length,26);
  local.push(head,name,body);
  const item=Buffer.alloc(46);item.writeUInt32LE(0x02014b50);item.writeUInt16LE(0x0314,4);item.writeUInt16LE(20,6);item.writeUInt16LE(0x800,8);
  item.writeUInt16LE(0x21,14);item.writeUInt32LE(checksum,16);item.writeUInt32LE(body.length,20);item.writeUInt32LE(body.length,24);item.writeUInt16LE(name.length,28);
  item.writeUInt32LE(((entry.executable?0o100755:0o100644)<<16)>>>0,38);item.writeUInt32LE(offset,42);
  central.push(item,name);offset+=head.length+name.length+body.length;
}
const listing=Buffer.concat(central),end=Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(listing.length,12);end.writeUInt32LE(offset,16);
const archive=Buffer.concat([...local,listing,end]);
const destination=resolve(root,'release/xiaowu-words-cloudbase-http.zip');
await mkdir(resolve(root,'release'),{recursive:true});await writeFile(destination,archive);
console.log(`${relative(root,destination)}: ${entries.length} files, ${archive.length} bytes; no credentials or user records included.`);
