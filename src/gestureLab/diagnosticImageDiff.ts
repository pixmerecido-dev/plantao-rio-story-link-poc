import {inflateSync} from 'node:zlib';
import type {Box} from './core.js';
function decode(png:Buffer){
 if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PNG inválido.');
 let width=0,height=0,channels=0;const chunks:Buffer[]=[];
 for(let offset=8;offset+12<=png.length;){
  const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+length);
  if(offset+12+length>png.length)throw Error('PNG truncado.');
  if(type==='IHDR'){
   if(length!==13)throw Error('IHDR inválido.');width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===2?3:data[9]===6?4:0;
   if(data[8]!==8||!channels||data[10]!==0||data[11]!==0||data[12]!==0||width*height>20000000||width===0||height===0)throw Error('Formato PNG não suportado na análise de pixels.');
  }
  if(type==='IDAT')chunks.push(data);offset+=length+12;if(type==='IEND')break;
 }
 if(!channels||!chunks.length)throw Error('PNG sem dados.');
 const stride=width*channels,bytes=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});
 if(bytes.length!==(stride+1)*height)throw Error('Tamanho PNG inconsistente.');
 const pixels=Buffer.alloc(stride*height);
 for(let y=0;y<height;y++){
  const filter=bytes[y*(stride+1)]!;if(filter>4)throw Error('Filtro PNG inválido.');
  for(let x=0;x<stride;x++){
   const left=x>=channels?pixels[y*stride+x-channels]!:0,up=y?pixels[(y-1)*stride+x]!:0,ul=y&&x>=channels?pixels[(y-1)*stride+x-channels]!:0;
   const p=left+up-ul,pa=Math.abs(p-left),pb=Math.abs(p-up),pc=Math.abs(p-ul);
   const predicted=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):pa<=pb&&pa<=pc?left:pb<=pc?up:ul;
   pixels[y*stride+x]=(bytes[y*(stride+1)+1+x]!+predicted)&255;
  }
 }
 return {width,height,channels,pixels};
}
/** Pixel difference is a review cue; background animation may also change the ROI. */
export function diagnosticImageDiff(before:Buffer,after:Buffer,roi:Box){
 const a=decode(before),b=decode(after);
 if(a.width!==b.width||a.height!==b.height)throw Error('Dimensões das capturas mudaram.');
 const box={left:Math.max(0,Math.floor(roi.left)),top:Math.max(0,Math.floor(roi.top)),right:Math.min(a.width,Math.ceil(roi.right)),bottom:Math.min(a.height,Math.ceil(roi.bottom))};
 if(box.right<=box.left||box.bottom<=box.top)throw Error('ROI inválida.');
 let changed=0,total=0,absolute=0;
 for(let y=box.top;y<box.bottom;y++)for(let x=box.left;x<box.right;x++){
  let peak=0;for(let c=0;c<3;c++){const d=Math.abs(a.pixels[(y*a.width+x)*a.channels+c]!-b.pixels[(y*b.width+x)*b.channels+c]!);peak=Math.max(peak,d);absolute+=d;}
  if(peak>=20)changed++;total++;
 }
 return {roi:box,pixel_count:total,changed_pixels:changed,changed_ratio:changed/total,mean_absolute_channel_difference:absolute/(total*3),channel_threshold:20,interpretation:'PIXEL_CHANGE_NOT_PROOF_OF_STICKER_RESIZE'};
}
